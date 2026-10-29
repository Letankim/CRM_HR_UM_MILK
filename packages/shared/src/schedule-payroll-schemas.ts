import { z } from 'zod';
import { EMPLOYEE_STAGES, toSelectOptions } from './enums.js';
import { zSystemColumns } from './schemas.js';

export const PAY_RATE_TYPES = ['HOURLY', 'MONTHLY', 'SHIFT'] as const;
export type PayRateType = (typeof PAY_RATE_TYPES)[number];

export const PAY_RATE_TYPE_LABELS: Record<PayRateType, string> = {
  HOURLY: 'Theo giờ',
  MONTHLY: 'Theo tháng (lương cứng)',
  SHIFT: 'Theo ca',
};
export const PAY_RATE_TYPE_OPTIONS = toSelectOptions(PAY_RATE_TYPES, PAY_RATE_TYPE_LABELS);

/** Đơn vị hiển thị sau mức lương: "28.000 đ/giờ", "8.500.000 đ/tháng" */
export const PAY_RATE_UNIT_LABELS: Record<PayRateType, string> = {
  HOURLY: 'giờ',
  MONTHLY: 'tháng',
  SHIFT: 'ca',
};

export const SALARY_PROFILE_STATUS_LABELS: Record<'ACTIVE' | 'EXPIRED' | 'SCHEDULED' | 'MISSING', string> = {
  ACTIVE: 'Đang áp dụng',
  EXPIRED: 'Đã hết hiệu lực',
  SCHEDULED: 'Chờ hiệu lực',
  MISSING: 'Chưa thiết lập lương',
};

/** Nguồn dữ liệu công dùng để tính lương (ghi vào snapshot để truy vết) */
export const PAYROLL_WORK_SOURCE_LABELS = {
  ATTENDANCE_CONFIRMED: 'Bảng công đã xác nhận',
  SCHEDULE_PUBLISHED: 'Lịch làm việc đã phát hành',
} as const;

export const SHIFT_ASSIGNMENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'SWAPPED',
  'ON_LEAVE',
  'COMPLETED',
  'ABSENT',
] as const;
export type ShiftAssignmentStatus = (typeof SHIFT_ASSIGNMENT_STATUSES)[number];

export const SHIFT_ASSIGNMENT_STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
  DRAFT: 'Chờ duyệt phân ca',
  PUBLISHED: 'Đã phân ca chính thức',
  SWAPPED: 'Đã đổi ca',
  ON_LEAVE: 'Nghỉ phép (OFF)',
  COMPLETED: 'Đã hoàn thành ca',
  ABSENT: 'Vắng mặt',
};
export const SHIFT_ASSIGNMENT_STATUS_OPTIONS = toSelectOptions(
  SHIFT_ASSIGNMENT_STATUSES,
  SHIFT_ASSIGNMENT_STATUS_LABELS,
);

export const PAYROLL_ITEM_TYPES = [
  'BONUS_ATTENDANCE',
  'BONUS_KPI',
  'BONUS_SALES',
  'ALLOWANCE_MEAL',
  'ALLOWANCE_RESPONSIBILITY',
  'ALLOWANCE_SWAP',
  'ADJUSTMENT_ADD',
  'DEDUCTION_APPROVED',
  'ADVANCE_DEDUCTION',
] as const;
export type PayrollItemType = (typeof PAYROLL_ITEM_TYPES)[number];

export const PAYROLL_ITEM_TYPE_LABELS: Record<PayrollItemType, string> = {
  BONUS_ATTENDANCE: 'Thưởng chuyên cần',
  BONUS_KPI: 'Thưởng hiệu suất (KPI)',
  BONUS_SALES: 'Thưởng doanh số',
  ALLOWANCE_MEAL: 'Phụ cấp ăn ca',
  ALLOWANCE_RESPONSIBILITY: 'Phụ cấp trách nhiệm',
  ALLOWANCE_SWAP: 'Phụ cấp nhận đổi ca (30.000đ)',
  ADJUSTMENT_ADD: 'Bổ sung lương cộng (+)',
  DEDUCTION_APPROVED: 'Khấu trừ đã phê duyệt (-)',
  ADVANCE_DEDUCTION: 'Khấu trừ tạm ứng (-)',
};
export const PAYROLL_ITEM_TYPE_OPTIONS = toSelectOptions(
  PAYROLL_ITEM_TYPES,
  PAYROLL_ITEM_TYPE_LABELS,
);

export const zShiftAssignment = zSystemColumns.extend({
  schedule_week_id: z.string().default(''),
  employee_id: z.string().min(1),
  branch_id: z.string().min(1),
  work_date: z.string().min(1),
  shift_template_id: z.string().default(''),
  start_at: z.string().default('07:00'),
  end_at: z.string().default('12:00'),
  status: z.enum(SHIFT_ASSIGNMENT_STATUSES).default('DRAFT'),
  source: z.string().default('MANUAL'),
  employee_stage: z.enum(EMPLOYEE_STAGES).default('PROBATION'),
  day_type: z.enum(['WORK', 'OFF', 'OT']).default('WORK'),
  shift_code: z.string().default('CA_SANG'),
  scheduled_hours: z.coerce.number().min(0).default(5),
  swapped_from_employee_id: z.string().default(''),
  replacement_for_employee_id: z.string().default(''),
  published_at: z.string().default(''),
  note: z.string().default(''),
});
export type ShiftAssignment = z.infer<typeof zShiftAssignment>;

export const zPayrollItem = zSystemColumns.extend({
  period_id: z.string().min(1),
  employee_id: z.string().min(1),
  branch_id: z.string().default(''),
  work_date: z.string().default(''),
  item_type: z.enum(PAYROLL_ITEM_TYPES).default('BONUS_ATTENDANCE'),
  category_code: z.string().default('BONUS'),
  title: z.string().min(1),
  direction: z.enum(['ADD', 'DEDUCT']).default('ADD'),
  quantity: z.coerce.number().min(0).default(1),
  unit_amount_vnd: z.coerce.number().min(0).default(0),
  total_amount_vnd: z.coerce.number().min(0).default(0),
  source_ref_id: z.string().default(''),
  policy_version: z.string().default('v5.1'),
  approval_status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('APPROVED'),
  approved_by: z.string().default(''),
  approved_at: z.string().default(''),
  note: z.string().default(''),
});
export type PayrollItem = z.infer<typeof zPayrollItem>;

/** Phiên bản điều chỉnh phiếu lương sau PUBLISHED (không sửa đè phiếu gốc) */
export const zPayslipRevision = zSystemColumns.extend({
  payslip_id: z.string().min(1),
  revision: z.coerce.number().int().min(1),
  reason: z.string().min(1),
  delta_vnd: z.coerce.number(),
  created_reason_by: z.string().default(''),
  period_id: z.string().default(''),
  employee_id: z.string().default(''),
  field_changed: z.string().default('ADJUSTMENT'),
  before_amount_vnd: z.coerce.number().default(0),
  after_amount_vnd: z.coerce.number().default(0),
  details_json: z.string().default('{}'),
  status: z.enum(['APPROVED', 'REJECTED']).default('APPROVED'),
  approved_by: z.string().default(''),
  approved_at: z.string().default(''),
});
export type PayslipRevision = z.infer<typeof zPayslipRevision>;

export const PAYSLIP_STATUS_LABELS: Record<'DRAFT' | 'PUBLISHED' | 'REVISED' | 'PAID', string> = {
  DRAFT: 'Nháp',
  PUBLISHED: 'Đã phát hành',
  REVISED: 'Đã thay thế bằng bản điều chỉnh',
  PAID: 'Đã thanh toán',
};
