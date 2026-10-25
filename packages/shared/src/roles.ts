/**
 * Vai trò và trạng thái dùng chung toàn hệ thống (Mục 3 tài liệu V5.1).
 */

export const INTERNAL_ROLES = ['ADMIN', 'HR', 'STORE', 'FINANCE', 'MKT'] as const;
export const EMPLOYEE_ROLES = ['THU_VIEC', 'CHINH_THUC'] as const;
export const ROLES = [...INTERNAL_ROLES, ...EMPLOYEE_ROLES] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Quản trị hệ thống',
  HR: 'Nhân sự',
  STORE: 'Quản lý cửa hàng',
  FINANCE: 'Kế toán',
  MKT: 'Truyền thông nội bộ',
  THU_VIEC: 'Nhân viên thử việc',
  CHINH_THUC: 'Nhân viên chính thức',
};

export function isInternalRole(role: Role): role is InternalRole {
  return (INTERNAL_ROLES as readonly string[]).includes(role);
}

export function isEmployeeRole(role: Role): role is EmployeeRole {
  return (EMPLOYEE_ROLES as readonly string[]).includes(role);
}

export const ACCOUNT_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'LOCKED', 'REVOKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const SCHEDULE_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const REQUEST_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const SHIFT_SWAP_STATUSES = [
  'PENDING_PEER',
  'PEER_ACCEPTED',
  'PEER_DECLINED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ShiftSwapStatus = (typeof SHIFT_SWAP_STATUSES)[number];

export const PAY_PERIOD_STATUSES = ['DRAFT', 'RECONCILE', 'APPROVED', 'PUBLISHED', 'PAID'] as const;
export type PayPeriodStatus = (typeof PAY_PERIOD_STATUSES)[number];

/** Chi nhánh: 'ALL' hoặc danh sách branch_id. */
export type BranchScope = 'ALL' | string[];
