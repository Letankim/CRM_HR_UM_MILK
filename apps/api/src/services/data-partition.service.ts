import { DRIVE_FOLDERS, OPERATION_SETTING_KEYS, PARTITION_MONTH_REGEX, SPREADSHEETS, parsePartitionRegistry, partitionTabName, type MonthlyPartitionMode, type MonthlyPartitionRegistryEntry } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import type { BaseRecord, TableStore } from '../sheets/table-store.js';
import { saveOperationSettings } from './operations-settings.service.js';

type AnyStore = TableStore<BaseRecord & Record<string, unknown>>;
type MonthlyStoreDesc = ReturnType<Database['monthlyStores']>[number];

export interface PartitionListItem {
  monthKey: string; label: string; isActive: boolean; mode: MonthlyPartitionMode;
  fileName: string; spreadsheetId: string; folderPath: string; webViewLink: string; createdAt: string; tabs: string[];
}

/** Trường ngày nghiệp vụ dùng để xác định bản ghi thuộc tháng nào khi chuyển sang file tháng mới. */
const DATE_FIELD: Record<string, string> = {
  SHIFT_ASSIGNMENTS: 'work_date', LEAVE_REQUESTS: 'leave_date', SHIFT_SWAPS: 'from_work_date',
  ATTENDANCE_EVENTS: 'work_date', ATTENDANCE_ADJUSTMENTS: 'work_date',
};
const PENDING_STATUSES = new Set(['DRAFT', 'PENDING', 'STORE_CONFIRMED', 'PENDING_PEER', 'PEER_ACCEPTED']);

export const monthKeyLabel = (monthKey: string) =>
  monthKey ? `Tháng ${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}` : 'Tệp gốc (Mặc định ban đầu)';
export const monthlyFileName = (monthKey: string) => `UMBM_MONTHLY_${monthKey}`;
export const monthlyFolderSegments = (monthKey: string) => [
  DRIVE_FOLDERS.MONTHLY_DATABASES,
  `${monthKey.slice(0, 4)}-${monthKey.slice(5, 7)}`,
];

export function readPartitionRegistry(db: Database): MonthlyPartitionRegistryEntry[] {
  const row = db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY);
  return parsePartitionRegistry(row?.value);
}

async function upsertPartitionRegistry(db: Database, entry: MonthlyPartitionRegistryEntry, actorId: string): Promise<void> {
  const others = readPartitionRegistry(db).filter((r) => r.monthKey !== entry.monthKey);
  const next = [entry, ...others].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const value = JSON.stringify(next);
  const existing = db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY);
  if (existing) {
    await db.systemSettings.update(existing.id, existing.version, { value }, actorId);
  } else {
    await db.systemSettings.insert(
      {
        key: OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY,
        value,
        label: 'Sổ đăng ký các file Google Sheets theo tháng',
        category: 'DATA',
        value_type: 'JSON',
        note: 'Danh sách file Google Spreadsheet độc lập theo từng tháng lưu trên Google Drive',
      },
      actorId,
    );
  }
}

async function discoverLegacyTabMonths(db: Database, registered: Set<string>): Promise<Set<string>> {
  const tabs = new Set([...(await db.gateway.listTabs(db.ids.SCHEDULE)), ...(await db.gateway.listTabs(db.ids.ATTENDANCE))]);
  const legacy = new Set<string>();
  for (const tab of tabs) {
    const m = tab.match(/^(SHIFT_ASSIGNMENTS|LEAVE_REQUESTS|SHIFT_SWAPS|ATTENDANCE_EVENTS|ATTENDANCE_ADJUSTMENTS)_(\d{4}_\d{2})$/);
    if (m && PARTITION_MONTH_REGEX.test(m[2]!) && !registered.has(m[2]!)) legacy.add(m[2]!);
  }
  return legacy;
}

/** Liệt kê file gốc cùng toàn bộ các file Google Spreadsheet theo tháng đã tạo trên Drive. */
export async function listPartitions(db: Database) {
  const registry = readPartitionRegistry(db);
  const regMap = new Map(registry.map((r) => [r.monthKey, r]));
  const legacyMonths = await discoverLegacyTabMonths(db, new Set(regMap.keys()));
  const allMonths = new Set<string>([...regMap.keys(), ...legacyMonths]);
  if (db.partitionMonth) allMonths.add(db.partitionMonth);

  const baseNames = db.monthlyStores().map((m) => m.base);
  const rootLink = db.ids.SCHEDULE && !db.ids.SCHEDULE.startsWith('mem-')
    ? `https://docs.google.com/spreadsheets/d/${db.ids.SCHEDULE}/edit`
    : '';

  const items: PartitionListItem[] = ['', ...Array.from(allMonths).sort().reverse()].map((monthKey) => {
    if (!monthKey) {
      return {
        monthKey: '', label: monthKeyLabel(''), isActive: db.partitionMonth === '',
        mode: 'ROOT_FILE', fileName: `${SPREADSHEETS.SCHEDULE.title} + ${SPREADSHEETS.ATTENDANCE.title}`,
        spreadsheetId: db.ids.SCHEDULE, folderPath: DRIVE_FOLDERS.DATABASE, webViewLink: rootLink, createdAt: '', tabs: baseNames,
      };
    }
    const reg = regMap.get(monthKey);
    if (reg && reg.mode === 'MONTHLY_FILE') {
      return {
        monthKey, label: monthKeyLabel(monthKey), isActive: monthKey === db.partitionMonth,
        mode: 'MONTHLY_FILE', fileName: reg.fileName, spreadsheetId: reg.spreadsheetId,
        folderPath: reg.folderPath || monthlyFolderSegments(monthKey).join('/'),
        webViewLink: reg.webViewLink, createdAt: reg.createdAt, tabs: baseNames,
      };
    }
    return {
      monthKey, label: monthKeyLabel(monthKey), isActive: monthKey === db.partitionMonth,
      mode: 'LEGACY_TAB', fileName: `${SPREADSHEETS.SCHEDULE.title} / ${SPREADSHEETS.ATTENDANCE.title}`,
      spreadsheetId: db.ids.SCHEDULE, folderPath: DRIVE_FOLDERS.DATABASE, webViewLink: rootLink,
      createdAt: reg?.createdAt ?? '', tabs: baseNames.map((b) => partitionTabName(b, monthKey)),
    };
  });

  const activeFile = items.find((i) => i.isActive) ?? items[0]!;
  const counts = db.monthlyStores().map((m) => ({
    base: m.base, tab: m.store.tab, spreadsheetId: m.store.spreadsheetId, rows: m.store.all().length,
  }));
  return { activeMonth: db.partitionMonth, activeLabel: monthKeyLabel(db.partitionMonth), activeFile, items, counts };
}

async function persistActiveMonth(db: Database, monthKey: string, actorId: string): Promise<void> {
  await saveOperationSettings(db, { dataPartitionMonth: monthKey }, actorId);
  if (!monthKey) {
    const row = db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITION_MONTH);
    if (row && row.value) await db.systemSettings.update(row.id, row.version, { value: '' }, actorId);
  }
}

async function ensureMonthlyTarget(db: Database, monthKey: string, actorId: string, forceMonthlyFile = false) {
  if (!monthKey) {
    return { mode: 'ROOT_FILE' as const, entry: null, targetFor: (m: MonthlyStoreDesc) => ({ spreadsheetId: m.defaultSpreadsheetId, tab: m.base }) };
  }
  const registry = readPartitionRegistry(db);
  const existing = registry.find((r) => r.monthKey === monthKey);
  if (existing && existing.mode === 'MONTHLY_FILE') {
    return { mode: 'MONTHLY_FILE' as const, entry: existing, targetFor: (m: MonthlyStoreDesc) => ({ spreadsheetId: existing.spreadsheetId, tab: m.base }) };
  }
  if (!forceMonthlyFile) {
    const legacy = await discoverLegacyTabMonths(db, new Set(registry.map((r) => r.monthKey)));
    if ((existing && existing.mode === 'LEGACY_TAB') || legacy.has(monthKey)) {
      return { mode: 'LEGACY_TAB' as const, entry: existing ?? null, targetFor: (m: MonthlyStoreDesc) => ({ spreadsheetId: m.defaultSpreadsheetId, tab: partitionTabName(m.base, monthKey) }) };
    }
  }
  const created = await db.gateway.createMonthlySpreadsheet({
    monthKey,
    title: monthlyFileName(monthKey),
    folderSegments: monthlyFolderSegments(monthKey),
    tabs: db.monthlyStores().map((m) => ({ name: m.base, headers: m.headers })),
  });
  const entry: MonthlyPartitionRegistryEntry = {
    monthKey, fileName: created.fileName, spreadsheetId: created.spreadsheetId,
    folderId: created.folderId, folderPath: created.folderPath, webViewLink: created.webViewLink,
    mode: 'MONTHLY_FILE', createdAt: nowIso(), createdBy: actorId,
  };
  await upsertPartitionRegistry(db, entry, actorId);
  return { mode: 'MONTHLY_FILE' as const, entry, targetFor: (m: MonthlyStoreDesc) => ({ spreadsheetId: entry.spreadsheetId, tab: m.base }) };
}

/** Chuyển toàn bộ 5 bảng vận hành sang file Google Spreadsheet tháng chỉ định (hoặc quay về file gốc). */
export async function switchPartition(db: Database, monthKey: string, actorId: string): Promise<void> {
  if (monthKey && !PARTITION_MONTH_REGEX.test(monthKey)) {
    throw Errors.fieldValidation('month_key', 'INVALID_FORMAT', 'Mã tháng phải theo định dạng YYYY_MM (ví dụ 2026_11)', monthKey);
  }
  const target = await ensureMonthlyTarget(db, monthKey, actorId, false);
  for (const m of db.monthlyStores()) await m.store.switchTarget(target.targetFor(m));
  db.partitionMonth = monthKey;
  await persistActiveMonth(db, monthKey, actorId);
}

/** Tạo 1 File Google Spreadsheet độc lập cho tháng mới trong folder Drive và chuyển tiếp dữ liệu từ đầu tháng trở đi. */
export async function rolloverToMonth(db: Database, monthKey: string, actorId: string, carryForward = true) {
  if (!PARTITION_MONTH_REGEX.test(monthKey)) {
    throw Errors.fieldValidation('month_key', 'INVALID_FORMAT', 'Mã tháng phải theo định dạng YYYY_MM (ví dụ 2026_11)', monthKey);
  }
  if (monthKey === db.partitionMonth) throw Errors.badRequest(`Hệ thống đang dùng ${monthKeyLabel(monthKey)}`);
  const target = await ensureMonthlyTarget(db, monthKey, actorId, true);
  const monthStart = `${monthKey.slice(0, 4)}-${monthKey.slice(5, 7)}-01`;
  const carried: Record<string, number> = {};
  const pendingLeftBehind: Record<string, number> = {};

  const snapshots = db.monthlyStores().map((m) => {
    const store = m.store as unknown as AnyStore, field = DATE_FIELD[m.base]!;
    const rows = store.all();
    const toCarry = carryForward ? rows.filter((r) => String(r[field] ?? '') >= monthStart) : [];
    pendingLeftBehind[m.base] = rows.filter((r) => String(r[field] ?? '') < monthStart && PENDING_STATUSES.has(String(r.status ?? ''))).length;
    return { desc: m, base: m.base, store, toCarry };
  });

  for (const s of snapshots) {
    if (s.toCarry.length > 0) await s.store.batchUpdate(s.toCarry.map((r) => ({ id: r.id, expectedVersion: r.version, patch: { is_deleted: true } })), actorId);
  }
  for (const s of snapshots) {
    await s.store.switchTarget(target.targetFor(s.desc));
    const existingById = new Map(s.store.all(true).map((r) => [r.id, r]));
    let count = 0;
    const ops: Promise<unknown>[] = [];
    for (const r of s.toCarry) {
      const found = existingById.get(r.id);
      if (!found) {
        const { version: _v, is_deleted: _d, created_by: _cb, updated_by: _ub, ...rest } = r;
        ops.push(s.store.insert(rest as never, actorId));
        count++;
      } else if (found.is_deleted) {
        ops.push(s.store.restore(found.id, found.version, actorId));
        count++;
      }
    }
    await Promise.all(ops);
    carried[s.base] = count;
  }
  db.partitionMonth = monthKey;
  await persistActiveMonth(db, monthKey, actorId);
  return { monthKey, label: monthKeyLabel(monthKey), file: target.entry, carried, pendingLeftBehind };
}
