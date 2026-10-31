import {
  isEmployeeRole,
  isInternalRole,
  isPermissionForbiddenForRole,
  normalizePhone,
  PERMISSIONS,
  PIN_REGEX,
  resolvePermissions,
  type BranchScope,
  type Permission,
  type PublicUser,
  type User,
} from '@umbm/shared';
import type { Database } from '../data/database.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
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

export type PinChangeReason = 'FIRST_LOGIN' | 'RESET' | 'EXPIRED';
export interface PinChangeState { required: boolean; reason: PinChangeReason | null }

export function toPublicUser(user: User, pinState?: PinChangeState): PublicUser {
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
    mustChangePin: pinState?.required ?? user.must_change_pin,
    pinChangeReason: pinState?.reason ?? null,
  };
}

export class AuthService {
  constructor(private readonly db: Database) {}

  /**
   * Đăng nhập. Backoffice dùng username; app nhân viên dùng số điện thoại.
   * Thông báo lỗi chung chung để không lộ tài khoản nào tồn tại.
   */
  async login(identifier: string, secret: string, app: 'backoffice' | 'employee'): Promise<User> {
    const invalid = Errors.unauthorized(app === 'employee' ? 'Số điện thoại hoặc mã PIN không đúng' : 'Thông tin đăng nhập không đúng');
    if (app === 'employee' && !normalizePhone(identifier)) {
      throw Errors.fieldValidation('identifier', 'INVALID_PHONE', 'Vui lòng nhập số điện thoại đăng nhập gồm 10 chữ số bắt đầu bằng số 0', identifier);
    }
    const user = this.findByIdentifier(identifier, app);
    if (user && app === 'employee' && isEmployeeRole(user.role) && !PIN_REGEX.test(secret)) {
      throw Errors.fieldValidation('secret', 'INVALID_FORMAT', 'Mã PIN đăng nhập phải gồm đúng 6 chữ số', '******');
    }

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

  /**
   * Trạng thái bắt buộc đổi mã PIN: vừa được cấp / đặt lại tài khoản, hoặc đã quá chu kỳ đổi PIN định kỳ
   * do Quản trị viên cấu hình (AUTH_PIN_ROTATION_DAYS, 0 = không áp dụng).
   */
  resolvePinState(user: User): PinChangeState {
    if (user.must_change_pin) return { required: true, reason: user.pin_changed_at ? 'RESET' : 'FIRST_LOGIN' };
    const days = getOperationSettings(this.db).pinRotationDays;
    const base = user.pin_changed_at || user.activated_at || user.created_at;
    if (days > 0 && base && dayjs().diff(dayjs(base), 'day') >= days) return { required: true, reason: 'EXPIRED' };
    return { required: false, reason: null };
  }

  /** Tìm tài khoản Cổng Nhân viên theo số điện thoại (bước 1 đăng nhập 2 bước). */
  findEmployeePortalUserByPhone(phone: string): User | undefined {
    return normalizePhone(phone) ? this.findByIdentifier(phone, 'employee') : undefined;
  }

  /** Xác thực lại mỗi request: tài khoản phải còn ACTIVE và session_version khớp. */
  resolveSession(claims: TokenClaims): User {
    const user = this.db.users.get(claims.sub);
    if (!user || user.status !== 'ACTIVE' || user.session_version !== claims.sv) {
      throw Errors.unauthorized();
    }
    return user;
  }

  /** Giải mã phạm vi chi nhánh thực tế (vai trò Quản trị/HR/Kế toán/MKT luôn toàn hệ thống ALL; khóa chặt chi nhánh với STORE / Nhân viên). */
  resolveEffectiveBranchScope(user: User): BranchScope {
    const isBranchRole = user.role === 'STORE' || user.role === 'THU_VIEC' || user.role === 'CHINH_THUC';
    if (!isBranchRole) return 'ALL';
    const emp = this.db.employees.find(
      (e) => e.user_id === user.id || Boolean(user.employee_id && (e.id === user.employee_id || e.employee_code === user.employee_id)),
    );
    let rawTokens = user.branch_scope && user.branch_scope.trim() !== 'ALL'
      ? user.branch_scope.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (emp?.branch_id && (rawTokens.length === 0 || (emp.updated_at ?? '') > (user.updated_at ?? ''))) {
      rawTokens = [emp.branch_id];
    }
    const expanded = new Set<string>();
    for (const t of rawTokens) {
      expanded.add(t);
      const b = this.db.branches.get(t) ?? this.db.branches.find((x) => x.code.toUpperCase() === t.toUpperCase());
      if (b) {
        expanded.add(b.id);
        expanded.add(b.code);
      }
    }
    return expanded.size > 0 ? Array.from(expanded) : ['NONE'];
  }

  getUserById(userId: string): User | undefined {
    return this.db.users.get(userId);
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
