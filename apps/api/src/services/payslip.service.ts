import type { PayPeriod, Payslip, PayrollSnapshot } from '@umbm/shared';
import { PAYSLIP_STATUS_LABELS, EMPLOYEE_STAGE_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { mapSnapshot } from './payroll-snapshot.service.js';

/** Sinh Phiếu lương (PAYSLIPS) bản số 1 từ Snapshot khi kỳ lương chuyển sang PUBLISHED */
export async function generatePayslips(ctx: AppContext, period: PayPeriod, actorId: string) {
  const snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  const created: Payslip[] = [];
  for (const s of snaps) {
    if (ctx.db.payslips.find((p) => p.period_id === period.id && p.employee_id === s.employee_id)) continue;
    created.push(await ctx.db.payslips.insert(buildPayslipPayload(ctx, period, s, 1, s.net_vnd, s.gross_vnd), actorId));
  }
  return created;
}

export function buildPayslipPayload(ctx: AppContext, period: PayPeriod, s: PayrollSnapshot, revision: number, net: number, gross: number) {
  const allowances = s.meal_allowance_vnd + s.transport_allowance_vnd + s.other_allowances_vnd + s.shift_swap_allowance_vnd;
  const bonus = s.attendance_bonus_vnd + s.kpi_bonus_vnd;
  return {
    period_id: period.id,
    employee_id: s.employee_id,
    snapshot_id: s.id,
    revision,
    status: 'PUBLISHED' as const,
    published_at: nowIso(),
    payslip_code: `PL-${period.period_code}-${s.employee_code}${revision > 1 ? `-R${revision}` : ''}`,
    period_name: period.name,
    from_date: period.from_date,
    to_date: period.to_date,
    employee_code: s.employee_code,
    full_name: s.full_name,
    branch_id: s.branch_id,
    branch_name: s.branch_name,
    stage: s.stage,
    total_shifts_count: s.total_shifts_count,
    approved_hours: s.approved_hours,
    ot_hours: s.ot_hours,
    base_salary_vnd: s.base_salary_vnd,
    ot_pay_vnd: s.ot_pay_vnd,
    total_allowances_vnd: allowances,
    total_bonus_vnd: bonus,
    total_adjustments_vnd: s.positive_adjustments_vnd + (net - s.net_vnd),
    total_deductions_vnd: s.approved_deductions_vnd + s.advance_deduction_vnd,
    gross_vnd: Math.max(0, gross),
    net_vnd: Math.max(0, net),
    breakdown_json: JSON.stringify(mapSnapshot(s, ctx)),
    viewed_by_employee_at: '',
    employee_confirmed_at: '',
    dispute_status: 'NONE' as const,
    dispute_reason: '',
    pdf_drive_file_id: '',
  };
}

export function mapPayslip(p: Payslip) {
  let breakdown: Record<string, unknown> = {};
  try {
    breakdown = JSON.parse(p.breakdown_json || '{}');
  } catch {
    breakdown = {};
  }
  return {
    id: p.id,
    payslipCode: p.payslip_code,
    periodId: p.period_id,
    periodName: p.period_name,
    fromDate: p.from_date,
    toDate: p.to_date,
    employeeId: p.employee_id,
    employeeCode: p.employee_code,
    fullName: p.full_name,
    branchName: p.branch_name,
    stageLabel: EMPLOYEE_STAGE_LABELS[p.stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? p.stage,
    revision: p.revision,
    status: p.status,
    statusLabel: PAYSLIP_STATUS_LABELS[p.status],
    publishedAt: p.published_at || null,
    totalShiftsCount: p.total_shifts_count,
    approvedHours: p.approved_hours,
    otHours: p.ot_hours,
    baseSalaryVnd: p.base_salary_vnd,
    otPayVnd: p.ot_pay_vnd,
    totalAllowancesVnd: p.total_allowances_vnd,
    totalBonusVnd: p.total_bonus_vnd,
    totalAdjustmentsVnd: p.total_adjustments_vnd,
    totalDeductionsVnd: p.total_deductions_vnd,
    grossVnd: p.gross_vnd,
    netVnd: p.net_vnd,
    disputeStatus: p.dispute_status,
    breakdown,
    version: p.version,
  };
}
