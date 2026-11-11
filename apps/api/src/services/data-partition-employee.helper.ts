import {
  addDaysYmd,
  type AttendanceEvent,
  type Employee,
  type LeaveRequest,
  type ShiftAssignment,
  type ShiftSwap,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { loadShiftsAcrossPartitions } from './historical-shifts-loader.js';
import { extractMonthKeyFromDate, getPartitionStore, preloadEmployeePartitionStores } from './partition-write-router.js';

/**
 * Xác định danh sách phân vùng tháng dành cho Cổng Nhân Viên dựa trên DATA_PARTITIONS_REGISTRY.
 * Khi tháng hiện tại đã có trong DATA_PARTITIONS_REGISTRY (ví dụ: 2026_11, 2026_10),
 * nhân viên chỉ làm việc trên các tệp tháng chính thức này và không bị trộn dữ liệu mẫu từ Tệp gốc,
 * bất kể Quản trị viên Backoffice đang chuyển sang xem tệp nào.
 */
export function getEmployeePartitionMonths(ctx: AppContext, todayStr?: string): string[] {
  const registry = readPartitionRegistry(ctx.db);
  const regMonths = registry.map((r) => r.monthKey).filter(Boolean);
  if (regMonths.length === 0 && !ctx.db.partitionMonth) return [''];
  const curKey = todayStr ? extractMonthKeyFromDate(todayStr) : '';
  if (regMonths.length > 0 && (!curKey || regMonths.includes(curKey))) {
    return Array.from(new Set(regMonths));
  }
  return Array.from(new Set(['', ...regMonths, ...(ctx.db.partitionMonth ? [ctx.db.partitionMonth] : [])]));
}

/**
 * Tải danh sách ca làm việc của nhân viên xuyên suốt các tệp Google Sheets phân vùng theo tháng.
 */
export async function loadCrossPartitionEmployeeShifts(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<ShiftAssignment[]> {
  await preloadEmployeePartitionStores(ctx.db);
  const months = getEmployeePartitionMonths(ctx, todayStr);
  const shiftMap = new Map<string, ShiftAssignment>();
  const isMine = (eid: string) => eid === emp.id || eid === emp.employee_code;

  if (months.includes('')) {
    const fromDate = addDaysYmd(todayStr, -35);
    const toDate = addDaysYmd(todayStr, 35);
    const crossShifts = await loadShiftsAcrossPartitions(ctx, fromDate, toDate).catch(() => [] as ShiftAssignment[]);
    for (const s of crossShifts) {
      if (isMine(s.employee_id) && !s.is_deleted) shiftMap.set(s.id, s);
    }
  }

  for (const mk of months) {
    const store = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk).catch(() => undefined);
    if (!store) continue;
    for (const s of store.all()) {
      if (isMine(s.employee_id) && !s.is_deleted) shiftMap.set(s.id, s);
    }
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
  if (!assignmentId) return undefined;
  const months = getEmployeePartitionMonths(ctx, todayStr);
  for (const mk of months) {
    const store = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk).catch(() => undefined);
    const found = store?.get(assignmentId);
    if (found && !found.is_deleted) return found;
  }

  const active = ctx.db.shiftAssignments.get(assignmentId);
  if (active && !active.is_deleted) return active;

  const fromDate = addDaysYmd(todayStr, -35);
  const toDate = addDaysYmd(todayStr, 35);
  const cross = await loadShiftsAcrossPartitions(ctx, fromDate, toDate).catch(() => [] as ShiftAssignment[]);
  return cross.find((s) => s.id === assignmentId && !s.is_deleted);
}

/**
 * Tải danh sách sự kiện điểm danh của nhân viên xuyên phân vùng tháng.
 */
export async function loadCrossPartitionEmployeeEvents(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<AttendanceEvent[]> {
  const isMine = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const eventMap = new Map<string, AttendanceEvent>();
  for (const mk of getEmployeePartitionMonths(ctx, todayStr)) {
    const store = await getPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', mk).catch(() => undefined);
    if (!store) continue;
    for (const e of store.all()) {
      if (isMine(e.employee_id) && !e.is_deleted) eventMap.set(e.id, e);
    }
  }
  return Array.from(eventMap.values()).reverse();
}

export async function loadCrossPartitionEmployeeLeaves(
  ctx: AppContext,
  emp: Pick<Employee, 'id' | 'employee_code'>,
  todayStr: string,
): Promise<LeaveRequest[]> {
  const isMine = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const leaveMap = new Map<string, LeaveRequest>();
  for (const mk of getEmployeePartitionMonths(ctx, todayStr)) {
    const store = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk).catch(() => undefined);
    if (!store) continue;
    for (const l of store.all()) {
      if (isMine(l.employee_id) && !l.is_deleted) leaveMap.set(l.id, l);
    }
  }
  return Array.from(leaveMap.values()).reverse();
}

export async function loadCrossPartitionEmployeeSwaps(
  ctx: AppContext,
  predicate: (s: ShiftSwap) => boolean,
  todayStr: string,
): Promise<ShiftSwap[]> {
  const swapMap = new Map<string, ShiftSwap>();
  for (const mk of getEmployeePartitionMonths(ctx, todayStr)) {
    const store = await getPartitionStore<ShiftSwap>(ctx.db, 'SHIFT_SWAPS', mk).catch(() => undefined);
    if (!store) continue;
    for (const s of store.all()) {
      if (!s.is_deleted && predicate(s)) swapMap.set(s.id, s);
    }
  }
  return Array.from(swapMap.values()).reverse();
}
