import { PARTITION_MONTH_REGEX } from '@umbm/shared';
import type { Database } from '../data/database.js';
import type { BaseRecord } from '../sheets/table-store.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { extractMonthKeyFromDate, getPartitionStore, type MonthlyTableName } from './partition-write-router.js';

export interface RehomeDetail {
  table: string;
  id: string;
  code?: string;
  fromMonth: string;
  toMonth: string;
}

export interface RehomeReport {
  rehomedCount: number;
  details: RehomeDetail[];
  scannedMonths: string[];
}

const DATE_FIELD: Record<MonthlyTableName, string> = {
  SHIFT_ASSIGNMENTS: 'work_date',
  LEAVE_REQUESTS: 'leave_date',
  SHIFT_SWAPS: 'from_work_date',
  ATTENDANCE_EVENTS: 'work_date',
  ATTENDANCE_ADJUSTMENTS: 'work_date',
};

/**
 * Tự động quét và di dời các bản ghi lưu sai phân vùng tháng về đúng tệp Google Spreadsheet tháng chuẩn xác.
 * Tuyệt đối bảo toàn dữ liệu mẫu gốc trong Tệp gốc (ROOT) và giữ nguyên các bản ghi tháng kế tiếp
 * đang nằm trong tệp tháng mới nhất khi Admin chưa khởi tạo tệp tháng mới.
 */
export async function rehomeMisplacedPartitionRecords(
  db: Database,
  actorId = 'system-rehome',
): Promise<RehomeReport> {
  const registry = readPartitionRegistry(db);
  const regMap = new Map(registry.map((r) => [r.monthKey, r]));
  const latestMonth = registry.length > 0 ? [...registry].sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0]!.monthKey : '';
  const allMonths = new Set<string>(registry.map((r) => r.monthKey));
  if (db.partitionMonth) allMonths.add(db.partitionMonth);
  if (allMonths.size > 0) allMonths.add('');

  const scannedMonths = Array.from(allMonths);
  const details: RehomeDetail[] = [];
  const descs = db.monthlyStores();
  const rootShifts = allMonths.has('')
    ? await getPartitionStore<BaseRecord>(db, 'SHIFT_ASSIGNMENTS', '', actorId)
    : undefined;

  for (const monthKey of scannedMonths) {
    for (const desc of descs) {
      const tableName = desc.base as MonthlyTableName;
      if (monthKey === '' && tableName === 'SHIFT_ASSIGNMENTS') continue;

      const dateField = DATE_FIELD[tableName];
      const sourceStore = await getPartitionStore<BaseRecord>(db, tableName, monthKey, actorId);
      const rows = sourceStore.all(false) as (BaseRecord & Record<string, unknown>)[];

      for (const row of rows) {
        const dateVal = String(row[dateField] ?? '');
        const rawMonth = extractMonthKeyFromDate(dateVal);
        if (!rawMonth || !PARTITION_MONTH_REGEX.test(rawMonth)) continue;
        const targetMonth = regMap.has(rawMonth)
          ? rawMonth
          : latestMonth && rawMonth > latestMonth
            ? latestMonth
            : '';
        if (!targetMonth || monthKey === targetMonth) continue;

        if (monthKey === '') {
          const creator = String(row.created_by ?? '');
          if (creator === 'seed-realistic' || creator === 'seed' || creator === 'system-rehome') continue;
          const linkedShiftId = String(row.assignment_id || row.from_assignment_id || '').trim();
          if (linkedShiftId && rootShifts?.get(linkedShiftId)) continue;
        }

        const targetStore = await getPartitionStore<BaseRecord>(db, tableName, targetMonth, actorId);
        const existingInTarget = targetStore.get(row.id);

        if (!existingInTarget) {
          const { version: _v, is_deleted: _d, created_at: _ca, updated_at: _ua, ...data } = row;
          await targetStore.insert(data as never, actorId);
        } else if (existingInTarget.is_deleted) {
          await targetStore.restore(existingInTarget.id, existingInTarget.version, actorId);
        }

        await sourceStore.softDelete(row.id, row.version, actorId);
        const code = String(row.adjustment_code || row.swap_code || row.request_code || row.id);
        details.push({
          table: tableName,
          id: row.id,
          code,
          fromMonth: monthKey || 'ROOT',
          toMonth: targetMonth,
        });
      }
    }
  }

  return {
    rehomedCount: details.length,
    details,
    scannedMonths,
  };
}
