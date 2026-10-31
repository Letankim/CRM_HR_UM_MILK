import {
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAYROLL_ITEM_TYPE_LABELS,
  SYSTEM_CONFIG,
  type Employee,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import {
  classifyShiftLog,
  collectHistoricalSnapshotLogs,
  filterApprovedPayrollItemsInRange,
  formatSalaryProfileOverview,
  SHIFT_EARNING_CATEGORY_LABELS,
  WEEKDAY_LABELS,
} from './my-earnings-helpers.js';
import { collectWorkEntries } from './payroll-work-collector.js';
import {
  currentProfile,
  ensureLegacySalaryProfiles,
  isOfficialAt,
  profilesOf,
  resolveProfileAt,
} from './salary-profile.service.js';
import { getVnNowDateAndHm, sweepExpiredShiftsAndMarkAbsent } from './shift-absent-scanner.js';

export type { ShiftEarningCategory } from './my-earnings-helpers.js';

export async function buildMyEarningsSummary(ctx: AppContext, emp: Employee, fromDate: string, toDate: string, actorId: string) {
  await Promise.all([sweepExpiredShiftsAndMarkAbsent(ctx.db, actorId), ensureLegacySalaryProfiles(ctx.db, actorId)]);
  const { todayStr } = getVnNowDateAndHm();
  const profiles = profilesOf(ctx.db, emp.id);
  const activeProfile = resolveProfileAt(profiles, toDate) ?? currentProfile(profiles);
  const liveSummary = collectWorkEntries(ctx, emp, fromDate, toDate);
  const allLogs = collectHistoricalSnapshotLogs(ctx, emp, fromDate, toDate, liveSummary.shiftLogs)
    .sort((a, b) => a.date.localeCompare(b.date) || a.shiftTime.localeCompare(b.shiftTime));

  const earnedMonthlyDays = new Set<string>(), projectedMonthlyDays = new Set<string>(), workedDates = new Set<string>();
  let completedShiftsCount = 0, completedProbationShiftsCount = 0, completedOfficialShiftsCount = 0;
  let completedHours = 0, completedProbationHours = 0, completedOfficialHours = 0, completedOtHours = 0;
  let swapInCompletedCount = 0, incompleteShiftsCount = 0, upcomingShiftsCount = 0, absentShiftsCount = 0;
  let leaveOffCount = 0, swappedOutCount = 0, lateShiftsCount = 0, lateMinutesTotal = 0, missingProfileShiftsCount = 0;
  let probationBasePayVnd = 0, officialBasePayVnd = 0, otPayVnd = 0, mealAllowanceVnd = 0, swapAllowanceVnd = 0;
  let projectedShiftSubtotalVnd = 0, totalProjectedHours = 0;

  const shiftRows = allLogs.map((log, idx) => {
    const category = classifyShiftLog(log.status);
    const isCountedInEarned = category === 'COMPLETED';
    const isWorkCandidate = category === 'COMPLETED' || category === 'INCOMPLETE' || category === 'UPCOMING';
    const official = isOfficialAt(emp, log.date);
    const stage = official ? 'OFFICIAL' : 'PROBATION';
    const stageLabel = EMPLOYEE_STAGE_LABELS[stage];
    const profile = isWorkCandidate ? resolveProfileAt(profiles, log.date) : undefined;
    const weekdayLabel = WEEKDAY_LABELS[dayjs(log.date).day()] ?? '';

    if (category === 'ABSENT') absentShiftsCount += 1;
    if (category === 'LEAVE_OFF') leaveOffCount += 1;
    if (category === 'SWAPPED_OUT') swappedOutCount += 1;
    if (category === 'INCOMPLETE') incompleteShiftsCount += 1;
    if (category === 'UPCOMING') upcomingShiftsCount += 1;
    if ((category === 'COMPLETED' || category === 'INCOMPLETE') && log.lateMinutes > 0) {
      lateShiftsCount += 1;
      lateMinutesTotal += log.lateMinutes;
    }

    let unitRateVnd = 0, unitLabel = 'giờ', rateTypeLabel = 'Chưa cấu hình lương', percent = official ? 100 : SYSTEM_CONFIG.defaults.probationSalaryPercent;
    let rowBasePay = 0, rowOtPay = 0, rowMeal = 0, rowSwap = 0;

    if (isWorkCandidate) {
      totalProjectedHours += log.hours + log.otHours;
      if (!profile) {
        if (isCountedInEarned) missingProfileShiftsCount += 1;
      } else {
        percent = official ? 100 : profile.probation_percent;
        const effectiveAmount = (profile.amount_vnd * percent) / 100;
        rateTypeLabel = PAY_RATE_TYPE_LABELS[profile.rate_type];
        let hourlyEq = effectiveAmount, qty = log.hours;
        if (profile.rate_type === 'SHIFT') {
          unitLabel = 'ca';
          unitRateVnd = Math.round(effectiveAmount);
          qty = log.hours > 0 ? 1 : 0;
          rowBasePay = Math.round(qty * effectiveAmount);
          hourlyEq = effectiveAmount / profile.standard_hours_per_day;
        } else if (profile.rate_type === 'MONTHLY') {
          const dailyRate = effectiveAmount / profile.standard_work_days;
          const dayKey = `${profile.id}|${stage}|${log.date}`;
          unitLabel = 'ngày';
          unitRateVnd = Math.round(dailyRate);
          hourlyEq = effectiveAmount / (profile.standard_work_days * profile.standard_hours_per_day);
          if (isCountedInEarned) {
            qty = earnedMonthlyDays.has(dayKey) ? 0 : 1;
            earnedMonthlyDays.add(dayKey);
            projectedMonthlyDays.add(dayKey);
          } else {
            qty = projectedMonthlyDays.has(dayKey) ? 0 : 1;
            projectedMonthlyDays.add(dayKey);
          }
          rowBasePay = Math.round(qty * dailyRate);
        } else {
          unitLabel = 'giờ';
          unitRateVnd = Math.round(effectiveAmount);
          rowBasePay = Math.round(log.hours * effectiveAmount);
        }
        rowOtPay = Math.round(log.otHours * hourlyEq * profile.ot_multiplier);
        rowMeal = log.hours > 0 ? profile.meal_allowance_per_shift_vnd : 0;
        rowSwap = log.isSwapIn ? Math.max(0, Math.round(log.swapAllowanceVnd ?? SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd)) : 0;
      }
    }

    const totalShiftPayVnd = rowBasePay + rowOtPay + rowMeal + rowSwap;
    if (isWorkCandidate) projectedShiftSubtotalVnd += totalShiftPayVnd;
    if (isCountedInEarned) {
      completedShiftsCount += 1;
      workedDates.add(log.date);
      completedHours += log.hours;
      completedOtHours += log.otHours;
      if (official) { completedOfficialShiftsCount += 1; completedOfficialHours += log.hours; officialBasePayVnd += rowBasePay; }
      else { completedProbationShiftsCount += 1; completedProbationHours += log.hours; probationBasePayVnd += rowBasePay; }
      otPayVnd += rowOtPay;
      mealAllowanceVnd += rowMeal;
      swapAllowanceVnd += rowSwap;
      if (log.isSwapIn) swapInCompletedCount += 1;
    }

    return {
      key: log.assignmentId || `${log.date}-${log.shiftCode}-${idx}`,
      assignmentId: log.assignmentId || null,
      date: log.date, weekdayLabel, shiftCode: log.shiftCode, shiftLabel: log.shiftLabel, shiftTime: log.shiftTime,
      branchName: log.branchName || ctx.db.branches.get(emp.branch_id)?.name || 'Chi nhánh',
      category, categoryLabel: SHIFT_EARNING_CATEGORY_LABELS[category], status: log.status, statusLabel: log.statusLabel,
      isCountedInEarned, stage, stageLabel, percent, rateTypeLabel, unitRateVnd, unitLabel,
      hours: isWorkCandidate ? log.hours : 0, otHours: isWorkCandidate ? log.otHours : 0,
      checkInHm: log.checkInHm, checkOutHm: log.checkOutHm, lateMinutes: log.lateMinutes,
      isSwapIn: log.isSwapIn, basePayVnd: rowBasePay, otPayVnd: rowOtPay,
      mealAllowanceVnd: rowMeal, swapAllowanceVnd: rowSwap, totalShiftPayVnd,
      pendingAdjustmentCode: log.pendingAdjustmentCode || null, note: log.note || '',
    };
  });

  const daysInRange = dayjs(toDate).diff(dayjs(fromDate), 'day') + 1;
  const matchedFullPeriod = ctx.db.payPeriods.find((p) => p.from_date === fromDate && p.to_date === toDate);
  const isFullMonthRange = daysInRange >= 25 || Boolean(matchedFullPeriod);
  const fixedMonthlyBase = activeProfile ? activeProfile.transport_allowance_vnd + activeProfile.responsibility_allowance_vnd + activeProfile.other_allowance_vnd : 0;
  const fixedAttendanceBonus = activeProfile && absentShiftsCount === 0 ? activeProfile.attendance_bonus_vnd : 0;
  const fixedMonthlyReferenceVnd = fixedMonthlyBase + (activeProfile?.attendance_bonus_vnd ?? 0);
  const fixedAllowanceAppliedVnd = isFullMonthRange && completedShiftsCount > 0 ? fixedMonthlyBase + fixedAttendanceBonus : 0;
  const totalProjectedShiftsCount = completedShiftsCount + incompleteShiftsCount + upcomingShiftsCount;
  const fixedAllowanceProjectedVnd = isFullMonthRange && totalProjectedShiftsCount > 0 ? fixedMonthlyBase + fixedAttendanceBonus : 0;

  const matchedItems = filterApprovedPayrollItemsInRange(ctx, emp, fromDate, toDate);
  const bonusAndAddItemsVnd = matchedItems.filter((x) => x.item.direction === 'ADD').reduce((s, x) => s + x.item.total_amount_vnd, 0);
  const deductionItemsVnd = matchedItems.filter((x) => x.item.direction === 'DEDUCT').reduce((s, x) => s + x.item.total_amount_vnd, 0);

  const basePayVnd = probationBasePayVnd + officialBasePayVnd;
  const shiftSubtotalVnd = basePayVnd + otPayVnd + mealAllowanceVnd + swapAllowanceVnd;
  const earnedGrossVnd = shiftSubtotalVnd + fixedAllowanceAppliedVnd + bonusAndAddItemsVnd;
  const earnedNetVnd = Math.max(0, earnedGrossVnd - deductionItemsVnd);
  const projectedGrossVnd = projectedShiftSubtotalVnd + fixedAllowanceProjectedVnd + bonusAndAddItemsVnd;
  const projectedNetVnd = Math.max(0, projectedGrossVnd - deductionItemsVnd);
  const officialNow = isOfficialAt(emp, todayStr);

  return {
    range: { fromDate, toDate, daysInRange, isFullMonthRange, todayDate: todayStr },
    employee: {
      id: emp.id, employeeCode: emp.employee_code, fullName: emp.full_name,
      branchName: ctx.db.branches.get(emp.branch_id)?.name ?? 'Chi nhánh',
      stage: emp.stage, stageLabel: EMPLOYEE_STAGE_LABELS[emp.stage], officialFrom: emp.official_from || null,
    },
    salaryProfile: formatSalaryProfileOverview(activeProfile, emp, officialNow, fixedMonthlyReferenceVnd),
    counts: {
      totalRows: shiftRows.length, completedShiftsCount, completedProbationShiftsCount, completedOfficialShiftsCount,
      workedDaysCount: workedDates.size, completedHours: Math.round(completedHours * 100) / 100,
      completedProbationHours: Math.round(completedProbationHours * 100) / 100,
      completedOfficialHours: Math.round(completedOfficialHours * 100) / 100,
      completedOtHours: Math.round(completedOtHours * 100) / 100, swapInCompletedCount,
      incompleteShiftsCount, upcomingShiftsCount, absentShiftsCount, leaveOffCount, swappedOutCount,
      lateShiftsCount, lateMinutesTotal, missingProfileShiftsCount,
    },
    earned: {
      probationBasePayVnd, officialBasePayVnd, basePayVnd, otPayVnd, mealAllowanceVnd, swapAllowanceVnd,
      shiftSubtotalVnd, fixedAllowanceAppliedVnd, fixedMonthlyReferenceVnd,
      bonusAndAddItemsVnd, deductionItemsVnd, grossVnd: earnedGrossVnd, netVnd: earnedNetVnd,
    },
    projected: {
      totalProjectedShiftsCount, totalProjectedHours: Math.round(totalProjectedHours * 100) / 100,
      pendingOrUpcomingPayVnd: Math.max(0, projectedShiftSubtotalVnd - shiftSubtotalVnd),
      projectedGrossVnd, projectedNetVnd,
    },
    payrollItems: matchedItems.map(({ item, effectiveDate }) => ({
      id: item.id, date: effectiveDate, type: item.item_type, typeLabel: PAYROLL_ITEM_TYPE_LABELS[item.item_type],
      title: item.title, direction: item.direction, amountVnd: item.total_amount_vnd, note: item.note || '',
    })),
    shifts: shiftRows.reverse(),
  };
}
