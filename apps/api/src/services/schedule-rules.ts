import { addDaysYmd, DEFAULT_SHIFT_LABELS, isOfficeEmployeeSpec, type Employee, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

/**
 * Chặn tạo mới hoặc dời ca làm việc vào ngày/giờ trong quá khứ:
 * chỉ cho phép xếp ca từ thời điểm hiện tại trở về tương lai.
 */
export function assertShiftNotInPast(workDate: string, startAt = '', field = 'work_date'): void {
  const { todayStr, nowHm } = getVnNowDateAndHm();
  if (workDate < todayStr) {
    throw Errors.fieldValidation(
      field,
      'OUT_OF_RANGE',
      `Không thể tạo hoặc xếp ca làm việc trong quá khứ (${dayjs(workDate).format('DD/MM/YYYY')}). Chỉ được tạo ca từ ngày giờ hiện tại trở về tương lai.`,
      workDate,
    );
  }
  if (workDate === todayStr && startAt && nowHm >= startAt) {
    throw Errors.fieldValidation(
      'shift_code',
      'OUT_OF_RANGE',
      `Khung ca (${startAt}) ngày hôm nay đã bắt đầu hoặc đã qua giờ hiện tại (${nowHm}). Chỉ được tạo ca từ ngày giờ hiện tại trở về tương lai.`,
      startAt,
    );
  }
}

/**
 * Quy tắc lịch làm việc dùng chung: số ca tối đa / ngày, chu kỳ thử việc 12 ngày,
 * khóa sửa ca đã duyệt và kiểm tra tuần / chu kỳ đã được HR chốt lịch.
 */
export const matchEmp = (emp: Pick<Employee, 'id' | 'employee_code'>) => (eid: string) => eid === emp.id || eid === emp.employee_code;

/** Ca được tính vào số ca trong ngày của nhân viên (không tính ngày OFF / ca đã nghỉ phép / ca đã chuyển đi). */
export function isCountedWorkShift(a: ShiftAssignment): boolean {
  return a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'SWAPPED';
}

/** Kiểm tra một phân ca thuộc nhân sự thử việc (không tính vào định biên chính thức của cửa hàng). */
export function isProbationShift(ctx: AppContext, a: ShiftAssignment): boolean {
  if (a.employee_stage === 'PROBATION') return true;
  const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
  return emp?.stage === 'PROBATION';
}

/** Nhân viên thử việc chỉ được đăng ký các ca cửa hàng (Sáng, Chiều, Tối), tuyệt đối không được đăng ký Ca Hành chính. */
export function isDisallowedProbationShiftCode(
  shiftCode: string,
  tpl?: { shift_group?: string; standard_hours?: number } | null,
): boolean {
  const upper = (shiftCode || '').trim().toUpperCase();
  if (upper.includes('HANH_CHINH') || upper.includes('OFFICE')) return true;
  if (tpl && ((tpl.shift_group || '').toUpperCase() === 'OFFICE' || Number(tpl.standard_hours || 5) >= 7.5)) return true;
  return false;
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

export interface ProbationCycle { start: string; end: string; dates: string[]; workRequired: number; offLimit: number; isOffice?: boolean }

/** Chu kỳ thử việc mặc định 12 ngày: Cửa hàng tối đa 5 ngày OFF (7 ca làm); Khối văn phòng tối đa 2 ngày OFF (10 ca làm). */
export function resolveProbationCycle(emp: Employee, fallbackStart?: string): ProbationCycle {
  const days = emp.probation_cycle_days || 12;
  let start = emp.probation_start || fallbackStart || dayjs().format('YYYY-MM-DD');
  if (emp.stage === 'PROBATION' && fallbackStart && addDaysYmd(start, days - 1) < fallbackStart) {
    start = fallbackStart;
  }
  const dates = Array.from({ length: days }, (_, i) => addDaysYmd(start, i));
  const isOffice = isOfficeEmployeeSpec(emp);
  const defaultOff = isOffice ? 2 : 5;
  const offLimit = isOffice ? 2 : (emp.probation_off_days || defaultOff);
  const workRequired = emp.probation_work_days || (days - offLimit);
  return { start, end: dates[dates.length - 1]!, dates, workRequired, offLimit, isOffice };
}

export const weekLockCode = (branchId: string, weekStart: string, partitionMonth = '') =>
  partitionMonth ? `WK@${partitionMonth}-${branchId || 'ALL'}-${weekStart}` : `WK-${branchId || 'ALL'}-${weekStart}`;

export const probationLockCode = (empCode: string, cycleStart: string, partitionMonth = '') =>
  partitionMonth ? `PB@${partitionMonth}-${empCode}-${cycleStart}` : `PB-${empCode}-${cycleStart}`;

/** Tuần (theo chi nhánh hoặc toàn hệ thống) trên đúng tệp dữ liệu tháng đang hoạt động đã được HR chốt lịch hay chưa. */
export function findWeekLock(ctx: AppContext, branchId: string, weekStart: string) {
  const pMonth = ctx.db.partitionMonth;
  const scopedCodes = new Set([weekLockCode(branchId, weekStart, pMonth), weekLockCode('ALL', weekStart, pMonth)]);
  const direct = ctx.db.scheduleWeeks.find((w) => scopedCodes.has(w.code) && w.status === 'PUBLISHED');
  if (direct || !pMonth) return direct;
  const legacyCodes = new Set([weekLockCode(branchId, weekStart, ''), weekLockCode('ALL', weekStart, '')]);
  const legacy = ctx.db.scheduleWeeks.find((w) => legacyCodes.has(w.code) && w.status === 'PUBLISHED');
  if (!legacy) return undefined;
  const hasShiftsFromLegacyLock = Boolean(ctx.db.shiftAssignments.find((a) => legacyCodes.has(a.schedule_week_id)));
  return hasShiftsFromLegacyLock ? legacy : undefined;
}

export function findProbationLock(ctx: AppContext, emp: Employee, cycleStart: string) {
  const pMonth = ctx.db.partitionMonth;
  const scopedCode = probationLockCode(emp.employee_code, cycleStart, pMonth);
  const direct = ctx.db.scheduleWeeks.find((w) => w.code === scopedCode && w.status === 'PUBLISHED');
  if (direct || !pMonth) return direct;
  const legacyCode = probationLockCode(emp.employee_code, cycleStart, '');
  const legacy = ctx.db.scheduleWeeks.find((w) => w.code === legacyCode && w.status === 'PUBLISHED');
  if (!legacy) return undefined;
  return ctx.db.shiftAssignments.find((a) => a.schedule_week_id === legacyCode) ? legacy : undefined;
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

export function mergeShiftDecisionNote(prevNote: string, decisionNote: string, prefix: 'Duyệt' | 'Từ chối'): string {
  const clean = decisionNote.trim();
  if (!clean) return prevNote;
  return prevNote ? `${prevNote} | ${prefix}: ${clean}` : prefix === 'Từ chối' ? `Từ chối: ${clean}` : clean;
}

export async function notifyDraftShiftsRejected(ctx: AppContext, rows: ShiftAssignment[], reason: string, actorId: string): Promise<void> {
  const cleanReason = reason.trim();
  for (const a of rows) {
    if (a.status !== 'DRAFT') continue;
    const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
    const empUser = (emp ? findLinkedUserForEmployee(emp, ctx) : undefined) ?? ctx.db.users.find((u) => Boolean(a.employee_id && u.employee_id.trim().toUpperCase() === a.employee_id.trim().toUpperCase()));
    if (!empUser || empUser.id === actorId) continue;
    const entityId = `${a.id}_REJECTED`;
    if (ctx.db.notifications.find((n) => n.entity_type === 'SHIFT_REJECTED_USER' && n.entity_id === entityId)) continue;
    const shiftLabel = (DEFAULT_SHIFT_LABELS as Record<string, string>)[a.shift_code] ?? a.shift_code;
    await ctx.db.notifications.insert({
      recipient_user_id: empUser.id, recipient_role: '', branch_id: emp?.branch_id || a.branch_id || 'ALL',
      category: 'WORKFLOW', title: `Ca đăng ký ngày ${a.work_date} bị từ chối`,
      body: `${shiftLabel} (${a.start_at}–${a.end_at}) ngày ${a.work_date} không được phê duyệt.${cleanReason ? ` Lý do: ${cleanReason}.` : ''}`,
      link: '/nv/lich', severity: 'WARNING', entity_type: 'SHIFT_REJECTED_USER', entity_id: entityId, read_at: '',
    }, actorId);
  }
}
