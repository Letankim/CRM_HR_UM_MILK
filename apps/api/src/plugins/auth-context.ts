import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BranchScope, Permission, PublicUser, User } from '@umbm/shared';
import { Errors } from '../lib/errors.js';
import { toPublicUser, type AuthService } from '../auth/auth.service.js';
import { ACCESS_COOKIE, type TokenService } from '../auth/tokens.js';

export interface AuthContext {
  user: User;
  publicUser: PublicUser;
  permissions: Set<Permission>;
  branchScope: BranchScope;
  app: 'backoffice' | 'employee';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/**
 * Gắn thông tin đăng nhập vào request (nếu có cookie hợp lệ) và chặn CSRF.
 * Mọi route cần đăng nhập phải dùng guard `requirePermission`/`requireAuth` bên dưới.
 */
export function registerAuthContext(app: FastifyInstance, tokens: TokenService, auth: AuthService): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    // CSRF: request thay đổi dữ liệu phải có header tùy chỉnh. Trình duyệt không thể
    // gửi header này từ site khác mà không qua CORS preflight (đã bị từ chối).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.url.startsWith('/api/internal/')) {
      if (request.headers['x-umbm-client'] !== 'web') throw Errors.forbidden('Thiếu header bảo mật x-umbm-client');
    }

    const token = request.cookies[ACCESS_COOKIE];
    if (!token) return;
    try {
      const claims = await tokens.verifyAccess(token);
      const user = auth.resolveSession(claims);
      const branchScope = auth.resolveEffectiveBranchScope(user);
      const publicUser = { ...toPublicUser(user), branchScope };
      request.auth = {
        user,
        publicUser,
        permissions: new Set(publicUser.permissions),
        branchScope,
        app: claims.app,
      };
    } catch {
      request.auth = null;
    }
  });
}

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function requireAuth(): Guard {
  return async (request, reply) => {
    if (!request.auth) {
      if (request.cookies[ACCESS_COOKIE]) reply.clearCookie(ACCESS_COOKIE, { path: '/' });
      throw Errors.unauthorized();
    }
  };
}

/** Yêu cầu có ÍT NHẤT MỘT trong các permission. */
export function requirePermission(...perms: Permission[]): Guard {
  return async (request, reply) => {
    if (!request.auth) {
      if (request.cookies[ACCESS_COOKIE]) reply.clearCookie(ACCESS_COOKIE, { path: '/' });
      throw Errors.unauthorized();
    }
    if (!perms.some((p) => request.auth!.permissions.has(p))) throw Errors.forbidden();
  };
}

/** Chặn truy cập chi nhánh ngoài branchScope (SEC-02). */
export function assertBranchAccess(request: FastifyRequest, branchId: string): void {
  const scope = request.auth?.branchScope;
  if (!scope) throw Errors.unauthorized();
  if (scope !== 'ALL' && !scope.includes(branchId)) throw Errors.forbidden('Ngoài phạm vi chi nhánh được phân quyền');
}

/** Lọc danh sách theo branchScope — dùng trong mọi API trả về dữ liệu theo chi nhánh. */
export function filterByBranch<T>(request: FastifyRequest, rows: T[], getBranchId: (row: T) => string): T[] {
  const scope = request.auth?.branchScope;
  if (!scope) return [];
  if (scope === 'ALL') return rows;
  return rows.filter((r) => scope.includes(getBranchId(r)));
}

export function auditContext(request: FastifyRequest) {
  return {
    actorUserId: request.auth?.user.id ?? 'anonymous',
    actorRole: request.auth?.user.role ?? 'NONE',
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id,
  };
}
