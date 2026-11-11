import { DEFAULT_SHIFT_LABELS, REQUEST_STATUS_LABELS, type DefaultShiftCode, type Employee, type LeaveRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { collectLeavesInRangeAcrossPartitions, getShiftStoreForDate } from './schedule-auto-planner.js';
import { isCountedWorkShift, isProbationShift, matchEmp } from './schedule-rules.js';
import { resolveApplicableStaffingRule } from './schedule-staffing-helper.js';

const ACTIVE_OFF = new Set(['PENDING', 'DRAFT', 'APPROVED']);
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');
const cleanShift = (raw: string) => raw.replace(/\s*\([^)]*\)\s*/g, '').trim();

export interface OffConflictPeerItem {
  requestId: string;
  requestCode: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  shiftCode: string;
  shiftLabel: string;
  status: string;
  statusLabel: string;
}

export interface LeaveRequestConflictInfo {
  hasConflict: boolean;
  severity: 'NONE' | 'WARNING' | 'CRITICAL';
  willUnderstaffShift: boolean;
  sameShiftOffCount: number;
  sameShiftTotalStaff: number;
  remainingGroupStaff: number;
  minStaffRequired: number;
  sameBranchOffCount: number;
  shiftCode: string;
  shiftLabel: string;
  sameShiftPeers: OffConflictPeerItem[];
  otherShiftPeers: OffConflictPeerItem[];
  warningMessage: string;
}

export interface PlannerOffConflictGroup {
  key: string;
  branchId: string;
  branchName: string;
  leaveDate: string;
  severity: 'WARNING' | 'CRITICAL';
  totalOffCount: number;
  emptyShiftSummaries: string[];
  employees: OffConflictPeerItem[];
  message: string;
}

function resolveEmp(ctx: AppContext, empIdOrCode: string): Employee | undefined {
  return ctx.db.employees.get(empIdOrCode) ?? ctx.db.employees.find((e) => e.employee_code === empIdOrCode);
}

function resolveLeaveShift(ctx: AppContext, req: LeaveRequest, emp?: Employee, branchId?: string) {
  const bId = branchId || emp?.branch_id || req.branch_id;
  const assigned = getShiftStoreForDate(ctx, req.leave_date).find(
    (a) => a.work_date === req.leave_date && isCountedWorkShift(a) && (a.employee_id === req.employee_id || Boolean(emp && matchEmp(emp)(a.employee_id))),
  );
  const code = (assigned?.shift_code || emp?.default_shift_code || req.shift_code || 'CA_SANG').toUpperCase();
  const tpl = findBranchShiftTemplate(ctx, code, bId);
  const fullLabel = tpl?.name || DEFAULT_SHIFT_LABELS[code as DefaultShiftCode] || code;
  return { code, label: cleanShift(fullLabel) };
}

function listActiveShiftGroupEmployees(ctx: AppContext, branchId: string, shiftCode: string): Employee[] {
  const targetCode = shiftCode.toUpperCase();
  return ctx.db.employees.filter(
    (e) => e.status === 'ACTIVE' && e.stage !== 'PROBATION' && e.branch_id === branchId && (e.default_shift_code || 'CA_SANG').toUpperCase() === targetCode,
  );
}

/**
 * Đánh giá xung đột nghỉ OFF trong cùng 1 ngày cho 1 đơn xin nghỉ:
 * - Phát hiện khi 2, 3, 4 (hoặc toàn bộ) nhân sự cùng nhóm ca / cùng chi nhánh đăng ký nghỉ OFF trùng ngày.
 * - Cảnh báo mức CRITICAL (trống ca / thiếu định biên) nếu duyệt đơn sẽ làm ca còn 0 / < min_staff người trực.
 */
export function evaluateLeaveRequestConflict(ctx: AppContext, target: LeaveRequest): LeaveRequestConflictInfo {
  const emp = resolveEmp(ctx, target.employee_id);
  const branchId = resolveEmployeeBranchId(ctx, target.employee_id, target.branch_id);
  const branchName = ctx.db.branches.get(branchId)?.name ?? 'Chi nhánh';
  const shift = resolveLeaveShift(ctx, target, emp, branchId);
  const minStaff = resolveApplicableStaffingRule(ctx, branchId, shift.code)?.min_staff ?? 1;
  const groupEmps = listActiveShiftGroupEmployees(ctx, branchId, shift.code);
  const sameShiftTotalStaff = Math.max(groupEmps.length, emp ? 1 : 0);

  if (!ACTIVE_OFF.has(target.status)) {
    return {
      hasConflict: false, severity: 'NONE', willUnderstaffShift: false, sameShiftOffCount: 0, sameShiftTotalStaff,
      remainingGroupStaff: sameShiftTotalStaff, minStaffRequired: minStaff, sameBranchOffCount: 0,
      shiftCode: shift.code, shiftLabel: shift.label, sameShiftPeers: [], otherShiftPeers: [], warningMessage: '',
    };
  }

  const peerLeaves = collectLeavesInRangeAcrossPartitions(ctx, [target.leave_date]).filter(
    (l) => l.id !== target.id && l.employee_stage !== 'PROBATION' && ACTIVE_OFF.has(l.status) && l.leave_date === target.leave_date && resolveEmployeeBranchId(ctx, l.employee_id, l.branch_id) === branchId
      && resolveEmp(ctx, l.employee_id)?.stage !== 'PROBATION',
  );
  const sameShiftPeers: OffConflictPeerItem[] = [];
  const otherShiftPeers: OffConflictPeerItem[] = [];

  for (const pl of peerLeaves) {
    const pEmp = resolveEmp(ctx, pl.employee_id);
    const pShift = resolveLeaveShift(ctx, pl, pEmp, branchId);
    const item: OffConflictPeerItem = {
      requestId: pl.id, requestCode: pl.request_code, employeeId: pEmp?.id ?? pl.employee_id,
      employeeCode: pEmp?.employee_code ?? pl.employee_id, employeeName: pEmp?.full_name ?? 'Nhân sự',
      shiftCode: pShift.code, shiftLabel: pShift.label, status: pl.status, statusLabel: REQUEST_STATUS_LABELS[pl.status] ?? pl.status,
    };
    if (pShift.code === shift.code) sameShiftPeers.push(item);
    else otherShiftPeers.push(item);
  }

  const offEmpCheckers = [target.employee_id, ...sameShiftPeers.map((p) => p.employeeId)].map((id) => {
    const e = resolveEmp(ctx, id);
    return e ? matchEmp(e) : (x: string) => x === id;
  });
  const availableGroupStaff = groupEmps.filter((ge) => !offEmpCheckers.some((fn) => fn(ge.id))).length;
  const publishedOtherShifts = getShiftStoreForDate(ctx, target.leave_date).filter(
    (a) => a.work_date === target.leave_date && a.shift_code.toUpperCase() === shift.code && a.status !== 'DRAFT'
      && !isProbationShift(ctx, a)
      && isCountedWorkShift(a) && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === branchId
      && !offEmpCheckers.some((fn) => fn(a.employee_id)),
  ).length;
  const remainingGroupStaff = Math.max(availableGroupStaff, publishedOtherShifts);
  const sameShiftOffCount = 1 + sameShiftPeers.length;
  const sameBranchOffCount = 1 + sameShiftPeers.length + otherShiftPeers.length;
  const willUnderstaffShift = remainingGroupStaff < minStaff;
  const hasMultiOff = sameBranchOffCount >= 2;
  const hasConflict = hasMultiOff || willUnderstaffShift;

  let severity: LeaveRequestConflictInfo['severity'] = 'NONE';
  let warningMessage = '';
  const selfName = emp ? `${emp.full_name} (${emp.employee_code})` : target.employee_id;

  if (willUnderstaffShift && sameShiftPeers.length > 0) {
    severity = 'CRITICAL';
    const names = [selfName, ...sameShiftPeers.map((p) => `${p.employeeName} (${p.employeeCode} - ${p.statusLabel})`)].join(', ');
    warningMessage = `Cảnh báo trống ca: Ngày ${vi(target.leave_date)} tại ${branchName} có ${sameShiftOffCount}/${sameShiftTotalStaff} nhân sự ${shift.label} cùng đăng ký nghỉ OFF (${names}). Nếu duyệt hết sẽ chỉ còn ${remainingGroupStaff}/${minStaff} người trực ca này!`;
  } else if (sameShiftPeers.length > 0) {
    severity = 'WARNING';
    const peerNames = sameShiftPeers.map((p) => `${p.employeeName} (${p.employeeCode} - ${p.statusLabel})`).join(', ');
    warningMessage = `Trùng ngày nghỉ cùng ${shift.label}: Ngày ${vi(target.leave_date)} tại ${branchName} có ${sameShiftOffCount}/${sameShiftTotalStaff} nhân sự cùng xin nghỉ (trùng với ${peerNames}) — còn ${remainingGroupStaff}/${minStaff} người trực.`;
  } else if (willUnderstaffShift && otherShiftPeers.length > 0) {
    severity = 'CRITICAL';
    const peerNames = otherShiftPeers.map((p) => `${p.employeeName} (${p.shiftLabel})`).join(', ');
    warningMessage = `Cảnh báo thiếu người trực & trùng ngày nghỉ: Ngày ${vi(target.leave_date)} tại ${branchName} có ${sameBranchOffCount} nhân sự cùng xin nghỉ (${peerNames}), đồng thời ${shift.label} chỉ còn ${remainingGroupStaff}/${minStaff} người trực!`;
  } else if (otherShiftPeers.length > 0) {
    severity = 'WARNING';
    const peerNames = otherShiftPeers.map((p) => `${p.employeeName} (${p.employeeCode} · ${p.shiftLabel})`).join(', ');
    warningMessage = `Nhiều nhân sự cùng xin nghỉ ngày ${vi(target.leave_date)}: Tại ${branchName} có ${sameBranchOffCount} nhân sự đăng ký OFF trùng ngày (cùng ngày với ${peerNames}).`;
  } else if (willUnderstaffShift) {
    severity = 'WARNING';
    warningMessage = `Lưu ý định biên ${shift.label}: Tại ${branchName} ngày ${vi(target.leave_date)}, nếu duyệt đơn nghỉ OFF của ${selfName} sẽ còn ${remainingGroupStaff}/${minStaff} nhân sự thuộc nhóm ${shift.label}.`;
  }

  return {
    hasConflict, severity, willUnderstaffShift, sameShiftOffCount, sameShiftTotalStaff, remainingGroupStaff,
    minStaffRequired: minStaff, sameBranchOffCount, shiftCode: shift.code, shiftLabel: shift.label,
    sameShiftPeers, otherShiftPeers, warningMessage,
  };
}

/** Tổng hợp các ngày trong tuần có từ 2 nhân sự trở lên cùng đăng ký OFF (hoặc làm trống ca) để cảnh báo nổi bật cho HR trên màn hình Chốt Lịch Tuần. */
export function summarizeWeekOffConflicts(
  ctx: AppContext,
  params: { weekStart: string; weekEnd: string; branchIds: string[] },
): PlannerOffConflictGroup[] {
  const branchSet = new Set(params.branchIds);
  const leaves = collectLeavesInRangeAcrossPartitions(ctx, [params.weekStart, params.weekEnd]).filter((l) => {
    if (!ACTIVE_OFF.has(l.status) || l.employee_stage === 'PROBATION' || l.leave_date < params.weekStart || l.leave_date > params.weekEnd) return false;
    if (resolveEmp(ctx, l.employee_id)?.stage === 'PROBATION') return false;
    return branchSet.has(resolveEmployeeBranchId(ctx, l.employee_id, l.branch_id));
  });

  const byBranchDate = new Map<string, LeaveRequest[]>();
  for (const l of leaves) {
    const bId = resolveEmployeeBranchId(ctx, l.employee_id, l.branch_id);
    const k = `${bId}|${l.leave_date}`;
    byBranchDate.set(k, [...(byBranchDate.get(k) ?? []), l]);
  }

  const groups: PlannerOffConflictGroup[] = [];
  for (const [key, dayLeaves] of Array.from(byBranchDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const [branchId, leaveDate] = key.split('|') as [string, string];
    const branchName = ctx.db.branches.get(branchId)?.name ?? 'Chi nhánh';
    const evals = dayLeaves.map((l) => ({ leave: l, info: evaluateLeaveRequestConflict(ctx, l) }));
    const criticalShifts = new Map<string, string>();
    for (const { info } of evals) {
      if (info.willUnderstaffShift) {
        criticalShifts.set(info.shiftCode, `${info.shiftLabel} (${info.sameShiftOffCount}/${info.sameShiftTotalStaff} nhân sự nghỉ — còn ${info.remainingGroupStaff}/${info.minStaffRequired} người trực)`);
      }
    }
    if (dayLeaves.length < 2 && criticalShifts.size === 0) continue;

    const employees: OffConflictPeerItem[] = evals.map(({ leave, info }) => {
      const e = resolveEmp(ctx, leave.employee_id);
      return {
        requestId: leave.id, requestCode: leave.request_code, employeeId: e?.id ?? leave.employee_id,
        employeeCode: e?.employee_code ?? leave.employee_id, employeeName: e?.full_name ?? 'Nhân sự',
        shiftCode: info.shiftCode, shiftLabel: info.shiftLabel, status: leave.status,
        statusLabel: REQUEST_STATUS_LABELS[leave.status] ?? leave.status,
      };
    });
    const emptyShiftSummaries = Array.from(criticalShifts.values());
    const severity: 'WARNING' | 'CRITICAL' = emptyShiftSummaries.length > 0 ? 'CRITICAL' : 'WARNING';
    const empSummary = employees.map((e) => `${e.employeeName} (${e.employeeCode} · ${e.shiftLabel})`).join(', ');
    const message = emptyShiftSummaries.length > 0
      ? `Ngày ${vi(leaveDate)} tại ${branchName}: Có ${employees.length} nhân sự đăng ký nghỉ OFF (${empSummary}) làm thiếu người trực tại ${emptyShiftSummaries.join('; ')}. HR nên xem xét từ chối bớt đơn trùng hoặc điều phối người thay trước khi chốt lịch!`
      : `Ngày ${vi(leaveDate)} tại ${branchName}: Có ${employees.length} nhân sự cùng đăng ký nghỉ OFF trong một ngày (${empSummary}).`;

    groups.push({ key, branchId, branchName, leaveDate, severity, totalOffCount: employees.length, emptyShiftSummaries, employees, message });
  }
  return groups;
}
