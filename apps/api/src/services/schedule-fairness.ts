import { addDaysYmd, DEFAULT_SHIFT_LABELS, type DefaultShiftCode, type Employee, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { isCountedWorkShift, matchEmp } from './schedule-rules.js';

const EPOCH_MONDAY = '2024-01-01';

export interface ShiftGroupFairnessMetrics {
  /** Độ lệch số ca tích lũy so với trung bình nhóm trong các tuần gần nhất (nhân 1000 để so sánh số nguyên). */
  balanceDeltaScaled: number;
  /** Tổng số ca đã làm/đã chốt trong 4 tuần (28 ngày) liền trước weekStart. */
  recent4WeeksShifts: number;
  /** Nhân sự có trực ngày Chủ Nhật liền trước weekStart hay không (0 = không, 1 = có). */
  workedPrevSunday: number;
  /** Thứ tự xoay vòng theo chỉ số tuần để đảo lượt công bằng ngay cả khi chưa chốt tuần trước. */
  rotationRank: number;
}

export interface PlannerEmployeeLoadSummary {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  defaultShiftCode: string;
  defaultShiftLabel: string;
  groupSize: number;
  existingShiftsCount: number;
  plannedShiftsCount: number;
  totalWeekShifts: number;
  totalWeekHours: number;
  offDaysCount: number;
  recent4WeeksShifts: number;
}

/** Tính chỉ số tuần nguyên tính từ Thứ Hai gốc (2024-01-01) để xoay vòng đều giữa các tuần. */
export function computeWeekRotationIndex(weekStart: string): number {
  return Math.round(dayjs(weekStart).diff(dayjs(EPOCH_MONDAY), 'day') / 7);
}

function wasEmployeeActiveInHistoricalWeek(emp: Employee, weekEnd: string, hadShiftInWeek: boolean): boolean {
  if (hadShiftInWeek) return true;
  if (emp.official_from && emp.official_from > weekEnd) return false;
  if (emp.probation_start && emp.probation_start > weekEnd) return false;
  return true;
}

/**
 * Tính bộ chỉ số công bằng cho một nhóm nhân sự có CÙNG ca mặc định tại 1 chi nhánh:
 * - So sánh độ lệch tương đối từng tuần trong `max(k, 4)` tuần gần nhất (nhân sự mới vào không bị tính bù cho các tuần chưa đi làm).
 * - Đảo lượt trực Chủ Nhật và xoay vòng điểm bắt đầu theo `weekIndex mod k`.
 */
export function buildShiftGroupFairnessMap(
  ctx: AppContext,
  groupEmps: Employee[],
  weekStart: string,
): Map<string, ShiftGroupFairnessMetrics> {
  const sorted = [...groupEmps].sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  const k = sorted.length;
  const result = new Map<string, ShiftGroupFairnessMetrics>();
  if (k === 0) return result;

  const lookbackWeeks = Math.max(k, 4);
  const earliestStart = addDaysYmd(weekStart, -7 * lookbackWeeks);
  const window28Start = addDaysYmd(weekStart, -28);
  const prevSunday = addDaysYmd(weekStart, -1);
  const historyEnd = prevSunday;

  const relevantAssignments = ctx.db.shiftAssignments.filter(
    (a) => a.work_date >= earliestStart && a.work_date <= historyEnd && a.status !== 'DRAFT' && isCountedWorkShift(a),
  );

  const countInRange = (emp: Employee, from: string, to: string) => {
    const isE = matchEmp(emp);
    return relevantAssignments.filter((a) => a.work_date >= from && a.work_date <= to && isE(a.employee_id)).length;
  };

  const deltaByEmp = new Map<string, number>(sorted.map((e) => [e.id, 0]));
  for (let w = 1; w <= lookbackWeeks; w++) {
    const wStart = addDaysYmd(weekStart, -7 * w);
    const wEnd = addDaysYmd(wStart, 6);
    const counts = new Map<string, number>();
    let total = 0;
    for (const emp of sorted) {
      const c = countInRange(emp, wStart, wEnd);
      counts.set(emp.id, c);
      total += c;
    }
    if (total === 0) continue;
    const activeMembers = sorted.filter((emp) => wasEmployeeActiveInHistoricalWeek(emp, wEnd, (counts.get(emp.id) ?? 0) > 0));
    if (activeMembers.length <= 1) continue;
    const activeTotal = activeMembers.reduce((s, emp) => s + (counts.get(emp.id) ?? 0), 0);
    const avg = activeTotal / activeMembers.length;
    for (const emp of activeMembers) {
      deltaByEmp.set(emp.id, (deltaByEmp.get(emp.id) ?? 0) + ((counts.get(emp.id) ?? 0) - avg));
    }
  }

  const weekIdx = computeWeekRotationIndex(weekStart);
  const offset = ((weekIdx % k) + k) % k;

  sorted.forEach((emp, idx) => {
    const isE = matchEmp(emp);
    const workedSunday = relevantAssignments.some((a) => a.work_date === prevSunday && isE(a.employee_id)) ? 1 : 0;
    result.set(emp.id, {
      balanceDeltaScaled: Math.round((deltaByEmp.get(emp.id) ?? 0) * 1000),
      recent4WeeksShifts: countInRange(emp, window28Start, historyEnd),
      workedPrevSunday: workedSunday,
      rotationRank: (idx - offset + k) % k,
    });
  });

  return result;
}

/** So sánh 2 ứng viên cùng nhóm ca mặc định theo 4 lớp ưu tiên công bằng. */
export function compareFairShiftCandidates(
  a: Employee,
  b: Employee,
  weeklyCount: Map<string, number>,
  fairnessMap: Map<string, ShiftGroupFairnessMetrics>,
): number {
  const wa = weeklyCount.get(a.id) ?? 0;
  const wb = weeklyCount.get(b.id) ?? 0;
  if (wa !== wb) return wa - wb;
  const fa = fairnessMap.get(a.id);
  const fb = fairnessMap.get(b.id);
  const da = fa?.balanceDeltaScaled ?? 0;
  const db = fb?.balanceDeltaScaled ?? 0;
  if (da !== db) return da - db;
  const ra = fa?.rotationRank ?? 0;
  const rb = fb?.rotationRank ?? 0;
  if (ra !== rb) return ra - rb;
  const sa = fa?.workedPrevSunday ?? 0;
  const sb = fb?.workedPrevSunday ?? 0;
  if (sa !== sb) return sa - sb;
  return a.employee_code.localeCompare(b.employee_code);
}

/** Tổng hợp tải phân bổ ca tuần này & lịch sử 4 tuần trước theo từng nhân sự chính thức để hiển thị trên Popup Lưới Tuần. */
export function summarizeOfficialEmployeeWeekLoads(
  ctx: AppContext,
  params: {
    weekStart: string;
    weekEnd: string;
    branchIds: string[];
    existingShifts: ShiftAssignment[];
    plannedShifts: { employeeId: string; hours: number }[];
    offEmployeeIdsByDate: { employeeId: string; leaveDate: string }[];
  },
): PlannerEmployeeLoadSummary[] {
  const branchSet = new Set(params.branchIds);
  const officials = ctx.db.employees
    .filter((e) => isOfficialSwapEligibleEmployee(ctx, e) && branchSet.has(e.branch_id))
    .sort((a, b) => a.branch_id.localeCompare(b.branch_id) || (a.default_shift_code || 'CA_SANG').localeCompare(b.default_shift_code || 'CA_SANG') || a.employee_code.localeCompare(b.employee_code));

  const window28Start = addDaysYmd(params.weekStart, -28);
  const prevDay = addDaysYmd(params.weekStart, -1);
  const histRows = ctx.db.shiftAssignments.filter(
    (a) => a.work_date >= window28Start && a.work_date <= prevDay && a.status !== 'DRAFT' && isCountedWorkShift(a),
  );

  const groupSizeMap = new Map<string, number>();
  for (const e of officials) {
    const gk = `${e.branch_id}|${(e.default_shift_code || 'CA_SANG').toUpperCase()}`;
    groupSizeMap.set(gk, (groupSizeMap.get(gk) ?? 0) + 1);
  }

  return officials.map((emp) => {
    const isE = matchEmp(emp);
    const br = ctx.db.branches.get(resolveEmployeeBranchId(ctx, emp.id, emp.branch_id));
    const defCode = (emp.default_shift_code || 'CA_SANG').toUpperCase();
    const exRows = params.existingShifts.filter((a) => isE(a.employee_id));
    const plRows = params.plannedShifts.filter((p) => isE(p.employeeId));
    const exHours = exRows.reduce((s, a) => s + Number(a.scheduled_hours || 5), 0);
    const plHours = plRows.reduce((s, p) => s + Number(p.hours || 5), 0);
    const offCount = params.offEmployeeIdsByDate.filter((o) => isE(o.employeeId)).length;
    const recent4w = histRows.filter((a) => isE(a.employee_id)).length;
    return {
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      employeeName: emp.full_name,
      branchId: emp.branch_id,
      branchCode: br?.code ?? '',
      branchName: br?.name ?? 'Chi nhánh',
      defaultShiftCode: defCode,
      defaultShiftLabel: DEFAULT_SHIFT_LABELS[defCode as DefaultShiftCode] ?? defCode,
      groupSize: groupSizeMap.get(`${emp.branch_id}|${defCode}`) ?? 1,
      existingShiftsCount: exRows.length,
      plannedShiftsCount: plRows.length,
      totalWeekShifts: exRows.length + plRows.length,
      totalWeekHours: Number((exHours + plHours).toFixed(1)),
      offDaysCount: offCount,
      recent4WeeksShifts: recent4w,
    };
  });
}
