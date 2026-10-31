import { DRIVE_FOLDERS, type PayPeriod, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { isSyntheticDemoEmail } from './email.service.js';
import {
  getConfiguredAdminSignature,
  persistPayrollMedia,
  saveConfiguredAdminSignature,
  toCleanDriveSlug,
} from './payroll-media-storage.js';
import { recalculatePeriodSnapshots } from './payroll-snapshot.service.js';
import { generatePayslips } from './payslip.service.js';

export { employeeDirectSignPayslip, markPayslipsPaid } from './payslip-sign-payment.service.js';

function notifyRoleWithEmail(
  ctx: AppContext,
  role: 'ADMIN' | 'FINANCE',
  params: { title: string; body: string; entityId: string; refCode: string; actorId: string },
) {
  ctx.realtime()?.toTargets({ roles: [role], excludeUserId: params.actorId }, SocketEvents.NOTIFICATION, {
    kind: 'PAYROLL_WORKFLOW', entityId: params.entityId, code: params.refCode, title: params.title,
  });
  for (const u of ctx.db.users.filter((x) => x.role === role && x.status === 'ACTIVE')) {
    if (u.email && !isSyntheticDemoEmail(u.email)) {
      ctx.email.enqueue({
        to: u.email,
        recipientName: u.display_name || u.username,
        template: 'PAYSLIP_PUBLISHED',
        referenceCode: params.refCode,
        subject: `[Ụm Bò Milk HR] ${params.title} (${params.refCode})`,
        summary: params.body,
        metadata: [
          { label: 'Mã kỳ lương', value: params.refCode },
          { label: 'Thời gian thực hiện', value: dayjs().format('HH:mm DD/MM/YYYY') },
        ],
        actionLabel: 'Mở Bảng lương & Phê duyệt',
        actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/admin/payroll`,
      });
    }
  }
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
  ctx.realtime()?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: updated.id, status: updated.status });
  notifyRoleWithEmail(ctx, 'ADMIN', { title, body, entityId: updated.id, refCode: updated.period_code, actorId: actor.id });
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
    throw Errors.forbidden('Chỉ Quản trị hệ thống mới có quyền phê duyệt và ký chữ ký Ban Quản trị trên kỳ lương');
  }
  const before = ctx.db.payPeriods.get(periodId);
  if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
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
  ctx.realtime()?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: updated.id, status: updated.status });
  notifyRoleWithEmail(ctx, 'FINANCE', { title, body, entityId: updated.id, refCode: updated.period_code, actorId: actor.id });
  return updated;
}

/** Bước 3: Kế toán tải chữ ký từ máy lên để ký & Phát hành phiếu lương xuống nhân viên (APPROVED -> PUBLISHED) */
export async function financeSignAndPublishPeriod(
  ctx: AppContext,
  periodId: string,
  params: { signatureBase64: string; signerName?: string; note?: string },
  actor: User,
): Promise<PayPeriod> {
  const before = ctx.db.payPeriods.get(periodId);
  if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
  if (before.status !== 'APPROVED') {
    throw Errors.conflict('Kỳ lương phải được Ban Quản trị ký phê duyệt trước khi Kế toán ký phát hành xuống nhân viên');
  }
  if (!params.signatureBase64?.trim()) {
    throw Errors.fieldValidation('signature_base64', 'REQUIRED_FIELD', 'Kế toán bắt buộc tải ảnh chữ ký từ máy lên để ký trước khi phát hành phiếu lương xuống nhân viên', '');
  }
  const signerName = (params.signerName || '').trim() || actor.display_name || actor.username;
  const savedFinSig = await persistPayrollMedia(ctx, {
    base64: params.signatureBase64,
    rootFolder: DRIVE_FOLDERS.PAYROLL_SIGNATURES,
    folderSegments: ['02_KE_TOAN', before.period_code],
    fileBaseName: `${before.period_code}_CHU_KY_KE_TOAN_${toCleanDriveSlug(signerName, 'FINANCE')}`,
    fieldName: 'signature_base64',
    labelVi: 'Ảnh chữ ký Kế toán',
  });
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
            finance_signature_file_id: savedFinSig.fileId, finance_signed_by: signerName, finance_signed_at: now,
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
              patch: { admin_signature_file_id: s.period.admin_signature_file_id, finance_signature_file_id: savedFinSig.fileId },
            })), actor.id);
          }
          await generatePayslips(ctx, s.period, actor.id, { actorEmail: actor.email });
        },
      },
    ],
    resultSelector: (s) => s.period,
  });
}
