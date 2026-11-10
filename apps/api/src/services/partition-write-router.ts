import type { ZodType, ZodTypeDef } from 'zod';
import { PARTITION_MONTH_REGEX, type AttendanceAdjustment, type AttendanceEvent, type LeaveRequest, type ShiftAssignment, type ShiftSwap } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { TableStore, type BaseRecord } from '../sheets/table-store.js';
import { ensureMonthlyTarget, readPartitionRegistry } from './data-partition.service.js';
import { invalidateHistoricalShiftsCache } from './historical-shifts-loader.js';

export type MonthlyTableName =
  | 'SHIFT_ASSIGNMENTS'
  | 'LEAVE_REQUESTS'
  | 'SHIFT_SWAPS'
  | 'ATTENDANCE_EVENTS'
  | 'ATTENDANCE_ADJUSTMENTS';

const partitionStoreCache = new WeakMap<Database, Map<string, TableStore<BaseRecord>>>();

export function extractMonthKeyFromDate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.match(/^(\d{4})[-_](\d{2})/);
  if (!m) return '';
  const key = `${m[1]}_${m[2]}`;
  return PARTITION_MONTH_REGEX.test(key) ? key : '';
}

export function resolveTargetMonthForRecord(
  db: Database,
  tableName: MonthlyTableName,
  record: Record<string, unknown>,
  dateHint?: string | null,
): string {
  if (!db.partitionMonth) {
    return '';
  }
  if (dateHint) {
    const k = extractMonthKeyFromDate(dateHint);
    if (k) return k;
  }
  const dateField =
    tableName === 'LEAVE_REQUESTS' ? 'leave_date' :
    tableName === 'SHIFT_SWAPS' ? 'from_work_date' :
    'work_date';
  const val = record[dateField];
  const parsed = extractMonthKeyFromDate(typeof val === 'string' ? val : null);
  return parsed || db.partitionMonth;
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
  if (monthKey === db.partitionMonth) {
    return desc.store as unknown as TableStore<T>;
  }
  let cache = partitionStoreCache.get(db);
  if (!cache) {
    cache = new Map();
    partitionStoreCache.set(db, cache);
  }
  const cacheKey = `${tableName}::${monthKey}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing as unknown as TableStore<T>;

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
  return store as unknown as TableStore<T>;
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
  const activeRecord = (desc.store as unknown as TableStore<T>).get(id);
  if (activeRecord && !activeRecord.is_deleted) {
    return { record: activeRecord, monthKey: db.partitionMonth, store: desc.store as unknown as TableStore<T> };
  }
  const targetMonth = dateHint ? extractMonthKeyFromDate(dateHint) : '';
  if (targetMonth && targetMonth !== db.partitionMonth) {
    const store = await getPartitionStore<T>(db, tableName, targetMonth);
    const r = store.get(id);
    if (r && !r.is_deleted) return { record: r, monthKey: targetMonth, store };
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
