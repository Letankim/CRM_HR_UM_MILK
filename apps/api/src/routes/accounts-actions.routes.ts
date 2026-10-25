import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACCOUNT_STATUS_LABELS, ROLE_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { accountBulkRoutes } from './accounts-bulk.routes.js';

const zVersionBody = z.object({
  version: z.number({ required_error: 'Phiên bản bản ghi (version) là bắt buộc' }).int().min(1),
  reason: z.string().max(500, 'Lý do tối đa 500 ký tự').optional(),
});

export async function accountActionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/activate',
    { preHandler: requirePermission('account.activate') },
    async (request) => {
      const body = zVersionBody.parse(request.body);
      const user = ctx.db.users.get(request.params.id);
      if (!user) throw Errors.notFound('Tài khoản', request.params.id);
      if (user.status === 'ACTIVE') {
        throw Errors.badRequest('Tài khoản này đang ở trạng thái hoạt động');
      }

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
              sagaCtx.updatedUser = await ctx.db.users.update(
                user.id,
                body.version,
                { status: 'ACTIVE', activated_by: actorId, activated_at: nowIso(), failed_login_count: 0, locked_until: '' },
                actorId,
              );
            },
            compensate: async (sagaCtx) => {
              await ctx.db.users.update(
                user.id,
                sagaCtx.updatedUser.version,
                { status: user.status, activated_by: user.activated_by, activated_at: user.activated_at },
                actorId,
              );
            },
          },
          {
            name: 'audit_and_notify_activation',
            run: async (sagaCtx) => {
              await ctx.audit.record(auditContext(request), {
                action: 'account.activate',
                entity: 'USERS',
                entityId: user.id,
                before: { status: user.status },
                after: { status: sagaCtx.updatedUser.status },
              });
              await ctx.email.send({
                to: user.email || `${user.username}@umbomilk.vn`,
                template: 'ACCOUNT_ACTIVATED',
                recipientName: user.display_name,
                referenceCode: `ACC-${user.id.slice(0, 8).toUpperCase()}`,
                summary: 'Tài khoản hệ thống Ụm Bò Milk của bạn đã được kích hoạt chính thức.',
                metadata: [
                  { label: 'Tên tài khoản', value: user.username },
                  { label: 'Vai trò', value: ROLE_LABELS[user.role] },
                  { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.ACTIVE },
                ],
              });
            },
          },
        ],
        resultSelector: (sagaCtx) => sagaCtx.updatedUser,
      });

      return sendSuccess(request, 'Kích hoạt tài khoản thành công', { user: toPublicUser(updated), version: updated.version });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/unlock',
    { preHandler: requirePermission('account.activate') },
    async (request) => {
      const body = zVersionBody.parse(request.body);
      const user = ctx.db.users.get(request.params.id);
      if (!user) throw Errors.notFound('Tài khoản', request.params.id);
      const actorId = request.auth!.user.id;
      const nextStatus = user.status === 'LOCKED' ? 'ACTIVE' : user.status;
      const updated = await ctx.db.users.update(user.id, body.version, { status: nextStatus, failed_login_count: 0, locked_until: '' }, actorId);
      await ctx.audit.record(auditContext(request), {
        action: 'account.unlock',
        entity: 'USERS',
        entityId: user.id,
        before: { status: user.status, failed_login_count: user.failed_login_count },
        after: { status: updated.status, failed_login_count: 0 },
      });
      return sendSuccess(request, `Đã mở khóa đăng nhập cho tài khoản ${user.display_name}`, { user: toPublicUser(updated), version: updated.version });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/revoke',
    { preHandler: requirePermission('account.activate') },
    async (request) => {
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
              sagaCtx.updatedUser = await ctx.db.users.update(
                user.id,
                body.version,
                { status: 'REVOKED', revoked_at: nowIso(), revoked_by: actorId, revoke_reason: body.reason ?? '', session_version: user.session_version + 1 },
                actorId,
              );
            },
            compensate: async (sagaCtx) => {
              await ctx.db.users.update(
                user.id,
                sagaCtx.updatedUser.version,
                { status: user.status, revoked_at: user.revoked_at, session_version: user.session_version },
                actorId,
              );
            },
          },
          {
            name: 'force_logout_and_audit',
            run: async (sagaCtx) => {
              ctx.realtime()?.forceLogout(user.id, body.reason ?? 'Tài khoản đã bị thu hồi');
              await ctx.audit.record(auditContext(request), {
                action: 'account.revoke',
                entity: 'USERS',
                entityId: user.id,
                before: { status: user.status },
                after: { status: sagaCtx.updatedUser.status, reason: body.reason ?? '' },
              });
              await ctx.email.send({
                to: user.email || `${user.username}@umbomilk.vn`,
                template: 'ACCOUNT_REVOKED',
                recipientName: user.display_name,
                referenceCode: `REV-${user.id.slice(0, 8).toUpperCase()}`,
                summary: 'Quyền truy cập hệ thống của tài khoản dưới đây đã bị thu hồi.',
                metadata: [
                  { label: 'Tên tài khoản', value: user.username },
                  { label: 'Lý do thu hồi', value: body.reason ?? 'Theo quyết định quản trị' },
                  { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.REVOKED },
                ],
              });
            },
          },
        ],
        resultSelector: (sagaCtx) => sagaCtx.updatedUser,
      });

      return sendSuccess(request, 'Thu hồi tài khoản thành công', { user: toPublicUser(updated), version: updated.version });
    },
  );

  await accountBulkRoutes(app, ctx);
}
