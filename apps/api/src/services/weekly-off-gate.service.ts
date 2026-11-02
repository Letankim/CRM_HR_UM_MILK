import { addDaysYmd, evaluateOffWindow, mondayOfWeek, type Employee, type LeaveRequest, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { AppError, Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { getOperationSettings } from './operations-settings.service.js';
import { assertDateNotLockedByPayroll } from './salary-profile.service.js';
import { planOfficialWeek } from './schedule-auto-planner.js';
import { findWeekLock, isCountedWorkShift, matchEmp, weekLockCode } from './schedule-rules.js';
import { resolveApplicableStaffingRule } from './schedule-staffing-helper.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

const ACTIVE_LEAVE = (status: string) => status !== 'REJECTED' && status !== 'CANCELLED';
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

export function isVipOffWindowActive(emp: Pick<Employee, 'vip_off_window_until'>): boolean {
  const raw = (emp.vip_off_window_until || '').trim();
  if (!raw) return false;
  const parsed = dayjs(raw);
  return parsed.isValid() && parsed.valueOf() > Date.now();
}

export interface WeeklyOffGateStatus {
  gateLocked: boolean; isOpen: boolean; registeredCount: number; requiredCount: number; registeredDates: string[];
  targetWeekStart: string; targetWeekEnd: string; opensAt: string; closesAt: string; vipWindowActive: boolean; vipWindowUntil: string | null; message: string;
}

export function evaluateEmployeeWeeklyOffGate(ctx: AppContext, emp: Employee): WeeklyOffGateStatus {
  const settings = getOperationSettings(ctx.db), { todayStr, nowHm } = getVnNowDateAndHm();
  const win = evaluateOffWindow(settings, todayStr, nowHm);
  const vipWindowActive = isVipOffWindowActive(emp), isEmp = matchEmp(emp);
  const activeInWeek = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && l.leave_date >= win.targetWeekStart && l.leave_date <= win.targetWeekEnd);
  const registeredDates = Array.from(new Set(activeInWeek.map((l) => l.leave_date))).sort();
  const registeredCount = registeredDates.length, requiredCount = settings.officialWeeklyOffLimit || 2;
  const weekLocked = Boolean(findWeekLock(ctx, emp.branch_id, win.targetWeekStart));
  const isOpen = (win.isOpen || vipWindowActive) && !weekLocked;
  const gateLocked = emp.stage === 'OFFICIAL' && isOpen && registeredCount < requiredCount;
  const message = gateLocked
    ? `Cổng đăng ký nghỉ OFF tuần ${vi(win.targetWeekStart)} – ${vi(win.targetWeekEnd)} đang mở. Bạn cần đăng ký đủ ${requiredCount} ngày OFF (hiện có ${registeredCount}/${requiredCount}) trước khi sử dụng các chức năng khác.`
    : vipWindowActive
    ? `Bạn đang được mở cổng bù VIP đến ${dayjs(emp.vip_off_window_until).format('HH:mm DD/MM/YYYY')} cho tuần ${vi(win.targetWeekStart)} – ${vi(win.targetWeekEnd)}.`
    : win.message;
  return {
    gateLocked, isOpen, registeredCount, requiredCount, registeredDates,
    targetWeekStart: win.targetWeekStart, targetWeekEnd: win.targetWeekEnd, opensAt: win.opensAt, closesAt: win.closesAt,
    vipWindowActive, vipWindowUntil: emp.vip_off_window_until || null, message,
  };
}

export async function submitWeeklyOffBatch(
  ctx: AppContext,
  params: { emp: Employee; leaveDates: string[]; reason?: string; actorId: string; skipWindowCheck?: boolean },
): Promise<{ weekStart: string; weekEnd: string; leaveDates: string[]; replacedCount: number; created: LeaveRequest[]; gate: WeeklyOffGateStatus }> {
  const { emp, actorId } = params;
  if (emp.stage !== 'OFFICIAL') throw Errors.forbidden('Cổng đăng ký 2 ngày OFF hàng tuần chỉ áp dụng cho Nhân viên chính thức');
  const uniqueDates = Array.from(new Set(params.leaveDates)).sort(), gate = evaluateEmployeeWeeklyOffGate(ctx, emp);
  if (uniqueDates.length !== gate.requiredCount) {
    throw Errors.fieldValidation('leave_dates', 'INVALID_VALUE', `Nhân viên chính thức bắt buộc chọn đúng ${gate.requiredCount} ngày nghỉ OFF khác nhau trong tuần`, params.leaveDates);
  }
  if (!params.skipWindowCheck && !gate.isOpen && !gate.vipWindowActive) {
    throw Errors.fieldValidation('leave_dates', 'OUT_OF_RANGE', gate.message, uniqueDates);
  }
  const d0 = uniqueDates[0]!, d1 = uniqueDates[1]!;
  if (mondayOfWeek(d0) !== mondayOfWeek(d1)) {
    throw Errors.fieldValidation('leave_dates', 'OUT_OF_RANGE', 'Hai ngày nghỉ OFF phải nằm trong cùng một tuần làm việc', uniqueDates);
  }
  const inTargetWeek = d0 >= gate.targetWeekStart && d1 <= gate.targetWeekEnd;
  if (!inTargetWeek && !gate.vipWindowActive && !params.skipWindowCheck) {
    throw Errors.fieldValidation('leave_dates', 'OUT_OF_RANGE', `Chỉ được đăng ký nghỉ OFF cho tuần mục tiêu (${vi(gate.targetWeekStart)} – ${vi(gate.targetWeekEnd)})`, uniqueDates);
  }
  const weekStart = inTargetWeek ? gate.targetWeekStart : mondayOfWeek(d0), weekEnd = addDaysYmd(weekStart, 6);
  if (findWeekLock(ctx, emp.branch_id, weekStart)) {
    throw Errors.fieldValidation('leave_dates', 'OUT_OF_RANGE', 'HR đã chốt lịch tuần này, không thể thay đổi ngày nghỉ OFF', uniqueDates);
  }
  for (const d of uniqueDates) assertDateNotLockedByPayroll(ctx.db, d, 'đăng ký 2 ngày OFF hàng tuần');

  const shiftCode = (emp.default_shift_code || 'CA_SANG').toUpperCase(), isEmp = matchEmp(emp);
  const sameShiftOfficials = ctx.db.employees.filter((e) => e.status === 'ACTIVE' && e.stage === 'OFFICIAL' && e.branch_id === emp.branch_id && (e.default_shift_code || 'CA_SANG').toUpperCase() === shiftCode);
  const minStaff = resolveApplicableStaffingRule(ctx, emp.branch_id, shiftCode)?.min_staff ?? 1;

  for (const d of uniqueDates) {
    const peerOffs = ctx.db.leaveRequests.filter((l) => {
      if (l.leave_date !== d || !ACTIVE_LEAVE(l.status) || isEmp(l.employee_id)) return false;
      const pEmp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === l.employee_id);
      if (!pEmp || pEmp.status !== 'ACTIVE' || pEmp.stage !== 'OFFICIAL') return false;
      return pEmp.branch_id === emp.branch_id && (pEmp.default_shift_code || l.shift_code || 'CA_SANG').toUpperCase() === shiftCode;
    });
    const remaining = sameShiftOfficials.length - peerOffs.length - 1;
    if (peerOffs.length > 0 && (remaining < minStaff || peerOffs.length >= 1)) {
      throw new AppError(400, 'BUSINESS_RULE_VIOLATION', `Ngày ${vi(d)} tại chi nhánh đã có đồng nghiệp cùng ca cố định (${shiftCode}) đăng ký nghỉ OFF làm số nhân sự còn lại giảm dưới định biên an toàn. Vui lòng chọn ngày nghỉ khác!`, [
        { field: 'leave_dates', code: 'OUT_OF_RANGE', message: `Trùng ngày nghỉ ca cố định ${shiftCode} ngày ${vi(d)}`, rejected_value: d },
      ]);
    }
  }

  const existingInWeek = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && l.leave_date >= weekStart && l.leave_date <= weekEnd);
  for (const old of existingInWeek) await ctx.db.leaveRequests.softDelete(old.id, old.version, actorId);

  const now = nowIso(), baseSeq = ctx.db.leaveRequests.all(true).length, wkCode = weekLockCode(emp.branch_id, weekStart, ctx.db.partitionMonth);
  const created: LeaveRequest[] = [];
  for (let i = 0; i < uniqueDates.length; i++) {
    const lv = await ctx.db.leaveRequests.insert({
      request_code: `OFF-${String(baseSeq + i + 1).padStart(4, '0')}`,
      employee_id: emp.id, branch_id: emp.branch_id, leave_date: uniqueDates[i]!, kind: 'WEEKLY_OFF',
      shift_code: shiftCode, reason: params.reason || 'Đăng ký 2 ngày OFF định kỳ hàng tuần',
      status: 'PENDING', employee_stage: emp.stage, schedule_week_id: wkCode, assignment_id: '',
      quota_cycle_used: i + 1, quota_cycle_limit: gate.requiredCount,
      staffing_after_leave: Math.max(1, sameShiftOfficials.length - 1), min_staff_required: minStaff,
      submitted_at: now, store_reviewed_by: '', store_reviewed_at: '', decided_by: '', decision_reason: '', decided_at: '',
    }, actorId);
    created.push(lv);
  }
  return { weekStart, weekEnd, leaveDates: uniqueDates, replacedCount: existingInWeek.length, created, gate: evaluateEmployeeWeeklyOffGate(ctx, emp) };
}

export async function grantEmployeeVipOffWindow(
  ctx: AppContext,
  params: { employeeId: string; durationMinutes: number; actorId: string },
): Promise<{ employeeId: string; employeeCode: string; fullName: string; durationMinutes: number; vip_off_window_until: string }> {
  const cleanId = params.employeeId.trim();
  const emp = ctx.db.employees.get(cleanId) ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === cleanId.toUpperCase());
  if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy hồ sơ nhân sự', params.employeeId);
  const mins = Math.round(Number(params.durationMinutes) || 60);
  if (mins < 30 || mins > 120) throw Errors.fieldValidation('duration_minutes', 'OUT_OF_RANGE', 'Thời lượng mở cổng bù VIP phải từ 30 đến 120 phút', params.durationMinutes);
  const untilIso = dayjs().add(mins, 'minute').toISOString();
  const updated = await ctx.db.employees.update(emp.id, emp.version, { vip_off_window_until: untilIso }, params.actorId);
  return { employeeId: updated.id, employeeCode: updated.employee_code, fullName: updated.full_name, durationMinutes: mins, vip_off_window_until: updated.vip_off_window_until };
}

export type CleanupAction = 'CLEAN_STALE_DRAFTS' | 'DEDUPE_SHIFTS' | 'BACKFILL_NEW_OFFICIAL';

export async function executeSchedulePlannerCleanup(
  ctx: AppContext,
  params: { weekStart: string; branchIds: string[]; actions: CleanupAction[]; historicalShifts?: ShiftAssignment[]; actorId: string },
) {
  const weekStart = mondayOfWeek(params.weekStart), weekEnd = addDaysYmd(weekStart, 6);
  const branchSet = new Set(params.branchIds), actSet = new Set(params.actions);
  let cleanedDraftCount = 0, dedupedCount = 0, backfilledCount = 0;
  const createdIds: string[] = [];

  if (actSet.has('CLEAN_STALE_DRAFTS')) {
    const staleDrafts = ctx.db.shiftAssignments.filter(
      (a) => a.status === 'DRAFT' && a.work_date >= weekStart && a.work_date <= weekEnd && branchSet.has(resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id)),
    );
    for (const d of staleDrafts) {
      await ctx.db.shiftAssignments.softDelete(d.id, d.version, params.actorId);
      cleanedDraftCount++;
    }
  }

  if (actSet.has('DEDUPE_SHIFTS')) {
    const rank = (s: ShiftAssignment['status']) => (s === 'COMPLETED' ? 3 : s === 'PUBLISHED' ? 2 : 1);
    const groups = new Map<string, ShiftAssignment[]>();
    for (const a of ctx.db.shiftAssignments.all()) {
      if (a.work_date < weekStart || a.work_date > weekEnd || !isCountedWorkShift(a)) continue;
      if (!branchSet.has(resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id))) continue;
      const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
      const k = `${emp?.id ?? a.employee_id}|${a.work_date}|${a.shift_code.toUpperCase()}`;
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    for (const list of groups.values()) {
      if (list.length <= 1) continue;
      const sorted = [...list].sort((x, y) => rank(y.status) - rank(x.status));
      for (const dup of sorted.slice(1)) {
        await ctx.db.shiftAssignments.softDelete(dup.id, dup.version, params.actorId);
        dedupedCount++;
      }
    }
  }

  if (actSet.has('BACKFILL_NEW_OFFICIAL')) {
    const now = nowIso();
    for (const bId of params.branchIds) {
      const plan = planOfficialWeek(ctx, { weekStart, branchId: bId, historicalShifts: params.historicalShifts });
      const wkCode = weekLockCode(bId, weekStart, ctx.db.partitionMonth);
      for (const p of plan.planned) {
        const ins = await ctx.db.shiftAssignments.insert({
          schedule_week_id: wkCode, employee_id: p.employeeId, branch_id: p.branchId, work_date: p.workDate, shift_template_id: p.templateId,
          start_at: p.startAt, end_at: p.endAt, status: 'PUBLISHED', source: 'AUTO_PLAN', employee_stage: p.stage, day_type: 'WORK', shift_code: p.shiftCode,
          scheduled_hours: p.hours, swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: now,
          note: 'Bổ sung ca tự động cho nhân sự chính thức khi dọn lịch tuần', linked_assignment_id: '',
        }, params.actorId);
        createdIds.push(ins.id);
        backfilledCount++;
      }
    }
  }

  return { weekStart, weekEnd, cleanedDraftCount, dedupedCount, backfilledCount, createdIds };
}
