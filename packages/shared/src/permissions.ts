import type { Role } from './roles.js';

/**
 * Danh mục permission. Backend kiểm tra permission trên MỌI route (SEC-01).
 * Việc ẩn/hiện tab trên giao diện chỉ là trải nghiệm, không thay thế kiểm tra này.
 */
export const PERMISSIONS = [
  'account.read', 'account.manage', 'account.activate',
  'system.config', 'system.maintenance', 'system.audit.read', 'system.backup', 'integration.read',
  'candidate.manage', 'interview.manage', 'employee.read', 'employee.manage', 'employee.promote',
  'schedule.read', 'schedule.propose', 'schedule.publish', 'leave.approve', 'swap.approve', 'emergency.handle',
  'attendance.read', 'attendance.media.read', 'attendance.confirm', 'adjustment.approve',
  'test.manage', 'test.read',
  'payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay',
  'comms.manage', 'notification.send',
  'report.hr', 'report.store', 'report.finance',
  'self.profile', 'self.schedule', 'self.attendance', 'self.leave', 'self.swap', 'self.adjustment', 'self.test', 'self.payslip',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'account.read': 'Xem danh sách tài khoản',
  'account.manage': 'Tạo & chỉnh sửa tài khoản, phân quyền',
  'account.activate': 'Kích hoạt, khóa/mở khóa & thu hồi tài khoản',
  'system.config': 'Cấu hình chi nhánh, ca làm & tham số hệ thống',
  'system.maintenance': 'Bật/tắt chế độ bảo trì hệ thống',
  'system.audit.read': 'Tra cứu & lưu trữ nhật ký kiểm toán',
  'system.backup': 'Sao lưu & khôi phục dữ liệu hệ thống',
  'integration.read': 'Theo dõi tích hợp Google Sheets, Drive & Đối soát',
  'candidate.manage': 'Quản lý hồ sơ ứng viên tuyển dụng',
  'interview.manage': 'Lên lịch & đánh giá phỏng vấn',
  'employee.read': 'Xem danh sách & hồ sơ nhân sự',
  'employee.manage': 'Tiếp nhận, cập nhật & điều chuyển hồ sơ nhân sự',
  'employee.promote': 'Đánh giá & quyết định chuyển chính thức',
  'schedule.read': 'Xem lịch làm việc & bảng phân ca',
  'schedule.propose': 'Đề xuất & xếp lịch phân ca',
  'schedule.publish': 'Duyệt & phát hành lịch làm việc chính thức',
  'leave.approve': 'Duyệt đơn xin nghỉ phép OFF',
  'swap.approve': 'Duyệt yêu cầu đổi ca làm việc',
  'emergency.handle': 'Xử lý báo nghỉ đột xuất & bố trí người thay',
  'attendance.read': 'Xem dữ liệu điểm danh vào/ra ca',
  'attendance.media.read': 'Xem ảnh selfie & tọa độ GPS điểm danh',
  'attendance.confirm': 'Xác nhận công thực tế cấp cửa hàng',
  'adjustment.approve': 'Phê duyệt phiếu bổ sung / điều chỉnh công',
  'test.manage': 'Quản lý ngân hàng đề & giao bài thi TEST',
  'test.read': 'Xem kết quả & lịch sử bài thi TEST',
  'payroll.read': 'Xem bảng công tổng hợp, hồ sơ lương & kỳ lương',
  'payroll.manage': 'Thiết lập mức lương, tính lương & đối soát kỳ lương',
  'payroll.publish': 'Phê duyệt & phát hành phiếu lương chính thức',
  'payroll.pay': 'Xác nhận thanh toán & tất toán kỳ lương',
  'comms.manage': 'Quản lý chiến dịch & phát bản tin truyền thông',
  'notification.send': 'Gửi thông báo nghiệp vụ nội bộ',
  'report.hr': 'Xem báo cáo thống kê Nhân sự',
  'report.store': 'Xem báo cáo vận hành Cửa hàng',
  'report.finance': 'Xem báo cáo chi phí & Quỹ lương Kế toán',
  'self.profile': 'Cổng NV: Xem hồ sơ cá nhân',
  'self.schedule': 'Cổng NV: Xem lịch ca cá nhân',
  'self.attendance': 'Cổng NV: Điểm danh GPS & xem công cá nhân',
  'self.leave': 'Cổng NV: Gửi đơn xin nghỉ OFF',
  'self.swap': 'Cổng NV: Gửi & xác nhận đổi ca',
  'self.adjustment': 'Cổng NV: Gửi phiếu bổ sung công',
  'self.test': 'Cổng NV: Làm bài thi TEST nghiệp vụ',
  'self.payslip': 'Cổng NV: Xem & xác nhận phiếu lương cá nhân',
};

export const PERMISSION_GROUPS: { key: string; label: string; permissions: Permission[] }[] = [
  { key: 'system', label: 'Tài khoản & Quản trị hệ thống', permissions: ['account.read', 'account.manage', 'account.activate', 'system.config', 'system.maintenance', 'system.audit.read', 'system.backup', 'integration.read'] },
  { key: 'hr', label: 'Tuyển dụng, Hồ sơ Nhân sự & Đào tạo TEST', permissions: ['candidate.manage', 'interview.manage', 'employee.read', 'employee.manage', 'employee.promote', 'test.manage', 'test.read'] },
  { key: 'schedule', label: 'Lịch làm việc, Nghỉ phép & Đổi ca', permissions: ['schedule.read', 'schedule.propose', 'schedule.publish', 'leave.approve', 'swap.approve', 'emergency.handle'] },
  { key: 'attendance', label: 'Điểm danh GPS & Điều chỉnh công', permissions: ['attendance.read', 'attendance.media.read', 'attendance.confirm', 'adjustment.approve'] },
  { key: 'payroll', label: 'Kế toán Tiền lương & Phiếu lương', permissions: ['payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay'] },
  { key: 'comms_report', label: 'Truyền thông & Báo cáo thống kê', permissions: ['comms.manage', 'notification.send', 'report.hr', 'report.store', 'report.finance'] },
  { key: 'self', label: 'Tự phục vụ Cổng Nhân viên', permissions: ['self.profile', 'self.schedule', 'self.attendance', 'self.leave', 'self.swap', 'self.adjustment', 'self.test', 'self.payslip'] },
];

const SELF_SERVICE: Permission[] = [
  'self.profile', 'self.schedule', 'self.attendance', 'self.leave', 'self.swap', 'self.adjustment', 'self.test', 'self.payslip',
];

/**
 * Permission mặc định theo vai trò (RBAC Matrix — Phần 01 tài liệu đặc tả).
 * Admin có thể cấp thêm permission bổ sung qua cột permissions_json của USERS.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    'account.read', 'account.manage', 'account.activate', 'system.config', 'system.maintenance',
    'system.audit.read', 'system.backup', 'integration.read', 'employee.read', 'schedule.read',
    'attendance.read', 'attendance.media.read', 'test.read', 'notification.send',
  ],
  HR: [
    'account.read', 'candidate.manage', 'interview.manage', 'employee.read', 'employee.manage', 'employee.promote',
    'schedule.read', 'schedule.propose', 'schedule.publish', 'leave.approve', 'swap.approve', 'emergency.handle',
    'attendance.read', 'attendance.media.read', 'adjustment.approve', 'test.manage', 'test.read', 'report.hr', 'notification.send',
  ],
  STORE: [
    'employee.read', 'schedule.read', 'schedule.propose', 'leave.approve', 'swap.approve', 'emergency.handle',
    'attendance.read', 'attendance.media.read', 'attendance.confirm', 'report.store', 'notification.send',
  ],
  FINANCE: [
    'employee.read', 'schedule.read', 'attendance.read', 'payroll.read', 'payroll.manage',
    'payroll.publish', 'payroll.pay', 'report.finance', 'notification.send',
  ],
  MKT: ['comms.manage', 'notification.send'],
  THU_VIEC: SELF_SERVICE,
  CHINH_THUC: SELF_SERVICE,
};

/**
 * Các permission bị cấm tuyệt đối theo từng vai trò (ngăn chặn cấu hình sai lệch trong permissions_json).
 */
export const FORBIDDEN_ROLE_PERMISSIONS: Partial<Record<Role, Permission[]>> = {
  ADMIN: ['candidate.manage', 'interview.manage', 'test.manage', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'schedule.propose', 'schedule.publish', 'attendance.confirm', 'adjustment.approve'],
  HR: ['payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config', 'system.maintenance', 'system.backup', 'system.audit.read', 'account.activate'],
  STORE: [' payroll.read' as Permission, 'payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config', 'system.maintenance', 'system.backup', 'account.read', 'account.manage', 'account.activate'],
  FINANCE: ['candidate.manage', 'interview.manage', 'test.manage', 'employee.manage', 'employee.promote', 'schedule.propose', 'schedule.publish', 'leave.approve', 'swap.approve', 'emergency.handle', 'attendance.confirm', 'adjustment.approve', 'system.config', 'account.manage', 'account.activate'],
  MKT: ['account.read', 'account.manage', 'account.activate', 'candidate.manage', 'interview.manage', 'employee.read', 'employee.manage', 'employee.promote', 'schedule.read', 'schedule.propose', 'schedule.publish', 'attendance.read', 'attendance.media.read', 'attendance.confirm', 'adjustment.approve', 'payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'test.manage', 'test.read'],
};
// Fix typo in STORE forbidden list:
FORBIDDEN_ROLE_PERMISSIONS.STORE = ['payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config', 'system.maintenance', 'system.backup', 'account.read', 'account.manage', 'account.activate'];

export function isPermissionForbiddenForRole(role: Role, perm: Permission): boolean {
  return (FORBIDDEN_ROLE_PERMISSIONS[role] ?? []).includes(perm);
}

export function getAllowedExtraPermissionsForRole(role: Role): Permission[] {
  const defaults = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role] ?? []);
  const forbidden = new Set<Permission>(FORBIDDEN_ROLE_PERMISSIONS[role] ?? []);
  return PERMISSIONS.filter((p) => !defaults.has(p) && !forbidden.has(p));
}

export function resolvePermissions(role: Role, extra: Permission[] = []): Set<Permission> {
  const forbidden = new Set<Permission>(FORBIDDEN_ROLE_PERMISSIONS[role] ?? []);
  const safeExtra = extra.filter((p) => !forbidden.has(p));
  return new Set<Permission>([...DEFAULT_ROLE_PERMISSIONS[role], ...safeExtra]);
}
