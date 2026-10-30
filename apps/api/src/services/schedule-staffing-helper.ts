import { DEFAULT_SHIFT_LABELS, type Employee, type StaffingRule } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { parseHm } from '../routes/attendance-helpers.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

export const CHECKOUT_GRACE_MINUTES = 60;

export interface ShiftCheckoutWindow {
  isPastEnd: boolean;
  isWithinCheckoutGrace: boolean;
  isCheckoutLocked: boolean;
  graceDeadlineHm: string;
  lateCheckInMinutes: number;
  earlyLeaveMinutes: number;
}

export function getShiftCheckoutWindow(
  workDate: string,
  startAt = '07:00',
  endAt = '12:00',
  nowDate?: string,
  nowHm?: string,
): ShiftCheckoutWindow {
  const vn = (!nowDate || !nowHm) ? getVnNowDateAndHm() : { todayStr: nowDate, nowHm };
  const safeStart = /^\d{2}:\d{2}$/.test(startAt) ? startAt : '07:00';
  const safeEnd = /^\d{2}:\d{2}$/.test(endAt) ? endAt : '12:00';
  const startDt = dayjs(`${workDate}T${safeStart}:00`);
  const rawEndDt = dayjs(`${workDate}T${safeEnd}:00`);
  const endDt = parseHm(safeEnd) <= parseHm(safeStart) ? rawEndDt.add(1, 'day') : rawEndDt;
  const graceEndDt = endDt.add(CHECKOUT_GRACE_MINUTES, 'minute');
  const nowDt = dayjs(`${vn.todayStr}T${vn.nowHm}:00`);

  const isPastEnd = nowDt.isAfter(endDt);
  const isCheckoutLocked = nowDt.isAfter(graceEndDt);
  const isWithinCheckoutGrace = isPastEnd && !isCheckoutLocked;
  return {
    isPastEnd,
    isWithinCheckoutGrace,
    isCheckoutLocked,
    graceDeadlineHm: graceEndDt.format('HH:mm'),
    lateCheckInMinutes: Math.max(0, nowDt.diff(startDt, 'minute')),
    earlyLeaveMinutes: Math.max(0, endDt.diff(nowDt, 'minute')),
  };
}

function toMinuteSpan(startAt: string, endAt: string): [number, number] {
  const s = parseHm(startAt || '07:00');
  const rawE = parseHm(endAt || '12:00');
  return [s, rawE <= s ? rawE + 1440 : rawE];
}

export function findEmployeeShiftConflictOnDate(
  ctx: AppContext,
  params: {
    emp: Employee;
    workDate: string;
    shiftCode: string;
    startAt: string;
    endAt: string;
    dayType?: string;
    status?: string;
    excludeId?: string;
  },
): { kind: 'SAME_SHIFT' | 'OVERLAP_SHIFT'; message: string } | null {
  const { emp, workDate, shiftCode, startAt, endAt, dayType = 'WORK', status = 'PUBLISHED', excludeId } = params;
  const dateVi = dayjs(workDate).format('DD/MM/YYYY');
  const isNewWorkShift = dayType !== 'OFF' && status !== 'ON_LEAVE';
  const [newStart, newEnd] = toMinuteSpan(startAt, endAt);

  for (const a of ctx.db.shiftAssignments.all()) {
    if (excludeId && a.id === excludeId) continue;
    if (a.work_date !== workDate) continue;
    if (a.employee_id !== emp.id && a.employee_id !== emp.employee_code) continue;

    const exTpl = findBranchShiftTemplate(ctx, a.shift_code, a.branch_id || emp.branch_id);
    const exLabel = exTpl?.name ?? DEFAULT_SHIFT_LABELS[a.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? a.shift_code;
    if (a.shift_code === shiftCode) {
      return {
        kind: 'SAME_SHIFT',
        message: `Nhân sự ${emp.full_name} (${emp.employee_code}) đã có ${exLabel} trong ngày ${dateVi}, không được phân hoặc đăng ký cùng 1 người nhiều hơn 1 lần trong cùng 1 ca.`,
      };
    }
    const isExistingWorkShift = a.day_type !== 'OFF' && a.status !== 'ON_LEAVE';
    if (isNewWorkShift && isExistingWorkShift) {
      const [exStart, exEnd] = toMinuteSpan(a.start_at || exTpl?.start_time || '07:00', a.end_at || exTpl?.end_time || '12:00');
      if (newStart < exEnd && newEnd > exStart) {
        return {
          kind: 'OVERLAP_SHIFT',
          message: `Khung giờ ca đã chọn (${startAt} – ${endAt}) bị trùng giờ với ${exLabel} (${a.start_at || exTpl?.start_time || '07:00'} – ${a.end_at || exTpl?.end_time || '12:00'}) của ${emp.full_name} trong ngày ${dateVi}.`,
        };
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
  if (conflict) {
    throw Errors.fieldValidation(params.field ?? 'shift_code', 'DUPLICATE_VALUE', conflict.message, params.shiftCode);
  }
}

export function resolveApplicableStaffingRule(
  ctx: AppContext,
  branchId: string,
  shiftCode: string,
): StaffingRule | null {
  if (!branchId || branchId === 'ALL') return null;
  const branch = ctx.db.branches.get(branchId) ?? ctx.db.branches.find((b) => b.code === branchId);
  const branchKeys = new Set([branchId, branch?.id, branch?.code].filter(Boolean) as string[]);
  let bestRule: StaffingRule | null = null;
  let bestScore = 0;

  for (const r of ctx.db.staffingRules.all()) {
    const isGlobalBranch = !r.branch_id || r.branch_id === 'ALL';
    const isExactBranch = !isGlobalBranch && branchKeys.has(r.branch_id);
    if (!isExactBranch && !isGlobalBranch) continue;

    const isGlobalShift = !r.shift_template_id || r.shift_template_id === 'ALL';
    let isExactShift = !isGlobalShift && r.shift_template_id === shiftCode;
    if (!isGlobalShift && !isExactShift) {
      const tpl = ctx.db.shiftTemplates.get(r.shift_template_id) ?? ctx.db.shiftTemplates.find((s) => s.code === r.shift_template_id);
      isExactShift = tpl?.code === shiftCode;
    }
    if (!isExactShift && !isGlobalShift) continue;

    const score = (isExactBranch ? 2 : 0) + (isExactShift ? 1 : 0) + 1;
    if (score > bestScore) {
      bestScore = score;
      bestRule = r;
    }
  }
  return bestRule;
}

export function evaluateBranchShiftCapacity(
  ctx: AppContext,
  params: { branchId: string; workDate: string; shiftCode: string; startAt?: string; endAt?: string; emp?: Employee },
) {
  const branch = ctx.db.branches.get(params.branchId) ?? ctx.db.branches.find((b) => b.code === params.branchId);
  const canonicalBranchId = branch?.id ?? params.branchId;
  const branchName = branch ? `${branch.code} — ${branch.name}` : params.branchId;
  const tpl = findBranchShiftTemplate(ctx, params.shiftCode, canonicalBranchId);
  const shiftLabel = tpl?.name ?? DEFAULT_SHIFT_LABELS[params.shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? params.shiftCode;
  const startAt = params.startAt || tpl?.start_time || '07:00';
  const endAt = params.endAt || tpl?.end_time || '12:00';

  const branchShiftRows = ctx.db.shiftAssignments.filter(
    (a) =>
      a.work_date === params.workDate
      && a.shift_code === params.shiftCode
      && a.day_type !== 'OFF'
      && a.status !== 'ON_LEAVE'
      && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === canonicalBranchId,
  );
  const approvedCount = branchShiftRows.filter((a) => a.status === 'PUBLISHED' || a.status === 'COMPLETED').length;
  const pendingDraftCount = branchShiftRows.filter((a) => a.status === 'DRAFT').length;
  const rule = resolveApplicableStaffingRule(ctx, canonicalBranchId, params.shiftCode);
  const minStaff = rule?.min_staff ?? null;
  const maxStaff = rule?.max_staff ?? null;
  const isFullOrExceeded = maxStaff !== null && approvedCount >= maxStaff;

  const empConflict = params.emp
    ? findEmployeeShiftConflictOnDate(ctx, { emp: params.emp, workDate: params.workDate, shiftCode: params.shiftCode, startAt, endAt })
    : null;
  const alreadyHasShift = empConflict?.kind === 'SAME_SHIFT';
  const hasOverlappingShift = empConflict?.kind === 'OVERLAP_SHIFT';
  const dateVi = dayjs(params.workDate).format('DD/MM/YYYY');

  let message = `${shiftLabel} ngày ${dateVi} tại ${branchName}: Hiện có ${approvedCount} nhân sự đã duyệt.`;
  if (empConflict) {
    message = empConflict.message.replace(`Nhân sự ${params.emp!.full_name} (${params.emp!.employee_code})`, 'Bạn');
  } else if (isFullOrExceeded) {
    message = `${shiftLabel} ngày ${dateVi} tại ${branchName} đã đạt tối đa quân số đã duyệt (${approvedCount}/${maxStaff} nhân sự), không thể đăng ký thêm.`;
  } else if (maxStaff !== null) {
    message = `${shiftLabel} ngày ${dateVi} tại ${branchName}: Đã duyệt ${approvedCount}/${maxStaff} nhân sự (còn nhận tối đa ${Math.max(0, maxStaff - approvedCount)} suất).`;
  }

  return {
    branchId: canonicalBranchId, branchName, workDate: params.workDate, shiftCode: params.shiftCode, shiftLabel,
    approvedCount, pendingDraftCount, minStaff, maxStaff, isFullOrExceeded,
    alreadyHasShift, hasOverlappingShift, canRegister: !isFullOrExceeded && !empConflict, message,
  };
}
