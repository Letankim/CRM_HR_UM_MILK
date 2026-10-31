import { DEFAULT_SHIFT_LABELS, weekDates, type Employee, type LeaveRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { getOperationSettings } from './operations-settings.service.js';
import { employeeShiftsOnDate, matchEmp, resolveProbationCycle } from './schedule-rules.js';
import { findEmployeeShiftConflictOnDate, resolveApplicableStaffingRule } from './schedule-staffing-helper.js';

export interface PlannedShift {
  employeeId: string; employeeCode: string; employeeName: string; stage: Employee['stage']; branchId: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; hours: number; templateId: string;
}
export interface PlanIssue {
  kind: 'NO_TEMPLATE' | 'CAPACITY_FULL' | 'CONFLICT' | 'MAX_PER_DAY' | 'UNDERSTAFFED' | 'OFF_QUOTA' | 'NOT_ENOUGH_SHIFTS';
  employeeId: string; employeeName: string; workDate: string; shiftCode: string; message: string;
}
export interface PlanResult { planned: PlannedShift[]; issues: PlanIssue[]; offRequests: LeaveRequest[] }

const OFF_ACTIVE = new Set(['PENDING', 'DRAFT', 'APPROVED']);
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

/** Bộ đếm sức chứa ca theo chi nhánh / ngày / khung ca (gồm ca đã có trên lịch + ca dự kiến xếp thêm). */
function createCapacityTracker(ctx: AppContext) {
  const planned = new Map<string, number>();
  const key = (b: string, d: string, s: string) => `${b}|${d}|${s}`;
  const existing = (b: string, d: string, s: string) => ctx.db.shiftAssignments.filter((a) =>
    a.work_date === d && a.shift_code === s && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'SWAPPED' && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === b).length;
  return {
    count: (b: string, d: string, s: string) => existing(b, d, s) + (planned.get(key(b, d, s)) ?? 0),
    /** Mặc định mỗi khung ca chỉ xếp 1 người nếu chi nhánh chưa cấu hình định biên tối đa. */
    capacity: (b: string, s: string) => resolveApplicableStaffingRule(ctx, b, s)?.max_staff ?? 1,
    minStaff: (b: string, s: string) => resolveApplicableStaffingRule(ctx, b, s)?.min_staff ?? 0,
    add: (b: string, d: string, s: string) => planned.set(key(b, d, s), (planned.get(key(b, d, s)) ?? 0) + 1),
  };
}

type Tracker = ReturnType<typeof createCapacityTracker>;

/** Thử xếp ca mặc định cho 1 nhân sự trong 1 ngày; trả về ca dự kiến hoặc lỗi không xếp được. */
function tryPlanDefaultShift(ctx: AppContext, emp: Employee, workDate: string, tracker: Tracker, maxPerDay: number, plannedToday: number): PlannedShift | PlanIssue {
  const shiftCode = emp.default_shift_code || 'CA_SANG';
  const tpl = findBranchShiftTemplate(ctx, shiftCode, emp.branch_id);
  const label = tpl?.name ?? DEFAULT_SHIFT_LABELS[shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? shiftCode;
  const base = { employeeId: emp.id, employeeName: `${emp.full_name} (${emp.employee_code})`, workDate, shiftCode };
  if (!tpl) return { ...base, kind: 'NO_TEMPLATE', message: `Chi nhánh của ${base.employeeName} chưa cấu hình khung ca mặc định (${label}).` };
  if (employeeShiftsOnDate(ctx, emp, workDate).length + plannedToday >= maxPerDay) {
    return { ...base, kind: 'MAX_PER_DAY', message: `${base.employeeName} đã đủ ${maxPerDay} ca trong ngày ${vi(workDate)}.` };
  }
  const conflict = findEmployeeShiftConflictOnDate(ctx, { emp, workDate, shiftCode, startAt: tpl.start_time, endAt: tpl.end_time });
  if (conflict) return { ...base, kind: 'CONFLICT', message: conflict.message };
  const cap = tracker.capacity(emp.branch_id, shiftCode), cur = tracker.count(emp.branch_id, workDate, shiftCode);
  if (cur >= cap) {
    return { ...base, kind: 'CAPACITY_FULL', message: `${label} ngày ${vi(workDate)} đã đủ ${cur}/${cap} người theo định biên — không thể xếp thêm ${base.employeeName}.` };
  }
  return {
    employeeId: emp.id, employeeCode: emp.employee_code, employeeName: emp.full_name, stage: emp.stage, branchId: emp.branch_id,
    workDate, shiftCode, shiftLabel: label, startAt: tpl.start_time, endAt: tpl.end_time, hours: tpl.standard_hours || 5, templateId: tpl.id,
  };
}

const isPlanned = (x: PlannedShift | PlanIssue): x is PlannedShift => !('kind' in x);

/**
 * Lập kế hoạch tuần cho Nhân viên chính thức: mỗi ngày không nghỉ OFF được xếp đúng ca mặc định,
 * mỗi khung ca chỉ nhận số người theo định biên (mặc định 1 người), báo cáo mọi trường hợp không xếp được.
 */
export function planOfficialWeek(ctx: AppContext, params: { weekStart: string; branchId?: string }): PlanResult {
  const settings = getOperationSettings(ctx.db), tracker = createCapacityTracker(ctx), dates = weekDates(params.weekStart);
  const inBranch = (e: Employee) => !params.branchId || params.branchId === 'ALL' || e.branch_id === params.branchId;
  const emps = ctx.db.employees.filter((e) => isOfficialSwapEligibleEmployee(ctx, e) && Boolean(e.branch_id) && inBranch(e))
    .sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  const offRequests = ctx.db.leaveRequests.filter((l) => OFF_ACTIVE.has(l.status) && l.leave_date >= dates[0]! && l.leave_date <= dates[6]! && emps.some((e) => matchEmp(e)(l.employee_id)));
  const planned: PlannedShift[] = [], issues: PlanIssue[] = [];
  for (const workDate of dates) {
    for (const emp of emps) {
      if (offRequests.some((l) => matchEmp(emp)(l.employee_id) && l.leave_date === workDate)) continue;
      const code = emp.default_shift_code || 'CA_SANG';
      if (employeeShiftsOnDate(ctx, emp, workDate).some((a) => a.shift_code === code)) continue;
      const res = tryPlanDefaultShift(ctx, emp, workDate, tracker, settings.maxShiftsPerDay, 0);
      if (isPlanned(res)) { planned.push(res); tracker.add(emp.branch_id, workDate, res.shiftCode); } else issues.push(res);
    }
  }
  const branchShiftPairs = new Set(emps.map((e) => `${e.branch_id}|${e.default_shift_code || 'CA_SANG'}`));
  for (const pair of branchShiftPairs) {
    const [branchId, shiftCode] = pair.split('|') as [string, string];
    const min = tracker.minStaff(branchId, shiftCode);
    for (const workDate of dates) {
      const cur = tracker.count(branchId, workDate, shiftCode);
      if (min > 0 && cur < min) {
        const branchName = ctx.db.branches.get(branchId)?.name ?? branchId;
        issues.push({ kind: 'UNDERSTAFFED', employeeId: '', employeeName: '', workDate, shiftCode, message: `${branchName} · ${DEFAULT_SHIFT_LABELS[shiftCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? shiftCode} ngày ${vi(workDate)} còn thiếu ${min - cur} người so với định biên tối thiểu (${cur}/${min}).` });
      }
    }
  }
  return { planned, issues, offRequests };
}

/**
 * Lập kế hoạch chu kỳ thử việc 12 ngày: sau khi trừ các ngày OFF đã đăng ký (tối đa 5 ngày),
 * xếp ca mặc định vào các ngày còn lại cho đến khi đủ 7 ca bắt buộc.
 */
export function planProbationCycle(ctx: AppContext, emp: Employee, todayStr: string): PlanResult & { cycle: ReturnType<typeof resolveProbationCycle>; existingCount: number } {
  const settings = getOperationSettings(ctx.db), tracker = createCapacityTracker(ctx), cycle = resolveProbationCycle(emp, todayStr);
  const isEmp = matchEmp(emp);
  const offRequests = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && OFF_ACTIVE.has(l.status) && cycle.dates.includes(l.leave_date));
  const issues: PlanIssue[] = [], planned: PlannedShift[] = [];
  const empName = `${emp.full_name} (${emp.employee_code})`;
  if (offRequests.length > cycle.offLimit) {
    issues.push({ kind: 'OFF_QUOTA', employeeId: emp.id, employeeName: empName, workDate: cycle.start, shiftCode: '', message: `${empName} đăng ký ${offRequests.length} ngày OFF, vượt định mức ${cycle.offLimit} ngày / chu kỳ thử việc.` });
  }
  const existingCount = cycle.dates.reduce((sum, d) => sum + employeeShiftsOnDate(ctx, emp, d).length, 0);
  let total = existingCount;
  for (const workDate of cycle.dates) {
    if (total >= cycle.workRequired) break;
    if (workDate < todayStr || offRequests.some((l) => l.leave_date === workDate)) continue;
    if (employeeShiftsOnDate(ctx, emp, workDate).length > 0) continue;
    const res = tryPlanDefaultShift(ctx, emp, workDate, tracker, settings.maxShiftsPerDay, 0);
    if (isPlanned(res)) { planned.push(res); tracker.add(emp.branch_id, workDate, res.shiftCode); total++; } else issues.push(res);
  }
  if (total < cycle.workRequired) {
    issues.push({ kind: 'NOT_ENOUGH_SHIFTS', employeeId: emp.id, employeeName: empName, workDate: cycle.end, shiftCode: emp.default_shift_code, message: `Chỉ xếp được ${total}/${cycle.workRequired} ca bắt buộc cho ${empName} trong chu kỳ ${vi(cycle.start)} – ${vi(cycle.end)}.` });
  }
  return { planned, issues, offRequests, cycle, existingCount };
}
