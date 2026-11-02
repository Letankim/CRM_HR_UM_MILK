import { DRIVE_FOLDERS, SYSTEM_CONFIG, type PayPeriod, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { AppError, Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { resolveSystemHrMailbox, resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import {
  getConfiguredAdminSignature,
  getConfiguredFinanceSignature,
  persistPayrollMedia,
  saveConfiguredAdminSignature,
  saveConfiguredFinanceSignature,
  toCleanDriveSlug,
} from './payroll-media-storage.js';
import { recalculatePeriodSnapshots } from './payroll-snapshot.service.js';
import { generatePayslips } from './payslip.service.js';

export { employeeDirectSignPayslip, markPayslipsPaid, notifyFinancePayslipConfirmed } from './payslip-sign-payment.service.js';

export function notifyPayrollRoleWithEmail(
  ctx: AppContext,
  role: 'ADMIN' | 'FINANCE',
  params: { title: string; body: string; entityId: string; refCode: string; actorId: string; version?: number },
) {
  ctx.realtime()?.toTargets({ roles: [role], excludeUserId: params.actorId }, SocketEvents.NOTIFICATION, {
    kind: 'PAYROLL_WORKFLOW', entityId: params.entityId, code: params.refCode, title: params.title,
  });
  const actorUser = ctx.db.users.get(params.actorId);
  const actorEmail = actorUser ? resolveUserPersonalRealEmail(ctx, actorUser) : '';
  const seenEmails = new Set<string>(), origin = webOrigin(ctx);
  for (const u of ctx.db.users.filter((x) => x.role === role && x.status === 'ACTIVE' && x.id !== params.actorId)) {
    const to = resolveUserPersonalRealEmail(ctx, u);
    if (!to || to === actorEmail || seenEmails.has(to)) continue;
    seenEmails.add(to);
    ctx.email.enqueue({
      to, recipientName: u.display_name || u.username, template: 'PAYSLIP_PUBLISHED', referenceCode: params.refCode,
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${params.title} (${params.refCode})`,
      summary: params.body,
      metadata: [{ label: 'Mã kỳ lương', value: params.refCode }, { label: 'Thời gian thực hiện', value: dayjs().format('HH:mm DD/MM/YYYY') }],
      actionLabel: role === 'ADMIN' ? 'Mở Bảng lương & Ký phê duyệt' : 'Mở Bảng lương & Xử lý',
      actionUrl: `${origin}/admin/payroll`,
    }, { dedupeKey: `payroll_wf:${role}:${params.entityId}:v${params.version ?? 1}:${to}` });
  }
  if (seenEmails.size === 0) {
    const fallback = resolveSystemHrMailbox(ctx);
    if (fallback && fallback !== actorEmail) {
      seenEmails.add(fallback);
      ctx.email.enqueue({
        to: fallback, recipientName: role === 'ADMIN' ? 'Ban Quản trị' : 'Bộ phận Kế toán', template: 'PAYSLIP_PUBLISHED', referenceCode: params.refCode,
        subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${params.title} (${params.refCode})`, summary: params.body,
        metadata: [{ label: 'Mã kỳ lương', value: params.refCode }, { label: 'Thời gian thực hiện', value: dayjs().format('HH:mm DD/MM/YYYY') }],
        actionLabel: 'Mở Bảng lương & Phê duyệt', actionUrl: `${origin}/admin/payroll`,
      }, { dedupeKey: `payroll_wf:${role}:${params.entityId}:v${params.version ?? 1}:${fallback}` });
    }
  }
  if (seenEmails.size > 0) void ctx.email.processQueueBatch(Math.min(6, seenEmails.size));
}

/** Bước 1: Kế toán rà soát xong gửi bảng lương trình Quản trị phê duyệt (DRAFT -> RECONCILE) */
export async function submitPeriodToAdmin(ctx: AppContext, periodId: string, note: string, actor: User): Promise<PayPeriod> {
  const before = ctx.db.payPeriods.get(periodId);
  if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
  if (before.status !== 'DRAFT') {
    throw Errors.conflict('Chỉ kỳ lương đang ở bước Nháp mới có thể gửi trình Ban Quản trị phê duyệt');
  }
  const current = await recalculatePeriodSnapshots(ctx, before, actor.id, true);
  if (current.unreconciled_records_count > 0) {
    throw Errors.badRequest(`Còn ${current.unreconciled_records_count} nhân sự có ca làm nhưng chưa thiết lập hồ sơ lương hợp lệ. Vui lòng thiết lập lương trước khi trình Quản trị.`);
  }
  const now = nowIso();
  const updated = await ctx.db.payPeriods.update(periodId, current.version, {
    status: 'RECONCILE', reconciled_by: actor.id, reconciled_at: now, ...(note ? { note } : {}),
  }, actor.id);
  const title = `Kế toán gửi trình phê duyệt bảng lương ${updated.name}`;
  const body = `${actor.display_name || actor.username} đã rà soát xong bảng lương ${updated.name} (${updated.total_employees} nhân sự — Tổng thực lĩnh ${updated.total_net_vnd.toLocaleString('vi-VN')} đ) và gửi trình Ban Quản trị ký phê duyệt.`;
  await ctx.db.notifications.insert({
    recipient_user_id: '', recipient_role: 'ADMIN', branch_id: 'ALL', category: 'PAYROLL', severity: 'INFO',
    title, body, link: '/admin/payroll', read_at: '', entity_type: 'PAYROLL_SUBMIT_ADMIN', entity_id: updated.id,
  }, actor.id);
  await ensureSyncedNotifications(ctx);
  ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'] }, SocketEvents.PAYROLL_UPDATED, { periodId: updated.id, status: updated.status });
  notifyPayrollRoleWithEmail(ctx, 'ADMIN', { title, body, entityId: updated.id, refCode: updated.period_code, actorId: actor.id, version: updated.version });
  return updated;
}

/** Bước 2: Quản trị duyệt & đóng chữ ký Ban Quản trị cấu hình từ hệ thống (RECONCILE -> APPROVED) */
export async function adminApproveAndSignPeriod(
  ctx: AppContext,
  periodId: string,
  params: { signatureBase64?: string; signerName?: string; note?: string },
  actor: User,
): Promise<PayPeriod> {
  if (actor.role !== 'ADMIN') {
    throw new AppError(403, 'SEPARATION_OF_DUTIES_VIOLATION', 'Vi phạm nguyên tắc tách biệt nhiệm vụ (Separation of Duties): Kế toán lập bảng lương không được tự phê duyệt; chỉ Tổng quản trị (ADMIN) mới có quyền phê duyệt và ký chữ ký Ban Quản trị trên kỳ lương');
  }
  const before = ctx.db.payPeriods.get(periodId);
  if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
  if (before.reconciled_by && before.reconciled_by === actor.id) {
    throw new AppError(403, 'SEPARATION_OF_DUTIES_VIOLATION', 'Vi phạm nguyên tắc tách biệt nhiệm vụ (Separation of Duties): Người gửi đối soát bảng lương không được tự phê duyệt kỳ lương của chính mình');
  }
  if (before.status !== 'RECONCILE') {
    throw Errors.conflict('Kỳ lương phải được Kế toán rà soát và gửi trình (bước Đối soát) trước khi Quản trị ký phê duyệt');
  }
  const current = await recalculatePeriodSnapshots(ctx, before, actor.id);
  if (current.unreconciled_records_count > 0) {
    throw Errors.badRequest(`Còn ${current.unreconciled_records_count} nhân sự chưa thiết lập hồ sơ lương hợp lệ, chưa thể ký phê duyệt.`);
  }
  const signerName = (params.signerName || '').trim() || actor.display_name || actor.username;
  let adminSig = getConfiguredAdminSignature(ctx);
  if (params.signatureBase64?.trim()) {
    adminSig = await saveConfiguredAdminSignature(ctx, { base64: params.signatureBase64, signerName, actorId: actor.id });
  }
  if (!adminSig.fileId) {
    throw Errors.fieldValidation('signature_base64', 'REQUIRED_FIELD', 'Chưa có chữ ký Ban Quản trị trong Cấu hình hệ thống. Vui lòng tải ảnh chữ ký Ban Quản trị lên trước khi ký phê duyệt.', '');
  }
  const now = nowIso();
  const updated = await ctx.db.payPeriods.update(periodId, current.version, {
    status: 'APPROVED', approved_by: actor.id, approved_at: now,
    admin_signature_file_id: adminSig.fileId, admin_signed_by: adminSig.signerName || signerName, admin_signed_at: now,
    ...(params.note ? { note: params.note } : {}),
  }, actor.id);
  const title = `Ban Quản trị đã ký phê duyệt bảng lương ${updated.name}`;
  const body = `Quản trị ${updated.admin_signed_by} đã ký duyệt bảng lương ${updated.name}. Phiếu đã được chuyển về Kế toán — vui lòng tải chữ ký Kế toán để phát hành phiếu lương xuống nhân viên.`;
  await ctx.db.notifications.insert({
    recipient_user_id: '', recipient_role: 'FINANCE', branch_id: 'ALL', category: 'PAYROLL', severity: 'INFO',
    title, body, link: '/admin/payroll', read_at: '', entity_type: 'PAYROLL_ADMIN_APPROVED', entity_id: updated.id,
  }, actor.id);
  await ensureSyncedNotifications(ctx);
  ctx.realtime()?.toTargets({ roles: ['ADMIN', 'FINANCE', 'HR'] }, SocketEvents.PAYROLL_UPDATED, { periodId: updated.id, status: updated.status });
  notifyPayrollRoleWithEmail(ctx, 'FINANCE', { title, body, entityId: updated.id, refCode: updated.period_code, actorId: actor.id, version: updated.version });
  return updated;
}

/** Bước 3: Kế toán đóng chữ ký Kế toán (đã tải lên hoặc tải mới từ máy) & Phát hành phiếu lương xuống nhân viên (APPROVED -> PUBLISHED) */
export async function financeSignAndPublishPeriod(
  ctx: AppContext,
  periodId: string,
  params: { signatureBase64?: string; signerName?: string; note?: string },
  actor: User,
): Promise<PayPeriod> {
  if (actor.role !== 'FINANCE') {
    throw Errors.forbidden('Chỉ vai trò Kế toán mới có quyền ký chữ ký Kế toán và phát hành phiếu lương xuống nhân viên');
  }
  const before = ctx.db.payPeriods.get(periodId);
  if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
  if (before.status !== 'APPROVED') {
    throw Errors.conflict('Kỳ lương phải được Ban Quản trị ký phê duyệt trước khi Kế toán ký phát hành xuống nhân viên');
  }
  const cfgFinSig = getConfiguredFinanceSignature(ctx);
  const signerName = (params.signerName || '').trim() || cfgFinSig.signerName || actor.display_name || actor.username;
  let finSigFileId = cfgFinSig.fileId;
  if (params.signatureBase64?.trim()) {
    await saveConfiguredFinanceSignature(ctx, { base64: params.signatureBase64, signerName, actorId: actor.id });
    const savedFinSig = await persistPayrollMedia(ctx, {
      base64: params.signatureBase64,
      rootFolder: DRIVE_FOLDERS.PAYROLL_SIGNATURES,
      folderSegments: ['02_KE_TOAN', before.period_code],
      fileBaseName: `${before.period_code}_CHU_KY_KE_TOAN_${toCleanDriveSlug(signerName, 'FINANCE')}`,
      fieldName: 'signature_base64',
      labelVi: 'Ảnh chữ ký Kế toán',
    });
    finSigFileId = savedFinSig.fileId;
  }
  if (!finSigFileId) {
    throw Errors.fieldValidation('signature_base64', 'REQUIRED_FIELD', 'Chưa có ảnh chữ ký Kế toán. Vui lòng tải ảnh chữ ký Kế toán từ máy lên trước khi ký phát hành phiếu lương xuống nhân viên.', '');
  }
  const now = nowIso();
  return ctx.reconciliation.executeSaga({
    sagaKey: `payroll-finance-publish-${periodId}-v${before.version}`,
    operation: 'PAYROLL_FINANCE_SIGN_PUBLISH',
    actorId: actor.id,
    initialContext: { period: before },
    steps: [
      {
        name: 'UPDATE_PERIOD_PUBLISHED_WITH_SIGNATURE',
        run: async (s) => {
          s.period = await ctx.db.payPeriods.update(periodId, before.version, {
            status: 'PUBLISHED', published_by: actor.id, published_at: now,
            finance_signature_file_id: finSigFileId, finance_signed_by: signerName, finance_signed_at: now,
            ...(params.note ? { note: params.note } : {}),
          }, actor.id);
        },
      },
      {
        name: 'STAMP_AND_GENERATE_PAYSLIPS',
        run: async (s) => {
          const existing = ctx.db.payslips.filter((p) => p.period_id === periodId && p.status !== 'REVISED');
          if (existing.length > 0) {
            await ctx.db.payslips.batchUpdate(existing.map((p) => ({
              id: p.id, expectedVersion: p.version,
              patch: { admin_signature_file_id: s.period.admin_signature_file_id, finance_signature_file_id: finSigFileId },
            })), actor.id);
          }
          await generatePayslips(ctx, s.period, actor.id, { actorEmail: actor.email });
        },
      },
    ],
    resultSelector: (s) => s.period,
  });
}
