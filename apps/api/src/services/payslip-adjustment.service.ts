import type { PayPeriod, Payslip, PayrollSnapshot, PayslipRevision } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { queuePayslipPublishedEmails } from './action-email-dispatcher.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import { mapSnapshot, recalculatePeriodSnapshots } from './payroll-snapshot.service.js';
import { buildPayslipPayload, mapPayslip } from './payslip.service.js';

async function executeApprovedPayslipRevisionSaga(
  ctx: AppContext,
  params: { period: PayPeriod; snap: PayrollSnapshot; activeSlip: Payslip; nextRevision: number; deltaVnd: number; afterNet: number; reason: string; fieldChanged: string; existingRev?: PayslipRevision; actorId: string; actorEmail?: string },
): Promise<Payslip> {
  const { period, snap, activeSlip, nextRevision, deltaVnd, afterNet, reason, fieldChanged, existingRev, actorId, actorEmail } = params;
  const result = await ctx.reconciliation.executeSaga({
    sagaKey: `payslip-revision-${activeSlip.id}-r${nextRevision}-${Date.now()}`,
    operation: 'PAYROLL_PAYSLIP_REVISION',
    actorId,
    initialContext: { newSlip: null as Payslip | null },
    steps: [
      {
        name: 'RECORD_APPROVED_REVISION',
        run: async () => {
          if (existingRev) {
            await ctx.db.payslipRevisions.update(existingRev.id, existingRev.version, {
              before_amount_vnd: activeSlip.net_vnd, after_amount_vnd: afterNet, status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
            }, actorId);
          } else {
            await ctx.db.payslipRevisions.insert({
              payslip_id: activeSlip.id, revision: nextRevision, reason, delta_vnd: deltaVnd, created_reason_by: actorId,
              period_id: activeSlip.period_id, employee_id: activeSlip.employee_id, field_changed: fieldChanged,
              before_amount_vnd: activeSlip.net_vnd, after_amount_vnd: afterNet, details_json: JSON.stringify({ previous_payslip_code: activeSlip.payslip_code }),
              status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
            }, actorId);
          }
        },
      },
      {
        name: 'SYNC_SNAPSHOT_AND_PERIOD_TOTALS',
        run: async () => {
          const ls = ctx.db.payrollSnapshots.get(snap.id);
          if (ls) {
            await ctx.db.payrollSnapshots.update(ls.id, ls.version, {
              positive_adjustments_vnd: deltaVnd > 0 ? ls.positive_adjustments_vnd + deltaVnd : ls.positive_adjustments_vnd,
              approved_deductions_vnd: deltaVnd < 0 ? ls.approved_deductions_vnd + Math.abs(deltaVnd) : ls.approved_deductions_vnd,
              gross_vnd: deltaVnd > 0 ? ls.gross_vnd + deltaVnd : ls.gross_vnd, net_vnd: afterNet,
            }, actorId);
          }
          const lp = ctx.db.payPeriods.get(period.id);
          if (lp) {
            await ctx.db.payPeriods.update(lp.id, lp.version, {
              total_gross_vnd: lp.total_gross_vnd + Math.max(0, deltaVnd),
              total_deductions_vnd: lp.total_deductions_vnd + (deltaVnd < 0 ? Math.abs(deltaVnd) : 0),
              total_net_vnd: lp.total_net_vnd + deltaVnd,
            }, actorId);
          }
        },
      },
      { name: 'MARK_PREVIOUS_REVISED', run: async () => { await ctx.db.payslips.update(activeSlip.id, activeSlip.version, { status: 'REVISED' }, actorId); } },
      {
        name: 'INSERT_NEW_PAYSLIP_REVISION',
        run: async (s) => {
          const latestSnap = ctx.db.payrollSnapshots.get(snap.id) ?? snap;
          const linkedTickets = ctx.db.supportTickets.filter((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === activeSlip.id);
          const openTicket = linkedTickets.find((t) => t.status !== 'CLOSED' && t.status !== 'RESOLVED');
          s.newSlip = await ctx.db.payslips.insert({
            ...buildPayslipPayload(ctx, period, latestSnap, nextRevision, afterNet, activeSlip.gross_vnd + Math.max(0, deltaVnd)),
            status: 'PUBLISHED',
            admin_signature_file_id: activeSlip.admin_signature_file_id || period.admin_signature_file_id || '',
            finance_signature_file_id: activeSlip.finance_signature_file_id || period.finance_signature_file_id || '',
            dispute_status: openTicket ? 'OPEN' : linkedTickets.length > 0 ? 'RESOLVED' : 'NONE',
            dispute_reason: activeSlip.dispute_reason || '',
          }, actorId);
          for (const tck of linkedTickets) {
            await ctx.db.supportTickets.update(tck.id, tck.version, { related_entity_id: s.newSlip.id, related_label: `${s.newSlip.payslip_code} — ${s.newSlip.period_name}` }, actorId);
          }
        },
      },
    ],
    resultSelector: (s) => s.newSlip!,
  });
  queuePayslipPublishedEmails(ctx, period, [result], { actorEmail });
  await ensureSyncedNotifications(ctx);
  const emp = ctx.db.employees.get(result.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === result.employee_code);
  const empUser = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
  if (empUser && empUser.id !== actorId) {
    ctx.realtime()?.toUser(empUser.id, SocketEvents.NOTIFICATION, {
      kind: 'PAYROLL', entityId: result.id, code: result.payslip_code,
      title: `Phiếu lương ${period.name} vừa có bản điều chỉnh mới đã được Quản trị duyệt (${result.payslip_code})`,
    });
  }
  ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'], userIds: empUser ? [empUser.id] : [] }, SocketEvents.PAYROLL_UPDATED, { periodId: period.id, payslipId: result.id, action: 'REVISED' });
  return result;
}

export async function applyPayslipAdjustment(
  ctx: AppContext, id: string, body: { version?: number; delta_vnd: number; reason: string; field_changed: string },
  actorId: string, actorEmail?: string, actorRole?: string,
) {
  const directSlip = ctx.db.payslips.get(id);
  if (directSlip && directSlip.status === 'REVISED') throw Errors.conflict('Phiếu lương này đã được thay thế bởi bản điều chỉnh mới hơn');
  const snapById = ctx.db.payrollSnapshots.get(id);
  let slip = directSlip ?? ctx.db.payslips.find((p) => p.snapshot_id === id && p.status !== 'REVISED')
    ?? (snapById ? ctx.db.payslips.find((p) => p.period_id === snapById.period_id && (p.employee_id === snapById.employee_id || p.employee_code === snapById.employee_code) && p.status !== 'REVISED') : undefined);
  const snap = snapById ?? (slip ? ctx.db.payrollSnapshots.get(slip.snapshot_id) ?? ctx.db.payrollSnapshots.find((s) => s.period_id === slip!.period_id && (s.employee_id === slip!.employee_id || s.employee_code === slip!.employee_code)) : undefined);
  const period = ctx.db.payPeriods.get(slip?.period_id ?? snap?.period_id ?? '');
  if (!period || !snap) throw Errors.notFound('Không tìm thấy dữ liệu bảng lương hoặc phiếu lương của nhân sự này');
  if (period.status === 'PAID' || slip?.status === 'PAID') throw Errors.conflict('Kỳ lương đã chuyển sang Đã thanh toán nên đã khóa toàn bộ dữ liệu, không thể điều chỉnh.');
  if (slip?.employee_confirmed_at || slip?.employee_signature_file_id) throw Errors.conflict(`Nhân sự ${snap.full_name} (${snap.employee_code}) đã ký tay xác nhận phiếu lương nên số liệu đã niêm phong chống gian lận, không thể điều chỉnh.`);
  if (period.status === 'APPROVED') throw Errors.conflict('Kỳ lương đã được Ban Quản trị ký phê duyệt. Không được tự ý điều chỉnh số liệu trước khi phát hành; nếu cần sửa, vui lòng trả kỳ lương về bước Đối soát để Ban Quản trị ký duyệt lại.');

  if (period.status === 'DRAFT' || period.status === 'RECONCILE') {
    const beforeNet = snap.net_vnd, afterNet = beforeNet + body.delta_vnd;
    if (afterNet < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm, vui lòng kiểm tra lại', body.delta_vnd);
    const isAdd = body.delta_vnd > 0, absDelta = Math.abs(body.delta_vnd);
    await ctx.db.payrollItems.insert({
      period_id: period.id, employee_id: snap.employee_id, branch_id: snap.branch_id, work_date: period.to_date,
      item_type: isAdd ? 'ADJUSTMENT_ADD' : 'DEDUCTION_APPROVED', category_code: isAdd ? 'ADJUSTMENT' : 'DEDUCTION',
      title: body.reason, direction: isAdd ? 'ADD' : 'DEDUCT', quantity: 1, unit_amount_vnd: absDelta, total_amount_vnd: absDelta,
      source_ref_id: snap.id, policy_version: 'v5.1', approval_status: 'APPROVED', approved_by: actorId, approved_at: nowIso(), note: body.reason,
    }, actorId);
    const nextRev = ctx.db.payslipRevisions.filter((r) => r.period_id === period.id && r.employee_id === snap.employee_id).length + 1;
    await ctx.db.payslipRevisions.insert({
      payslip_id: slip?.id ?? snap.id, revision: nextRev, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
      period_id: period.id, employee_id: snap.employee_id, field_changed: body.field_changed,
      before_amount_vnd: beforeNet, after_amount_vnd: afterNet, details_json: JSON.stringify({ mode: 'PAYROLL_SHEET_ADJUSTMENT', period_status: period.status }),
      status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
    }, actorId);
    await recalculatePeriodSnapshots(ctx, period, actorId, true);
    ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'] }, SocketEvents.PAYROLL_UPDATED, { periodId: period.id, action: 'ADJUSTED' });
    const updatedSnap = ctx.db.payrollSnapshots.get(snap.id) ?? snap;
    return {
      entity: 'PAYROLL_SNAPSHOTS' as const, entityId: updatedSnap.id, before: { net_vnd: beforeNet }, after: { net_vnd: updatedSnap.net_vnd, reason: body.reason },
      message: `Đã điều chỉnh bảng lương lần ${nextRev} và cập nhật thực lĩnh mới`, data: { ...mapSnapshot(updatedSnap, ctx), revision: nextRev },
    };
  }

  if (!slip) slip = await ctx.db.payslips.insert(buildPayslipPayload(ctx, period, snap, 1, snap.net_vnd, snap.gross_vnd), actorId);
  const activeSlip = slip, after = activeSlip.net_vnd + body.delta_vnd;
  if (after < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm, vui lòng kiểm tra lại', body.delta_vnd);
  const existingRevs = ctx.db.payslipRevisions.filter((r) => r.period_id === period.id && (r.employee_id === snap.employee_id || r.employee_id === snap.employee_code));
  const pendingRev = existingRevs.find((r) => r.status === 'PENDING');
  const nextRevision = pendingRev ? pendingRev.revision : activeSlip.revision + 1;

  if (actorRole && actorRole !== 'ADMIN') {
    const revRecord = pendingRev
      ? await ctx.db.payslipRevisions.update(pendingRev.id, pendingRev.version, {
          payslip_id: activeSlip.id, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
          before_amount_vnd: activeSlip.net_vnd, after_amount_vnd: after, status: 'PENDING', approved_by: '', approved_at: '',
        }, actorId)
      : await ctx.db.payslipRevisions.insert({
          payslip_id: activeSlip.id, revision: nextRevision, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
          period_id: activeSlip.period_id, employee_id: activeSlip.employee_id, field_changed: body.field_changed,
          before_amount_vnd: activeSlip.net_vnd, after_amount_vnd: after, details_json: JSON.stringify({ previous_payslip_code: activeSlip.payslip_code }),
          status: 'PENDING', approved_by: '', approved_at: '',
        }, actorId);
    const deltaText = `${body.delta_vnd >= 0 ? '+' : ''}${body.delta_vnd.toLocaleString('vi-VN')}đ`;
    await ctx.db.notifications.insert({
      recipient_user_id: '', recipient_role: 'ADMIN', branch_id: snap.branch_id || 'ALL', category: 'PAYROLL', severity: 'WARNING',
      title: `Trình duyệt điều chỉnh phiếu lương: ${snap.full_name} (${snap.employee_code})`,
      body: `Kế toán đề xuất điều chỉnh ${deltaText} trên phiếu lương ${activeSlip.payslip_code} (${period.name}) — Thực lĩnh dự kiến: ${after.toLocaleString('vi-VN')}đ. Lý do: ${body.reason}.`,
      link: '/admin/payroll', entity_type: 'PAYSLIP_REVISION_PENDING', entity_id: revRecord.id, read_at: '',
    }, actorId);
    ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE'] }, SocketEvents.PAYROLL_UPDATED, { periodId: period.id, payslipId: activeSlip.id, action: 'REVISION_PENDING' });
    ctx.realtime()?.toTargets({ roles: ['ADMIN'] }, SocketEvents.NOTIFICATION, { kind: 'PAYROLL_REVISION_PENDING', entityId: revRecord.id, title: `Trình duyệt điều chỉnh phiếu lương ${snap.full_name} (${deltaText})` });
    return {
      entity: 'PAYSLIP_REVISIONS' as const, entityId: revRecord.id,
      before: { payslip_code: activeSlip.payslip_code, net_vnd: activeSlip.net_vnd },
      after: { delta_vnd: body.delta_vnd, after_amount_vnd: after, status: 'PENDING', reason: body.reason },
      message: `Đã gửi yêu cầu điều chỉnh phiếu lương (${deltaText}) trình Ban Quản trị phê duyệt`,
      data: { ...mapPayslip(activeSlip, ctx), snapshot: mapSnapshot(snap, ctx) },
    };
  }

  const result = await executeApprovedPayslipRevisionSaga(ctx, { period, snap, activeSlip, nextRevision, deltaVnd: body.delta_vnd, afterNet: after, reason: body.reason, fieldChanged: body.field_changed, existingRev: pendingRev, actorId, actorEmail });
  return { entity: 'PAYSLIPS' as const, entityId: result.id, before: { payslip_code: activeSlip.payslip_code, net_vnd: activeSlip.net_vnd }, after: { payslip_code: result.payslip_code, net_vnd: result.net_vnd, reason: body.reason }, message: `Đã tạo và phê duyệt phiếu lương điều chỉnh lần ${nextRevision}`, data: mapPayslip(result, ctx) };
}

export async function decidePayslipRevision(
  ctx: AppContext, targetId: string, body: { action: 'APPROVE' | 'REJECT'; note?: string }, actor: { id: string; role: string; email?: string },
) {
  if (actor.role !== 'ADMIN') throw Errors.forbidden('Chỉ Ban Quản trị (ADMIN) mới có quyền phê duyệt hoặc từ chối điều chỉnh phiếu lương cá nhân');
  const rev = ctx.db.payslipRevisions.get(targetId) ?? ctx.db.payslipRevisions.find((r) => r.status === 'PENDING' && (r.payslip_id === targetId || r.employee_id === targetId));
  if (!rev) throw Errors.notFound('Không tìm thấy yêu cầu điều chỉnh phiếu lương chờ duyệt');
  if (rev.status !== 'PENDING') throw Errors.conflict('Yêu cầu điều chỉnh phiếu lương này đã được xử lý trước đó');
  const period = ctx.db.payPeriods.get(rev.period_id);
  const snap = ctx.db.payrollSnapshots.find((s) => s.period_id === rev.period_id && (s.employee_id === rev.employee_id || s.employee_code === rev.employee_id));
  const activeSlip = ctx.db.payslips.find((p) => p.period_id === rev.period_id && (p.employee_id === rev.employee_id || p.employee_code === rev.employee_id) && p.status !== 'REVISED') ?? ctx.db.payslips.get(rev.payslip_id);
  if (!period || !snap || !activeSlip) throw Errors.notFound('Không tìm thấy dữ liệu phiếu lương gốc cần điều chỉnh');

  if (body.action === 'REJECT') {
    const rejected = await ctx.db.payslipRevisions.update(rev.id, rev.version, {
      status: 'REJECTED', approved_by: actor.id, approved_at: nowIso(),
      details_json: JSON.stringify({ previous_payslip_code: activeSlip.payslip_code, reject_note: body.note || '' }),
    }, actor.id);
    ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE'] }, SocketEvents.PAYROLL_UPDATED, { periodId: period.id, payslipId: activeSlip.id, action: 'REVISION_REJECTED' });
    return { entity: 'PAYSLIP_REVISIONS' as const, entityId: rejected.id, message: `Đã từ chối yêu cầu điều chỉnh phiếu lương của ${snap.full_name}`, data: mapSnapshot(snap, ctx) };
  }

  const after = activeSlip.net_vnd + rev.delta_vnd;
  if (after < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm', rev.delta_vnd);
  const newSlip = await executeApprovedPayslipRevisionSaga(ctx, {
    period, snap, activeSlip, nextRevision: rev.revision, deltaVnd: rev.delta_vnd, afterNet: after, reason: rev.reason, fieldChanged: rev.field_changed, existingRev: rev, actorId: actor.id, actorEmail: actor.email,
  });
  const latestSnap = ctx.db.payrollSnapshots.get(snap.id) ?? snap;
  return {
    entity: 'PAYSLIPS' as const, entityId: newSlip.id,
    message: `Ban Quản trị đã phê duyệt điều chỉnh phiếu lương lần #${rev.revision} cho ${snap.full_name} (${snap.employee_code})`,
    data: { ...mapSnapshot(latestSnap, ctx), ...mapPayslip(newSlip, ctx), snapshotId: latestSnap.id },
  };
}
