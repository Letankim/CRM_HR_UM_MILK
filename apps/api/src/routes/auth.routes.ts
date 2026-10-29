import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { normalizePhone, ROLE_LABELS, zLoginRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { toPublicUser } from '../auth/auth.service.js';
import { hashSecret, verifySecret } from '../auth/password.js';
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, REFRESH_COOKIE, REFRESH_TTL_SECONDS, SESSION_MARKER_COOKIE, type TokenClaims } from '../auth/tokens.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
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
});

const zChangePasswordBody = z.object({
  current_secret: z.string().min(1, 'Vui lòng nhập mật khẩu hoặc mã PIN hiện tại'),
  new_secret: z.string().min(6, 'Mật khẩu / Mã PIN mới tối thiểu 6 ký tự').max(128),
  confirm_secret: z.string().min(6, 'Vui lòng xác nhận lại mật khẩu / mã PIN mới').max(128),
});

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookieBase = { httpOnly: true, secure: ctx.env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  const toResolvedPublicUser = (u: Parameters<typeof toPublicUser>[0]) => ({ ...toPublicUser(u), branchScope: ctx.auth.resolveEffectiveBranchScope(u) });

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

    return sendSuccess(request, 'Đã cập nhật thông tin cá nhân thành công', { user: toResolvedPublicUser(updatedUser) });
  });

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
    const nextHash = await hashSecret(body.new_secret);
    await ctx.db.users.update(
      user.id,
      user.version,
      { password_hash: nextHash, ...( /^\d{6}$/.test(body.new_secret) ? { pin_hash: nextHash } : {} ) },
      user.id,
    );
    await ctx.audit.record(auditContext(request), { action: 'auth.password.change', entity: 'USERS', entityId: user.id });
    return sendSuccess(request, 'Đã đổi mật khẩu / mã PIN bảo mật thành công', { ok: true });
  });
}
