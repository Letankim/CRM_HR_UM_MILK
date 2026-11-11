import {
  addDaysYmd,
  type AttendanceAdjustment,
  type AttendanceEvent,
  type Employee,
  type LeaveRequest,
  type ShiftAssignment,
  type ShiftSwap,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import type { BaseRecord } from '../sheets/table-store.js';
import { readPartitionRegistry } from './data-partition-helpers.js';
import { loadShiftsAcrossPartitions } from './historical-shifts-loader.js';
import {
  getCachedPartitionStore,
  getPartitionStore,
  preloadEmployeePartitionStores,
  resolveTargetMonthForRecord,
  type MonthlyTableName,
} from './partition-write-router.js';

/**
 * Xác định danh sách phân vùng tháng dành cho Cổng Nhân Viên dựa trên DATA_PARTITIONS_REGISTRY.
 * Khi hệ thống đã có tệp phân vùng tháng trong DATA_PARTITIONS_REGISTRY (ví dụ: 2026_11, 2026_10),
 * nhân viên luôn làm việc trên các tệp tháng chính thức này (kể cả những ngày đầu tháng mới khi Admin chưa tạo sheet mới)
 * và không bị trộn dữ liệu mẫu từ Tệp gốc, bất kể Quản trị viên Backoffice đang chuyển sang xem tệp nào.
 */
export function getEmployeePartitionMonths(ctx: AppContext, _todayStr?: string): string[] {
  const registry = readPartitionRegistry(ctx.db);
  const regMonths = registry.map((r) => r.monthKey).filter(Boolean);
  if (regMonths.length === 0 && !ctx.db.partitionMonth) return [''];
  if (regMonths.length > 0) {
    return Array.from(new Set(regMonths));
  }
  return Array.from(new Set(['', ...(ctx.db.partitionMonth ? [ctx.db.partitionMonth] : [])]));
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

export function resolveWorkCollectorStores(ctx: AppContext, from: string, to: string) {
  const reg = readPartitionRegistry(ctx.db);
  if (reg.length === 0 && !ctx.db.partitionMonth) {
    return {
      shiftsAll: (includeDeleted = false) => ctx.db.shiftAssignments.all(includeDeleted),
      getShift: (id: string) => ctx.db.shiftAssignments.get(id),
      leaves: () => ctx.db.leaveRequests.all(),
      swaps: () => ctx.db.shiftSwaps.all(),
      events: () => ctx.db.attendanceEvents.all(),
      adjustments: () => ctx.db.attendanceAdjustments.all(),
    };
  }
  const mFrom = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', {}, from);
  const mTo = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', {}, to);
  const overlapReg = reg.map((r) => r.monthKey).filter((mk) => {
    const ym = mk.replace('_', '-');
    return from <= `${ym}-31` && to >= `${ym}-01`;
  });
  const months = Array.from(new Set(['', mFrom, mTo, ...overlapReg]));
  const lookupMonths = Array.from(new Set([mFrom, mTo, ...overlapReg, '']));
  const collectTable = <T extends BaseRecord>(table: MonthlyTableName, fallback: readonly T[], includeDeleted = false): T[] => {
    const map = new Map<string, T>();
    let foundStore = false;
    for (const mk of months) {
      const st = getCachedPartitionStore<T>(ctx.db, table, mk);
      if (!st) continue;
      foundStore = true;
      for (const r of st.all(includeDeleted)) {
        const prev = map.get(r.id);
        if (!prev || (prev.is_deleted && !r.is_deleted) || (!r.is_deleted && r.version >= prev.version)) {
          map.set(r.id, r);
        }
      }
    }
    return foundStore ? Array.from(map.values()) : [...fallback];
  };
  return {
    shiftsAll: (includeDeleted = false) => collectTable('SHIFT_ASSIGNMENTS', ctx.db.shiftAssignments.all(includeDeleted), includeDeleted),
    getShift: (id: string) => {
      for (const mk of lookupMonths) {
        const found = getCachedPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk)?.get(id);
        if (found && !found.is_deleted) return found;
      }
      return ctx.db.shiftAssignments.get(id);
    },
    leaves: () => collectTable('LEAVE_REQUESTS', ctx.db.leaveRequests.all()),
    swaps: () => collectTable('SHIFT_SWAPS', ctx.db.shiftSwaps.all()),
    events: () => collectTable('ATTENDANCE_EVENTS', ctx.db.attendanceEvents.all()),
    adjustments: () => collectTable<AttendanceAdjustment>('ATTENDANCE_ADJUSTMENTS', ctx.db.attendanceAdjustments.all()),
  };
}
