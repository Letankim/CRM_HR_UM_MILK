import { SYSTEM_CONFIG, computeDailyOtThresholdAllowance, zPayRate, type Employee, type PayRate, type PayrollItem } from '@umbm/shared';
import { isOfficialAt, resolveProfileAt } from './salary-profile.service.js';

/**
 * Bộ tính lương thuần (pure function) — dễ kiểm thử, không truy cập Google Sheets.
 * Công thức theo Hồ sơ lương CÁ NHÂN có ngày hiệu lực:
 *  - Theo giờ:  giờ công x đơn giá (thử việc = đơn giá chính thức x % thử việc)
 *  - Theo ca:   số ca x đơn giá ca
 *  - Theo tháng: lương tháng / công chuẩn x số ngày công thực tế
 *  - Tăng ca:   giờ OT x đơn giá giờ quy đổi x hệ số OT
 */

export interface WorkEntry {
  assignmentId: string;
  date: string;
  hours: number;
  otHours: number;
  isSwap: boolean;
  swapAllowanceVnd?: number;
}

export interface SalarySegment {
  rateId: string;
  rateType: PayRate['rate_type'];
  stage: 'PROBATION' | 'OFFICIAL';
  percent: number;
  unitRateVnd: number;
  quantity: number;
  unit: 'giờ' | 'ngày' | 'ca';
  hours: number;
  amountVnd: number;
  fromDate: string;
  toDate: string;
}

export interface PayrollComputationInput {
  emp: Employee;
  profiles: PayRate[];
  entries: WorkEntry[];
  items: PayrollItem[];
  absentCount: number;
  periodToDate: string;
  swapAllowanceVnd: number;
  useDefaultHourlyFallback?: boolean;
  lateFineVnd?: number;
}

const sumItems = (items: PayrollItem[], ...types: PayrollItem['item_type'][]) =>
  items.filter((i) => types.includes(i.item_type)).reduce((s, i) => s + i.total_amount_vnd, 0);

export function buildDefaultPayRate(emp: Employee): PayRate {
  const offVnd = SYSTEM_CONFIG.defaults.officialHourlyRateVnd, probVnd = SYSTEM_CONFIG.defaults.probationHourlyRateVnd;
  return zPayRate.parse({
    id: `DEFAULT_RATE_${emp.id}`, employee_id: emp.id, rate_type: 'HOURLY', amount_vnd: offVnd,
    probation_percent: Math.round((probVnd / offVnd) * 10000) / 100, standard_work_days: 26, standard_hours_per_day: 5,
    ot_multiplier: 1, effective_from: '2020-01-01', status: 'ACTIVE', created_at: '2020-01-01T00:00:00Z', created_by: 'system', updated_at: '2020-01-01T00:00:00Z', updated_by: 'system', version: 1, is_deleted: false,
  });
}

export function computeEmployeePayroll(input: PayrollComputationInput) {
  const { emp, items } = input;
  const profiles = input.profiles.length === 0 && input.useDefaultHourlyFallback ? [buildDefaultPayRate(emp)] : input.profiles;
  const entries = [...input.entries].sort((a, b) => a.date.localeCompare(b.date));
  const segments = new Map<string, SalarySegment>();
  const monthlyDaysSeen = new Set<string>();
  const workedDates = new Set<string>();
  const dailyHoursMap = new Map<string, number>();
  let otHours = 0;
  let otPay = 0;
  let meal = 0;
  let swapCount = 0;
  let paidSwapCount = 0;
  let swapAuto = 0;
  let missingProfileShifts = 0;
  let lastProfile: PayRate | undefined;

  for (const e of entries) {
    const profile = resolveProfileAt(profiles, e.date);
    if (!profile) {
      missingProfileShifts += 1;
      continue;
    }
    lastProfile = profile;
    workedDates.add(e.date);
    dailyHoursMap.set(e.date, (dailyHoursMap.get(e.date) ?? 0) + e.hours + e.otHours);
    const official = isOfficialAt(emp, e.date);
    const percent = official ? 100 : profile.probation_percent;
    const base = official ? profile.amount_vnd : Math.round((profile.amount_vnd * percent) / 100);
    const stage = official ? 'OFFICIAL' : 'PROBATION';
    const key = `${profile.id}|${stage}`;

    let unitRate = base;
    let qty = e.hours;
    let unit: SalarySegment['unit'] = 'giờ';
    let hourlyEq = base;
    if (profile.rate_type === 'SHIFT') {
      qty = 1;
      unit = 'ca';
      hourlyEq = base / profile.standard_hours_per_day;
    } else if (profile.rate_type === 'MONTHLY') {
      const rawBase = (profile.amount_vnd * percent) / 100;
      unitRate = rawBase / profile.standard_work_days;
      qty = monthlyDaysSeen.has(`${key}|${e.date}`) ? 0 : 1;
      monthlyDaysSeen.add(`${key}|${e.date}`);
      unit = 'ngày';
      hourlyEq = rawBase / (profile.standard_work_days * profile.standard_hours_per_day);
    }

    const seg =
      segments.get(key) ??
      ({ rateId: profile.id, rateType: profile.rate_type, stage, percent, unitRateVnd: Math.round(unitRate), quantity: 0, unit, hours: 0, amountVnd: 0, fromDate: e.date, toDate: e.date } as SalarySegment);
    seg.quantity += qty;
    seg.hours += e.hours;
    seg.amountVnd += qty * unitRate;
    seg.toDate = e.date;
    segments.set(key, seg);

    otHours += e.otHours;
    otPay += e.otHours * hourlyEq * profile.ot_multiplier;
    if (e.hours > 0) meal += profile.meal_allowance_per_shift_vnd;
    if (e.isSwap) {
      swapCount += 1;
      const entrySwapVnd = e.swapAllowanceVnd !== undefined ? Math.max(0, Math.round(e.swapAllowanceVnd)) : input.swapAllowanceVnd;
      swapAuto += entrySwapVnd;
      if (entrySwapVnd > 0) paidSwapCount += 1;
    }
  }

  let otDailyAllowanceVnd = 0;
  let otDailyAllowanceSlots = 0;
  for (const [, totalDayHours] of dailyHoursMap) {
    const dOt = computeDailyOtThresholdAllowance(totalDayHours, SYSTEM_CONFIG.defaults.otAllowancePerSlotVnd);
    otDailyAllowanceVnd += dOt.allowanceVnd;
    otDailyAllowanceSlots += dOt.slots;
  }

  const segList = [...segments.values()].map((s) => ({ ...s, amountVnd: Math.round(s.amountVnd), quantity: Math.round(s.quantity * 100) / 100 }));
  const prob = segList.filter((s) => s.stage === 'PROBATION');
  const off = segList.filter((s) => s.stage === 'OFFICIAL');
  const sum = (arr: SalarySegment[], k: 'hours' | 'amountVnd') => arr.reduce((acc, s) => acc + s[k], 0);

  const dTo = (input.periodToDate ?? '').trim().slice(0, 10);
  const fixedProfile = resolveProfileAt(profiles, dTo) ?? lastProfile ?? profiles.find((p) => !p.effective_to || p.effective_to.trim().slice(0, 10) >= dTo);
  const hasWork = workedDates.size > 0 && !!fixedProfile;
  const transport = hasWork ? fixedProfile!.transport_allowance_vnd : 0;
  const responsibility = hasWork ? fixedProfile!.responsibility_allowance_vnd + fixedProfile!.other_allowance_vnd : 0;
  const attendanceAuto = hasWork && input.absentCount === 0 ? fixedProfile!.attendance_bonus_vnd : 0;

  const swapPay = swapAuto + sumItems(items, 'ALLOWANCE_SWAP');
  const mealVnd = Math.round(meal) + sumItems(items, 'ALLOWANCE_MEAL');
  const attendanceBonus = attendanceAuto + sumItems(items, 'BONUS_ATTENDANCE');
  const kpiBonus = sumItems(items, 'BONUS_KPI', 'BONUS_SALES');
  const otherAllowances = responsibility + sumItems(items, 'ALLOWANCE_RESPONSIBILITY');
  const positiveAdj = sumItems(items, 'ADJUSTMENT_ADD');
  const lateFineVnd = Math.max(0, Math.round(input.lateFineVnd ?? 0));
  const deductions = sumItems(items, 'DEDUCTION_APPROVED') + lateFineVnd;
  const advance = sumItems(items, 'ADVANCE_DEDUCTION');

  const probationPay = sum(prob, 'amountVnd');
  const officialPay = sum(off, 'amountVnd');
  const baseSalary = probationPay + officialPay;
  const otPayRounded = Math.round(otPay);
  const gross = baseSalary + otPayRounded + otDailyAllowanceVnd + swapPay + mealVnd + transport + attendanceBonus + kpiBonus + otherAllowances + positiveAdj;
  const net = Math.max(0, gross - deductions - advance);

  return {
    primaryProfile: fixedProfile,
    segments: segList,
    workedDays: workedDates.size,
    totalShifts: entries.length - missingProfileShifts,
    missingProfileShifts,
    approvedHours: sum(segList, 'hours'),
    probationHours: sum(prob, 'hours'),
    probationRateVnd: prob[prob.length - 1]?.unitRateVnd ?? 0,
    defaultProbationRateVnd: SYSTEM_CONFIG.defaults.probationHourlyRateVnd,
    probationPay,
    officialHours: sum(off, 'hours'),
    officialRateVnd: off[off.length - 1]?.unitRateVnd ?? 0,
    defaultOfficialRateVnd: SYSTEM_CONFIG.defaults.officialHourlyRateVnd,
    officialPay,
    baseSalary,
    otHours,
    otRateVnd: fixedProfile ? Math.round(otHours > 0 ? otPay / otHours : 0) : 0,
    otPay: otPayRounded,
    otDailyAllowanceSlots,
    otDailyAllowanceVnd,
    swapCount,
    paidSwapCount,
    swapPay,
    mealVnd,
    transport,
    attendanceBonus,
    kpiBonus,
    otherAllowances,
    positiveAdj,
    lateFineVnd,
    deductions,
    advance,
    gross,
    net,
  };
}

export type PayrollComputation = ReturnType<typeof computeEmployeePayroll>;
