import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  EMPLOYEE_STAGE_LABELS,
  ROLES,
  ROLE_LABELS,
  STAFF_GROUP_LABELS,
  normalizePhone,
  zListQueryBase,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { hashSecret } from '../auth/password.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { healBranchConsistency, syncEmployeeFromAccount } from './account-employee-sync.js';
import { accountActionRoutes } from './accounts-actions.routes.js';
import { assertUniquePersonalIdentifiers, findLinkedEmployeeForUser } from './employee-mapper.js';

const zAccountListQuery = zListQueryBase.extend({
  status: z.enum([...ACCOUNT_STATUSES, 'ALL'] as const).optional(),
  role: z.enum([...ROLES, 'ALL'] as const).optional(),
  branch_id: z.string().max(64).optional(),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

const zCreateAccountBody = z.object({
  username: z
    .string({ required_error: 'Tên đăng nhập là bắt buộc' })
    .trim()
    .min(3, 'Tên đăng nhập tối thiểu 3 ký tự')
    .max(32, 'Tên đăng nhập tối đa 32 ký tự')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Tên đăng nhập chỉ gồm chữ cái không dấu, số và dấu chấm/gạch ngang'),
  display_name: z
    .string({ required_error: 'Họ và tên hiển thị là bắt buộc' })
    .trim()
    .min(2, 'Họ và tên tối thiểu 2 ký tự')
    .max(80, 'Họ và tên tối đa 80 ký tự'),
  phone_number: z.string().trim().optional().default(''),
  email: z.string().trim().email('Định dạng địa chỉ email không hợp lệ').or(z.literal('')).optional().default(''),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Vai trò phân quyền không hợp lệ' }) }),
  secret: z
    .string({ required_error: 'Mật khẩu hoặc mã PIN là bắt buộc' })
    .min(6, 'Mật khẩu hoặc mã PIN tối thiểu 6 ký tự')
    .max(128, 'Mật khẩu tối đa 128 ký tự'),
  employee_id: z.string().trim().max(32).optional().default(''),
  branch_scope: z.string().trim().max(200).optional().default('ALL'),
});

/**
 * ADM-02 (Danh sách & Tạo mới tài khoản) và đăng ký ADM-03 (Kích hoạt / Thu hồi / Mở khóa / Hàng loạt).
 */
export async function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/accounts', { preHandler: requirePermission('account.read') }, async (request) => {
    const query = zAccountListQuery.parse(request.query);

    if (query.refresh === '1' || query.refresh === 'true') {
      await Promise.all([ctx.db.users.refreshIfIdle(), ctx.db.employees.refreshIfIdle(), ctx.db.branches.refreshIfIdle()]);
    }
    await healBranchConsistency(ctx);

    const branchMap = new Map(ctx.db.branches.all().map((b) => [b.id, b]));

    const mapped = ctx.db.users.all().map((u) => {
      const pub = toPublicUser(u);
      const linkedEmp = findLinkedEmployeeForUser(u, ctx);
      const branchNames =
        pub.branchScope === 'ALL'
          ? 'Toàn hệ thống (4 chi nhánh)'
          : pub.branchScope.map((bid) => branchMap.get(bid)?.name ?? bid).join(', ');

      return {
        ...pub,
        employeeId: linkedEmp?.employee_code ?? pub.employeeId,
        employeeRecordId: linkedEmp?.id ?? null,
        employeeName: linkedEmp?.full_name ?? null,
        employeePosition: linkedEmp ? linkedEmp.position_title || STAFF_GROUP_LABELS[linkedEmp.staff_group] : null,
        employeeStage: linkedEmp?.stage ?? null,
        employeeStageLabel: linkedEmp ? EMPLOYEE_STAGE_LABELS[linkedEmp.stage] : null,
        roleLabel: ROLE_LABELS[u.role],
        statusLabel: ACCOUNT_STATUS_LABELS[u.status],
        phone: u.phone || linkedEmp?.phone || '',
        phone_number: u.phone || linkedEmp?.phone || '',
        email: u.email || linkedEmp?.email || '',
        branchNames,
        primaryBranchId: linkedEmp?.branch_id ?? null,
        employeeBranchName: linkedEmp ? branchMap.get(linkedEmp.branch_id)?.name ?? null : null,
        version: u.version,
        failedLoginCount: u.failed_login_count,
        lockedUntil: u.locked_until || null,
        lastLoginAt: u.last_login_at || null,
        activatedAt: u.activated_at || null,
        activatedBy: u.activated_by || null,
        revokedAt: u.revoked_at || null,
        revokedBy: u.revoked_by || null,
        revokeReason: u.revoke_reason || null,
        createdAt: u.created_at,
        created_at: u.created_at,
        updated_at: u.updated_at,
      };
    });

    const result = paginateAndSort(mapped, {
      page: query.page,
      perPage: query.per_page,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
      allowedSortFields: ['created_at', 'updated_at', 'username', 'displayName', 'role', 'status', 'lastLoginAt'],
      q: query.q,
      searchExtractor: (item) => [item.username, item.displayName, item.phone, item.email, item.employeeId, item.roleLabel],
      filters: {
        status: query.status,
        role: query.role,
        branch_id: query.branch_id,
      },
      filterPredicates: {
        branch_id: (item, branchId) =>
          item.primaryBranchId === branchId ||
          (Array.isArray(item.branchScope) && item.branchScope.includes(branchId)),
      },
    });

    return sendPaginated(request, 'Lấy danh sách tài khoản thành công', result);
  });

  app.post('/api/admin/accounts', { preHandler: requirePermission('account.manage', 'employee.manage') }, async (request, reply) => {
    const body = zCreateAccountBody.parse(request.body);
    let normalizedPhone = '';
    if (body.phone_number) {
      const norm = normalizePhone(body.phone_number);
      if (!norm) throw Errors.fieldValidation('phone_number', 'INVALID_PHONE', 'Định dạng số điện thoại không hợp lệ', body.phone_number);
      normalizedPhone = norm;
    }
    const targetEmp = body.employee_id
      ? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === body.employee_id.trim().toUpperCase() || e.id === body.employee_id)
      : undefined;
    assertUniquePersonalIdentifiers(ctx, {
      username: body.username,
      phone: normalizedPhone || undefined,
      phoneField: 'phone_number',
      email: body.email || undefined,
      excludeEmployeeId: targetEmp?.id ?? null,
    });
    const resolvedEmployeeCode = targetEmp ? targetEmp.employee_code : body.employee_id;

    const actorId = request.auth!.user.id;
    const passwordHash = await hashSecret(body.secret);
    const effectiveBranchScope =
      (!body.branch_scope || body.branch_scope === 'ALL') &&
      targetEmp &&
      (body.role === 'THU_VIEC' || body.role === 'CHINH_THUC' || body.role === 'STORE')
        ? targetEmp.branch_id
        : body.branch_scope || targetEmp?.branch_id || 'ALL';
    const created = await ctx.db.users.insert(
      {
        username: body.username, phone: normalizedPhone || targetEmp?.phone || '', display_name: body.display_name,
        password_hash: passwordHash, role: body.role, permissions_json: '[]',
        branch_scope: effectiveBranchScope, employee_id: resolvedEmployeeCode || '',
        status: 'PENDING_ACTIVATION', session_version: 1, failed_login_count: 0, locked_until: '',
        last_login_at: '', activated_by: '', activated_at: '', revoked_at: '',
        email: body.email || targetEmp?.email || '', revoked_by: '', revoke_reason: '',
      },
      actorId,
    );

    if (targetEmp) {
      await syncEmployeeFromAccount(ctx, {
        userId: created.id,
        targetEmp,
        displayName: body.display_name,
        phone: normalizedPhone || undefined,
        email: body.email || undefined,
        role: body.role,
        branchScope: effectiveBranchScope,
        actorId,
      });
    }

    await ctx.audit.record(auditContext(request), {
      action: 'account.create', entity: 'USERS', entityId: created.id,
      after: { username: created.username, role: created.role, status: created.status, email: created.email },
    });
    ctx.realtime()?.toRole('ADMIN', 'account:pending', { id: created.id, username: created.username });
    reply.code(201);
    return sendSuccess(request, 'Tạo tài khoản mới thành công, đang chờ Quản trị viên kích hoạt', {
      user: toPublicUser(created), version: created.version,
    });
  });

  await accountActionRoutes(app, ctx);
}
