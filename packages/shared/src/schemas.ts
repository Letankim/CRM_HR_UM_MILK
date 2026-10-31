import { z } from 'zod';
import { ACCOUNT_STATUSES, ROLES } from './roles.js';
import { PERMISSIONS } from './permissions.js';

/* ------------------------------------------------------------------ */
/* Kiểu dữ liệu cơ bản                                                 */
/* ------------------------------------------------------------------ */

/** ISO 8601 có múi giờ, ví dụ 2026-10-23T08:01:12+07:00 */
export const zDateTime = z.string().datetime({ offset: true });
/** Ngày thuần YYYY-MM-DD */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD');
/** Số điện thoại chuẩn Việt Nam bắt đầu bằng số 0 (10 chữ số, ví dụ 0901234567) */
export const zPhone = z
  .string()
  .regex(/^0\d{9}$/, 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0');
export const zId = z.string().min(10).max(32);

/**
 * Boolean đọc từ Google Sheets (mọi ô lưu dạng chuỗi).
 * Không dùng z.coerce.boolean() vì Boolean("FALSE") === true.
 */
export const zBool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === '1';
}, z.boolean());

/**
 * Chuẩn hóa số điện thoại Việt Nam về dạng mặc định bắt đầu bằng số 0 (10 chữ số, ví dụ 0901000001).
 * Tự động chuyển đổi nếu người dùng dán dạng +84... hoặc 84... về 0...
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(digits)) return digits;
  if (/^\+84\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^84\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return null;
}

/** Cột hệ thống có mặt trên mọi tab dữ liệu */
export const zSystemColumns = z.object({
  id: zId,
  created_at: zDateTime,
  created_by: z.string(),
  updated_at: zDateTime,
  updated_by: z.string(),
  version: z.coerce.number().int().min(1),
  is_deleted: zBool.default(false),
});

/* ------------------------------------------------------------------ */
/* UMBM_CORE                                                           */
/* ------------------------------------------------------------------ */

export const zBranch = zSystemColumns.extend({
  code: z.string().min(2).max(10),
  name: z.string().min(1),
  address: z.string().default(''),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(10).max(2000),
  max_accuracy_m: z.coerce.number().int().min(5).max(500),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  phone_contact: z.string().default(''),
  manager_employee_id: z.string().default(''),
  open_time: z.string().default('07:00'),
  close_time: z.string().default('22:30'),
  effective_from: z.string().default(''),
  note: z.string().default(''),
});
export type Branch = z.infer<typeof zBranch>;

export const zShiftTemplate = zSystemColumns.extend({
  code: z.string().min(2).max(20),
  name: z.string().min(1),
  start_time: z.string().default('07:00'),
  end_time: z.string().default('12:00'),
  effective_from: z.string().default('2026-01-01'),
  effective_to: z.string().default(''),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  shift_group: z.string().default('STORE'),
  break_minutes: z.coerce.number().int().min(0).default(0),
  standard_hours: z.preprocess((v) => (v === '' || v === null || v === undefined || Number(v) < 0.5 ? 5 : Number(v)), z.number().min(0.5)),
  is_overnight: zBool.default(false),
  note: z.string().default(''),
});
export type ShiftTemplate = z.infer<typeof zShiftTemplate>;

export const zUser = zSystemColumns.extend({
  username: z.string().min(2),
  phone: z.string().default(''),
  display_name: z.string().min(1),
  password_hash: z.string().min(20),
  role: z.enum(ROLES),
  permissions_json: z.string().default('[]'),
  branch_scope: z.string().default('ALL'),
  employee_id: z.string().default(''),
  status: z.enum(ACCOUNT_STATUSES),
  session_version: z.coerce.number().int().min(1),
  failed_login_count: z.coerce.number().int().min(0).default(0),
  locked_until: z.string().default(''),
  last_login_at: z.string().default(''),
  activated_by: z.string().default(''),
  activated_at: z.string().default(''),
  revoked_at: z.string().default(''),
  email: z.string().default(''),
  revoked_by: z.string().default(''),
  revoke_reason: z.string().default(''),
  /** Bắt buộc đổi mã PIN / mật khẩu ngay lần đăng nhập kế tiếp (khi vừa được cấp hoặc bị đặt lại). */
  must_change_pin: zBool.default(false),
  /** Thời điểm đổi mã PIN gần nhất — dùng để tính chu kỳ bắt buộc đổi PIN định kỳ. */
  pin_changed_at: z.string().default(''),
});
export type User = z.infer<typeof zUser>;

/** Mã PIN đăng nhập của nhân viên: đúng 6 chữ số. */
export const PIN_REGEX = /^\d{6}$/;

/** Dạng an toàn để trả về client — không bao giờ chứa password_hash */
export const zPublicUser = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  extraPermissions: z.array(z.enum(PERMISSIONS)).optional(),
  branchScope: z.union([z.literal('ALL'), z.array(z.string())]),
  employeeId: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  /** true khi hệ thống yêu cầu đổi mã PIN trước khi tiếp tục sử dụng */
  mustChangePin: z.boolean().optional(),
  /** Lý do yêu cầu đổi PIN: lần đầu cấp tài khoản / đặt lại / hết chu kỳ định kỳ */
  pinChangeReason: z.enum(['FIRST_LOGIN', 'RESET', 'EXPIRED']).nullable().optional(),
});
export type PublicUser = z.infer<typeof zPublicUser>;

/* ------------------------------------------------------------------ */
/* API contracts                                                       */
/* ------------------------------------------------------------------ */

export const zLoginRequest = z.object({
  identifier: z.string().trim().min(2, 'Nhập tên đăng nhập hoặc số điện thoại').max(64),
  secret: z.string().min(6, 'Mật khẩu/PIN tối thiểu 6 ký tự').max(128),
  app: z.enum(['backoffice', 'employee']),
});
export type LoginRequest = z.infer<typeof zLoginRequest>;

export const zApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof zApiError>;

export const zHealth = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  time: z.string(),
  checks: z.record(
    z.object({
      status: z.enum(['ok', 'degraded', 'down']),
      detail: z.string().optional(),
    }),
  ),
});
export type Health = z.infer<typeof zHealth>;
