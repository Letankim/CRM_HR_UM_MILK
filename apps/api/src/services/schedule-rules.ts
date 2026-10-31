import { addDaysYmd, type Employee, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';

/**
 * Quy tắc lịch làm việc dùng chung: số ca tối đa / ngày, chu kỳ thử việc 12 ngày,
 * khóa sửa ca đã duyệt và kiểm tra tuần / chu kỳ đã được HR chốt lịch.
 */
export const matchEmp = (emp: Pick<Employee, 'id' | 'employee_code'>) => (eid: string) => eid === emp.id || eid === emp.employee_code;

/** Ca được tính vào số ca trong ngày của nhân viên (không tính ngày OFF / ca đã nghỉ phép / ca đã chuyển đi). */
export function isCountedWorkShift(a: ShiftAssignment): boolean {
  return a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'SWAPPED';
}

export function employeeShiftsOnDate(ctx: AppContext, emp: Pick<Employee, 'id' | 'employee_code'>, workDate: string, excludeIds: string[] = []): ShiftAssignment[] {
  const isEmp = matchEmp(emp), skip = new Set(excludeIds);
  return ctx.db.shiftAssignments.filter((a) => !skip.has(a.id) && isEmp(a.employee_id) && a.work_date === workDate && isCountedWorkShift(a));
}

/** Không nhân viên nào làm quá `maxPerDay` ca trong 1 ngày (mặc định 2 ca, Quản trị viên cấu hình). */
export function assertMaxShiftsPerDay(
  ctx: AppContext,
  params: { emp: Employee; workDate: string; maxPerDay: number; adding?: number; excludeIds?: string[]; field?: string; isSelf?: boolean },
): void {
  const current = employeeShiftsOnDate(ctx, params.emp, params.workDate, params.excludeIds).length;
  const adding = params.adding ?? 1;
  if (current + adding > params.maxPerDay) {
    const who = params.isSelf ? 'Bạn' : `Nhân sự ${params.emp.full_name} (${params.emp.employee_code})`;
    throw Errors.fieldValidation(
      params.field ?? 'work_date', 'OUT_OF_RANGE',
      `${who} đã có ${current} ca trong ngày ${dayjs(params.workDate).format('DD/MM/YYYY')}. Theo quy định công ty, không nhân viên nào được làm quá ${params.maxPerDay} ca trong 1 ngày.`,
      params.workDate,
    );
  }
}

export interface ProbationCycle { start: string; end: string; dates: string[]; workRequired: number; offLimit: number }

/** Chu kỳ thử việc mặc định 12 ngày: 7 ca bắt buộc làm + 5 ngày OFF (tính từ ngày bắt đầu thử việc). */
export function resolveProbationCycle(emp: Employee, fallbackStart?: string): ProbationCycle {
  const days = emp.probation_cycle_days || 12;
  const start = emp.probation_start || fallbackStart || dayjs().format('YYYY-MM-DD');
  const dates = Array.from({ length: days }, (_, i) => addDaysYmd(start, i));
  return { start, end: dates[dates.length - 1]!, dates, workRequired: emp.probation_work_days || 7, offLimit: emp.probation_off_days || 5 };
}

export const weekLockCode = (branchId: string, weekStart: string) => `WK-${branchId || 'ALL'}-${weekStart}`;
export const probationLockCode = (empCode: string, cycleStart: string) => `PB-${empCode}-${cycleStart}`;

/** Tuần (theo chi nhánh hoặc toàn hệ thống) đã được HR chốt lịch & tự động sắp ca hay chưa. */
export function findWeekLock(ctx: AppContext, branchId: string, weekStart: string) {
  const codes = new Set([weekLockCode(branchId, weekStart), weekLockCode('ALL', weekStart)]);
  return ctx.db.scheduleWeeks.find((w) => codes.has(w.code) && w.status === 'PUBLISHED');
}

export function findProbationLock(ctx: AppContext, emp: Employee, cycleStart: string) {
  const code = probationLockCode(emp.employee_code, cycleStart);
  return ctx.db.scheduleWeeks.find((w) => w.code === code && w.status === 'PUBLISHED');
}

export function assertApprovedShiftNoteOnlyPatch(
  before: ShiftAssignment,
  body: { employee_id?: string; work_date?: string; shift_code?: string; status?: string; day_type?: string; scheduled_hours?: number },
  origEmpId?: string,
  origEmpCode?: string,
): void {
  if (before.status === 'DRAFT') return;
  const allowedEmpIds = new Set([before.employee_id, origEmpId, origEmpCode].filter(Boolean) as string[]);
  const changedCore =
    (body.employee_id !== undefined && !allowedEmpIds.has(body.employee_id)) ||
    (body.work_date !== undefined && body.work_date !== before.work_date) ||
    (body.shift_code !== undefined && body.shift_code !== before.shift_code) ||
    (body.day_type !== undefined && body.day_type !== before.day_type) ||
    (body.scheduled_hours !== undefined && Number(body.scheduled_hours) !== Number(before.scheduled_hours)) ||
    (body.status !== undefined && body.status !== before.status);
  if (changedCore) {
    throw Errors.badRequest('Ca làm việc này đã được phê duyệt nên chỉ được phép chỉnh sửa Ghi chú phân ca hoặc xóa phân ca; không thể thay đổi nhân sự, ngày, khung ca, giờ công hay trạng thái.');
  }
}

/**
 * Duyệt ca thử việc đăng ký thêm: dời ca cuối chu kỳ (đã liên kết khi đăng ký) lên ca vừa duyệt
 * để nhân viên vẫn làm đủ 7 ca bắt buộc. Chỉ xóa ca cuối khi ca đó chưa phát sinh chấm công.
 */
export async function applyProbationExtraApproval(ctx: AppContext, approved: ShiftAssignment, actorId: string): Promise<ShiftAssignment | null> {
  if (!approved.linked_assignment_id) return null;
  const linked = ctx.db.shiftAssignments.get(approved.linked_assignment_id);
  if (!linked || linked.id === approved.id || (linked.status !== 'PUBLISHED' && linked.status !== 'DRAFT')) return null;
  if (ctx.db.attendanceEvents.find((e) => e.assignment_id === linked.id)) return null;
  await ctx.db.shiftAssignments.softDelete(linked.id, linked.version, actorId);
  return linked;
}
