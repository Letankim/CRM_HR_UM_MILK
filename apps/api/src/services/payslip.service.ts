import type { PayPeriod, Payslip, PayrollSnapshot } from '@umbm/shared';
import { PAYSLIP_STATUS_LABELS, EMPLOYEE_STAGE_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { queuePayslipPublishedEmails } from './action-email-dispatcher.js';
import { isSyntheticDemoEmail } from './email.service.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import { mapSnapshot, recalculatePeriodSnapshots } from './payroll-snapshot.service.js';

function collectRealPayslipEmailRefs(ctx: AppContext): string {
  return [
    ...ctx.db.deliveryLogs.all().filter((l) => l.channel === 'EMAIL' && l.status !== 'FAILED' && !isSyntheticDemoEmail(l.recipient_user_id) && l.announcement_id.startsWith('PAYSLIP_PUBLISHED:')).map((l) => l.announcement_id),
    ...ctx.email.recent(200).filter((r) => r.template === 'PAYSLIP_PUBLISHED' && r.status !== 'FAILED' && !isSyntheticDemoEmail(r.to)).map((r) => `${r.referenceCode} ${r.subject}`),
  ].join(' | ');
}

function emitPayslipRealtime(ctx: AppContext, period: PayPeriod, slips: Payslip[], isPaid = false) {
  ctx.realtime()?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: period.id, status: period.status });
  const notifiedUsers = new Set<string>();
  for (const s of slips) {
    const emp = ctx.db.employees.get(s.employee_id) ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === s.employee_code.trim().toUpperCase());
    const u = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
    if (u && !notifiedUsers.has(u.id)) {
      notifiedUsers.add(u.id);
      ctx.realtime()?.toUser(u.id, SocketEvents.NOTIFICATION, {
        kind: 'PAYROLL', code: s.payslip_code,
        title: isPaid ? `Đã thanh toán lương kỳ ${period.name}` : `Phiếu lương ${period.name} đã phát hành`,
      });
    }
  }
}

/** Sinh Phiếu lương (PAYSLIPS), đồng bộ thông báo chuông & gửi Email cho nhân viên */
export async function generatePayslips(
  ctx: AppContext,
  period: PayPeriod,
  actorId: string,
  opts?: { actorEmail?: string; isPaid?: boolean; forceEmail?: boolean; skipEmail?: boolean },
) {
  let snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  if (snaps.length === 0) {
    await recalculatePeriodSnapshots(ctx, period, actorId, true);
    snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  }
  const existingActive = ctx.db.payslips.filter((p) => p.period_id === period.id && p.status !== 'REVISED');
  const hasSlipForSnap = (s: PayrollSnapshot) =>
    existingActive.some((p) => p.employee_id === s.employee_id || (Boolean(s.employee_code) && p.employee_code.trim().toUpperCase() === s.employee_code.trim().toUpperCase()));
  const toCreate = snaps.filter((s) => !hasSlipForSnap(s));
  const targetStatus: Payslip['status'] = period.status === 'PAID' || opts?.isPaid ? 'PAID' : 'PUBLISHED';
  const created: Payslip[] = toCreate.length > 0
    ? await Promise.all(toCreate.map((s) => ctx.db.payslips.insert({ ...buildPayslipPayload(ctx, period, s, 1, s.net_vnd, s.gross_vnd), status: targetStatus }, actorId)))
    : [];
  if (targetStatus === 'PAID') {
    const unpaid = existingActive.filter((p) => p.status === 'PUBLISHED');
    if (unpaid.length > 0) await ctx.db.payslips.batchUpdate(unpaid.map((p) => ({ id: p.id, expectedVersion: p.version, patch: { status: 'PAID' as const } })), actorId);
  }
  const activeSlips = ctx.db.payslips.filter((p) => p.period_id === period.id && p.status !== 'REVISED');
  let slipsToEmail: Payslip[] = [];
  if (!opts?.skipEmail) {
    const sentRefs = collectRealPayslipEmailRefs(ctx);
    const periodHasEmail = sentRefs.includes(period.period_code);
    slipsToEmail = opts?.forceEmail || opts?.isPaid
      ? activeSlips
      : activeSlips.filter((p) => created.some((c) => c.id === p.id) || (!periodHasEmail && !sentRefs.includes(p.payslip_code)));
    if (slipsToEmail.length > 0) queuePayslipPublishedEmails(ctx, period, slipsToEmail, { actorEmail: opts?.actorEmail, isPaid: opts?.isPaid, force: opts?.forceEmail });
  }
  await ensureSyncedNotifications(ctx);
  if (created.length > 0 || slipsToEmail.length > 0 || opts?.isPaid) emitPayslipRealtime(ctx, period, activeSlips, Boolean(opts?.isPaid));
  return activeSlips;
}

/** Tự động kiểm tra & sinh bù phiếu lương + thông báo/email còn thiếu cho các kỳ đã PUBLISHED / PAID */
export async function ensurePublishedPeriodPayslips(ctx: AppContext, actorId = 'system-sync', opts?: { skipEmail?: boolean }): Promise<void> {
  const closedPeriods = ctx.db.payPeriods.filter((p) => p.status === 'PUBLISHED' || p.status === 'PAID');
  if (closedPeriods.length === 0) return;
  const sentRefs = opts?.skipEmail ? '' : collectRealPayslipEmailRefs(ctx);
  for (const p of closedPeriods) {
    const snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === p.id);
    const active = ctx.db.payslips.filter((x) => x.period_id === p.id && x.status !== 'REVISED');
    const needsPaidSync = p.status === 'PAID' && active.some((x) => x.status === 'PUBLISHED');
    const missingEmail = !opts?.skipEmail && active.length > 0 && !sentRefs.includes(p.period_code) && active.some((x) => !sentRefs.includes(x.payslip_code));
    if (snaps.length === 0 || active.length < snaps.length || needsPaidSync || missingEmail) {
      await generatePayslips(ctx, p, actorId, { skipEmail: opts?.skipEmail });
    }
  }
}

export function buildPayslipPayload(ctx: AppContext, period: PayPeriod, s: PayrollSnapshot, revision: number, net: number, gross: number) {
  const allowances = s.meal_allowance_vnd + s.transport_allowance_vnd + s.other_allowances_vnd + s.shift_swap_allowance_vnd;
  const bonus = s.attendance_bonus_vnd + s.kpi_bonus_vnd;
  return {
    period_id: period.id, employee_id: s.employee_id, snapshot_id: s.id, revision, status: 'PUBLISHED' as const, published_at: nowIso(),
    payslip_code: `PL-${period.period_code}-${s.employee_code}${revision > 1 ? `-R${revision}` : ''}`,
    period_name: period.name, from_date: period.from_date, to_date: period.to_date, employee_code: s.employee_code, full_name: s.full_name,
    branch_id: s.branch_id, branch_name: s.branch_name, stage: s.stage, total_shifts_count: s.total_shifts_count,
    approved_hours: s.approved_hours, ot_hours: s.ot_hours, base_salary_vnd: s.base_salary_vnd, ot_pay_vnd: s.ot_pay_vnd,
    total_allowances_vnd: allowances, total_bonus_vnd: bonus,
    total_adjustments_vnd: s.positive_adjustments_vnd + (net - s.net_vnd),
    total_deductions_vnd: s.approved_deductions_vnd + s.advance_deduction_vnd,
    gross_vnd: Math.max(0, gross), net_vnd: Math.max(0, net), breakdown_json: JSON.stringify(mapSnapshot(s, ctx)),
    viewed_by_employee_at: '', employee_confirmed_at: '', dispute_status: 'NONE' as const, dispute_reason: '', pdf_drive_file_id: '',
  };
}

export function mapPayslip(p: Payslip) {
  let breakdown: Record<string, unknown> = {};
  try { breakdown = JSON.parse(p.breakdown_json || '{}'); } catch { breakdown = {}; }
  return {
    id: p.id, payslipCode: p.payslip_code, periodId: p.period_id, periodName: p.period_name, fromDate: p.from_date, toDate: p.to_date,
    employeeId: p.employee_id, employeeCode: p.employee_code, fullName: p.full_name, branchName: p.branch_name,
    stageLabel: EMPLOYEE_STAGE_LABELS[p.stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? p.stage,
    revision: p.revision, status: p.status, statusLabel: PAYSLIP_STATUS_LABELS[p.status], publishedAt: p.published_at || null,
    totalShiftsCount: p.total_shifts_count, approvedHours: p.approved_hours, otHours: p.ot_hours, baseSalaryVnd: p.base_salary_vnd,
    otPayVnd: p.ot_pay_vnd, totalAllowancesVnd: p.total_allowances_vnd, totalBonusVnd: p.total_bonus_vnd,
    totalAdjustmentsVnd: p.total_adjustments_vnd, totalDeductionsVnd: p.total_deductions_vnd,
    grossVnd: p.gross_vnd, netVnd: p.net_vnd, viewedByEmployeeAt: p.viewed_by_employee_at || null,
    employeeConfirmedAt: p.employee_confirmed_at || null, disputeStatus: p.dispute_status, disputeReason: p.dispute_reason || '',
    breakdown, version: p.version,
  };
}

export async function syncPayslipConfirmNotifications(
  ctx: AppContext,
  ins: (data: Omit<Parameters<typeof ctx.db.notifications.insert>[0], 'read_at'>, actorId?: string) => Promise<void>,
): Promise<void> {
  for (const ps of ctx.db.payslips.filter((x) => x.status !== 'REVISED' && Boolean(x.employee_confirmed_at)).slice(-100)) {
    const emp = ctx.db.employees.get(ps.employee_id) ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === ps.employee_code.trim().toUpperCase());
    const empUser = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
    await ins({
      recipient_user_id: '', recipient_role: 'FINANCE', branch_id: ps.branch_id || 'ALL', category: 'PAYROLL', severity: 'INFO',
      title: `Nhân sự đã xác nhận phiếu lương: ${ps.full_name} (${ps.employee_code})`,
      body: `${ps.full_name} (${ps.employee_code}) đã xác nhận đồng ý phiếu lương ${ps.payslip_code} (${ps.period_name}) — Thực lĩnh ${Number(ps.net_vnd || 0).toLocaleString('vi-VN')}đ.`,
      link: '/admin/payroll', entity_type: 'PAYSLIP_CONFIRMED_FINANCE', entity_id: ps.id, created_at: ps.employee_confirmed_at,
    }, empUser?.id || ps.updated_by);
  }
}

export { applyPayslipAdjustment } from './payslip-adjustment.service.js';
