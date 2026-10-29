import type { PayPeriod, Payslip, PayrollSnapshot } from '@umbm/shared';
import { PAYSLIP_STATUS_LABELS, EMPLOYEE_STAGE_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { queuePayslipPublishedEmails } from './action-email-dispatcher.js';
import { mapSnapshot, recalculatePeriodSnapshots } from './payroll-snapshot.service.js';

/** Sinh Phiếu lương (PAYSLIPS) bản số 1 từ Snapshot khi kỳ lương chuyển sang PUBLISHED */
export async function generatePayslips(ctx: AppContext, period: PayPeriod, actorId: string) {
  const snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
  const existingEmpIds = new Set(ctx.db.payslips.filter((p) => p.period_id === period.id).map((p) => p.employee_id));
  const toCreate = snaps.filter((s) => !existingEmpIds.has(s.employee_id));
  const created: Payslip[] = toCreate.length > 0
    ? await Promise.all(toCreate.map((s) => ctx.db.payslips.insert(buildPayslipPayload(ctx, period, s, 1, s.net_vnd, s.gross_vnd), actorId)))
    : [];
  queuePayslipPublishedEmails(ctx, period, created);
  return created;
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
    grossVnd: p.gross_vnd, netVnd: p.net_vnd, disputeStatus: p.dispute_status, breakdown, version: p.version,
  };
}

export async function applyPayslipAdjustment(
  ctx: AppContext,
  id: string,
  body: { version?: number; delta_vnd: number; reason: string; field_changed: string },
  actorId: string,
) {
  const directSlip = ctx.db.payslips.get(id);
  if (directSlip && directSlip.status === 'REVISED') {
    throw Errors.conflict('Phiếu lương này đã được thay thế bởi bản điều chỉnh mới hơn');
  }
  const snapById = ctx.db.payrollSnapshots.get(id);
  let slip =
    directSlip ??
    ctx.db.payslips.find((p) => p.snapshot_id === id && p.status !== 'REVISED') ??
    (snapById
      ? ctx.db.payslips.find(
          (p) => p.period_id === snapById.period_id && (p.employee_id === snapById.employee_id || p.employee_code === snapById.employee_code) && p.status !== 'REVISED',
        )
      : undefined);
  const snap =
    snapById ??
    (slip
      ? ctx.db.payrollSnapshots.get(slip.snapshot_id) ??
        ctx.db.payrollSnapshots.find((s) => s.period_id === slip!.period_id && (s.employee_id === slip!.employee_id || s.employee_code === slip!.employee_code))
      : undefined);
  const period = ctx.db.payPeriods.get(slip?.period_id ?? snap?.period_id ?? '');
  if (!period || !snap) throw Errors.notFound('Không tìm thấy dữ liệu bảng lương hoặc phiếu lương của nhân sự này');

  if (period.status === 'DRAFT' || period.status === 'RECONCILE') {
    const beforeNet = snap.net_vnd;
    const afterNet = beforeNet + body.delta_vnd;
    if (afterNet < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm, vui lòng kiểm tra lại', body.delta_vnd);
    const isAdd = body.delta_vnd > 0;
    const absDelta = Math.abs(body.delta_vnd);
    await ctx.db.payrollItems.insert(
      {
        period_id: period.id, employee_id: snap.employee_id, branch_id: snap.branch_id, work_date: period.to_date,
        item_type: isAdd ? 'ADJUSTMENT_ADD' : 'DEDUCTION_APPROVED', category_code: isAdd ? 'ADJUSTMENT' : 'DEDUCTION',
        title: body.reason, direction: isAdd ? 'ADD' : 'DEDUCT', quantity: 1, unit_amount_vnd: absDelta, total_amount_vnd: absDelta,
        source_ref_id: snap.id, policy_version: 'v5.1', approval_status: 'APPROVED', approved_by: actorId, approved_at: nowIso(), note: body.reason,
      },
      actorId,
    );
    const nextRev = ctx.db.payslipRevisions.filter((r) => r.period_id === period.id && r.employee_id === snap.employee_id).length + 1;
    await ctx.db.payslipRevisions.insert(
      {
        payslip_id: slip?.id ?? snap.id, revision: nextRev, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
        period_id: period.id, employee_id: snap.employee_id, field_changed: body.field_changed,
        before_amount_vnd: beforeNet, after_amount_vnd: afterNet, details_json: JSON.stringify({ mode: 'PAYROLL_SHEET_ADJUSTMENT', period_status: period.status }),
        status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
      },
      actorId,
    );
    await recalculatePeriodSnapshots(ctx, period, actorId, true);
    const updatedSnap = ctx.db.payrollSnapshots.get(snap.id) ?? snap;
    return {
      entity: 'PAYROLL_SNAPSHOTS' as const,
      entityId: updatedSnap.id,
      before: { net_vnd: beforeNet },
      after: { net_vnd: updatedSnap.net_vnd, reason: body.reason },
      message: `Đã điều chỉnh bảng lương lần ${nextRev} và cập nhật thực lĩnh mới`,
      data: { ...mapSnapshot(updatedSnap, ctx), revision: nextRev },
    };
  }

  if (!slip) slip = await ctx.db.payslips.insert(buildPayslipPayload(ctx, period, snap, 1, snap.net_vnd, snap.gross_vnd), actorId);
  const activeSlip = slip;
  const after = activeSlip.net_vnd + body.delta_vnd;
  if (after < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm, vui lòng kiểm tra lại', body.delta_vnd);

  const nextRevision = activeSlip.revision + 1;
  const result = await ctx.reconciliation.executeSaga({
    sagaKey: `payslip-revision-${activeSlip.id}-r${nextRevision}`,
    operation: 'PAYROLL_PAYSLIP_REVISION',
    actorId,
    initialContext: { newSlip: null as Payslip | null },
    steps: [
      {
        name: 'INSERT_REVISION_LOG',
        run: async () => {
          await ctx.db.payslipRevisions.insert(
            {
              payslip_id: activeSlip.id, revision: nextRevision, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
              period_id: activeSlip.period_id, employee_id: activeSlip.employee_id, field_changed: body.field_changed,
              before_amount_vnd: activeSlip.net_vnd, after_amount_vnd: after, details_json: JSON.stringify({ previous_payslip_code: activeSlip.payslip_code }),
              status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
            },
            actorId,
          );
        },
      },
      {
        name: 'INSERT_NEW_PAYSLIP_REVISION',
        run: async (s) => { s.newSlip = await ctx.db.payslips.insert(buildPayslipPayload(ctx, period, snap, nextRevision, after, activeSlip.gross_vnd + Math.max(0, body.delta_vnd)), actorId); },
      },
      { name: 'MARK_PREVIOUS_REVISED', run: async () => { await ctx.db.payslips.update(activeSlip.id, body.version ?? activeSlip.version, { status: 'REVISED' }, actorId); } },
      {
        name: 'SYNC_SNAPSHOT_AND_PERIOD_TOTALS',
        run: async () => {
          const ls = ctx.db.payrollSnapshots.get(snap.id);
          if (ls) {
            await ctx.db.payrollSnapshots.update(ls.id, ls.version, {
              positive_adjustments_vnd: body.delta_vnd > 0 ? ls.positive_adjustments_vnd + body.delta_vnd : ls.positive_adjustments_vnd,
              approved_deductions_vnd: body.delta_vnd < 0 ? ls.approved_deductions_vnd + Math.abs(body.delta_vnd) : ls.approved_deductions_vnd,
              gross_vnd: body.delta_vnd > 0 ? ls.gross_vnd + body.delta_vnd : ls.gross_vnd,
              net_vnd: after,
            }, actorId);
          }
          const lp = ctx.db.payPeriods.get(period.id);
          if (lp) {
            await ctx.db.payPeriods.update(lp.id, lp.version, {
              total_gross_vnd: lp.total_gross_vnd + Math.max(0, body.delta_vnd),
              total_deductions_vnd: lp.total_deductions_vnd + (body.delta_vnd < 0 ? Math.abs(body.delta_vnd) : 0),
              total_net_vnd: lp.total_net_vnd + body.delta_vnd,
            }, actorId);
          }
        },
      },
    ],
    resultSelector: (s) => s.newSlip!,
  });
  queuePayslipPublishedEmails(ctx, period, [result]);
  return {
    entity: 'PAYSLIPS' as const,
    entityId: result.id,
    before: { payslip_code: activeSlip.payslip_code, net_vnd: activeSlip.net_vnd },
    after: { payslip_code: result.payslip_code, net_vnd: result.net_vnd, reason: body.reason },
    message: `Đã tạo phiếu lương điều chỉnh lần ${nextRevision} (phiếu gốc được giữ nguyên để truy vết)`,
    data: mapPayslip(result),
  };
}
