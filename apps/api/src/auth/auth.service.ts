import {
  isEmployeeRole,
  isInternalRole,
  isPermissionForbiddenForRole,
  normalizePhone,
  PERMISSIONS,
  resolvePermissions,
  type BranchScope,
  type Permission,
  type PublicUser,
  type User,
} from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { getDummyHash, verifySecret } from './password.js';
import type { TokenClaims } from './tokens.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function parseBranchScope(raw: string): BranchScope {
  const value = raw.trim();
  if (!value || value === 'ALL') return 'ALL';
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseExtraPermissions(raw: string): Permission[] {
  try {
    const arr = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(String(p)));
  } catch {
    return [];
  }
}

export function toPublicUser(user: User): PublicUser {
  const extraPermissions = parseExtraPermissions(user.permissions_json).filter(
    (p) => !isPermissionForbiddenForRole(user.role, p),
  );
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    permissions: [...resolvePermissions(user.role, extraPermissions)],
    extraPermissions,
    branchScope: parseBranchScope(user.branch_scope),
    employeeId: user.employee_id || null,
    status: user.status,
  };
}

export class AuthService {
  constructor(private readonly db: Database) {}

  /**
   * Đăng nhập. Backoffice dùng username; app nhân viên dùng số điện thoại.
   * Thông báo lỗi chung chung để không lộ tài khoản nào tồn tại.
   */
  async login(identifier: string, secret: string, app: 'backoffice' | 'employee'): Promise<User> {
    const invalid = Errors.unauthorized('Thông tin đăng nhập không đúng');
    const user = this.findByIdentifier(identifier, app);

    if (!user) {
      await verifySecret(await getDummyHash(), secret);
      throw invalid;
    }

    if (user.locked_until && dayjs(user.locked_until).isAfter(dayjs())) {
      throw Errors.locked(`Tài khoản tạm khóa đến ${dayjs(user.locked_until).format('HH:mm DD/MM/YYYY')} do nhập sai nhiều lần`);
    }

    const ok = await verifySecret(user.password_hash, secret);
    if (!ok) {
      const failed = user.failed_login_count + 1;
      const lock = failed >= MAX_FAILED_ATTEMPTS;
      await this.db.users.update(
        user.id,
        user.version,
        {
          failed_login_count: lock ? 0 : failed,
          locked_until: lock ? dayjs().add(LOCK_MINUTES, 'minute').format('YYYY-MM-DDTHH:mm:ssZ') : user.locked_until,
        },
        'system',
      );
      throw invalid;
    }

    if (user.status === 'PENDING_ACTIVATION') {
      throw Errors.forbidden('Tài khoản đang chờ Admin kích hoạt');
    }
    if (user.status !== 'ACTIVE') {
      throw Errors.forbidden('Tài khoản đã bị khóa hoặc thu hồi');
    }
    if (app === 'backoffice' && !isInternalRole(user.role)) throw invalid;
    if (app === 'employee' && user.role === 'MKT') throw invalid;

    return this.db.users.update(
      user.id,
      user.version,
      { failed_login_count: 0, locked_until: '', last_login_at: nowIso() },
      user.id,
    );
  }

  /** Xác thực lại mỗi request: tài khoản phải còn ACTIVE và session_version khớp. */
  resolveSession(claims: TokenClaims): User {
    const user = this.db.users.get(claims.sub);
    if (!user || user.status !== 'ACTIVE' || user.session_version !== claims.sv) {
      throw Errors.unauthorized();
    }
    return user;
  }

  private findByIdentifier(identifier: string, app: 'backoffice' | 'employee'): User | undefined {
    const id = identifier.trim();
    const lower = id.toLowerCase();
    const phone = normalizePhone(id);

    if (app === 'employee') {
      const matchedEmpCodes = new Set<string>();
      const matchedUserIds = new Set<string>();
      if (phone) {
        for (const e of this.db.employees.all()) {
          if (e.phone === phone) {
            matchedEmpCodes.add(e.employee_code.toUpperCase());
            if (e.user_id) matchedUserIds.add(e.user_id);
          }
        }
      }
      const candidates = this.db.users.all().filter((u) => {
        if (phone && (u.phone === phone || matchedUserIds.has(u.id) || (u.employee_id && matchedEmpCodes.has(u.employee_id.toUpperCase())))) {
          return true;
        }
        return u.username.toLowerCase() === lower || Boolean(u.email && u.email.toLowerCase() === lower);
      });
      candidates.sort((a, b) => {
        const aRole = isEmployeeRole(a.role) ? 0 : 1;
        const bRole = isEmployeeRole(b.role) ? 0 : 1;
        if (aRole !== bRole) return aRole - bRole;
        const aActive = a.status === 'ACTIVE' ? 0 : a.status === 'PENDING_ACTIVATION' ? 1 : 2;
        const bActive = b.status === 'ACTIVE' ? 0 : b.status === 'PENDING_ACTIVATION' ? 1 : 2;
        return aActive - bActive;
      });
      return candidates[0];
    }

    return this.db.users.find(
      (u) =>
        u.username.toLowerCase() === lower ||
        Boolean(u.email && u.email.toLowerCase() === lower) ||
        Boolean(phone && u.phone === phone),
    );
  }
}
