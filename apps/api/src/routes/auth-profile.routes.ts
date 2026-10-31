import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DRIVE_FOLDERS, normalizePhone, ROLE_LABELS, type PublicUser, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { persistPayrollMedia, resolvePayrollMediaUrl, toCleanDriveSlug } from '../services/payroll-media-storage.js';
import { assertUniquePersonalIdentifiers } from './employee-mapper.js';

const zUpdateProfileBody = z.object({
  display_name: z.string().trim().min(2, 'Họ và tên hiển thị tối thiểu 2 ký tự').max(100),
  phone: z.string().trim().optional().default(''),
  email: z.string().trim().optional().default(''),
  current_address: z.string().trim().max(300).optional().default(''),
  emergency_contact_name: z.string().trim().max(100).optional().default(''),
  emergency_contact_phone: z.string().trim().max(20).optional().default(''),
  bank_name: z.string().trim().max(100).optional().default(''),
  bank_account_number: z.string().trim().max(50).optional().default(''),
  bank_account_holder: z.string().trim().max(100).optional().default(''),
  bank_qr_base64: z.string().trim().optional().default(''),
  remove_bank_qr: z.boolean().optional().default(false),
});

/** Hồ sơ cá nhân của người dùng đang đăng nhập (xem & tự cập nhật). */
export function registerAuthProfileRoutes(app: FastifyInstance, ctx: AppContext, toResolvedPublicUser: (u: User) => PublicUser): void {
  app.get('/api/auth/profile', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const emp = ctx.db.employees.find(
      (e) => e.user_id === user.id || Boolean(user.employee_id && (e.employee_code === user.employee_id || e.id === user.employee_id)),
    );
    const branch = emp ? ctx.db.branches.get(emp.branch_id) : undefined;
    return sendSuccess(request, 'Lấy thông tin hồ sơ cá nhân thành công', {
      id: user.id,
      version: user.version,
      username: user.username,
      displayName: user.display_name,
      phone: user.phone || emp?.phone || '',
      email: user.email || emp?.email || '',
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      employeeId: emp?.id ?? null,
      employeeCode: emp?.employee_code ?? (user.employee_id || null),
      branchName: branch?.name ?? 'Toàn hệ thống',
      currentAddress: emp?.current_address ?? '',
      emergencyContactName: emp?.emergency_contact_name ?? '',
      emergencyContactPhone: emp?.emergency_contact_phone ?? '',
      bankName: emp?.bank_name ?? 'Techcombank',
      bankAccountNumber: emp?.bank_account_number ?? '',
      bankAccountHolder: emp?.bank_account_holder ?? user.display_name.toUpperCase(),
      bankQrFileId: emp?.bank_qr_file_id ?? '',
      bankQrUrl: resolvePayrollMediaUrl(emp?.bank_qr_file_id),
      bankQrDriveFolder: DRIVE_FOLDERS.EMPLOYEE_BANK_QR,
    });
  });

  app.put('/api/auth/profile', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const body = zUpdateProfileBody.parse(request.body);
    const emp = ctx.db.employees.find(
      (e) => e.user_id === user.id || Boolean(user.employee_id && (e.employee_code === user.employee_id || e.id === user.employee_id)),
    );
    let normalizedPhone = '';
    if (body.phone) {
      const p = normalizePhone(body.phone);
      if (!p) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Định dạng số điện thoại không hợp lệ (gồm 10 chữ số bắt đầu bằng số 0)', body.phone);
      normalizedPhone = p;
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw Errors.fieldValidation('email', 'INVALID_EMAIL', 'Định dạng địa chỉ email không hợp lệ', body.email);
    }
    assertUniquePersonalIdentifiers(ctx, {
      phone: normalizedPhone || undefined,
      phoneField: 'phone',
      email: body.email || undefined,
      bank_account_number: body.bank_account_number || undefined,
      excludeUserId: user.id,
      excludeEmployeeId: emp?.id ?? null,
    });

    const updatedUser = await ctx.db.users.update(
      user.id,
      user.version,
      {
        display_name: body.display_name,
        phone: normalizedPhone || user.phone,
        email: body.email || user.email,
      },
      user.id,
    );

    let nextBankQrFileId = emp?.bank_qr_file_id ?? '';
    if (body.remove_bank_qr) nextBankQrFileId = '';
    if (body.bank_qr_base64) {
      if (!emp) throw Errors.badRequest('Tài khoản chưa liên kết hồ sơ nhân sự nên không thể lưu Mã QR ngân hàng nhận lương');
      const bankLabel = body.bank_name || emp.bank_name || 'Bank';
      const savedQr = await persistPayrollMedia(ctx, {
        base64: body.bank_qr_base64,
        rootFolder: DRIVE_FOLDERS.EMPLOYEE_BANK_QR,
        fileBaseName: `${emp.employee_code}_${toCleanDriveSlug(body.display_name || emp.full_name)}_${toCleanDriveSlug(bankLabel)}_QR`,
        fieldName: 'bank_qr_base64',
        labelVi: 'Ảnh Mã QR ngân hàng',
      });
      nextBankQrFileId = savedQr.fileId;
    }

    if (emp) {
      await ctx.db.employees.update(
        emp.id,
        emp.version,
        {
          full_name: body.display_name,
          phone: normalizedPhone || emp.phone,
          email: body.email || emp.email,
          current_address: body.current_address || emp.current_address,
          emergency_contact_name: body.emergency_contact_name,
          emergency_contact_phone: body.emergency_contact_phone ? normalizePhone(body.emergency_contact_phone) || body.emergency_contact_phone : '',
          bank_name: body.bank_name || emp.bank_name,
          bank_account_number: body.bank_account_number,
          bank_account_holder: body.bank_account_holder || body.display_name.toUpperCase(),
          bank_qr_file_id: nextBankQrFileId,
        },
        user.id,
      );
    }

    await ctx.audit.record(auditContext(request), {
      action: 'auth.profile.update',
      entity: 'USERS',
      entityId: user.id,
      before: { display_name: user.display_name, phone: user.phone, email: user.email },
      after: { display_name: updatedUser.display_name, phone: updatedUser.phone, email: updatedUser.email },
    });

    return sendSuccess(request, 'Đã cập nhật thông tin cá nhân thành công', {
      user: toResolvedPublicUser(updatedUser),
      bankQrFileId: nextBankQrFileId,
      bankQrUrl: resolvePayrollMediaUrl(nextBankQrFileId),
      bankQrDriveFolder: DRIVE_FOLDERS.EMPLOYEE_BANK_QR,
    });
  });
}
