import { createHash } from 'node:crypto';
import {
  PAYROLL_ITEM_TYPE_LABELS,
  SYSTEM_CONFIG,
  type PayPeriod,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { computeEmployeePayroll } from './payroll-calculator.js';
import { collectWorkEntries } from './payroll-work-collector.js';
import { profilesOf } from './salary-profile.service.js';

export { collectWorkEntries } from './payroll-work-collector.js';

export async function recalculatePeriodSnapshots(ctx: AppContext, period: PayPeriod, actorId: string) {
  const existingSnaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  const periodItems = ctx.db.payrollItems.filter((i) => i.period_id === period.id && i.approval_status === 'APPROVED');
  const emps = ctx.db.employees.filter((e) => {
    if (e.status === 'ACTIVE') return true;
    return !!ctx.db.shiftAssignments.find((a) => (a.employee_id === e.id || a.employee_id === e.employee_code) && a.work_date >= period.from_date && a.work_date <= period.to_date);
  });

  const totals = { hours: 0, ot: 0, gross: 0, deduct: 0, net: 0, unreconciled: 0 };
  const keepIds = new Set<string>();

  for (const emp of emps) {
    const branch = ctx.db.branches.get(emp.branch_id);
    const workSummary = collectWorkEntries(ctx, emp, period.from_date, period.to_date);
    const { entries, absentCount, source } = workSummary;
    const empItems = periodItems.filter((i) => i.employee_id === emp.id || i.employee_id === emp.employee_code);
    const r = computeEmployeePayroll({
      emp,
      profiles: profilesOf(ctx.db, emp.id),
      entries,
      items: empItems,
      absentCount,
      periodToDate: period.to_date,
      swapAllowanceVnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
    });
    const missingProfile = r.missingProfileShifts > 0 || (entries.length > 0 && !r.primaryProfile);
    if (missingProfile) totals.unreconciled += 1;

    const allowanceLines = [
      { code: 'ALLOWANCE_MEAL', label: 'Phụ cấp ăn ca', amount: r.mealVnd },
      { code: 'ALLOWANCE_TRANSPORT', label: 'Phụ cấp đi lại', amount: r.transport },
      { code: 'ALLOWANCE_RESPONSIBILITY', label: 'Phụ cấp trách nhiệm & khác', amount: r.otherAllowances },
      { code: 'ALLOWANCE_SWAP', label: 'Phụ cấp nhận đổi ca', amount: r.swapPay },
      { code: 'BONUS_ATTENDANCE', label: 'Thưởng chuyên cần', amount: r.attendanceBonus },
    ].filter((l) => l.amount > 0);

    const adjustmentsJson = JSON.stringify({
      source,
      workedDays: r.workedDays,
      missingProfileShifts: r.missingProfileShifts,
      checkedInShiftsCount: workSummary.checkedInShiftsCount,
      adjustedShiftsCount: workSummary.adjustedShiftsCount,
      scheduledOnlyShiftsCount: workSummary.scheduledOnlyShiftsCount,
      leaveOffCount: workSummary.leaveOffCount,
      emergencyLeaveCount: workSummary.emergencyLeaveCount,
      swappedOutCount: workSummary.swappedOutCount,
      absentCount: workSummary.absentCount,
      lateCount: workSummary.lateCount,
      lateMinutesTotal: workSummary.lateMinutesTotal,
      shiftLogs: workSummary.shiftLogs,
      segments: r.segments,
      items: empItems.map((i) => ({ id: i.id, type: i.item_type, label: PAYROLL_ITEM_TYPE_LABELS[i.item_type], title: i.title, direction: i.direction, amount: i.total_amount_vnd })),
    });

    const dataHash = createHash('sha256')
      .update(`${period.id}:${emp.id}:${r.gross}:${r.net}:${r.approvedHours}:${r.otHours}:${r.swapCount}:${workSummary.lateCount}:${workSummary.leaveOffCount}:${adjustmentsJson}`)
      .digest('hex')
      .slice(0, 16);

    const payload = {
      period_id: period.id,
      period_code: period.period_code,
      employee_id: emp.id,
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      branch_id: emp.branch_id,
      branch_name: branch?.name ?? 'Chi nhánh',
      staff_group: emp.staff_group,
      stage: emp.stage,
      pay_rate_id: r.primaryProfile?.id ?? '',
      approved_hours: r.approvedHours,
      rate_vnd: r.primaryProfile?.amount_vnd ?? 0,
      ot_hours: r.otHours,
      allowances_json: JSON.stringify(allowanceLines),
      adjustments_json: adjustmentsJson,
      probation_hours: r.probationHours,
      probation_hourly_rate_vnd: r.probationRateVnd,
      probation_pay_vnd: r.probationPay,
      official_hours: r.officialHours,
      official_hourly_rate_vnd: r.officialRateVnd,
      official_pay_vnd: r.officialPay,
      total_shifts_count: r.totalShifts,
      base_salary_vnd: r.baseSalary,
      ot_rate_vnd: r.otRateVnd,
      ot_pay_vnd: r.otPay,
      shift_swap_count: r.swapCount,
      shift_swap_allowance_vnd: r.swapPay,
      meal_allowance_vnd: r.mealVnd,
      transport_allowance_vnd: r.transport,
      attendance_bonus_vnd: r.attendanceBonus,
      kpi_bonus_vnd: r.kpiBonus,
      other_allowances_vnd: r.otherAllowances,
      positive_adjustments_vnd: r.positiveAdj,
      approved_deductions_vnd: r.deductions,
      advance_deduction_vnd: r.advance,
      late_count: workSummary.lateCount,
      late_minutes_total: workSummary.lateMinutesTotal,
      gross_vnd: r.gross,
      net_vnd: r.net,
      data_hash: dataHash,
      bank_name: emp.bank_name,
      bank_account_number: emp.bank_account_number,
      bank_account_holder: emp.bank_account_holder,
      snapshot_at: nowIso(),
    };

    const existing = existingSnaps.find((s) => s.employee_id === emp.id);
    const saved = existing
      ? (existing.data_hash === dataHash ? existing : await ctx.db.payrollSnapshots.update(existing.id, existing.version, payload, actorId))
      : await ctx.db.payrollSnapshots.insert(payload, actorId);
    keepIds.add(saved.id);

    totals.hours += r.approvedHours;
    totals.ot += r.otHours;
    totals.gross += r.gross;
    totals.deduct += r.deductions + r.advance;
    totals.net += r.net;
  }

  for (const stale of existingSnaps.filter((s) => !keepIds.has(s.id))) {
    await ctx.db.payrollSnapshots.softDelete(stale.id, stale.version, actorId);
  }

  const latest = ctx.db.payPeriods.get(period.id)!;
  const nextSnapshotHash = createHash('sha256').update(`${period.id}:${totals.hours}:${totals.ot}:${totals.gross}:${totals.deduct}:${totals.net}`).digest('hex').slice(0, 16);
  if (
    latest.snapshot_hash === nextSnapshotHash &&
    latest.total_employees === keepIds.size &&
    latest.total_approved_hours === totals.hours &&
    latest.total_ot_hours === totals.ot &&
    latest.total_gross_vnd === totals.gross &&
    latest.total_deductions_vnd === totals.deduct &&
    latest.total_net_vnd === totals.net &&
    latest.unreconciled_records_count === totals.unreconciled
  ) {
    return latest;
  }
  return ctx.db.payPeriods.update(
    period.id,
    latest.version,
    {
      total_employees: keepIds.size,
      total_approved_hours: totals.hours,
      total_ot_hours: totals.ot,
      total_gross_vnd: totals.gross,
      total_deductions_vnd: totals.deduct,
      total_net_vnd: totals.net,
      unreconciled_records_count: totals.unreconciled,
      snapshot_hash: nextSnapshotHash,
    },
    actorId,
  );
}

export { mapSnapshot } from './payroll-snapshot.mapper.js';
