import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, normalizePhone, PIN_REGEX, zLoginRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, REFRESH_COOKIE, REFRESH_TTL_SECONDS, SESSION_MARKER_COOKIE, type TokenClaims } from '../auth/tokens.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { registerAuthProfileRoutes } from './auth-profile.routes.js';

const zChangePasswordBody = z.object({
  current_secret: z.string().optional(),
  new_secret: z.string().optional(),
  confirm_secret: z.string().optional(),
  current_pin: z.string().optional(),
  new_pin: z.string().optional(),
  confirm_pin: z.string().optional(),
});

export function parsePinHistory(raw?: string): string[] {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  } catch {
    return [];
  }
}

/** Kiểm tra đợt xoay mã PIN định kỳ từ ngày 01 đến ngày 05 hàng tháng hoặc quá hạn pinRotationDays. */
export function isPinRotationRequiredInWindow(
  user: { must_change_pin?: boolean; pin_changed_at?: string; activated_at?: string; created_at?: string },
  pinRotationDays: number,
  nowInput?: string | Date,
): { required: boolean; inDay01To05Window: boolean; reason: 'FIRST_LOGIN' | 'RESET' | 'EXPIRED' | null } {
  const now = nowInput ? dayjs(nowInput) : dayjs();
  const inDay01To05Window = now.date() >= 1 && now.date() <= 5;
  if (user.must_change_pin) return { required: true, inDay01To05Window, reason: user.pin_changed_at ? 'RESET' : 'FIRST_LOGIN' };
  if (pinRotationDays <= 0) return { required: false, inDay01To05Window, reason: null };
  const base = user.pin_changed_at || user.activated_at || user.created_at;
  const expiredByDays = Boolean(base && now.diff(dayjs(base), 'day') >= pinRotationDays);
  const changedThisMonth = Boolean(user.pin_changed_at && dayjs(user.pin_changed_at).format('YYYY-MM') === now.format('YYYY-MM'));
  if (expiredByDays || (inDay01To05Window && !changedThisMonth)) {
    return { required: true, inDay01To05Window, reason: 'EXPIRED' };
  }
  return { required: false, inDay01To05Window, reason: null };
}

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
      const isEmp = isEmployeeRole(user.role);
      return sendSuccess(request, isEmp ? 'Số điện thoại hợp lệ, vui lòng nhập mã PIN 6 số' : 'Số điện thoại hợp lệ, vui lòng nhập mật khẩu đăng nhập', {
        phone: normalized, maskedPhone: `${normalized.slice(0, 4)}***${normalized.slice(-3)}`, displayName: maskName(user.display_name), pinLength: 6, authKind: isEmp ? 'PIN' : 'PASSWORD',
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

  const handlePinOrPasswordChange = async (request: Parameters<typeof auditContext>[0]) => {
    const user = request.auth!.user;
    const isEmp = isEmployeeRole(user.role);
    const raw = zChangePasswordBody.parse(request.body ?? {});
    const currentSecret = raw.current_secret ?? raw.current_pin ?? '';
    const newSecret = raw.new_secret ?? raw.new_pin ?? '';
    const confirmSecret = raw.confirm_secret ?? raw.confirm_pin ?? newSecret;
    if (!currentSecret) throw Errors.fieldValidation('current_secret', 'REQUIRED_FIELD', 'Vui lòng nhập mật khẩu hoặc mã PIN hiện tại', '');
    if (newSecret.length < 6) throw Errors.fieldValidation('new_secret', 'INVALID_FORMAT', 'Mật khẩu / Mã PIN mới tối thiểu 6 ký tự', '***');
    if (newSecret !== confirmSecret) {
      throw Errors.fieldValidation('confirm_secret', 'INVALID_VALUE', isEmp ? 'Mã PIN xác nhận không khớp với mã PIN mới' : 'Mật khẩu xác nhận không khớp với mật khẩu mới', '***');
    }
    if (!(await verifySecret(user.password_hash, currentSecret))) {
      throw Errors.fieldValidation('current_secret', 'INVALID_VALUE', isEmp ? 'Mã PIN hiện tại không chính xác' : 'Mật khẩu hiện tại không chính xác', '***');
    }
    if (isEmp && !PIN_REGEX.test(newSecret)) {
      throw Errors.fieldValidation('new_secret', 'INVALID_FORMAT', 'Mã PIN mới phải gồm đúng 6 chữ số', '******');
    }
    const history = parsePinHistory(user.pin_history_json);
    const sameCurrent = await verifySecret(user.password_hash, newSecret);
    let sameHistory = false;
    if (!sameCurrent) {
      for (const oldHash of history) {
        if (await verifySecret(oldHash, newSecret)) { sameHistory = true; break; }
      }
    }
    if (sameCurrent || sameHistory) {
      throw Errors.fieldValidation('new_secret', 'INVALID_VALUE', 'Mã PIN mới không được trùng với các mã PIN bạn đã từng sử dụng trước đây', '******');
    }
    const nextHash = await hashSecret(newSecret);
    const nextHistory = [user.password_hash, ...history.filter((h) => h !== user.password_hash)].slice(0, 10);
    const updated = await ctx.db.users.update(
      user.id,
      user.version,
      { password_hash: nextHash, must_change_pin: false, pin_changed_at: nowIso(), pin_history_json: JSON.stringify(nextHistory) },
      user.id,
    );
    await ctx.audit.record(auditContext(request), { action: 'auth.password.change', entity: 'USERS', entityId: user.id });
    return sendSuccess(request, isEmp ? 'Đã đổi mã PIN bảo mật thành công' : 'Đã đổi mật khẩu bảo mật thành công', { ok: true, user: toResolvedPublicUser(updated) });
  };

  app.put('/api/auth/password', { preHandler: requireAuth() }, handlePinOrPasswordChange);
  app.post('/api/auth/change-pin', { preHandler: requireAuth() }, handlePinOrPasswordChange);
}
