import {
  SPREADSHEETS,
  addDaysYmd,
  partitionTabName,
  zAttendanceEvent,
  type AttendanceEvent,
  type Employee,
  type ShiftAssignment,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { parseSheetRows } from '../sheets/table-store-codec.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { loadShiftsAcrossPartitions } from './historical-shifts-loader.js';

type TargetRef = { spreadsheetId: string; tab: string };

async function readHistoricalEventsTarget(
  ctx: AppContext,
  target: TargetRef,
): Promise<AttendanceEvent[]> {
  const rawRows = await ctx.db.gateway.readTab(target.spreadsheetId, target.tab).catch(() => [] as string[][]);
  const headers = SPREADSHEETS.ATTENDANCE.tabs.ATTENDANCE_EVENTS;
  const parsed = rawRows.length > 1 ? parseSheetRows(headers, zAttendanceEvent, rawRows) : { entries: new Map() };
  const rows: AttendanceEvent[] = [];
  for (const entry of parsed.entries.values()) {
    if (!entry.data.is_deleted) rows.push(entry.data);
  }
  return rows;
}

/**
 * Tải danh sách ca làm việc của nhân viên xuyên suốt các tệp Google Sheets phân vùng theo tháng.
 * Đảm bảo khi Quản trị viên Backoffice chuyển phân vùng sang tháng khác (ví dụ: tháng trước hoặc tháng sau),
 * nhân viên trên Cổng NV vẫn xem được đầy đủ lịch làm việc trong phạm vi 35 ngày quanh ngày hiện tại.
 */
export async function loadCrossPartitionEmployeeShifts(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<ShiftAssignment[]> {
  const fromDate = addDaysYmd(todayStr, -35);
  const toDate = addDaysYmd(todayStr, 35);
  const crossShifts = await loadShiftsAcrossPartitions(ctx, fromDate, toDate).catch(() => [] as ShiftAssignment[]);
  const activeShifts = ctx.db.shiftAssignments
    .filter((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && !a.is_deleted);

  const shiftMap = new Map<string, ShiftAssignment>();
  for (const s of crossShifts) {
    if ((s.employee_id === emp.id || s.employee_id === emp.employee_code) && !s.is_deleted) {
      shiftMap.set(s.id, s);
    }
  }
  for (const s of activeShifts) {
    shiftMap.set(s.id, s);
  }
  return Array.from(shiftMap.values()).reverse();
}

/**
 * Tìm ca làm việc theo ID xuyên các phân vùng tháng khi điểm danh hoặc thao tác ca.
 */
export async function findShiftAcrossPartitions(
  ctx: AppContext,
  assignmentId: string,
  todayStr: string,
): Promise<ShiftAssignment | undefined> {
  const active = ctx.db.shiftAssignments.get(assignmentId);
  if (active && !active.is_deleted) return active;

  const fromDate = addDaysYmd(todayStr, -15);
  const toDate = addDaysYmd(todayStr, 15);
  const cross = await loadShiftsAcrossPartitions(ctx, fromDate, toDate).catch(() => [] as ShiftAssignment[]);
  return cross.find((s) => s.id === assignmentId && !s.is_deleted);
}

/**
 * Tải danh sách sự kiện điểm danh của nhân viên xuyên phân vùng tháng khi Backoffice đổi tháng vận hành.
 */
export async function loadCrossPartitionEmployeeEvents(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<AttendanceEvent[]> {
  const activeEvents = ctx.db.attendanceEvents
    .filter((e) => (e.employee_id === emp.id || e.employee_id === emp.employee_code) && !e.is_deleted);

  const currentMonthKey = todayStr.slice(0, 7).replace('-', '_');
  if (ctx.db.partitionMonth === currentMonthKey) {
    return activeEvents.reverse();
  }

  const registry = readPartitionRegistry(ctx.db);
  const reg = registry.find((r) => r.monthKey === currentMonthKey);
  const targets: TargetRef[] = [];
  if (reg?.mode === 'MONTHLY_FILE') {
    targets.push({ spreadsheetId: reg.spreadsheetId, tab: 'ATTENDANCE_EVENTS' });
  } else if (reg?.mode === 'LEGACY_TAB') {
    targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: partitionTabName('ATTENDANCE_EVENTS', currentMonthKey) });
  }
  if (ctx.db.partitionMonth !== '') {
    targets.push({ spreadsheetId: ctx.db.ids.ATTENDANCE, tab: 'ATTENDANCE_EVENTS' });
  }

  const eventMap = new Map<string, AttendanceEvent>();
  for (const t of targets) {
    const rows = await readHistoricalEventsTarget(ctx, t);
    for (const r of rows) {
      if ((r.employee_id === emp.id || r.employee_id === emp.employee_code) && !r.is_deleted) {
        eventMap.set(r.id, r);
      }
    }
  }
  for (const e of activeEvents) {
    eventMap.set(e.id, e);
  }
  return Array.from(eventMap.values()).reverse();
}
