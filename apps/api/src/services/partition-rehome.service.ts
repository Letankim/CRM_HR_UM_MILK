import type { ZodType, ZodTypeDef } from 'zod';
import { PARTITION_MONTH_REGEX } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { TableStore, type BaseRecord } from '../sheets/table-store.js';
import { ensureMonthlyTarget, readPartitionRegistry } from './data-partition.service.js';
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
 * Tự động quét và di dời toàn bộ các bản ghi lưu sai phân vùng tháng (ví dụ: ca hoặc phiếu bổ sung công
 * của tháng 11 nhưng lưu nhầm vào file tháng 10) về đúng file Google Spreadsheet tháng chuẩn xác.
 */
export async function rehomeMisplacedPartitionRecords(
  db: Database,
  actorId = 'system-rehome',
): Promise<RehomeReport> {
  const registry = readPartitionRegistry(db);
  const allMonths = new Set<string>(registry.map((r) => r.monthKey));
  allMonths.add('');
  if (db.partitionMonth) allMonths.add(db.partitionMonth);

  const scannedMonths = Array.from(allMonths);
  const details: RehomeDetail[] = [];
  const descs = db.monthlyStores();

  for (const monthKey of scannedMonths) {
    for (const desc of descs) {
      const tableName = desc.base as MonthlyTableName;
      const dateField = DATE_FIELD[tableName];
      const sourceStore = await getPartitionStore<BaseRecord>(db, tableName, monthKey, actorId);
      const rows = sourceStore.all(false) as (BaseRecord & Record<string, unknown>)[];

      for (const row of rows) {
        const dateVal = String(row[dateField] ?? '');
        const targetMonth = extractMonthKeyFromDate(dateVal);
        if (!targetMonth || !PARTITION_MONTH_REGEX.test(targetMonth)) continue;

        if (monthKey !== targetMonth) {
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
  }

  return {
    rehomedCount: details.length,
    details,
    scannedMonths,
  };
}
