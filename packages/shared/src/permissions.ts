import type { Role } from './roles.js';

/**
 * Danh mục permission. Backend kiểm tra permission trên MỌI route (SEC-01).
 * Việc ẩn/hiện tab trên giao diện chỉ là trải nghiệm, không thay thế kiểm tra này.
 */
export const PERMISSIONS = [
  // Tài khoản & hệ thống
  'account.read',
  'account.manage',
  'account.activate',
  'system.config',
  'system.maintenance',
  'system.audit.read',
  'system.backup',
  'integration.read',
  // Nhân sự
  'candidate.manage',
  'interview.manage',
  'employee.read',
  'employee.manage',
  'employee.promote',
  // Lịch
  'schedule.read',
  'schedule.propose',
  'schedule.publish',
  'leave.approve',
  'swap.approve',
  'emergency.handle',
  // Chấm công
  'attendance.read',
  'attendance.media.read',
  'attendance.confirm',
  'adjustment.approve',
  // TEST
  'test.manage',
  'test.read',
  // Lương
  'payroll.read',
  'payroll.manage',
  'payroll.publish',
  'payroll.pay',
  // Truyền thông
  'comms.manage',
  'notification.send',
  // Báo cáo
  'report.hr',
  'report.store',
  'report.finance',
  // Tự phục vụ của nhân viên
  'self.profile',
  'self.schedule',
  'self.attendance',
  'self.leave',
  'self.swap',
  'self.adjustment',
  'self.test',
  'self.payslip',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SELF_SERVICE: Permission[] = [
  'self.profile',
  'self.schedule',
  'self.attendance',
  'self.leave',
  'self.swap',
  'self.adjustment',
  'self.test',
  'self.payslip',
];

/**
 * Permission mặc định theo vai trò (RBAC Matrix — Phần 01 tài liệu đặc tả).
 * Admin có thể cấp thêm permission bổ sung qua cột permissions_json của USERS.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    'account.read',
    'account.manage',
    'account.activate',
    'system.config',
    'system.maintenance',
    'system.audit.read',
    'system.backup',
    'integration.read',
    'employee.read',
    'schedule.read',
    'attendance.read',
    'attendance.media.read',
    'test.read',
    'notification.send',
  ],
  HR: [
    'account.read',
    'candidate.manage',
    'interview.manage',
    'employee.read',
    'employee.manage',
    'employee.promote',
    'schedule.read',
    'schedule.propose',
    'schedule.publish',
    'leave.approve',
    'swap.approve',
    'emergency.handle',
    'attendance.read',
    'attendance.media.read',
    'adjustment.approve',
    'test.manage',
    'test.read',
    'report.hr',
    'notification.send',
  ],
  STORE: [
    'employee.read',
    'schedule.read',
    'schedule.propose',
    'leave.approve',
    'swap.approve',
    'emergency.handle',
    'attendance.read',
    'attendance.media.read',
    'attendance.confirm',
    'report.store',
    'notification.send',
  ],
  FINANCE: [
    'employee.read',
    'schedule.read',
    'attendance.read',
    'payroll.read',
    'payroll.manage',
    'payroll.publish',
    'payroll.pay',
    'report.finance',
    'notification.send',
  ],
  // MKT tuyệt đối không có quyền lương, GPS, ảnh điểm danh, hồ sơ nhạy cảm.
  MKT: ['comms.manage', 'notification.send'],
  THU_VIEC: SELF_SERVICE,
  CHINH_THUC: SELF_SERVICE,
};

/**
 * Các permission bị cấm tuyệt đối theo từng vai trò (ngăn chặn cấu hình sai lệch trong permissions_json).
 */
const FORBIDDEN_ROLE_PERMISSIONS: Partial<Record<Role, Permission[]>> = {
  ADMIN: ['candidate.manage', 'interview.manage', 'test.manage', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'schedule.propose', 'schedule.publish', 'attendance.confirm', 'adjustment.approve'],
  HR: ['payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config', 'system.maintenance', 'system.backup', 'system.audit.read', 'account.activate'],
  STORE: ['candidate.manage', 'interview.manage', 'test.manage', 'test.read', 'payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config', 'account.read', 'account.manage', 'account.activate'],
  FINANCE: ['candidate.manage', 'interview.manage', 'test.manage', 'test.read', 'employee.manage', 'employee.promote', 'schedule.propose', 'schedule.publish', 'leave.approve', 'swap.approve', 'emergency.handle', 'attendance.confirm', 'adjustment.approve', 'system.config', 'account.read', 'account.manage', 'account.activate'],
  MKT: ['account.read', 'account.manage', 'account.activate', 'candidate.manage', 'interview.manage', 'employee.read', 'employee.manage', 'employee.promote', 'schedule.read', 'schedule.propose', 'schedule.publish', 'attendance.read', 'attendance.media.read', 'attendance.confirm', 'adjustment.approve', 'payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'test.manage', 'test.read'],
};

export function resolvePermissions(role: Role, extra: Permission[] = []): Set<Permission> {
  const forbidden = new Set<Permission>(FORBIDDEN_ROLE_PERMISSIONS[role] ?? []);
  const safeExtra = extra.filter((p) => !forbidden.has(p));
  return new Set<Permission>([...DEFAULT_ROLE_PERMISSIONS[role], ...safeExtra]);
}
