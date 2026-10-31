import { DEFAULT_SHIFT_LABELS, weekDates, type Employee, type LeaveRequest, type ShiftTemplate } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { getOperationSettings } from './operations-settings.service.js';
import { employeeShiftsOnDate, isCountedWorkShift, matchEmp, resolveProbationCycle } from './schedule-rules.js';
import { findEmployeeShiftConflictOnDate, resolveApplicableStaffingRule, toMinuteSpan } from './schedule-staffing-helper.js';
import { listBranchStoreShiftTemplates } from './staffing-one-per-shift.service.js';

export interface PlannedShift {
  employeeId: string; employeeCode: string; employeeName: string; stage: Employee['stage']; branchId: string; branchName?: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; hours: number; templateId: string; isCoverShift?: boolean;
}
export interface PlanIssue {
  kind: 'NO_TEMPLATE' | 'CAPACITY_FULL' | 'CONFLICT' | 'MAX_PER_DAY' | 'UNDERSTAFFED' | 'OFF_QUOTA' | 'NOT_ENOUGH_SHIFTS';
  employeeId: string; employeeName: string; workDate: string; shiftCode: string; message: string;
}
export interface PlanResult { planned: PlannedShift[]; issues: PlanIssue[]; offRequests: LeaveRequest[] }

const OFF_ACTIVE = new Set(['PENDING', 'DRAFT', 'APPROVED']);
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

/** Bộ đếm sức chứa ca theo chi nhánh / ngày / khung ca (mặc định quy tắc chuẩn: 1 ca = đúng 1 người, không thiếu không thừa). */
function createCapacityTracker(ctx: AppContext, ignoredAssignmentIds: Set<string> = new Set()) {
  const planned = new Map<string, number>();
  const key = (b: string, d: string, s: string) => `${b}|${d}|${s}`;
  const existing = (b: string, d: string, s: string) => ctx.db.shiftAssignments.filter((a) =>
    !ignoredAssignmentIds.has(a.id) && a.work_date === d && a.shift_code === s && a.status !== 'DRAFT'
    && isCountedWorkShift(a) && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === b).length;
  return {
    count: (b: string, d: string, s: string) => existing(b, d, s) + (planned.get(key(b, d, s)) ?? 0),
    capacity: (b: string, s: string) => resolveApplicableStaffingRule(ctx, b, s)?.max_staff ?? 1,
    minStaff: (b: string, s: string) => resolveApplicableStaffingRule(ctx, b, s)?.min_staff ?? 1,
    add: (b: string, d: string, s: string) => planned.set(key(b, d, s), (planned.get(key(b, d, s)) ?? 0) + 1),
  };
}

type Tracker = ReturnType<typeof createCapacityTracker>;

function collectOffBlockedAssignmentIds(ctx: AppContext, fromDate: string, toDate: string): Set<string> {
  const activeLeaves = ctx.db.leaveRequests.filter((l) => OFF_ACTIVE.has(l.status) && l.leave_date >= fromDate && l.leave_date <= toDate);
  const blocked = new Set<string>();
  for (const l of activeLeaves) {
    const emp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === l.employee_id);
    for (const a of ctx.db.shiftAssignments.all()) {
      if (a.work_date !== l.leave_date || !isCountedWorkShift(a)) continue;
      if (a.employee_id === l.employee_id || (emp && matchEmp(emp)(a.employee_id))) blocked.add(a.id);
    }
  }
  return blocked;
}

/**
 * Lập kế hoạch tuần cho Nhân viên chính thức theo quy tắc 1 ca = đúng 1 người (hoặc theo định biên chi nhánh):
 * - Lượt 1: Xếp nhân sự khả dụng vào đúng ca mặc định (chưa có ca trong ngày, ưu tiên người ít ca nhất trong tuần).
 * - Lượt 2: Bù các ca còn trống (0/1 do người phụ trách chính nghỉ OFF) bằng nhân sự chính thức cùng chi nhánh chưa có ca trong ngày.
 * - Lượt 3: Bù các ca vẫn còn trống bằng nhân sự chính thức cùng chi nhánh còn dưới giới hạn số ca/ngày và không trùng giờ.
 * - Lượt 4: Đối soát toàn bộ khung ca trong tuần để cảnh báo chính xác ca nào vẫn thiếu (< min) hoặc thừa (> max).
 */
export function planOfficialWeek(ctx: AppContext, params: { weekStart: string; branchId?: string }): PlanResult {
  const settings = getOperationSettings(ctx.db), dates = weekDates(params.weekStart);
  const ignoredIds = collectOffBlockedAssignmentIds(ctx, dates[0]!, dates[6]!);
  const tracker = createCapacityTracker(ctx, ignoredIds);
  const branches = ctx.db.branches.filter((b) => b.status === 'ACTIVE' && (!params.branchId || params.branchId === 'ALL' || b.id === params.branchId || b.code === params.branchId))
    .sort((a, b) => a.code.localeCompare(b.code));
  const branchSet = new Set(branches.map((b) => b.id));
  const emps = ctx.db.employees.filter((e) => isOfficialSwapEligibleEmployee(ctx, e) && branchSet.has(e.branch_id))
    .sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  const offRequests = ctx.db.leaveRequests.filter((l) => OFF_ACTIVE.has(l.status) && l.leave_date >= dates[0]! && l.leave_date <= dates[6]! && emps.some((e) => matchEmp(e)(l.employee_id)));

  const weeklyCount = new Map<string, number>();
  const dailySpans = new Map<string, [number, number][]>();
  const dailyCodes = new Map<string, Set<string>>();
  for (const emp of emps) {
    let wCount = 0;
    for (const d of dates) {
      const ek = `${emp.id}|${d}`;
      const rows = ctx.db.shiftAssignments.filter((a) => !ignoredIds.has(a.id) && a.work_date === d && matchEmp(emp)(a.employee_id) && isCountedWorkShift(a));
      const approvedRows = rows.filter((a) => a.status !== 'DRAFT');
      wCount += approvedRows.length;
      dailySpans.set(ek, approvedRows.map((a) => toMinuteSpan(a.start_at, a.end_at)));
      dailyCodes.set(ek, new Set(approvedRows.map((a) => a.shift_code.toUpperCase())));
    }
    weeklyCount.set(emp.id, wCount);
  }

  const isOffOnDate = (emp: Employee, d: string) => offRequests.some((l) => matchEmp(emp)(l.employee_id) && l.leave_date === d);
  const canTakeShift = (emp: Employee, d: string, tpl: ShiftTemplate) => {
    if (isOffOnDate(emp, d)) return false;
    const ek = `${emp.id}|${d}`, spans = dailySpans.get(ek) ?? [], codes = dailyCodes.get(ek) ?? new Set<string>();
    if (codes.has(tpl.code.toUpperCase()) || spans.length >= settings.maxShiftsPerDay) return false;
    const [ns, ne] = toMinuteSpan(tpl.start_time, tpl.end_time);
    return !spans.some(([s, e]) => ns < e && ne > s);
  };

  const planned: PlannedShift[] = [], issues: PlanIssue[] = [];
  const assign = (emp: Employee, branchName: string, d: string, tpl: ShiftTemplate, isCoverShift: boolean) => {
    const ek = `${emp.id}|${d}`;
    planned.push({
      employeeId: emp.id, employeeCode: emp.employee_code, employeeName: emp.full_name, stage: emp.stage, branchId: emp.branch_id, branchName,
      workDate: d, shiftCode: tpl.code, shiftLabel: tpl.name, startAt: tpl.start_time, endAt: tpl.end_time, hours: tpl.standard_hours || 5, templateId: tpl.id, isCoverShift,
    });
    tracker.add(emp.branch_id, d, tpl.code);
    dailySpans.set(ek, [...(dailySpans.get(ek) ?? []), toMinuteSpan(tpl.start_time, tpl.end_time)]);
    const set = dailyCodes.get(ek) ?? new Set<string>();
    set.add(tpl.code.toUpperCase());
    dailyCodes.set(ek, set);
    weeklyCount.set(emp.id, (weeklyCount.get(emp.id) ?? 0) + 1);
  };

  for (const branch of branches) {
    const branchEmps = emps.filter((e) => e.branch_id === branch.id);
    const storeShifts = listBranchStoreShiftTemplates(ctx, branch.id);
    if (storeShifts.length === 0) {
      for (const emp of branchEmps) {
        const sc = emp.default_shift_code || 'CA_SANG';
        issues.push({ kind: 'NO_TEMPLATE', employeeId: emp.id, employeeName: `${emp.full_name} (${emp.employee_code})`, workDate: dates[0]!, shiftCode: sc, message: `Chi nhánh ${branch.name} chưa cấu hình khung ca hoạt động (${DEFAULT_SHIFT_LABELS[sc as keyof typeof DEFAULT_SHIFT_LABELS] ?? sc}).` });
      }
      continue;
    }
    const hasStaffOrRule = branchEmps.length > 0 || Boolean(ctx.db.staffingRules.find((r) => r.branch_id === branch.id || r.branch_id === branch.code));
    if (!hasStaffOrRule) continue;

    for (const workDate of dates) {
      for (const tpl of storeShifts) {
        while (tracker.count(branch.id, workDate, tpl.code) < tracker.capacity(branch.id, tpl.code)) {
          const cands = branchEmps.filter((e) => (e.default_shift_code || 'CA_SANG').toUpperCase() === tpl.code.toUpperCase() && (dailySpans.get(`${e.id}|${workDate}`)?.length ?? 0) === 0 && canTakeShift(e, workDate, tpl))
            .sort((a, b) => (weeklyCount.get(a.id) ?? 0) - (weeklyCount.get(b.id) ?? 0) || a.employee_code.localeCompare(b.employee_code));
          if (cands.length === 0) break;
          assign(cands[0]!, branch.name, workDate, tpl, false);
        }
      }
      for (const tpl of storeShifts) {
        while (tracker.count(branch.id, workDate, tpl.code) < tracker.capacity(branch.id, tpl.code)) {
          const cands = branchEmps.filter((e) => (dailySpans.get(`${e.id}|${workDate}`)?.length ?? 0) === 0 && canTakeShift(e, workDate, tpl))
            .sort((a, b) => (weeklyCount.get(a.id) ?? 0) - (weeklyCount.get(b.id) ?? 0) || a.employee_code.localeCompare(b.employee_code));
          if (cands.length === 0) break;
          assign(cands[0]!, branch.name, workDate, tpl, true);
        }
      }
      for (const tpl of storeShifts) {
        while (tracker.count(branch.id, workDate, tpl.code) < tracker.capacity(branch.id, tpl.code)) {
          const cands = branchEmps.filter((e) => canTakeShift(e, workDate, tpl))
            .sort((a, b) => (dailySpans.get(`${a.id}|${workDate}`)?.length ?? 0) - (dailySpans.get(`${b.id}|${workDate}`)?.length ?? 0) || (weeklyCount.get(a.id) ?? 0) - (weeklyCount.get(b.id) ?? 0) || a.employee_code.localeCompare(b.employee_code));
          if (cands.length === 0) break;
          assign(cands[0]!, branch.name, workDate, tpl, true);
        }
      }
      for (const tpl of storeShifts) {
        const cur = tracker.count(branch.id, workDate, tpl.code), min = tracker.minStaff(branch.id, tpl.code), cap = tracker.capacity(branch.id, tpl.code);
        if (cur < min) {
          issues.push({ kind: 'UNDERSTAFFED', employeeId: '', employeeName: '', workDate, shiftCode: tpl.code, message: `${branch.name} · ${tpl.name} ngày ${vi(workDate)} chưa đủ người trực (${cur}/${min} nhân sự) do nhân sự nghỉ OFF hoặc thiếu định biên.` });
        } else if (cur > cap) {
          issues.push({ kind: 'CAPACITY_FULL', employeeId: '', employeeName: '', workDate, shiftCode: tpl.code, message: `${branch.name} · ${tpl.name} ngày ${vi(workDate)} đang vượt định biên (${cur}/${cap} nhân sự — quy định mỗi ca chỉ có ${cap} người).` });
        }
      }
    }
  }
  return { planned, issues, offRequests };
}

/**
 * Lập kế hoạch chu kỳ thử việc 12 ngày: trừ tối đa 5 ngày OFF, ưu tiên xếp ca mặc định vào các ngày còn lại;
 * nếu ca mặc định ngày đó đã có 1/1 người trực thì tự động chuyển sang khung ca còn trống (0/1) trong ngày để đủ 7 ca bắt buộc.
 */
export function planProbationCycle(ctx: AppContext, emp: Employee, todayStr: string): PlanResult & { cycle: ReturnType<typeof resolveProbationCycle>; existingCount: number } {
  const settings = getOperationSettings(ctx.db), cycle = resolveProbationCycle(emp, todayStr);
  const ignoredIds = collectOffBlockedAssignmentIds(ctx, cycle.start, cycle.end);
  const tracker = createCapacityTracker(ctx, ignoredIds), isEmp = matchEmp(emp);
  const offRequests = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && OFF_ACTIVE.has(l.status) && cycle.dates.includes(l.leave_date));
  const issues: PlanIssue[] = [], dayIssues: PlanIssue[] = [], planned: PlannedShift[] = [];
  const empName = `${emp.full_name} (${emp.employee_code})`;
  if (offRequests.length > cycle.offLimit) {
    issues.push({ kind: 'OFF_QUOTA', employeeId: emp.id, employeeName: empName, workDate: cycle.start, shiftCode: '', message: `${empName} đăng ký ${offRequests.length} ngày OFF, vượt định mức ${cycle.offLimit} ngày / chu kỳ thử việc.` });
  }
  const existingCount = cycle.dates.reduce((sum, d) => sum + employeeShiftsOnDate(ctx, emp, d, [...ignoredIds]).length, 0);
  let total = existingCount;
  const defCode = (emp.default_shift_code || 'CA_SANG').toUpperCase();
  const defTpl = findBranchShiftTemplate(ctx, defCode, emp.branch_id);
  const storeTpls = listBranchStoreShiftTemplates(ctx, emp.branch_id);
  const candidateTpls = [...(defTpl ? [defTpl] : []), ...storeTpls.filter((s) => s.code.toUpperCase() !== defCode)];
  const branchName = ctx.db.branches.get(emp.branch_id)?.name ?? emp.branch_id;

  for (const workDate of cycle.dates) {
    if (total >= cycle.workRequired) break;
    if (workDate < todayStr || offRequests.some((l) => l.leave_date === workDate)) continue;
    const todayShifts = employeeShiftsOnDate(ctx, emp, workDate, [...ignoredIds]);
    if (todayShifts.length > 0 || todayShifts.length >= settings.maxShiftsPerDay) continue;
    if (candidateTpls.length === 0) {
      dayIssues.push({ kind: 'NO_TEMPLATE', employeeId: emp.id, employeeName: empName, workDate, shiftCode: defCode, message: `Chi nhánh ${branchName} chưa cấu hình khung ca làm việc cho ${empName}.` });
      continue;
    }
    let picked: ShiftTemplate | null = null;
    for (const tpl of candidateTpls) {
      if (tracker.count(emp.branch_id, workDate, tpl.code) >= tracker.capacity(emp.branch_id, tpl.code)) continue;
      if (findEmployeeShiftConflictOnDate(ctx, { emp, workDate, shiftCode: tpl.code, startAt: tpl.start_time, endAt: tpl.end_time })) continue;
      picked = tpl;
      break;
    }
    if (picked) {
      planned.push({
        employeeId: emp.id, employeeCode: emp.employee_code, employeeName: emp.full_name, stage: emp.stage, branchId: emp.branch_id, branchName,
        workDate, shiftCode: picked.code, shiftLabel: picked.name, startAt: picked.start_time, endAt: picked.end_time,
        hours: picked.standard_hours || 5, templateId: picked.id, isCoverShift: picked.code.toUpperCase() !== defCode,
      });
      tracker.add(emp.branch_id, workDate, picked.code);
      total++;
    } else {
      dayIssues.push({ kind: 'CAPACITY_FULL', employeeId: emp.id, employeeName: empName, workDate, shiftCode: defCode, message: `Toàn bộ khung ca ngày ${vi(workDate)} tại ${branchName} đã đủ 1/1 người theo định biên — chưa thể xếp ${empName}.` });
    }
  }
  if (total < cycle.workRequired) {
    issues.push(...dayIssues, { kind: 'NOT_ENOUGH_SHIFTS', employeeId: emp.id, employeeName: empName, workDate: cycle.end, shiftCode: emp.default_shift_code, message: `Chỉ xếp được ${total}/${cycle.workRequired} ca bắt buộc cho ${empName} trong chu kỳ ${vi(cycle.start)} – ${vi(cycle.end)}.` });
  }
  return { planned, issues, offRequests, cycle, existingCount };
}
