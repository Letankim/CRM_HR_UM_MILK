import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACCOUNT_STATUS_LABELS, AUDIT_ACTION_LABELS, PERMISSION_LABELS, ROLE_LABELS, type Permission, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { queueAccountActivatedEmail, queueAccountLockedEmail, queueAccountRevokedEmail, queueAccountUnlockedEmail } from '../services/action-email-dispatcher.js';
import { accountBulkRoutes } from './accounts-bulk.routes.js';

const zVersionBody = z.object({
  version: z.number({ required_error: 'Phiên bản bản ghi (version) là bắt buộc' }).int().min(1),
  reason: z.string().max(500, 'Lý do tối đa 500 ký tự').optional(),
});

function parseJsonObj(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function describeAccountAuditRow(action: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const parts: string[] = [];
  if (before.role && after.role && before.role !== after.role) {
    parts.push(`Vai trò: ${ROLE_LABELS[before.role as Role] ?? before.role} -> ${ROLE_LABELS[after.role as Role] ?? after.role}`);
  } else if (!before.role && after.role) {
    parts.push(`Vai trò khởi tạo: ${ROLE_LABELS[after.role as Role] ?? after.role}`);
  }
  if (before.branch_scope !== undefined && after.branch_scope !== undefined && before.branch_scope !== after.branch_scope) {
    parts.push(`Phạm vi chi nhánh: ${before.branch_scope} -> ${after.branch_scope}`);
  }
  const bPerms = Array.isArray(before.extra_permissions) ? (before.extra_permissions as string[]) : null;
  const aPerms = Array.isArray(after.extra_permissions) ? (after.extra_permissions as string[]) : null;
  if (aPerms && JSON.stringify(bPerms ?? []) !== JSON.stringify(aPerms)) {
    const names = aPerms.map((p) => PERMISSION_LABELS[p as Permission] ?? p);
    parts.push(names.length > 0 ? `Quyền bổ sung (${names.length}): ${names.join(', ')}` : 'Đã gỡ toàn bộ quyền bổ sung (dùng quyền mặc định của vai trò)');
  }
  if (before.status && after.status && before.status !== after.status) {
    parts.push(`Trạng thái: ${ACCOUNT_STATUS_LABELS[before.status as keyof typeof ACCOUNT_STATUS_LABELS] ?? before.status} -> ${ACCOUNT_STATUS_LABELS[after.status as keyof typeof ACCOUNT_STATUS_LABELS] ?? after.status}`);
  }
  if (after.reason) parts.push(`Lý do: ${String(after.reason)}`);
  return parts.length > 0 ? parts.join(' · ') : (AUDIT_ACTION_LABELS[action] ?? action);
}

export async function accountActionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/history',
    { preHandler: requirePermission('account.read', 'account.manage', 'account.activate') },
    async (request) => {
      const user = ctx.db.users.get(request.params.id);
      if (!user) throw Errors.notFound('Tài khoản', request.params.id);
      const auditStore = await ctx.db.audit();
      const userMap = new Map(ctx.db.users.all(true).map((u) => [u.id, u]));
      const rows = auditStore
        .all(true)
        .filter((r) => r.entity === 'USERS' && (r.entity_id === user.id || (r.entity_id.startsWith('bulk_') && r.after_json.includes(user.id))))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50)
        .map((r) => {
          const actor = userMap.get(r.actor_user_id);
          const before = parseJsonObj(r.before_json);
          const after = parseJsonObj(r.after_json);
          return {
            id: r.id, action: r.action, actionLabel: AUDIT_ACTION_LABELS[r.action] ?? r.action,
            actorUsername: actor?.username ?? (r.actor_user_id === 'seed' ? 'system' : r.actor_user_id),
            actorDisplayName: actor?.display_name ?? 'Hệ thống',
            actorRoleLabel: ROLE_LABELS[r.actor_role as Role] ?? 'Quản trị hệ thống',
            summary: describeAccountAuditRow(r.action, before, after),
            beforeData: before, afterData: after, created_at: r.created_at,
          };
        });
      return sendSuccess(request, 'Lấy lịch sử thay đổi quyền và trạng thái tài khoản thành công', rows);
    },
  );

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/activate', { preHandler: requirePermission('account.activate') }, async (request) => {
    const body = zVersionBody.parse(request.body);
    const user = ctx.db.users.get(request.params.id);
    if (!user) throw Errors.notFound('Tài khoản', request.params.id);
    if (user.status === 'ACTIVE') throw Errors.badRequest('Tài khoản này đang ở trạng thái hoạt động');

    const actorId = request.auth!.user.id;
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `activate:${user.id}:v${body.version}`,
      operation: 'account.activate',
      actorId,
      initialContext: { updatedUser: user },
      steps: [
        {
          name: 'update_user_active',
          run: async (sagaCtx) => {
            sagaCtx.updatedUser = await ctx.db.users.update(user.id, body.version, { status: 'ACTIVE', activated_by: actorId, activated_at: nowIso(), failed_login_count: 0, locked_until: '' }, actorId);
          },
          compensate: async (sagaCtx) => {
            await ctx.db.users.update(user.id, sagaCtx.updatedUser.version, { status: user.status, activated_by: user.activated_by, activated_at: user.activated_at }, actorId);
          },
        },
        {
          name: 'audit_and_notify_activation',
          run: async (sagaCtx) => {
            await ctx.audit.record(auditContext(request), { action: 'account.activate', entity: 'USERS', entityId: user.id, before: { status: user.status }, after: { status: sagaCtx.updatedUser.status } });
            queueAccountActivatedEmail(ctx, sagaCtx.updatedUser, request.auth?.user.email);
          },
        },
      ],
      resultSelector: (sagaCtx) => sagaCtx.updatedUser,
    });
    return sendSuccess(request, 'Kích hoạt tài khoản thành công', { user: toPublicUser(updated), version: updated.version });
  });

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/lock', { preHandler: requirePermission('account.activate', 'account.manage') }, async (request) => {
    const body = zVersionBody.parse(request.body);
    const user = ctx.db.users.get(request.params.id);
    if (!user) throw Errors.notFound('Tài khoản', request.params.id);
    if (user.id === request.auth!.user.id || user.username === 'admin') {
      throw Errors.badRequest('Không thể tự khóa tài khoản của chính mình hoặc tài khoản Quản trị gốc');
    }
    const actorId = request.auth!.user.id;
    const updated = await ctx.db.users.update(user.id, body.version, { status: 'LOCKED', session_version: user.session_version + 1 }, actorId);
    ctx.realtime()?.forceLogout(user.id, body.reason ?? 'Tài khoản đã bị khóa tạm thời bởi Quản trị viên');
    await ctx.audit.record(auditContext(request), {
      action: 'account.lock', entity: 'USERS', entityId: user.id,
      before: { status: user.status }, after: { status: updated.status, reason: body.reason ?? 'Khóa tạm thời bởi Quản trị viên' },
    });
    queueAccountLockedEmail(ctx, updated, body.reason, request.auth?.user.email);
    return sendSuccess(request, `Đã khóa tạm thời tài khoản ${user.display_name}`, { user: toPublicUser(updated), version: updated.version });
  });

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/unlock', { preHandler: requirePermission('account.activate') }, async (request) => {
    const body = zVersionBody.parse(request.body);
    const user = ctx.db.users.get(request.params.id);
    if (!user) throw Errors.notFound('Tài khoản', request.params.id);
    const actorId = request.auth!.user.id;
    const nextStatus = user.status === 'LOCKED' ? 'ACTIVE' : user.status;
    const updated = await ctx.db.users.update(user.id, body.version, { status: nextStatus, failed_login_count: 0, locked_until: '' }, actorId);
    await ctx.audit.record(auditContext(request), {
      action: 'account.unlock', entity: 'USERS', entityId: user.id,
      before: { status: user.status, failed_login_count: user.failed_login_count }, after: { status: updated.status, failed_login_count: 0 },
    });
    queueAccountUnlockedEmail(ctx, updated, request.auth?.user.email);
    return sendSuccess(request, `Đã mở khóa đăng nhập cho tài khoản ${user.display_name}`, { user: toPublicUser(updated), version: updated.version });
  });

  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/revoke', { preHandler: requirePermission('account.activate') }, async (request) => {
    const body = zVersionBody.parse(request.body);
    const user = ctx.db.users.get(request.params.id);
    if (!user) throw Errors.notFound('Tài khoản', request.params.id);
    if (user.id === request.auth!.user.id) throw Errors.badRequest('Không thể tự thu hồi tài khoản của chính mình');

    const actorId = request.auth!.user.id;
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `revoke:${user.id}:v${body.version}`,
      operation: 'account.revoke',
      actorId,
      initialContext: { updatedUser: user },
      steps: [
        {
          name: 'update_user_revoked',
          run: async (sagaCtx) => {
            sagaCtx.updatedUser = await ctx.db.users.update(user.id, body.version, { status: 'REVOKED', revoked_at: nowIso(), revoked_by: actorId, revoke_reason: body.reason ?? '', session_version: user.session_version + 1 }, actorId);
          },
          compensate: async (sagaCtx) => {
            await ctx.db.users.update(user.id, sagaCtx.updatedUser.version, { status: user.status, revoked_at: user.revoked_at, session_version: user.session_version }, actorId);
          },
        },
        {
          name: 'force_logout_and_audit',
          run: async (sagaCtx) => {
            ctx.realtime()?.forceLogout(user.id, body.reason ?? 'Tài khoản đã bị thu hồi');
            await ctx.audit.record(auditContext(request), { action: 'account.revoke', entity: 'USERS', entityId: user.id, before: { status: user.status }, after: { status: sagaCtx.updatedUser.status, reason: body.reason ?? '' } });
            queueAccountRevokedEmail(ctx, sagaCtx.updatedUser, body.reason, request.auth?.user.email);
          },
        },
      ],
      resultSelector: (sagaCtx) => sagaCtx.updatedUser,
    });
    return sendSuccess(request, 'Thu hồi tài khoản thành công', { user: toPublicUser(updated), version: updated.version });
  });

  await accountBulkRoutes(app, ctx);
}
