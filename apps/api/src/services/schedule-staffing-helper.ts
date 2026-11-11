import { DEFAULT_SHIFT_LABELS, type Employee, type ShiftAssignment, type StaffingRule } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { parseHm } from '../routes/attendance-helpers.js';
import { getCheckoutGraceMinutes } from './checkout-grace.js';
import { getCachedPartitionStore, resolveTargetMonthForRecord } from './partition-write-router.js';
import { isDisallowedProbationShiftCode, isProbationShift } from './schedule-rules.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';
export { formatGraceLabel, getCheckoutGraceMinutes, setCheckoutGraceMinutes } from './checkout-grace.js';
export { assertApprovedShiftNoteOnlyPatch } from './schedule-rules.js';

export interface ShiftCheckoutWindow {
  isPastEnd: boolean; isWithinCheckoutGrace: boolean; isCheckoutLocked: boolean;
  graceDeadlineHm: string; lateCheckInMinutes: number; earlyLeaveMinutes: number;
}

function getShiftStoreForDate(ctx: AppContext, workDate: string) {
  const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: workDate }, workDate);
  return getCachedPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', targetMonth) ?? ctx.db.shiftAssignments;
}

export function getShiftCheckoutWindow(workDate: string, startAt = '07:00', endAt = '12:00', nowDate?: string, nowHm?: string): ShiftCheckoutWindow {
  const vn = (!nowDate || !nowHm) ? getVnNowDateAndHm() : { todayStr: nowDate, nowHm };
  const safeStart = /^\d{2}:\d{2}$/.test(startAt) ? startAt : '07:00', safeEnd = /^\d{2}:\d{2}$/.test(endAt) ? endAt : '12:00';
  const startDt = dayjs(`${workDate}T${safeStart}:00`), rawEndDt = dayjs(`${workDate}T${safeEnd}:00`);
  const endDt = parseHm(safeEnd) <= parseHm(safeStart) ? rawEndDt.add(1, 'day') : rawEndDt;
  const graceEndDt = endDt.add(getCheckoutGraceMinutes(), 'minute'), nowDt = dayjs(`${vn.todayStr}T${vn.nowHm}:00`);
  const isPastEnd = nowDt.isAfter(endDt), isCheckoutLocked = nowDt.isAfter(graceEndDt), isWithinCheckoutGrace = isPastEnd && !isCheckoutLocked;
  return {
    isPastEnd, isWithinCheckoutGrace, isCheckoutLocked, graceDeadlineHm: graceEndDt.format('HH:mm'),
    lateCheckInMinutes: Math.max(0, nowDt.diff(startDt, 'minute')), earlyLeaveMinutes: Math.max(0, endDt.diff(nowDt, 'minute')),
  };
}

export function toMinuteSpan(startAt: string, endAt: string): [number, number] {
  const s = parseHm(startAt || '07:00'), rawE = parseHm(endAt || '12:00');
  return [s, rawE <= s ? rawE + 1440 : rawE];
}

export function findEmployeeShiftConflictOnDate(
  ctx: AppContext,
  params: { emp: Employee; workDate: string; shiftCode: string; startAt: string; endAt: string; dayType?: string; status?: string; excludeId?: string },
): { kind: 'SAME_SHIFT' | 'OVERLAP_SHIFT'; message: string } | null {
  const { emp, workDate, shiftCode, startAt, endAt, dayType = 'WORK', status = 'PUBLISHED', excludeId } = params;
  const dateVi = dayjs(workDate).format('DD/MM/YYYY'), isNewWorkShift = dayType !== 'OFF' && status !== 'ON_LEAVE';
  const [newStart, newEnd] = toMinuteSpan(startAt, endAt), shiftStore = getShiftStoreForDate(ctx, workDate);

  for (const a of shiftStore.all()) {
    if ((excludeId && a.id === excludeId) || a.work_date !== workDate) continue;
    if (a.employee_id !== emp.id && a.employee_id !== emp.employee_code) continue;
    const exTpl = findBranchShiftTemplate(ctx, a.shift_code, a.branch_id || emp.branch_id);
    const exLabel = exTpl?.name ?? DEFAULT_SHIFT_LABELS[a.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? a.shift_code;
    if (a.shift_code === shiftCode) {
      return { kind: 'SAME_SHIFT', message: `Nhân sự ${emp.full_name} (${emp.employee_code}) đã có ${exLabel} trong ngày ${dateVi}, không được phân hoặc đăng ký cùng 1 người nhiều hơn 1 lần trong cùng 1 ca.` };
    }
    const isExistingWorkShift = a.day_type !== 'OFF' && a.status !== 'ON_LEAVE';
    if (isNewWorkShift && isExistingWorkShift) {
      const [exStart, exEnd] = toMinuteSpan(a.start_at || exTpl?.start_time || '07:00', a.end_at || exTpl?.end_time || '12:00');
      if (newStart < exEnd && newEnd > exStart) {
        return { kind: 'OVERLAP_SHIFT', message: `Khung giờ ca đã chọn (${startAt} – ${endAt}) bị trùng giờ với ${exLabel} (${a.start_at || exTpl?.start_time || '07:00'} – ${a.end_at || exTpl?.end_time || '12:00'}) của ${emp.full_name} trong ngày ${dateVi}.` };
      }
    }
  }
  return null;
}

export function assertNoDuplicateOrOverlappingEmployeeShift(
  ctx: AppContext,
  params: Parameters<typeof findEmployeeShiftConflictOnDate>[1] & { field?: string },
): void {
  const conflict = findEmployeeShiftConflictOnDate(ctx, params);
  if (conflict) throw Errors.fieldValidation(params.field ?? 'shift_code', 'DUPLICATE_VALUE', conflict.message, params.shiftCode);
}

export function resolveApplicableStaffingRule(ctx: AppContext, branchId: string, shiftCode: string): StaffingRule | null {
  if (!branchId || branchId === 'ALL') return null;
  const branch = ctx.db.branches.get(branchId) ?? ctx.db.branches.find((b) => b.code.toUpperCase() === branchId.trim().toUpperCase());
  const branchKeys = new Set([branchId, branch?.id, branch?.code, branch?.code.toUpperCase()].filter(Boolean) as string[]);
  const allTemplates = ctx.db.shiftTemplates.all(true), shiftUpper = shiftCode.trim().toUpperCase();
  let bestRule: StaffingRule | null = null, bestScore = 0;

  for (const r of ctx.db.staffingRules.all()) {
    const rb = (r.branch_id || '').trim(), isGlobalBranch = !rb || rb === 'ALL';
    const isExactBranch = !isGlobalBranch && (branchKeys.has(rb) || branchKeys.has(rb.toUpperCase()));
    if (!isExactBranch && !isGlobalBranch) continue;

    const rs = (r.shift_template_id || '').trim(), isGlobalShift = !rs || rs === 'ALL';
    let isExactShift = !isGlobalShift && rs.toUpperCase() === shiftUpper;
    if (!isGlobalShift && !isExactShift) {
      const tpl = allTemplates.find((s) => s.id === rs || s.code.toUpperCase() === rs.toUpperCase());
      isExactShift = tpl?.code.toUpperCase() === shiftUpper;
    }
    if (!isExactShift && !isGlobalShift) continue;

    const score = (isExactBranch ? 2 : 0) + (isExactShift ? 1 : 0) + 1;
    if (score > bestScore) { bestScore = score; bestRule = r; }
  }
  return bestRule;
}

export function evaluateBranchShiftCapacity(
  ctx: AppContext,
  params: { branchId: string; workDate: string; shiftCode: string; startAt?: string; endAt?: string; emp?: Employee },
) {
  const branch = ctx.db.branches.get(params.branchId) ?? ctx.db.branches.find((b) => b.code === params.branchId);
  const canonicalBranchId = branch?.id ?? params.branchId, branchName = branch ? `${branch.code} — ${branch.name}` : params.branchId;
  const tpl = findBranchShiftTemplate(ctx, params.shiftCode, canonicalBranchId);
  const shiftLabel = tpl?.name ?? DEFAULT_SHIFT_LABELS[params.shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? params.shiftCode;
  const startAt = params.startAt || tpl?.start_time || '07:00', endAt = params.endAt || tpl?.end_time || '12:00';
  const shiftStore = getShiftStoreForDate(ctx, params.workDate);

  const branchShiftRows = shiftStore.filter(
    (a) => a.work_date === params.workDate && a.shift_code === params.shiftCode && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && !isProbationShift(ctx, a) && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === canonicalBranchId,
  );
  const approvedCount = branchShiftRows.filter((a) => a.status === 'PUBLISHED' || a.status === 'COMPLETED').length;
  const pendingDraftCount = branchShiftRows.filter((a) => a.status === 'DRAFT').length;
  const rule = resolveApplicableStaffingRule(ctx, canonicalBranchId, params.shiftCode);
  const minStaff = rule?.min_staff ?? 1, maxStaff = rule?.max_staff ?? 1, isProbationEmp = params.emp?.stage === 'PROBATION';
  const disallowedProbationShift = isProbationEmp && isDisallowedProbationShiftCode(params.shiftCode, tpl);
  const isFullOrExceeded = !isProbationEmp && approvedCount >= maxStaff;
  const { todayStr, nowHm } = getVnNowDateAndHm(), isPastDate = params.workDate < todayStr, isPastStartToday = params.workDate === todayStr && nowHm >= startAt;

  const empConflict = params.emp ? findEmployeeShiftConflictOnDate(ctx, { emp: params.emp, workDate: params.workDate, shiftCode: params.shiftCode, startAt, endAt }) : null;
  const alreadyHasShift = empConflict?.kind === 'SAME_SHIFT', hasOverlappingShift = empConflict?.kind === 'OVERLAP_SHIFT', dateVi = dayjs(params.workDate).format('DD/MM/YYYY');

  let message = `${shiftLabel} ngày ${dateVi} tại ${branchName}: Hiện có ${approvedCount} nhân sự chính thức đã duyệt.`;
  if (isPastDate) message = `Không thể đăng ký ca cho ngày đã qua trong quá khứ (${dateVi}).`;
  else if (isPastStartToday) message = `Khung ca ${shiftLabel} (${startAt} – ${endAt}) hôm nay đã qua giờ bắt đầu (${startAt}), không thể đăng ký thêm ca này. Vui lòng chọn ca khác hoặc ngày tiếp theo.`;
  else if (disallowedProbationShift) message = 'Nhân viên thử việc chỉ được phép đăng ký các ca cửa hàng (Ca Sáng, Ca Chiều, Ca Tối), không được đăng ký Ca Hành chính.';
  else if (empConflict) message = empConflict.message.replace(`Nhân sự ${params.emp!.full_name} (${params.emp!.employee_code})`, 'Bạn');
  else if (isProbationEmp) message = `${shiftLabel} ngày ${dateVi} tại ${branchName}: Nhân viên thử việc được phép đăng ký học việc cùng nhân sự chính thức (không tính vào định biên ${approvedCount}/${maxStaff} người).`;
  else if (isFullOrExceeded) message = `${shiftLabel} ngày ${dateVi} tại ${branchName} đã đủ ${approvedCount}/${maxStaff} nhân sự chính thức theo định biên (mỗi ca chỉ bố trí đúng ${maxStaff} người), không thể xếp thêm.`;
  else message = `${shiftLabel} ngày ${dateVi} tại ${branchName}: Đã duyệt ${approvedCount}/${maxStaff} nhân sự chính thức (còn nhận tối đa ${Math.max(0, maxStaff - approvedCount)} suất).`;

  return {
    branchId: canonicalBranchId, branchName, workDate: params.workDate, shiftCode: params.shiftCode, shiftLabel,
    approvedCount, pendingDraftCount, minStaff, maxStaff, isFullOrExceeded, alreadyHasShift, hasOverlappingShift,
    canRegister: !isPastDate && !isPastStartToday && !disallowedProbationShift && !isFullOrExceeded && !empConflict, message,
  };
}

export function assertBranchShiftCapacityAvailable(
  ctx: AppContext,
  params: { branchId: string; workDate: string; shiftCode: string; excludeIds?: string[]; extraCount?: number; field?: string; isProbation?: boolean },
): void {
  if (params.isProbation) return;
  const branch = ctx.db.branches.get(params.branchId) ?? ctx.db.branches.find((b) => b.code === params.branchId);
  const canonicalBranchId = branch?.id ?? params.branchId, branchName = branch ? `${branch.code} — ${branch.name}` : params.branchId;
  const tpl = findBranchShiftTemplate(ctx, params.shiftCode, canonicalBranchId);
  const shiftLabel = tpl?.name ?? DEFAULT_SHIFT_LABELS[params.shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? params.shiftCode;
  const skip = new Set((params.excludeIds ?? []).filter(Boolean)), shiftStore = getShiftStoreForDate(ctx, params.workDate);
  const approvedCount = shiftStore.filter(
    (a) => !skip.has(a.id) && a.work_date === params.workDate && a.shift_code === params.shiftCode && a.day_type !== 'OFF' && (a.status === 'PUBLISHED' || a.status === 'COMPLETED') && !isProbationShift(ctx, a) && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === canonicalBranchId,
  ).length + (params.extraCount ?? 0);
  const maxStaff = resolveApplicableStaffingRule(ctx, canonicalBranchId, params.shiftCode)?.max_staff ?? 1;
  if (approvedCount >= maxStaff) {
    const dateVi = dayjs(params.workDate).format('DD/MM/YYYY');
    throw Errors.fieldValidation(params.field ?? 'shift_code', 'OUT_OF_RANGE', `${shiftLabel} ngày ${dateVi} tại ${branchName} đã đủ ${approvedCount}/${maxStaff} nhân sự chính thức theo quy định (mỗi ca chỉ có ${maxStaff} người chính thức, không thể xếp nhiều hơn).`, params.shiftCode);
  }
}
