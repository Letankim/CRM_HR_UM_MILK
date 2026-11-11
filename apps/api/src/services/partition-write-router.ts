import type { ZodType, ZodTypeDef } from 'zod';
import { PARTITION_MONTH_REGEX } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { TableStore, type BaseRecord } from '../sheets/table-store.js';
import { ensureMonthlyTarget, readPartitionRegistry } from './data-partition.service.js';
import { invalidateHistoricalShiftsCache } from './historical-shifts-loader.js';

export type MonthlyTableName = 'SHIFT_ASSIGNMENTS' | 'LEAVE_REQUESTS' | 'SHIFT_SWAPS' | 'ATTENDANCE_EVENTS' | 'ATTENDANCE_ADJUSTMENTS';

const partitionStoreCache = new WeakMap<Database, Map<string, TableStore<BaseRecord>>>();
const partitionStoreInFlight = new WeakMap<Database, Map<string, Promise<TableStore<BaseRecord>>>>();

export async function invalidatePartitionStoreCache(db: Database): Promise<void> {
  const cache = partitionStoreCache.get(db);
  partitionStoreInFlight.delete(db);
  if (!cache) return;
  partitionStoreCache.delete(db);
  await Promise.all(Array.from(cache.values()).map((s) => s.flushPending().catch(() => undefined)));
}

export function nextPartitionCode<T extends BaseRecord>(store: TableStore<T>, prefix: string, codeField: keyof T & string): string {
  let maxNum = 0;
  for (const row of store.all(true)) {
    const raw = String((row as Record<string, unknown>)[codeField] ?? '');
    if (raw.startsWith(prefix)) {
      const n = Number.parseInt(raw.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  const next = Math.max(maxNum + 1, store.all(true).length + 1);
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export function extractMonthKeyFromDate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.match(/^(\d{4})[-_](\d{2})/);
  const key = m ? `${m[1]}_${m[2]}` : '';
  return PARTITION_MONTH_REGEX.test(key) ? key : '';
}

export function resolveTargetMonthForRecord(db: Database, tableName: MonthlyTableName, record: Record<string, unknown>, dateHint?: string | null): string {
  const registry = readPartitionRegistry(db);
  if (!db.partitionMonth && registry.length === 0) return '';

  const linkedShiftId = String(record.assignment_id || record.from_assignment_id || '').trim();
  if (linkedShiftId) {
    for (const reg of registry) {
      if (getCachedPartitionStore(db, 'SHIFT_ASSIGNMENTS', reg.monthKey)?.get(linkedShiftId)) return reg.monthKey;
    }
  }

  const dateField = tableName === 'LEAVE_REQUESTS' ? 'leave_date' : tableName === 'SHIFT_SWAPS' ? 'from_work_date' : 'work_date';
  const candidate = extractMonthKeyFromDate(dateHint) || extractMonthKeyFromDate(typeof record[dateField] === 'string' ? (record[dateField] as string) : null);
  if (!candidate) {
    if (registry.length > 0 && !registry.some((r) => r.monthKey === db.partitionMonth)) {
      return [...registry].sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0]!.monthKey;
    }
    return db.partitionMonth;
  }
  if (registry.some((r) => r.monthKey === candidate)) return candidate;
  if (registry.length > 0) {
    const latestMonth = [...registry].sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0]!.monthKey;
    if (candidate >= latestMonth) return latestMonth;
  }
  if (candidate === db.partitionMonth) return candidate;
  if (linkedShiftId && db.shiftAssignments.get(linkedShiftId)) return db.partitionMonth;
  return db.partitionMonth;
}

export function getCachedPartitionStore<T extends BaseRecord>(
  db: Database,
  tableName: MonthlyTableName,
  monthKey: string,
): TableStore<T> | undefined {
  if (monthKey === db.partitionMonth) {
    const desc = db.monthlyStores().find((m) => m.base === tableName);
    return desc?.store as unknown as TableStore<T>;
  }
  const cache = partitionStoreCache.get(db);
  return cache?.get(`${tableName}::${monthKey}`) as unknown as TableStore<T> | undefined;
}

function getStoreDescriptor(db: Database, tableName: MonthlyTableName) {
  const desc = db.monthlyStores().find((m) => m.base === tableName);
  if (!desc) throw new Error(`Không tìm thấy cấu hình bảng phân vùng: ${tableName}`);
  return desc;
}

export async function getPartitionStore<T extends BaseRecord>(
  db: Database,
  tableName: MonthlyTableName,
  monthKey: string,
  actorId = 'system',
): Promise<TableStore<T>> {
  const desc = getStoreDescriptor(db, tableName);
  const cacheKey = `${tableName}::${monthKey}`;
  if (monthKey === db.partitionMonth) {
    partitionStoreCache.get(db)?.delete(cacheKey);
    return desc.store as unknown as TableStore<T>;
  }
  let cache = partitionStoreCache.get(db);
  if (!cache) {
    cache = new Map();
    partitionStoreCache.set(db, cache);
  }
  const existing = cache.get(cacheKey);
  if (existing) return existing as unknown as TableStore<T>;

  let inFlight = partitionStoreInFlight.get(db);
  if (!inFlight) {
    inFlight = new Map();
    partitionStoreInFlight.set(db, inFlight);
  }
  const pending = inFlight.get(cacheKey);
  if (pending) return pending as unknown as Promise<TableStore<T>>;

  const promise = (async () => {
    try {
      const target = await ensureMonthlyTarget(db, monthKey, actorId, false);
      const targetRef = target.targetFor(desc);
      const store = new TableStore<BaseRecord>(db.gateway, db.queue, {
        spreadsheetKey: 'MONTHLY',
        spreadsheetId: targetRef.spreadsheetId,
        tab: targetRef.tab,
        headers: desc.headers,
        schema: desc.schema as unknown as ZodType<BaseRecord, ZodTypeDef, unknown>,
      });
      await store.load();
      cache.set(cacheKey, store);
      return store;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();
  inFlight.set(cacheKey, promise);
  return promise as unknown as Promise<TableStore<T>>;
}

export async function preloadEmployeePartitionStores(db: Database): Promise<string[]> {
  const registry = readPartitionRegistry(db);
  const months = registry.length > 0
    ? Array.from(new Set([db.partitionMonth, ...registry.map((r) => r.monthKey)].filter(Boolean)))
    : Array.from(new Set(['', db.partitionMonth]));
  if (months.length === 0) return [''];
  const tables: MonthlyTableName[] = ['SHIFT_ASSIGNMENTS', 'LEAVE_REQUESTS', 'SHIFT_SWAPS', 'ATTENDANCE_EVENTS', 'ATTENDANCE_ADJUSTMENTS'];
  await Promise.all(
    months.flatMap((mk) =>
      mk === db.partitionMonth ? [] : tables.map((t) => getPartitionStore(db, t, mk).catch(() => undefined)),
    ),
  );
  return months;
}

export type PartitionRecord = BaseRecord & Record<string, unknown>;

export async function insertPartitionAwareRecord<T extends BaseRecord = PartitionRecord>(
  db: Database,
  tableName: MonthlyTableName,
  record: Record<string, unknown>,
  dateHint: string | null,
  actorId: string,
): Promise<T> {
  const targetMonth = resolveTargetMonthForRecord(db, tableName, record, dateHint);
  const store = await getPartitionStore<T>(db, tableName, targetMonth, actorId);
  const inserted = await store.insert(record as never, actorId);
  if (tableName === 'SHIFT_ASSIGNMENTS') invalidateHistoricalShiftsCache(db);
  return inserted;
}

export async function findPartitionAwareRecord<T extends BaseRecord = PartitionRecord>(
  db: Database,
  tableName: MonthlyTableName,
  id: string,
  dateHint?: string | null,
): Promise<{ record: T; monthKey: string; store: TableStore<T> } | undefined> {
  const desc = getStoreDescriptor(db, tableName);
  const targetMonth = dateHint ? resolveTargetMonthForRecord(db, tableName, {}, dateHint) : '';
  if (targetMonth && targetMonth !== db.partitionMonth) {
    const store = await getPartitionStore<T>(db, tableName, targetMonth);
    const r = store.get(id);
    if (r && !r.is_deleted) return { record: r, monthKey: targetMonth, store };
  }
  const activeRecord = (desc.store as unknown as TableStore<T>).get(id);
  if (activeRecord && !activeRecord.is_deleted) {
    return { record: activeRecord, monthKey: db.partitionMonth, store: desc.store as unknown as TableStore<T> };
  }
  const registry = readPartitionRegistry(db);
  for (const reg of registry) {
    if (reg.monthKey === db.partitionMonth || reg.monthKey === targetMonth) continue;
    const store = await getPartitionStore<T>(db, tableName, reg.monthKey);
    const r = store.get(id);
    if (r && !r.is_deleted) return { record: r, monthKey: reg.monthKey, store };
  }
  if (db.partitionMonth !== '') {
    const rootStore = await getPartitionStore<T>(db, tableName, '');
    const r = rootStore.get(id);
    if (r && !r.is_deleted) return { record: r, monthKey: '', store: rootStore };
  }
  return undefined;
}

export async function updatePartitionAwareRecord<T extends BaseRecord = PartitionRecord>(
  db: Database,
  tableName: MonthlyTableName,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  dateHint: string | null,
  actorId: string,
): Promise<T> {
  const found = await findPartitionAwareRecord<T>(db, tableName, id, dateHint);
  if (!found) {
    const desc = getStoreDescriptor(db, tableName);
    return (desc.store as unknown as TableStore<T>).update(id, expectedVersion, patch as never, actorId);
  }
  const updated = await found.store.update(id, expectedVersion, patch as never, actorId);
  if (tableName === 'SHIFT_ASSIGNMENTS') invalidateHistoricalShiftsCache(db);
  return updated;
}
