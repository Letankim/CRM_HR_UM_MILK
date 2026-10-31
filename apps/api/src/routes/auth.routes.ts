import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, normalizePhone, PIN_REGEX, zLoginRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, REFRESH_COOKIE, REFRESH_TTL_SECONDS, SESSION_MARKER_COOKIE, type TokenClaims } from '../auth/tokens.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { registerAuthProfileRoutes } from './auth-profile.routes.js';

const zChangePasswordBody = z.object({
  current_secret: z.string().min(1, 'Vui lòng nhập mật khẩu hoặc mã PIN hiện tại'),
  new_secret: z.string().min(6, 'Mật khẩu / Mã PIN mới tối thiểu 6 ký tự').max(128, 'Mật khẩu tối đa 128 ký tự'),
  confirm_secret: z.string().min(6, 'Vui lòng xác nhận lại mật khẩu / mã PIN mới').max(128),
});

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookieBase = { httpOnly: true, secure: ctx.env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  const toResolvedPublicUser = (u: Parameters<typeof toPublicUser>[0]) => ({ ...toPublicUser(u, ctx.auth.resolvePinState(u)), branchScope: ctx.auth.resolveEffectiveBranchScope(u) });
  const maskName = (name: string) => name.split(' ').map((w, i, arr) => (i === arr.length - 1 ? w : `${w.charAt(0)}.`)).join(' ');

  async function issueSession(reply: FastifyReply, claims: TokenClaims): Promise<string> {
    const [access, refresh] = await Promise.all([ctx.tokens.signAccess(claims), ctx.tokens.signRefresh(claims)]);
    reply.setCookie(ACCESS_COOKIE, access, { ...cookieBase, maxAge: ACCESS_TTL_SECONDS });
    reply.setCookie(REFRESH_COOKIE, refresh, { ...cookieBase, path: '/api/auth', maxAge: REFRESH_TTL_SECONDS });
    reply.setCookie(SESSION_MARKER_COOKIE, claims.app, { ...cookieBase, maxAge: REFRESH_TTL_SECONDS });
    return access;
  }

  function clearSession(reply: FastifyReply) {
    reply.clearCookie(ACCESS_COOKIE, { path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    reply.clearCookie(SESSION_MARKER_COOKIE, { path: '/' });
  }

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: ctx.env.NODE_ENV === 'test' ? 200 : 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { identifier, secret, app: appKind } = zLoginRequest.parse(request.body);
      const user = await ctx.auth.login(identifier, secret, appKind);
      const socketToken = await issueSession(reply, { sub: user.id, role: user.role, sv: user.session_version, app: appKind });
      await ctx.audit.record(
        { ...auditContext(request), actorUserId: user.id, actorRole: user.role },
        { action: 'auth.login', entity: 'USERS', entityId: user.id, after: { app: appKind } },
      );
      return sendSuccess(request, 'Đăng nhập hệ thống thành công', { user: toResolvedPublicUser(user), socketToken });
    },
  );

  app.post(
    '/api/auth/employee/lookup',
    { config: { rateLimit: { max: ctx.env.NODE_ENV === 'test' ? 200 : 15, timeWindow: '1 minute' } } },
    async (request) => {
      const { phone } = z.object({ phone: z.string().trim().min(1, 'Vui lòng nhập số điện thoại đăng nhập') }).parse(request.body ?? {});
      const normalized = normalizePhone(phone);
      if (!normalized) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0', phone);
      const user = ctx.auth.findEmployeePortalUserByPhone(normalized);
      if (!user || user.role === 'MKT') throw Errors.fieldValidation('phone', 'INVALID_VALUE', 'Số điện thoại chưa được cấp tài khoản Cổng Nhân viên. Vui lòng liên hệ Phòng Nhân sự.', phone);
      if (user.status === 'PENDING_ACTIVATION') throw Errors.forbidden('Tài khoản đang chờ Quản trị viên kích hoạt, vui lòng thử lại sau');
      if (user.status !== 'ACTIVE') throw Errors.forbidden('Tài khoản đã bị khóa hoặc thu hồi, vui lòng liên hệ Phòng Nhân sự');
      return sendSuccess(request, 'Số điện thoại hợp lệ, vui lòng nhập mã PIN 6 số', {
        phone: normalized, maskedPhone: `${normalized.slice(0, 4)}***${normalized.slice(-3)}`, displayName: maskName(user.display_name), pinLength: 6,
      });
    },
  );

  app.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw Errors.unauthorized();
    try {
      const claims = await ctx.tokens.verifyRefresh(token);
      const user = ctx.auth.resolveSession(claims);
      const socketToken = await issueSession(reply, {
        sub: user.id,
        role: user.role,
        sv: user.session_version,
        app: claims.app,
      });
      return sendSuccess(request, 'Làm mới phiên đăng nhập thành công', {
        user: toResolvedPublicUser(user),
        socketToken,
      });
    } catch {
      clearSession(reply);
      throw Errors.unauthorized();
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.auth) {
      await ctx.audit.record(auditContext(request), {
        action: 'auth.logout',
        entity: 'USERS',
        entityId: request.auth.user.id,
      });
    }
    clearSession(reply);
    return sendSuccess(request, 'Đăng xuất thành công', { ok: true });
  });

  app.get('/api/auth/me', { preHandler: requireAuth() }, async (request) => {
    return sendSuccess(request, 'Lấy thông tin tài khoản hiện tại thành công', {
      user: request.auth!.publicUser,
      app: request.auth!.app,
      socketToken: request.cookies[ACCESS_COOKIE] ?? null,
    });
  });

  registerAuthProfileRoutes(app, ctx, toResolvedPublicUser);

  app.put('/api/auth/password', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const body = zChangePasswordBody.parse(request.body);
    if (body.new_secret !== body.confirm_secret) {
      throw Errors.fieldValidation('confirm_secret', 'INVALID_VALUE', 'Mật khẩu / Mã PIN xác nhận không khớp với mật khẩu mới', '***');
    }
    const ok = await verifySecret(user.password_hash, body.current_secret);
    if (!ok) {
      throw Errors.fieldValidation('current_secret', 'INVALID_VALUE', 'Mật khẩu / Mã PIN hiện tại không chính xác', '***');
    }
    if (isEmployeeRole(user.role) && !PIN_REGEX.test(body.new_secret)) {
      throw Errors.fieldValidation('new_secret', 'INVALID_FORMAT', 'Mã PIN mới phải gồm đúng 6 chữ số', '******');
    }
    if (await verifySecret(user.password_hash, body.new_secret)) {
      throw Errors.fieldValidation('new_secret', 'INVALID_VALUE', 'Mã PIN / mật khẩu mới phải khác mã hiện tại', '******');
    }
    const nextHash = await hashSecret(body.new_secret);
    const updated = await ctx.db.users.update(user.id, user.version, { password_hash: nextHash, must_change_pin: false, pin_changed_at: nowIso() }, user.id);
    await ctx.audit.record(auditContext(request), { action: 'auth.password.change', entity: 'USERS', entityId: user.id });
    return sendSuccess(request, 'Đã đổi mật khẩu / mã PIN bảo mật thành công', { ok: true, user: toResolvedPublicUser(updated) });
  });
}
