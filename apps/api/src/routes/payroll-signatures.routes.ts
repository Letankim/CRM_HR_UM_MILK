import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import {
  getConfiguredAdminSignature,
  loadPayrollMediaBuffer,
  saveConfiguredAdminSignature,
} from '../services/payroll-media-storage.js';
import {
  adminApproveAndSignPeriod,
  employeeDirectSignPayslip,
  financeSignAndPublishPeriod,
  markPayslipsPaid,
  submitPeriodToAdmin,
} from '../services/payroll-signature-workflow.service.js';
import { exportPeriodPayslipsZip, exportSinglePayslipPdf } from '../services/payslip-zip-exporter.js';
import { findAllLinkedEmployeesForUser } from './employee-mapper.js';
import { withPeriodLabel } from './payroll-periods.routes.js';
import { isOwnPayslip, mapPayslipWithTicket } from './payslips.routes.js';

const zAdminSigConfigBody = z.object({
  signature_base64: z.string({ required_error: 'Vui lòng chọn ảnh chữ ký Ban Quản trị' }).trim().min(20, 'Ảnh chữ ký Ban Quản trị không hợp lệ'),
  signer_name: z.string().trim().min(2, 'Tên người đại diện ký tối thiểu 2 ký tự').max(100).optional(),
});

const zSubmitAdminBody = z.object({
  note: z.string().trim().max(300).optional().default(''),
});

const zAdminApproveBody = z.object({
  signature_base64: z.string().trim().optional().default(''),
  signer_name: z.string().trim().max(100).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});

const zFinancePublishBody = z.object({
  signature_base64: z.string({ required_error: 'Kế toán bắt buộc tải ảnh chữ ký từ máy lên để ký phát hành' }).trim().min(1, 'Kế toán bắt buộc tải ảnh chữ ký từ máy lên để ký phát hành'),
  signer_name: z.string().trim().max(100).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});

const zEmployeeSignBody = z.object({
  signature_base64: z.string({ required_error: 'Vui lòng ký tay trực tiếp trên khung chữ ký' }).trim().min(1, 'Vui lòng ký tay trực tiếp trên khung chữ ký'),
  signature_source: z.string().trim().default('DIRECT_CANVAS'),
});

const zPaySingleBody = z.object({
  payment_reference: z.string().trim().max(200).optional().default(''),
});

const zBulkPayBody = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, 'Vui lòng chọn ít nhất 1 phiếu lương cần đánh dấu đã thanh toán'),
  payment_reference: z.string().trim().max(200).optional().default(''),
});

const zExportZipBody = z.object({
  selected_ids: z.array(z.string().trim().min(1)).optional().default([]),
});

export async function payrollSignatureRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/payroll/media/:fileId', async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const media = await loadPayrollMediaBuffer(ctx, fileId);
    if (!media) throw Errors.notFound('Hình ảnh chữ ký / mã QR trên Google Drive', fileId);
    return reply.header('Content-Type', media.mimeType).header('Cache-Control', 'private, max-age=86400').send(media.buffer);
  });

  app.get('/api/admin/payroll/admin-signature', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'system.config') }, async (request) => {
    return sendSuccess(request, 'Lấy cấu hình chữ ký Ban Quản trị thành công', getConfiguredAdminSignature(ctx));
  });

  app.put('/api/admin/payroll/admin-signature', { preHandler: requirePermission('system.config') }, async (request) => {
    if (request.auth!.user.role !== 'ADMIN') {
      throw Errors.forbidden('Chỉ Quản trị hệ thống mới được phép cấu hình chữ ký Ban Quản trị');
    }
    const body = zAdminSigConfigBody.parse(request.body);
    const signerName = body.signer_name?.trim() || request.auth!.user.display_name || request.auth!.user.username;
    const saved = await saveConfiguredAdminSignature(ctx, { base64: body.signature_base64, signerName, actorId: request.auth!.user.id });
    await ctx.audit.record(auditContext(request), { action: 'payroll.admin_signature_config', entity: 'SYSTEM_SETTINGS', entityId: 'payroll.admin_signature', after: { signerName: saved.signerName, fileId: saved.fileId } });
    return sendSuccess(request, 'Đã lưu cấu hình chữ ký số Ban Quản trị trên Google Drive thành công', saved);
  });

  app.post('/api/admin/payroll/periods/:id/submit-to-admin', { preHandler: requirePermission('payroll.manage', 'payroll.publish', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zSubmitAdminBody.parse(request.body ?? {});
    const updated = await submitPeriodToAdmin(ctx, id, body.note, request.auth!.user);
    await ctx.audit.record(auditContext(request), { action: 'payroll_period.submit_admin', entity: 'PAY_PERIODS', entityId: id, after: { status: updated.status } });
    return sendSuccess(request, `Đã gửi bảng lương "${updated.name}" trình Ban Quản trị ký phê duyệt`, withPeriodLabel(ctx, updated));
  });

  app.post('/api/admin/payroll/periods/:id/admin-approve', { preHandler: requirePermission('system.config', 'payroll.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zAdminApproveBody.parse(request.body ?? {});
    const updated = await adminApproveAndSignPeriod(ctx, id, { signatureBase64: body.signature_base64, signerName: body.signer_name, note: body.note }, request.auth!.user);
    await ctx.audit.record(auditContext(request), { action: 'payroll_period.admin_approve', entity: 'PAY_PERIODS', entityId: id, after: { status: updated.status, admin_signed_by: updated.admin_signed_by } });
    return sendSuccess(request, `Ban Quản trị đã ký phê duyệt kỳ lương "${updated.name}" và chuyển phiếu về Kế toán`, withPeriodLabel(ctx, updated));
  });

  app.post('/api/admin/payroll/periods/:id/finance-publish', { preHandler: requirePermission('payroll.publish', 'payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zFinancePublishBody.parse(request.body ?? {});
    const updated = await financeSignAndPublishPeriod(ctx, id, { signatureBase64: body.signature_base64, signerName: body.signer_name, note: body.note }, request.auth!.user);
    await ctx.audit.record(auditContext(request), { action: 'payroll_period.finance_publish', entity: 'PAY_PERIODS', entityId: id, after: { status: updated.status, finance_signed_by: updated.finance_signed_by } });
    return sendSuccess(request, `Kế toán đã ký và phát hành phiếu lương kỳ "${updated.name}" xuống toàn bộ nhân viên`, withPeriodLabel(ctx, updated));
  });

  app.post('/api/me/payslips/:id/sign', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zEmployeeSignBody.parse(request.body ?? {});
    const user = request.auth!.user, emps = findAllLinkedEmployeesForUser(user, ctx);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!isOwnPayslip(slip, emps, user)) throw Errors.forbidden('Bạn chỉ được ký xác nhận phiếu lương của chính mình');
    const updated = await employeeDirectSignPayslip(ctx, slip, { signatureBase64: body.signature_base64, signatureSource: body.signature_source }, user);
    await ctx.audit.record(auditContext(request), { action: 'payslip.employee_sign', entity: 'PAYSLIPS', entityId: updated.id, after: { payslip_code: updated.payslip_code, employee_confirmed_at: updated.employee_confirmed_at } });
    return sendSuccess(request, 'Đã ký tay xác nhận phiếu lương thành công. Quản trị & Kế toán đã nhận thông báo chuyển khoản.', mapPayslipWithTicket(ctx, updated));
  });

  app.post('/api/admin/payroll/payslips/:id/pay', { preHandler: requirePermission('payroll.pay', 'payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zPaySingleBody.parse(request.body ?? {});
    const paid = await markPayslipsPaid(ctx, [id], body.payment_reference, request.auth!.user);
    await ctx.audit.record(auditContext(request), { action: 'payslip.pay', entity: 'PAYSLIPS', entityId: id, after: { count: paid.length, reference: body.payment_reference } });
    return sendSuccess(request, 'Đã đánh dấu phiếu lương Đã thanh toán và ghi nhận sổ chi lương thành công', paid[0] ?? null);
  });

  app.post('/api/admin/payroll/payslips/bulk-pay', { preHandler: requirePermission('payroll.pay', 'payroll.manage', 'system.config') }, async (request) => {
    const body = zBulkPayBody.parse(request.body ?? {});
    const paid = await markPayslipsPaid(ctx, body.ids, body.payment_reference, request.auth!.user);
    await ctx.audit.record(auditContext(request), { action: 'payslip.bulk_pay', entity: 'PAYSLIPS', entityId: paid[0]?.id ?? 'bulk', after: { count: paid.length } });
    return sendSuccess(request, `Đã đánh dấu Đã thanh toán cho ${paid.length} phiếu lương thành công`, { count: paid.length, items: paid });
  });

  app.post('/api/admin/payroll/periods/:id/export-pdf-zip', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zExportZipBody.parse(request.body ?? {});
    const out = await exportPeriodPayslipsZip(ctx, id, body.selected_ids, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'payroll.export_pdf_zip', entity: 'PAY_PERIODS', entityId: id, after: { count: out.count, zipFileName: out.zipFileName } });
    return sendSuccess(request, `Đã kết xuất ${out.count} phiếu lương PDF đầy đủ chữ ký và nén tệp ZIP thành công`, {
      fileName: out.zipFileName,
      mimeType: 'application/zip',
      count: out.count,
      fileNames: out.fileNames,
      base64: out.zipBuffer.toString('base64'),
    });
  });

  app.get('/api/admin/payroll/payslips/:id/export-pdf', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const out = await exportSinglePayslipPdf(ctx, id);
    return sendSuccess(request, 'Đã kết xuất tệp PDF phiếu lương thành công', {
      fileName: out.fileName,
      mimeType: 'application/pdf',
      base64: out.pdfBuffer.toString('base64'),
    });
  });

  app.get('/api/me/payslips/:id/export-pdf', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.auth!.user, emps = findAllLinkedEmployeesForUser(user, ctx);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!isOwnPayslip(slip, emps, user)) throw Errors.forbidden('Bạn chỉ được tải tệp PDF phiếu lương của chính mình');
    const out = await exportSinglePayslipPdf(ctx, slip.id);
    return sendSuccess(request, 'Đã kết xuất tệp PDF phiếu lương cá nhân thành công', {
      fileName: out.fileName,
      mimeType: 'application/pdf',
      base64: out.pdfBuffer.toString('base64'),
    });
  });
}
