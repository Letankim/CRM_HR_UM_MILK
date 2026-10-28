/**
 * Kho lưu trữ tập trung toàn bộ Enum, nhãn hiển thị Tiếng Việt và mã lỗi của hệ thống.
 * Cả Backend (apps/api) và Frontend (apps/web) bắt buộc import từ đây để đồng bộ 100%.
 * Quy tắc: Không bao giờ hiển thị mã kỹ thuật (key) ra giao diện người dùng; luôn hiển thị nhãn tiếng Việt.
 */

import {
  ACCOUNT_STATUSES,
  PAY_PERIOD_STATUSES,
  REQUEST_STATUSES,
  ROLES,
  ROLE_LABELS,
  SCHEDULE_STATUSES,
  SHIFT_SWAP_STATUSES,
  type AccountStatus,
  type PayPeriodStatus,
  type RequestStatus,
  type Role,
  type ScheduleStatus,
  type ShiftSwapStatus,
} from './roles.js';

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  ADMIN: 'Quản trị',
  HR: 'Nhân sự',
  STORE: 'Cửa hàng',
  FINANCE: 'Kế toán',
  MKT: 'Truyền thông',
  THU_VIEC: 'Thử việc',
  CHINH_THUC: 'Chính thức',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_ACTIVATION: 'Chờ kích hoạt',
  ACTIVE: 'Đang hoạt động',
  LOCKED: 'Tạm khóa',
  REVOKED: 'Đã thu hồi',
};

export const BRANCH_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];
export const BRANCH_STATUS_LABELS: Record<BranchStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  INACTIVE: 'Ngừng hoạt động',
};

export const EMPLOYEE_STAGES = ['CANDIDATE', 'INTERVIEW', 'PROBATION', 'OFFICIAL', 'RESIGNED'] as const;
export type EmployeeStage = (typeof EMPLOYEE_STAGES)[number];
export const EMPLOYEE_STAGE_LABELS: Record<EmployeeStage, string> = {
  CANDIDATE: 'Ứng viên',
  INTERVIEW: 'Phỏng vấn',
  PROBATION: 'Nhân viên thử việc',
  OFFICIAL: 'Nhân viên chính thức',
  RESIGNED: 'Đã nghỉ việc',
};

export const STAFF_GROUPS = ['BARISTA', 'CASHIER', 'SERVICE', 'SHIFT_LEADER', 'STORE_MANAGER', 'BACKOFFICE', 'FACTORY', 'SALES'] as const;
export type StaffGroup = (typeof STAFF_GROUPS)[number];
export const STAFF_GROUP_LABELS: Record<string, string> = {
  BARISTA: 'Pha chế',
  CASHIER: 'Thu ngân',
  SERVICE: 'Phục vụ',
  SHIFT_LEADER: 'Ca trưởng',
  STORE_MANAGER: 'Quản lý cửa hàng',
  BACKOFFICE: 'Khối văn phòng',
  FACTORY: 'Khối xưởng sản xuất',
  SALES: 'Khối kinh doanh (Sale)',
};

export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'SUSPENDED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Đang làm việc',
  ON_LEAVE: 'Tạm nghỉ phép',
  RESIGNED: 'Đã nghỉ việc',
  SUSPENDED: 'Tạm đình chỉ',
};

export const EMPLOYMENT_TYPES = ['PROBATION', 'PART_TIME', 'FULL_TIME'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PROBATION: 'Thử việc (Chu kỳ 12 ngày)',
  PART_TIME: 'Bán thời gian (Theo ca)',
  FULL_TIME: 'Toàn thời gian',
};

export const DEFAULT_SHIFT_CODES = ['CA_SANG', 'CA_CHIEU', 'CA_TOI', 'HANH_CHINH'] as const;
export type DefaultShiftCode = (typeof DEFAULT_SHIFT_CODES)[number];
export const DEFAULT_SHIFT_LABELS: Record<DefaultShiftCode, string> = {
  CA_SANG: 'Ca Sáng (07:00 - 12:00)',
  CA_CHIEU: 'Ca Chiều (12:00 - 17:00)',
  CA_TOI: 'Ca Tối (17:00 - 22:30)',
  HANH_CHINH: 'Ca Hành chính (08:00 - 17:30)',
};

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  DRAFT: 'Bản nháp',
  PUBLISHED: 'Đã phát hành',
  CANCELLED: 'Đã hủy',
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'Bản nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const SHIFT_SWAP_STATUS_LABELS: Record<ShiftSwapStatus, string> = {
  PENDING_PEER: 'Chờ đồng nghiệp nhận',
  PEER_ACCEPTED: 'Chờ Quản lý duyệt',
  PEER_DECLINED: 'Đồng nghiệp từ chối',
  APPROVED: 'Đã duyệt đổi ca',
  REJECTED: 'Từ chối đổi ca',
  CANCELLED: 'Đã hủy',
};

export const PAY_PERIOD_STATUS_LABELS: Record<PayPeriodStatus, string> = {
  DRAFT: 'Đang tính nháp',
  RECONCILE: 'Đang đối soát',
  APPROVED: 'Đã phê duyệt',
  PUBLISHED: 'Đã phát hành phiếu',
  PAID: 'Đã chi trả',
};

export const BACKUP_KINDS = ['DAILY', 'CRITICAL', 'PRE_OPERATION', 'WEEKLY', 'MONTHLY'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  DAILY: 'Sao lưu hàng ngày (01:00)',
  CRITICAL: 'Sao lưu định kỳ 4 giờ',
  PRE_OPERATION: 'Sao lưu trước thao tác nhạy cảm',
  WEEKLY: 'Sao lưu hàng tuần',
  MONTHLY: 'Sao lưu hàng tháng',
};

export const BACKUP_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  RUNNING: 'Đang sao lưu',
  SUCCESS: 'Thành công',
  FAILED: 'Thất bại',
};

export const SAGA_STATUSES = ['PENDING', 'COMMITTED', 'COMPENSATED', 'NEEDS_RECONCILIATION'] as const;
export type SagaStatus = (typeof SAGA_STATUSES)[number];
export const SAGA_STATUS_LABELS: Record<SagaStatus, string> = {
  PENDING: 'Đang thực thi',
  COMMITTED: 'Hoàn tất đồng bộ',
  COMPENSATED: 'Đã hoàn tác an toàn',
  NEEDS_RECONCILIATION: 'Cần đối soát',
};

export const RECONCILIATION_ISSUE_CODES = [
  'DUPLICATE_UNIQUE_KEY', 'ORPHAN_FOREIGN_KEY', 'STATE_INVARIANT_VIOLATION',
  'EXPIRED_ACCOUNT_LOCK', 'UNRESOLVED_DEAD_LETTER', 'STUCK_SAGA_OPERATION', 'SCHEMA_INVALID_ROW',
] as const;
export type ReconciliationIssueCode = (typeof RECONCILIATION_ISSUE_CODES)[number];

export const RECONCILIATION_ISSUE_LABELS: Record<ReconciliationIssueCode, string> = {
  DUPLICATE_UNIQUE_KEY: 'Trùng khóa duy nhất (Tên đăng nhập / Số điện thoại / Mã)',
  ORPHAN_FOREIGN_KEY: 'Tham chiếu khóa ngoại không tồn tại (Chi nhánh / Nhân sự)',
  STATE_INVARIANT_VIOLATION: 'Dữ liệu trạng thái thiếu dấu thời gian bắt buộc',
  EXPIRED_ACCOUNT_LOCK: 'Tài khoản tạm khóa đã hết thời gian phạt',
  UNRESOLVED_DEAD_LETTER: 'Bản ghi lỗi hàng đợi chưa được đồng bộ lại',
  STUCK_SAGA_OPERATION: 'Giao dịch đa bảng bị ngắt giữa chừng',
  SCHEMA_INVALID_ROW: 'Dòng dữ liệu trên Google Sheets sai định dạng cột',
};

export const EMAIL_TEMPLATE_CODES = [
  'ACCOUNT_ACTIVATED',
  'ACCOUNT_REVOKED',
  'INTERVIEW_INVITATION',
  'PROBATION_TO_OFFICIAL',
  'SCHEDULE_SHIFT_DECISION',
  'LEAVE_SWAP_DECISION',
  'EMERGENCY_LEAVE_ALERT',
  'TEST_ASSIGNED',
  'PAYSLIP_PUBLISHED',
  'INTERNAL_ANNOUNCEMENT',
  'SYSTEM_RECONCILIATION_REPORT',
] as const;
export type EmailTemplateCode = (typeof EMAIL_TEMPLATE_CODES)[number];

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateCode, string> = {
  ACCOUNT_ACTIVATED: 'Thông báo kích hoạt tài khoản hệ thống',
  ACCOUNT_REVOKED: 'Thông báo thu hồi quyền truy cập tài khoản',
  INTERVIEW_INVITATION: 'Thư mời tham dự phỏng vấn tuyển dụng',
  PROBATION_TO_OFFICIAL: 'Quyết định công nhận Nhân viên Chính thức',
  SCHEDULE_SHIFT_DECISION: 'Thông báo phân ca & duyệt lịch làm việc',
  LEAVE_SWAP_DECISION: 'Thông báo kết quả duyệt Nghỉ OFF / Đổi ca / Bù công',
  EMERGENCY_LEAVE_ALERT: 'Cảnh báo nhân sự báo nghỉ khẩn cấp trong ca',
  TEST_ASSIGNED: 'Thông báo giao bài kiểm tra nghiệp vụ (TEST)',
  PAYSLIP_PUBLISHED: 'Thông báo phát hành phiếu lương kỳ mới',
  INTERNAL_ANNOUNCEMENT: 'Bản tin truyền thông & Chính sách nội bộ',
  SYSTEM_RECONCILIATION_REPORT: 'Báo cáo đối soát toàn vẹn dữ liệu & sao lưu',
};

export const API_ERROR_CODES = [
  'VALIDATION_ERROR', 'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VERSION_CONFLICT',
  'ACCOUNT_LOCKED', 'RATE_LIMITED', 'SYNC_PENDING', 'BUSINESS_RULE_VIOLATION', 'REQUEST_ERROR', 'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const VALIDATION_ERROR_CODES = [
  'REQUIRED_FIELD', 'INVALID_FORMAT', 'INVALID_PHONE', 'INVALID_EMAIL', 'INVALID_DATE', 'INVALID_ENUM',
  'TOO_SHORT', 'TOO_LONG', 'OUT_OF_RANGE', 'INVALID_TYPE', 'DUPLICATE_VALUE', 'INVALID_VALUE',
] as const;
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export function toSelectOptions<T extends string>(values: readonly T[], labels: Record<T, string>): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export const ROLE_OPTIONS = toSelectOptions(ROLES, ROLE_LABELS);
export const ACCOUNT_STATUS_OPTIONS = toSelectOptions(ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS);
export const BRANCH_STATUS_OPTIONS = toSelectOptions(BRANCH_STATUSES, BRANCH_STATUS_LABELS);
export const EMPLOYEE_STAGE_OPTIONS = toSelectOptions(EMPLOYEE_STAGES, EMPLOYEE_STAGE_LABELS);
export const STAFF_GROUP_OPTIONS = toSelectOptions(STAFF_GROUPS, STAFF_GROUP_LABELS);
export const EMPLOYEE_STATUS_OPTIONS = toSelectOptions(EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS);
export const EMPLOYMENT_TYPE_OPTIONS = toSelectOptions(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS);
export const DEFAULT_SHIFT_OPTIONS = toSelectOptions(DEFAULT_SHIFT_CODES, DEFAULT_SHIFT_LABELS);
export const SCHEDULE_STATUS_OPTIONS = toSelectOptions(SCHEDULE_STATUSES, SCHEDULE_STATUS_LABELS);
export const REQUEST_STATUS_OPTIONS = toSelectOptions(REQUEST_STATUSES, REQUEST_STATUS_LABELS);
export const SHIFT_SWAP_STATUS_OPTIONS = toSelectOptions(SHIFT_SWAP_STATUSES, SHIFT_SWAP_STATUS_LABELS);
export const PAY_PERIOD_STATUS_OPTIONS = toSelectOptions(PAY_PERIOD_STATUSES, PAY_PERIOD_STATUS_LABELS);
