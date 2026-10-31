import { createHash } from 'node:crypto';
import {
  OPERATION_SETTING_KEYS,
  PAYROLL_ITEM_TYPE_LABELS,
  SYSTEM_CONFIG,
  parsePartitionRegistry,
  type PayPeriod,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { computeEmployeePayroll } from './payroll-calculator.js';
import { collectWorkEntries } from './payroll-work-collector.js';
import { ensureLegacySalaryProfiles, profilesOf } from './salary-profile.service.js';
import { sweepExpiredShiftsAndMarkAbsent } from './shift-absent-scanner.js';

export { collectWorkEntries } from './payroll-work-collector.js';

const periodSigByDb = new WeakMap<object, Map<string, string>>();
const periodInFlightByDb = new WeakMap<object, Map<string, Promise<PayPeriod>>>();

function computePeriodDirtySig(ctx: AppContext, period: PayPeriod): string {
  const sumVer = <T extends { version: number; updated_at: string }>(rows: readonly T[]) => {
    let v = rows.length, maxTs = '';
    for (const r of rows) { v += r.version; if (r.updated_at > maxTs) maxTs = r.updated_at; }
    return `${rows.length}:${v}:${maxTs}`;
  };
  const inRange = <T extends { work_date: string; version: number; updated_at: string }>(rows: readonly T[]) =>
    sumVer(rows.filter((r) => r.work_date >= period.from_date && r.work_date <= period.to_date));
  return [
    'v5', ctx.db.partitionMonth, period.version, period.from_date, period.to_date,
    sumVer(ctx.db.employees.all(true)),
    sumVer(ctx.db.payRates.all(true)),
    inRange(ctx.db.shiftAssignments.all(true)),
    inRange(ctx.db.attendanceEvents.all(true)),
    inRange(ctx.db.attendanceAdjustments.all(true)),
    sumVer(ctx.db.leaveRequests.all(true).filter((l) => l.leave_date >= period.from_date && l.leave_date <= period.to_date)),
    sumVer(ctx.db.shiftSwaps.all(true)),
    sumVer(ctx.db.payrollItems.all(true).filter((i) => i.period_id === period.id)),
  ].join('|');
}

export async function recalculatePeriodSnapshots(ctx: AppContext, period: PayPeriod, actorId: string, force = false): Promise<PayPeriod> {
  let inFlightMap = periodInFlightByDb.get(ctx.db);
  if (!inFlightMap) { inFlightMap = new Map(); periodInFlightByDb.set(ctx.db, inFlightMap); }
  const existingTask = inFlightMap.get(period.id);
  if (existingTask && !force) return existingTask;

  const task = doRecalculatePeriodSnapshots(ctx, period, actorId, force).finally(() => {
    inFlightMap?.delete(period.id);
  });
  inFlightMap.set(period.id, task);
  return task;
}

export async function recalculateOpenPeriods(ctx: AppContext, actorId: string): Promise<void> {
  const openPeriods = ctx.db.payPeriods.filter((p) => p.status === 'DRAFT' || p.status === 'RECONCILE');
  for (const p of openPeriods) {
    await recalculatePeriodSnapshots(ctx, p, actorId, true);
  }
  ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'] }, SocketEvents.PAYROLL_UPDATED, { actorId });
}

function shouldPreserveOtherPartitionSnapshot(ctx: AppContext, period: PayPeriod, existingSnaps: readonly { total_shifts_count: number; approved_hours: number }[]): boolean {
  if (existingSnaps.length === 0) return false;
  if (ctx.db.shiftAssignments.find((a) => a.work_date >= period.from_date && a.work_date <= period.to_date)) return false;
  const pMonth = ctx.db.partitionMonth;
  if (pMonth) {
    const ym = `${pMonth.slice(0, 4)}-${pMonth.slice(5, 7)}`;
    if (!(period.from_date <= `${ym}-31` && period.to_date >= `${ym}-01`)) return true;
  }
  if (!existingSnaps.some((s) => s.total_shifts_count > 0 || s.approved_hours > 0)) return false;
  const reg = parsePartitionRegistry(ctx.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY)?.value);
  return reg.some((r) => {
    if (r.monthKey === pMonth) return false;
    const ym = `${r.monthKey.slice(0, 4)}-${r.monthKey.slice(5, 7)}`;
    return period.from_date <= `${ym}-31` && period.to_date >= `${ym}-01`;
  });
}

async function doRecalculatePeriodSnapshots(ctx: AppContext, period: PayPeriod, actorId: string, force = false): Promise<PayPeriod> {
  await Promise.all([sweepExpiredShiftsAndMarkAbsent(ctx.db, actorId), ensureLegacySalaryProfiles(ctx.db, actorId)]);
  let sigMap = periodSigByDb.get(ctx.db);
  if (!sigMap) { sigMap = new Map(); periodSigByDb.set(ctx.db, sigMap); }
  const existingSnaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  if (shouldPreserveOtherPartitionSnapshot(ctx, period, existingSnaps)) {
    return ctx.db.payPeriods.get(period.id) ?? period;
  }
  const currentSig = computePeriodDirtySig(ctx, period);
  if (!force && existingSnaps.length > 0 && sigMap.get(period.id) === currentSig) {
    return ctx.db.payPeriods.get(period.id) ?? period;
  }

  const periodItems = ctx.db.payrollItems.filter((i) => i.period_id === period.id && i.approval_status === 'APPROVED');
  const emps = ctx.db.employees.filter((e) => {
    if (e.status === 'ACTIVE') return true;
    return !!ctx.db.shiftAssignments.find((a) => (a.employee_id === e.id || a.employee_id === e.employee_code) && a.work_date >= period.from_date && a.work_date <= period.to_date);
  });

  const totals = { hours: 0, ot: 0, gross: 0, deduct: 0, net: 0, unreconciled: 0 };
  const keepEmpIds = new Set<string>();
  const toInsert: Parameters<typeof ctx.db.payrollSnapshots.insert>[0][] = [];
  const toBatchUpdate: Parameters<typeof ctx.db.payrollSnapshots.batchUpdate>[0] = [];

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
      source, workedDays: r.workedDays, missingProfileShifts: r.missingProfileShifts, paidSwapCount: r.paidSwapCount,
      checkedInShiftsCount: workSummary.checkedInShiftsCount, adjustedShiftsCount: workSummary.adjustedShiftsCount,
      scheduledOnlyShiftsCount: workSummary.scheduledOnlyShiftsCount, leaveOffCount: workSummary.leaveOffCount,
      swappedOutCount: workSummary.swappedOutCount,
      absentCount: workSummary.absentCount, lateCount: workSummary.lateCount, lateMinutesTotal: workSummary.lateMinutesTotal,
      shiftLogs: workSummary.shiftLogs, segments: r.segments,
      items: empItems.map((i) => ({ id: i.id, type: i.item_type, label: PAYROLL_ITEM_TYPE_LABELS[i.item_type], title: i.title, direction: i.direction, amount: i.total_amount_vnd })),
    });

    const dataHash = createHash('sha256')
      .update(`${period.id}:${emp.id}:${emp.stage}:${emp.branch_id}:${r.primaryProfile?.id ?? ''}:${r.primaryProfile?.rate_type ?? ''}:${r.primaryProfile?.amount_vnd ?? 0}:${r.primaryProfile?.probation_percent ?? 0}:${r.gross}:${r.net}:${r.approvedHours}:${r.otHours}:${r.swapCount}:${r.paidSwapCount}:${r.swapPay}:${workSummary.lateCount}:${workSummary.leaveOffCount}:${emp.bank_name}:${emp.bank_account_number}:${adjustmentsJson}`)
      .digest('hex').slice(0, 16);

    const payload = {
      period_id: period.id, period_code: period.period_code, employee_id: emp.id, employee_code: emp.employee_code,
      full_name: emp.full_name, branch_id: emp.branch_id, branch_name: branch?.name ?? 'Chi nhánh',
      staff_group: emp.staff_group, stage: emp.stage, pay_rate_id: r.primaryProfile?.id ?? '',
      approved_hours: r.approvedHours, rate_vnd: r.primaryProfile?.amount_vnd ?? 0, ot_hours: r.otHours,
      allowances_json: JSON.stringify(allowanceLines), adjustments_json: adjustmentsJson,
      probation_hours: r.probationHours, probation_hourly_rate_vnd: r.probationRateVnd, probation_pay_vnd: r.probationPay,
      official_hours: r.officialHours, official_hourly_rate_vnd: r.officialRateVnd, official_pay_vnd: r.officialPay,
      total_shifts_count: r.totalShifts, base_salary_vnd: r.baseSalary, ot_rate_vnd: r.otRateVnd, ot_pay_vnd: r.otPay,
      shift_swap_count: r.swapCount, shift_swap_allowance_vnd: r.swapPay, meal_allowance_vnd: r.mealVnd,
      transport_allowance_vnd: r.transport, attendance_bonus_vnd: r.attendanceBonus, kpi_bonus_vnd: r.kpiBonus,
      other_allowances_vnd: r.otherAllowances, positive_adjustments_vnd: r.positiveAdj,
      approved_deductions_vnd: r.deductions, advance_deduction_vnd: r.advance,
      late_count: workSummary.lateCount, late_minutes_total: workSummary.lateMinutesTotal,
      gross_vnd: r.gross, net_vnd: r.net, data_hash: dataHash,
      bank_name: emp.bank_name, bank_account_number: emp.bank_account_number, bank_account_holder: emp.bank_account_holder,
      snapshot_at: nowIso(),
    };

    const existing = existingSnaps.find((s) => s.employee_id === emp.id || (emp.employee_code && s.employee_code === emp.employee_code));
    if (existing) {
      if (existing.data_hash !== dataHash || existing.pay_rate_id !== payload.pay_rate_id || existing.rate_vnd !== payload.rate_vnd) {
        toBatchUpdate.push({ id: existing.id, expectedVersion: existing.version, patch: payload });
      }
    } else {
      toInsert.push(payload);
    }
    keepEmpIds.add(existing?.employee_id ?? emp.id);

    totals.hours += r.approvedHours;
    totals.ot += r.otHours;
    totals.gross += r.gross;
    totals.deduct += r.deductions + r.advance;
    totals.net += r.net;
  }

  for (const stale of existingSnaps.filter((s) => !keepEmpIds.has(s.employee_id))) {
    toBatchUpdate.push({ id: stale.id, expectedVersion: stale.version, patch: { is_deleted: true } });
  }
  if (toInsert.length > 0) await Promise.all(toInsert.map((p) => ctx.db.payrollSnapshots.insert(p, actorId)));
  if (toBatchUpdate.length > 0) await ctx.db.payrollSnapshots.batchUpdate(toBatchUpdate, actorId);

  const latest = ctx.db.payPeriods.get(period.id)!;
  const nextSnapshotHash = createHash('sha256').update(`${period.id}:${totals.hours}:${totals.ot}:${totals.gross}:${totals.deduct}:${totals.net}:${totals.unreconciled}`).digest('hex').slice(0, 16);
  const unchangedPeriod =
    latest.snapshot_hash === nextSnapshotHash &&
    latest.total_employees === keepEmpIds.size &&
    latest.total_approved_hours === totals.hours &&
    latest.total_ot_hours === totals.ot &&
    latest.total_gross_vnd === totals.gross &&
    latest.total_deductions_vnd === totals.deduct &&
    latest.total_net_vnd === totals.net &&
    latest.unreconciled_records_count === totals.unreconciled;

  const finalPeriod = unchangedPeriod
    ? latest
    : await ctx.db.payPeriods.update(
        period.id,
        latest.version,
        {
          total_employees: keepEmpIds.size,
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
  sigMap.set(period.id, computePeriodDirtySig(ctx, finalPeriod));
  return finalPeriod;
}

export { mapSnapshot } from './payroll-snapshot.mapper.js';
