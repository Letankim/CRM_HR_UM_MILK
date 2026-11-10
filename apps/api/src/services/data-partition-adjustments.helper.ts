import {
  SPREADSHEETS,
  partitionTabName,
  zAttendanceAdjustment,
  type AttendanceAdjustment,
  type Employee,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { parseSheetRows } from '../sheets/table-store-codec.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { extractMonthKeyFromDate } from './partition-write-router.js';
import { rehomeMisplacedPartitionRecords } from './partition-rehome.service.js';

type TargetRef = { spreadsheetId: string; tab: string };

async function readHistoricalAdjustmentsTarget(
  ctx: AppContext,
  target: TargetRef,
): Promise<AttendanceAdjustment[]> {
  const rawRows = await ctx.db.gateway.readTab(target.spreadsheetId, target.tab).catch(() => [] as string[][]);
  const headers = SPREADSHEETS.ATTENDANCE.tabs.ATTENDANCE_ADJUSTMENTS;
  const parsed = rawRows.length > 1 ? parseSheetRows(headers, zAttendanceAdjustment, rawRows) : { entries: new Map() };
  const rows: AttendanceAdjustment[] = [];
  for (const entry of parsed.entries.values()) {
    if (!entry.data.is_deleted) rows.push(entry.data);
  }
  return rows;
}

/**
 * Tải phiếu bổ sung công của nhân viên xuyên các tệp phân vùng tháng,
 * đảm bảo nhân viên không bị mất phiếu bù công (ADJ-xxxx) khi quản trị viên chuyển tháng dữ liệu.
 */
export async function loadCrossPartitionEmployeeAdjustments(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<AttendanceAdjustment[]> {
  const activeAdjustments = ctx.db.attendanceAdjustments
    .filter((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && !a.is_deleted);

  const adjMap = new Map<string, AttendanceAdjustment>();
  for (const a of activeAdjustments) adjMap.set(a.id, a);

  const registry = readPartitionRegistry(ctx.db);
  const targets: TargetRef[] = [];
  if (ctx.db.partitionMonth !== '') {
    targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: 'ATTENDANCE_ADJUSTMENTS' });
  }
  const curKey = todayStr.slice(0, 7).replace('-', '_');
  for (const reg of registry) {
    if (reg.monthKey === ctx.db.partitionMonth) continue;
    if (reg.monthKey === curKey || !ctx.db.partitionMonth) {
      if (reg.mode === 'MONTHLY_FILE') {
        targets.push({ spreadsheetId: reg.spreadsheetId, tab: 'ATTENDANCE_ADJUSTMENTS' });
      } else if (reg.mode === 'LEGACY_TAB') {
        targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: partitionTabName('ATTENDANCE_ADJUSTMENTS', reg.monthKey) });
      }
    }
  }

  for (const t of targets) {
    const rows = await readHistoricalAdjustmentsTarget(ctx, t);
    for (const r of rows) {
      if ((r.employee_id === emp.id || r.employee_id === emp.employee_code) && !r.is_deleted) {
        adjMap.set(r.id, r);
      }
    }
  }
  return Array.from(adjMap.values()).reverse();
}

/**
 * Tải danh sách phiếu bổ sung công cho Quản trị viên (HR), tự động gộp các phiếu đang chờ duyệt
 * (PENDING, STORE_CONFIRMED) từ tháng hiện hành, tệp gốc và các tháng liên quan để HR không bao giờ bị sót phiếu.
 */
export async function loadCrossPartitionBackofficeAdjustments(
  ctx: AppContext,
  todayStr: string,
  queryQ?: string,
): Promise<AttendanceAdjustment[]> {
  const activeAdjustments = ctx.db.attendanceAdjustments.all();
  const adjMap = new Map<string, AttendanceAdjustment>();
  for (const a of activeAdjustments) if (!a.is_deleted) adjMap.set(a.id, a);

  const registry = readPartitionRegistry(ctx.db);
  const targets: TargetRef[] = [];
  if (ctx.db.partitionMonth !== '') {
    targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: 'ATTENDANCE_ADJUSTMENTS' });
  }
  for (const reg of registry) {
    if (reg.monthKey === ctx.db.partitionMonth) continue;
    if (reg.mode === 'MONTHLY_FILE') {
      targets.push({ spreadsheetId: reg.spreadsheetId, tab: 'ATTENDANCE_ADJUSTMENTS' });
    } else if (reg.mode === 'LEGACY_TAB') {
      targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: partitionTabName('ATTENDANCE_ADJUSTMENTS', reg.monthKey) });
    }
  }

  const qLower = (queryQ || '').trim().toLowerCase();
  const activeMonthKey = ctx.db.partitionMonth;
  let hasMisplaced = false;

  for (const t of targets) {
    const rows = await readHistoricalAdjustmentsTarget(ctx, t);
    for (const r of rows) {
      if (r.is_deleted) continue;
      const isPending = r.status === 'PENDING' || r.status === 'STORE_CONFIRMED';
      const matchesQ = Boolean(qLower && (r.adjustment_code.toLowerCase().includes(qLower) || r.employee_id.toLowerCase().includes(qLower)));
      const matchesActiveMonth = Boolean(activeMonthKey && r.work_date && extractMonthKeyFromDate(r.work_date) === activeMonthKey);
      if (matchesActiveMonth) hasMisplaced = true;
      if (isPending || matchesQ || matchesActiveMonth) {
        if (!adjMap.has(r.id)) adjMap.set(r.id, r);
      }
    }
  }

  if (hasMisplaced) {
    void rehomeMisplacedPartitionRecords(ctx.db).catch(() => undefined);
  }

  return Array.from(adjMap.values());
}
