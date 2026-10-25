import type { Employee, PayRate, PayrollItem } from '@umbm/shared';
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
}

const sumItems = (items: PayrollItem[], ...types: PayrollItem['item_type'][]) =>
  items.filter((i) => types.includes(i.item_type)).reduce((s, i) => s + i.total_amount_vnd, 0);

export function computeEmployeePayroll(input: PayrollComputationInput) {
  const { emp, profiles, items } = input;
  const entries = [...input.entries].sort((a, b) => a.date.localeCompare(b.date));
  const segments = new Map<string, SalarySegment>();
  const monthlyDaysSeen = new Set<string>();
  const workedDates = new Set<string>();
  let otHours = 0;
  let otPay = 0;
  let meal = 0;
  let swapCount = 0;
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
    const official = isOfficialAt(emp, e.date);
    const percent = official ? 100 : profile.probation_percent;
    const base = (profile.amount_vnd * percent) / 100;
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
      unitRate = base / profile.standard_work_days;
      qty = monthlyDaysSeen.has(`${key}|${e.date}`) ? 0 : 1;
      monthlyDaysSeen.add(`${key}|${e.date}`);
      unit = 'ngày';
      hourlyEq = base / (profile.standard_work_days * profile.standard_hours_per_day);
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
    if (e.isSwap) swapCount += 1;
  }

  const segList = [...segments.values()].map((s) => ({ ...s, amountVnd: Math.round(s.amountVnd), quantity: Math.round(s.quantity * 100) / 100 }));
  const prob = segList.filter((s) => s.stage === 'PROBATION');
  const off = segList.filter((s) => s.stage === 'OFFICIAL');
  const sum = (arr: SalarySegment[], k: 'hours' | 'amountVnd') => arr.reduce((acc, s) => acc + s[k], 0);

  const fixedProfile = resolveProfileAt(profiles, input.periodToDate) ?? lastProfile;
  const hasWork = workedDates.size > 0 && !!fixedProfile;
  const transport = hasWork ? fixedProfile!.transport_allowance_vnd : 0;
  const responsibility = hasWork ? fixedProfile!.responsibility_allowance_vnd + fixedProfile!.other_allowance_vnd : 0;
  const attendanceAuto = hasWork && input.absentCount === 0 ? fixedProfile!.attendance_bonus_vnd : 0;

  const swapAuto = swapCount * input.swapAllowanceVnd;
  const swapPay = swapAuto + sumItems(items, 'ALLOWANCE_SWAP');
  const mealVnd = Math.round(meal) + sumItems(items, 'ALLOWANCE_MEAL');
  const attendanceBonus = attendanceAuto + sumItems(items, 'BONUS_ATTENDANCE');
  const kpiBonus = sumItems(items, 'BONUS_KPI', 'BONUS_SALES');
  const otherAllowances = responsibility + sumItems(items, 'ALLOWANCE_RESPONSIBILITY');
  const positiveAdj = sumItems(items, 'ADJUSTMENT_ADD');
  const deductions = sumItems(items, 'DEDUCTION_APPROVED');
  const advance = sumItems(items, 'ADVANCE_DEDUCTION');

  const probationPay = sum(prob, 'amountVnd');
  const officialPay = sum(off, 'amountVnd');
  const baseSalary = probationPay + officialPay;
  const otPayRounded = Math.round(otPay);
  const gross = baseSalary + otPayRounded + swapPay + mealVnd + transport + attendanceBonus + kpiBonus + otherAllowances + positiveAdj;
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
    probationPay,
    officialHours: sum(off, 'hours'),
    officialRateVnd: off[off.length - 1]?.unitRateVnd ?? 0,
    officialPay,
    baseSalary,
    otHours,
    otRateVnd: fixedProfile ? Math.round(otHours > 0 ? otPay / otHours : 0) : 0,
    otPay: otPayRounded,
    swapCount,
    swapPay,
    mealVnd,
    transport,
    attendanceBonus,
    kpiBonus,
    otherAllowances,
    positiveAdj,
    deductions,
    advance,
    gross,
    net,
  };
}

export type PayrollComputation = ReturnType<typeof computeEmployeePayroll>;
