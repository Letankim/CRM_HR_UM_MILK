import { z } from 'zod';
import { toSelectOptions } from './enums.js';
import { zSystemColumns } from './schemas.js';

export const TICKET_DEPARTMENTS = ['FINANCE', 'HR', 'STORE', 'ADMIN', 'MKT'] as const;
export type TicketDepartment = (typeof TICKET_DEPARTMENTS)[number];

export const TICKET_DEPARTMENT_LABELS: Record<TicketDepartment, string> = {
  FINANCE: 'Bộ phận Kế toán & Tiền lương',
  HR: 'Phòng Nhân sự (HR)',
  STORE: 'Quản lý Cửa hàng / Chi nhánh',
  ADMIN: 'Quản trị Hệ thống & Tài khoản',
  MKT: 'Bộ phận Truyền thông Nội bộ',
};
export const TICKET_DEPARTMENT_OPTIONS = toSelectOptions(TICKET_DEPARTMENTS, TICKET_DEPARTMENT_LABELS);

export const TICKET_CATEGORIES = [
  'PAYSLIP_INQUIRY',
  'ATTENDANCE_SCHEDULE',
  'HR_POLICY',
  'STORE_OPERATION',
  'ACCOUNT_SYSTEM',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  PAYSLIP_INQUIRY: 'Thắc mắc Bảng lương & Phiếu lương',
  ATTENDANCE_SCHEDULE: 'Chấm công, Lịch ca & Phụ cấp đổi ca',
  HR_POLICY: 'Hồ sơ nhân sự, Thử việc & Chế độ',
  STORE_OPERATION: 'Vận hành & Phối hợp tại Cửa hàng',
  ACCOUNT_SYSTEM: 'Tài khoản, Đăng nhập & Kỹ thuật',
  OTHER: 'Đề xuất & Hỗ trợ nghiệp vụ khác',
};
export const TICKET_CATEGORY_OPTIONS = toSelectOptions(TICKET_CATEGORIES, TICKET_CATEGORY_LABELS);

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Thấp',
  NORMAL: 'Thông thường',
  HIGH: 'Ưu tiên cao',
  URGENT: 'Khẩn cấp',
};
export const TICKET_PRIORITY_OPTIONS = toSelectOptions(TICKET_PRIORITIES, TICKET_PRIORITY_LABELS);

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Chờ tiếp nhận',
  IN_PROGRESS: 'Đang xử lý',
  RESOLVED: 'Đã phản hồi / Giải quyết',
  CLOSED: 'Đã đóng phiếu',
};
export const TICKET_STATUS_OPTIONS = toSelectOptions(TICKET_STATUSES, TICKET_STATUS_LABELS);

export const zTicketMessage = z.object({
  id: z.string(),
  sender_user_id: z.string(),
  sender_name: z.string(),
  sender_role: z.string(),
  content: z.string(),
  created_at: z.string(),
});
export type TicketMessage = z.infer<typeof zTicketMessage>;

export const zSupportTicket = zSystemColumns.extend({
  ticket_code: z.string().min(1),
  requester_user_id: z.string().min(1),
  requester_employee_id: z.string().default(''),
  branch_id: z.string().default('ALL'),
  category: z.enum(TICKET_CATEGORIES).default('OTHER'),
  priority: z.enum(TICKET_PRIORITIES).default('NORMAL'),
  target_department: z.enum(TICKET_DEPARTMENTS).default('HR'),
  assignee_user_id: z.string().default(''),
  subject: z.string().min(1),
  description: z.string().min(1),
  related_entity_type: z.string().default(''),
  related_entity_id: z.string().default(''),
  related_label: z.string().default(''),
  status: z.enum(TICKET_STATUSES).default('OPEN'),
  messages_json: z.string().default('[]'),
  resolution_note: z.string().default(''),
  resolved_by: z.string().default(''),
  resolved_at: z.string().default(''),
  closed_at: z.string().default(''),
});
export type SupportTicket = z.infer<typeof zSupportTicket>;
