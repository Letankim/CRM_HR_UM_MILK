import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACCOUNT_STATUS_LABELS, PERMISSIONS, ROLE_LABELS, ROLES, isPermissionForbiddenForRole, normalizePhone } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { parseExtraPermissions, toPublicUser } from '../auth/auth.service.js';
import { hashSecret } from '../auth/password.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { queueAccountActivatedEmail, queueAccountLockedEmail, queueAccountRevokedEmail, queueAccountUnlockedEmail, queueAccountUpdatedEmail } from '../services/action-email-dispatcher.js';
import { syncEmployeeFromAccount } from './account-employee-sync.js';
import { sanitizeExtraPermissions } from './accounts.routes.js';
import { assertUniquePersonalIdentifiers, findLinkedEmployeeForUser } from './employee-mapper.js';

const zUpdateAccountBody = z.object({
  version: z.coerce.number().int().min(1),
  display_name: z.string().trim().min(2).max(80).optional(),
  phone_number: z.string().trim().optional(),
  email: z.string().trim().email('Định dạng địa chỉ email không hợp lệ').or(z.literal('')).optional(),
  role: z.enum(ROLES).optional(),
  branch_scope: z.string().trim().min(1).optional(),
  employee_id: z.string().trim().max(64).optional(),
  secret: z.string().min(6).max(128).optional(),
  extra_permissions: z.array(z.enum(PERMISSIONS)).optional(),
  reason: z.string().trim().max(500).optional(),
});

const zDeleteVersionBody = z.object({ version: z.coerce.number().int().min(1).optional() });
const zBulkActionBody = z.object({
  action: z.enum(['ACTIVATE', 'LOCK', 'REVOKE', 'UNLOCK', 'DELETE'], {
    errorMap: () => ({ message: 'Hành động hàng loạt không hợp lệ (ACTIVATE, LOCK, REVOKE, UNLOCK, DELETE)' }),
  }),
  items: z.array(z.object({ id: z.string().min(1, 'Mã tài khoản không được để trống'), version: z.number().int().min(1, 'Phiên bản bản ghi không hợp lệ') }))
    .min(1, 'Vui lòng chọn ít nhất 1 tài khoản để thực hiện')
    .max(100, 'Tối đa 100 tài khoản trong một lần thao tác hàng loạt'),
  reason: z.string().max(500, 'Lý do tối đa 500 ký tự').optional(),
});

export async function accountBulkRoutes(app: FastifyInstance, ctx: AppContext) {
  app.put<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requirePermission('account.manage', 'employee.manage') },
    async (request) => {
      const { id } = request.params;
      const body = zUpdateAccountBody.parse(request.body);
      const before = ctx.db.users.get(id);
      if (!before) throw Errors.notFound('Tài khoản', id);
      const actorId = request.auth!.user.id;

      let phone = before.phone;
      if (body.phone_number !== undefined) {
        if (body.phone_number === '') {
          phone = '';
        } else {
          const normalized = normalizePhone(body.phone_number);
          if (!normalized) {
            throw Errors.fieldValidation('phone_number', 'INVALID_PHONE', 'Định dạng số điện thoại không hợp lệ', body.phone_number);
          }
          phone = normalized;
        }
      }

      const prevEmp = findLinkedEmployeeForUser(before, ctx);
      const nextTargetEmp = body.employee_id
        ? ctx.db.employees.find(
            (e) => e.employee_code.trim().toUpperCase() === body.employee_id!.trim().toUpperCase() || e.id === body.employee_id,
          )
        : body.employee_id === ''
          ? undefined
          : prevEmp;
      if (body.employee_id && !nextTargetEmp) {
        throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Hồ sơ nhân sự được chọn không tồn tại', body.employee_id);
      }
      assertUniquePersonalIdentifiers(ctx, {
        phone: body.phone_number !== undefined ? phone || undefined : undefined,
        phoneField: 'phone_number',
        email: body.email || undefined,
        excludeUserId: id,
        excludeEmployeeId: nextTargetEmp?.id ?? prevEmp?.id ?? null,
      });

      const effectiveRole = body.role ?? before.role;
      const beforeExtraPerms = parseExtraPermissions(before.permissions_json);
      const nextExtraPerms =
        body.extra_permissions !== undefined
          ? sanitizeExtraPermissions(effectiveRole, body.extra_permissions)
          : beforeExtraPerms.filter((p) => !isPermissionForbiddenForRole(effectiveRole, p));
      const nextPermissionsJson = JSON.stringify(nextExtraPerms);

      const rawScope = body.branch_scope ?? before.branch_scope;
      const effectiveBranchScope =
        rawScope === 'ALL' &&
        nextTargetEmp &&
        (effectiveRole === 'THU_VIEC' || effectiveRole === 'CHINH_THUC' || effectiveRole === 'STORE')
          ? nextTargetEmp.branch_id
          : rawScope;

      const nextEmployeeCode = await syncEmployeeFromAccount(ctx, {
        userId: before.id,
        prevEmp,
        targetEmp: nextTargetEmp,
        displayName: body.display_name,
        phone: body.phone_number !== undefined ? phone : undefined,
        email: body.email,
        role: body.role,
        branchScope: effectiveBranchScope,
        actorId,
      });

      const patch: Record<string, unknown> = {
        ...(body.display_name ? { display_name: body.display_name } : {}),
        ...(body.phone_number !== undefined ? { phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(effectiveBranchScope !== before.branch_scope ? { branch_scope: effectiveBranchScope } : {}),
        ...(nextPermissionsJson !== before.permissions_json ? { permissions_json: nextPermissionsJson } : {}),
        ...(body.employee_id !== undefined || nextEmployeeCode !== before.employee_id ? { employee_id: nextEmployeeCode } : {}),
      };
      if (body.secret) {
        patch.password_hash = await hashSecret(body.secret);
        patch.session_version = before.session_version + 1;
      }

      const updated = await ctx.db.users.update(id, body.version, patch, actorId);
      const isPermOrScopeChanged =
        before.role !== updated.role ||
        before.branch_scope !== updated.branch_scope ||
        JSON.stringify(beforeExtraPerms) !== JSON.stringify(nextExtraPerms);

      await ctx.audit.record(auditContext(request), {
        action: isPermOrScopeChanged ? 'account.permissions_update' : 'account.update',
        entity: 'USERS',
        entityId: id,
        before: { display_name: before.display_name, role: before.role, extra_permissions: beforeExtraPerms, branch_scope: before.branch_scope, phone: before.phone, employee_id: before.employee_id },
        after: { display_name: updated.display_name, role: updated.role, extra_permissions: nextExtraPerms, branch_scope: updated.branch_scope, phone: updated.phone, employee_id: updated.employee_id, ...(body.reason ? { reason: body.reason } : {}) },
      });
      const mailInfo = queueAccountUpdatedEmail(ctx, updated, body.reason || (body.secret ? 'Đặt lại mật khẩu/PIN và cập nhật thông tin' : 'Cập nhật thông tin và phân quyền'), request.auth?.user.email, body.secret);
      const msg = body.secret && mailInfo.emailQueued ? `Đã cập nhật tài khoản và đưa email mật khẩu mới vào hàng đợi gửi tới ${mailInfo.queuedToEmail}` : 'Cập nhật thông tin tài khoản và phân quyền thành công';
      return sendSuccess(request, msg, { user: toPublicUser(updated), version: updated.version, ...mailInfo });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requirePermission('account.manage') },
    async (request) => {
      const { id } = request.params;
      const body = zDeleteVersionBody.parse(request.body ?? {});
      const user = ctx.db.users.get(id);
      if (!user) throw Errors.notFound('Tài khoản', id);
      if (user.id === request.auth!.user.id || user.username === 'admin') {
        throw Errors.badRequest('Không thể xóa tài khoản Quản trị hệ thống gốc hoặc tài khoản đang đăng nhập');
      }

      await ctx.db.users.softDelete(id, body.version ?? user.version, request.auth!.user.id);
      ctx.realtime()?.forceLogout(user.id, 'Tài khoản đã bị xóa khỏi hệ thống');
      await ctx.audit.record(auditContext(request), { action: 'account.delete', entity: 'USERS', entityId: id, before: { username: user.username, role: user.role } });
      return sendSuccess(request, `Đã xóa tài khoản ${user.display_name} (${user.username})`, { id });
    },
  );

  app.post('/api/admin/accounts/bulk-action', { preHandler: requirePermission('account.activate') }, async (request) => {
    const body = zBulkActionBody.parse(request.body);
    const actorId = request.auth!.user.id;
    const actorEmail = request.auth?.user.email;
    const processedIds: string[] = [];
    const skippedIds: string[] = [];

    const now = nowIso();
    const patches: Parameters<typeof ctx.db.users.batchUpdate>[0] = [];
    for (const item of body.items) {
      const user = ctx.db.users.get(item.id);
      if (!user) { skippedIds.push(item.id); continue; }
      if (body.action === 'ACTIVATE' && user.status !== 'ACTIVE') {
        patches.push({ id: user.id, expectedVersion: user.version, patch: { status: 'ACTIVE', activated_by: actorId, activated_at: now, failed_login_count: 0, locked_until: '', revoked_at: '' } });
        processedIds.push(user.id);
      } else if (body.action === 'LOCK' && user.id !== actorId && user.username !== 'admin' && user.status === 'ACTIVE') {
        patches.push({ id: user.id, expectedVersion: user.version, patch: { status: 'LOCKED', session_version: user.session_version + 1 } });
        processedIds.push(user.id);
      } else if (body.action === 'UNLOCK') {
        patches.push({ id: user.id, expectedVersion: user.version, patch: { status: user.status === 'LOCKED' ? 'ACTIVE' : user.status, failed_login_count: 0, locked_until: '' } });
        processedIds.push(user.id);
      } else if (body.action === 'REVOKE' && user.id !== actorId && user.status !== 'REVOKED') {
        patches.push({ id: user.id, expectedVersion: user.version, patch: { status: 'REVOKED', revoked_at: now, session_version: user.session_version + 1 } });
        processedIds.push(user.id);
      } else if (body.action === 'DELETE' && user.id !== actorId && user.username !== 'admin') {
        patches.push({ id: user.id, expectedVersion: user.version, patch: { is_deleted: true } });
        processedIds.push(user.id);
      } else {
        skippedIds.push(user.id);
      }
    }
    const updatedUsers = patches.length > 0 ? await ctx.db.users.batchUpdate(patches, actorId) : [];
    for (const updated of updatedUsers) {
      if (body.action === 'ACTIVATE') queueAccountActivatedEmail(ctx, updated, actorEmail);
      else if (body.action === 'LOCK') { ctx.realtime()?.forceLogout(updated.id, body.reason ?? 'Khóa tạm thời tài khoản hàng loạt'); queueAccountLockedEmail(ctx, updated, body.reason, actorEmail); }
      else if (body.action === 'UNLOCK') queueAccountUnlockedEmail(ctx, updated, actorEmail);
      else if (body.action === 'REVOKE') { ctx.realtime()?.forceLogout(updated.id, body.reason ?? 'Thu hồi quyền hàng loạt'); queueAccountRevokedEmail(ctx, updated, body.reason, actorEmail); }
      else if (body.action === 'DELETE') ctx.realtime()?.forceLogout(updated.id, 'Xóa tài khoản hàng loạt');
    }

    await ctx.audit.record(auditContext(request), {
      action: `account.bulk.${body.action.toLowerCase()}`, entity: 'USERS', entityId: `bulk_${processedIds.length}`,
      after: { action: body.action, processedIds, skippedIds, reason: body.reason ?? '' },
    });

    const labels = { ACTIVATE: 'kích hoạt', LOCK: 'khóa tạm thời', UNLOCK: 'mở khóa đăng nhập', REVOKE: 'thu hồi quyền truy cập', DELETE: 'xóa' } as const;
    return sendSuccess(request, `Đã ${labels[body.action]} thành công ${processedIds.length}/${body.items.length} tài khoản đã chọn`, {
      action: body.action, processedCount: processedIds.length, skippedCount: skippedIds.length, processedIds, skippedIds,
    });
  });
}
