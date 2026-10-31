import { OPERATION_SETTING_KEYS, PARTITION_MONTH_REGEX, partitionTabName } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import type { BaseRecord, TableStore } from '../sheets/table-store.js';
import { saveOperationSettings } from './operations-settings.service.js';

type AnyStore = TableStore<BaseRecord & Record<string, unknown>>;

/** Trường ngày nghiệp vụ dùng để xác định bản ghi thuộc tháng nào khi chuyển phân vùng. */
const DATE_FIELD: Record<string, string> = {
  SHIFT_ASSIGNMENTS: 'work_date', LEAVE_REQUESTS: 'leave_date', SHIFT_SWAPS: 'from_work_date',
  ATTENDANCE_EVENTS: 'work_date', ATTENDANCE_ADJUSTMENTS: 'work_date',
};
const PENDING_STATUSES = new Set(['DRAFT', 'PENDING', 'STORE_CONFIRMED', 'PENDING_PEER', 'PEER_ACCEPTED']);

export const monthKeyLabel = (monthKey: string) => (monthKey ? `Tháng ${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}` : 'Sheet gốc (chưa phân vùng)');

/** Liệt kê các phân vùng tháng đã có trên Google Sheets (dò theo tên tab BASE_YYYY_MM). */
export async function listPartitions(db: Database) {
  const tabs = new Set([...(await db.gateway.listTabs(db.ids.SCHEDULE)), ...(await db.gateway.listTabs(db.ids.ATTENDANCE))]);
  const months = new Set<string>();
  for (const tab of tabs) {
    const m = tab.match(/^(SHIFT_ASSIGNMENTS|LEAVE_REQUESTS|SHIFT_SWAPS|ATTENDANCE_EVENTS|ATTENDANCE_ADJUSTMENTS)_(\d{4}_\d{2})$/);
    if (m && PARTITION_MONTH_REGEX.test(m[2]!)) months.add(m[2]!);
  }
  if (db.partitionMonth) months.add(db.partitionMonth);
  const items = ['', ...Array.from(months).sort().reverse()].map((monthKey) => ({
    monthKey, label: monthKeyLabel(monthKey), isActive: monthKey === db.partitionMonth,
    tabs: db.monthlyStores().map((m) => partitionTabName(m.base, monthKey)),
  }));
  const counts = db.monthlyStores().map((m) => ({ base: m.base, tab: m.store.tab, rows: m.store.all().length }));
  return { activeMonth: db.partitionMonth, activeLabel: monthKeyLabel(db.partitionMonth), items, counts };
}

async function persistActiveMonth(db: Database, monthKey: string, actorId: string): Promise<void> {
  await saveOperationSettings(db, { dataPartitionMonth: monthKey }, actorId);
  if (!monthKey) {
    const row = db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITION_MONTH);
    if (row && row.value) await db.systemSettings.update(row.id, row.version, { value: '' }, actorId);
  }
}

/** Chuyển toàn bộ bảng dữ liệu theo tháng sang phân vùng chỉ định (tự tạo sheet nếu chưa có). */
export async function switchPartition(db: Database, monthKey: string, actorId: string): Promise<void> {
  if (monthKey && !PARTITION_MONTH_REGEX.test(monthKey)) {
    throw Errors.fieldValidation('month_key', 'INVALID_FORMAT', 'Mã tháng phải theo định dạng YYYY_MM (ví dụ 2026_11)', monthKey);
  }
  for (const m of db.monthlyStores()) await m.store.switchTab(partitionTabName(m.base, monthKey));
  db.partitionMonth = monthKey;
  await persistActiveMonth(db, monthKey, actorId);
}

/**
 * Tạo / chuyển sang sheet tháng mới. Các bản ghi có ngày nghiệp vụ từ đầu tháng mới trở đi
 * (ca đã xếp trước, đơn OFF, đổi ca, chấm công...) được chuyển tiếp sang sheet mới để không mất dữ liệu đang vận hành.
 */
export async function rolloverToMonth(db: Database, monthKey: string, actorId: string, carryForward = true) {
  if (!PARTITION_MONTH_REGEX.test(monthKey)) {
    throw Errors.fieldValidation('month_key', 'INVALID_FORMAT', 'Mã tháng phải theo định dạng YYYY_MM (ví dụ 2026_11)', monthKey);
  }
  if (monthKey === db.partitionMonth) throw Errors.badRequest(`Hệ thống đang dùng phân vùng ${monthKeyLabel(monthKey)}`);
  const monthStart = `${monthKey.slice(0, 4)}-${monthKey.slice(5, 7)}-01`;
  const carried: Record<string, number> = {};
  const pendingLeftBehind: Record<string, number> = {};
  const snapshots = db.monthlyStores().map((m) => {
    const store = m.store as unknown as AnyStore, field = DATE_FIELD[m.base]!;
    const rows = store.all();
    const toCarry = carryForward ? rows.filter((r) => String(r[field] ?? '') >= monthStart) : [];
    pendingLeftBehind[m.base] = rows.filter((r) => String(r[field] ?? '') < monthStart && PENDING_STATUSES.has(String(r.status ?? ''))).length;
    return { base: m.base, store, toCarry };
  });

  for (const s of snapshots) {
    if (s.toCarry.length > 0) await s.store.batchUpdate(s.toCarry.map((r) => ({ id: r.id, expectedVersion: r.version, patch: { is_deleted: true } })), actorId);
  }
  for (const s of snapshots) {
    await s.store.switchTab(partitionTabName(s.base, monthKey));
    const existingIds = new Set(s.store.all(true).map((r) => r.id));
    const inserts = s.toCarry.filter((r) => !existingIds.has(r.id)).map((r) => {
      const { version: _v, is_deleted: _d, created_by: _cb, updated_by: _ub, ...rest } = r;
      return s.store.insert(rest as never, actorId);
    });
    await Promise.all(inserts);
    carried[s.base] = inserts.length;
  }
  db.partitionMonth = monthKey;
  await persistActiveMonth(db, monthKey, actorId);
  return { monthKey, label: monthKeyLabel(monthKey), carried, pendingLeftBehind };
}
