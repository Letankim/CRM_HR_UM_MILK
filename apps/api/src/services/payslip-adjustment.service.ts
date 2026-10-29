import type { Payslip } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queuePayslipPublishedEmails } from './action-email-dispatcher.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import { mapSnapshot, recalculatePeriodSnapshots } from './payroll-snapshot.service.js';
import { buildPayslipPayload, mapPayslip } from './payslip.service.js';

export async function applyPayslipAdjustment(
  ctx: AppContext,
  id: string,
  body: { version?: number; delta_vnd: number; reason: string; field_changed: string },
  actorId: string,
  actorEmail?: string,
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
  if (period.status === 'PAID' || slip?.status === 'PAID') {
    throw Errors.conflict('Kỳ lương đã chuyển sang Đã thanh toán nên đã khóa toàn bộ dữ liệu, không thể điều chỉnh.');
  }
  if (slip?.employee_confirmed_at) {
    throw Errors.conflict(`Nhân sự ${snap.full_name} (${snap.employee_code}) đã xác nhận đồng ý phiếu lương nên không thể điều chỉnh.`);
  }

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
    ctx.realtime()?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: period.id, action: 'ADJUSTED' });
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
      { name: 'MARK_PREVIOUS_REVISED', run: async () => { await ctx.db.payslips.update(activeSlip.id, body.version ?? activeSlip.version, { status: 'REVISED' }, actorId); } },
      {
        name: 'INSERT_NEW_PAYSLIP_REVISION',
        run: async (s) => {
          const latestSnap = ctx.db.payrollSnapshots.get(snap.id) ?? snap;
          const linkedTickets = ctx.db.supportTickets.filter((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === activeSlip.id);
          const openTicket = linkedTickets.find((t) => t.status !== 'CLOSED' && t.status !== 'RESOLVED');
          s.newSlip = await ctx.db.payslips.insert(
            {
              ...buildPayslipPayload(ctx, period, latestSnap, nextRevision, after, activeSlip.gross_vnd + Math.max(0, body.delta_vnd)),
              status: 'PUBLISHED',
              dispute_status: openTicket ? 'OPEN' : linkedTickets.length > 0 ? 'RESOLVED' : 'NONE',
              dispute_reason: activeSlip.dispute_reason || '',
            },
            actorId,
          );
          for (const tck of linkedTickets) {
            await ctx.db.supportTickets.update(tck.id, tck.version, {
              related_entity_id: s.newSlip.id,
              related_label: `${s.newSlip.payslip_code} — ${s.newSlip.period_name}`,
            }, actorId);
          }
        },
      },
    ],
    resultSelector: (s) => s.newSlip!,
  });
  queuePayslipPublishedEmails(ctx, period, [result], { actorEmail });
  await ensureSyncedNotifications(ctx);
  ctx.realtime()?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: period.id, payslipId: result.id, action: 'REVISED' });
  return {
    entity: 'PAYSLIPS' as const,
    entityId: result.id,
    before: { payslip_code: activeSlip.payslip_code, net_vnd: activeSlip.net_vnd },
    after: { payslip_code: result.payslip_code, net_vnd: result.net_vnd, reason: body.reason },
    message: `Đã tạo phiếu lương điều chỉnh lần ${nextRevision} (phiếu gốc được giữ nguyên để truy vết)`,
    data: mapPayslip(result),
  };
}
