import { createHash } from 'node:crypto';
import {
  PAYROLL_ITEM_TYPE_LABELS,
  PAYROLL_WORK_SOURCE_LABELS,
  SYSTEM_CONFIG,
  type PayPeriod,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { computeEmployeePayroll, type WorkEntry } from './payroll-calculator.js';
import { profilesOf } from './salary-profile.service.js';

const COUNTED_STATUSES = new Set(['PUBLISHED', 'COMPLETED']);

/** Thu thập dữ liệu công của nhân sự trong kỳ (hiện lấy từ lịch đã phát hành; chấm công GPS sẽ thay thế khi bật) */
export function collectWorkEntries(ctx: AppContext, employeeId: string, from: string, to: string) {
  const inRange = ctx.db.shiftAssignments.filter((a) => a.employee_id === employeeId && a.work_date >= from && a.work_date <= to);
  const entries: WorkEntry[] = inRange
    .filter((a) => COUNTED_STATUSES.has(a.status) && a.day_type !== 'OFF')
    .map((a) => ({
      assignmentId: a.id,
      date: a.work_date,
      hours: a.day_type === 'OT' ? 0 : a.scheduled_hours,
      otHours: a.day_type === 'OT' ? a.scheduled_hours : 0,
      isSwap: !!a.swapped_from_employee_id || !!a.replacement_for_employee_id,
    }));
  const absentCount = inRange.filter((a) => a.status === 'ABSENT').length;
  return { entries, absentCount, source: 'SCHEDULE_PUBLISHED' as keyof typeof PAYROLL_WORK_SOURCE_LABELS };
}

export async function recalculatePeriodSnapshots(ctx: AppContext, period: PayPeriod, actorId: string) {
  const existingSnaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  const periodItems = ctx.db.payrollItems.filter((i) => i.period_id === period.id && i.approval_status === 'APPROVED');
  const emps = ctx.db.employees.filter((e) => {
    if (e.status === 'ACTIVE') return true;
    return !!ctx.db.shiftAssignments.find((a) => a.employee_id === e.id && a.work_date >= period.from_date && a.work_date <= period.to_date);
  });

  const totals = { hours: 0, ot: 0, gross: 0, deduct: 0, net: 0, unreconciled: 0 };
  const keepIds = new Set<string>();

  for (const emp of emps) {
    const branch = ctx.db.branches.get(emp.branch_id);
    const { entries, absentCount, source } = collectWorkEntries(ctx, emp.id, period.from_date, period.to_date);
    const empItems = periodItems.filter((i) => i.employee_id === emp.id);
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
      adjustments_json: JSON.stringify({
        source,
        workedDays: r.workedDays,
        missingProfileShifts: r.missingProfileShifts,
        segments: r.segments,
        items: empItems.map((i) => ({ id: i.id, type: i.item_type, label: PAYROLL_ITEM_TYPE_LABELS[i.item_type], title: i.title, direction: i.direction, amount: i.total_amount_vnd })),
      }),
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
      late_count: 0,
      late_minutes_total: 0,
      gross_vnd: r.gross,
      net_vnd: r.net,
      data_hash: createHash('sha256').update(`${period.id}:${emp.id}:${r.gross}:${r.net}:${JSON.stringify(r.segments)}`).digest('hex').slice(0, 16),
      bank_name: emp.bank_name,
      bank_account_number: emp.bank_account_number,
      bank_account_holder: emp.bank_account_holder,
      snapshot_at: nowIso(),
    };

    const existing = existingSnaps.find((s) => s.employee_id === emp.id);
    const saved = existing
      ? await ctx.db.payrollSnapshots.update(existing.id, existing.version, payload, actorId)
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
      snapshot_hash: createHash('sha256').update(`${period.id}:${totals.gross}:${totals.net}`).digest('hex').slice(0, 16),
    },
    actorId,
  );
}

export { mapSnapshot } from './payroll-snapshot.mapper.js';
