import { z } from 'zod';
import { REQUEST_STATUSES, SCHEDULE_STATUSES, SHIFT_SWAP_STATUSES } from './roles.js';
import { zBool, zSystemColumns } from './schemas.js';

/**
 * Schema đầy đủ cho Phiếu lương, Lịch tuần, Nghỉ OFF, Đổi ca 3 bước, Nghỉ khẩn,
 * Chấm công GPS bất biến, Điều chỉnh công, Tuyển dụng, Phỏng vấn, Thi TEST,
 * Chính sách, Bảo trì, Cài đặt & Truyền thông nội bộ theo chuẩn V5.1.
 */

const enumOrDefault = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s === '' || s === null || s === undefined || !values.includes(String(s)) ? fallback : s;
  }, z.enum(values));

export const zPayslip = zSystemColumns.extend({
  period_id: z.string(),
  employee_id: z.string(),
  snapshot_id: z.string().default(''),
  revision: z.preprocess((v) => (v === '' || v === null || v === undefined || Number(v) < 1 ? 1 : Number(v)), z.number().int().min(1)),
  status: enumOrDefault(['DRAFT', 'PUBLISHED', 'REVISED', 'PAID'] as const, 'PUBLISHED'),
  published_at: z.string().default(''),
  payslip_code: z.string().default(''),
  period_name: z.string().default(''),
  from_date: z.string().default(''),
  to_date: z.string().default(''),
  employee_code: z.string().default(''),
  full_name: z.string().default(''),
  branch_id: z.string().default(''),
  branch_name: z.string().default(''),
  stage: z.string().default(''),
  total_shifts_count: z.coerce.number().int().min(0).default(0),
  approved_hours: z.coerce.number().min(0).default(0),
  ot_hours: z.coerce.number().min(0).default(0),
  base_salary_vnd: z.coerce.number().min(0).default(0),
  ot_pay_vnd: z.coerce.number().min(0).default(0),
  total_allowances_vnd: z.coerce.number().min(0).default(0),
  total_bonus_vnd: z.coerce.number().min(0).default(0),
  total_adjustments_vnd: z.coerce.number().default(0),
  total_deductions_vnd: z.coerce.number().min(0).default(0),
  gross_vnd: z.coerce.number().min(0).default(0),
  net_vnd: z.coerce.number().min(0).default(0),
  breakdown_json: z.string().default('{}'),
  viewed_by_employee_at: z.string().default(''),
  employee_confirmed_at: z.string().default(''),
  dispute_status: enumOrDefault(['NONE', 'OPEN', 'RESOLVED'] as const, 'NONE'),
  dispute_reason: z.string().default(''),
  pdf_drive_file_id: z.string().default(''),
});
export type Payslip = z.infer<typeof zPayslip>;

export const zScheduleWeek = zSystemColumns.extend({
  branch_id: z.string(),
  week_start: z.string(),
  status: z.enum(SCHEDULE_STATUSES).default('DRAFT'),
  published_by: z.string().default(''),
  published_at: z.string().default(''),
  code: z.string().default(''),
  schedule_kind: z.enum(['WEEKLY', 'PROBATION_12_DAYS']).default('WEEKLY'),
  week_end: z.string().default(''),
  store_confirmed_by: z.string().default(''),
  store_confirmed_at: z.string().default(''),
  locked_at: z.string().default(''),
  note: z.string().default(''),
});
export type ScheduleWeek = z.infer<typeof zScheduleWeek>;

export const zLeaveRequest = zSystemColumns.extend({
  employee_id: z.string(),
  branch_id: z.string(),
  leave_date: z.string(),
  kind: z.enum(['PROBATION_OFF', 'WEEKLY_OFF', 'UNPAID_LEAVE']).default('WEEKLY_OFF'),
  reason: z.string().default(''),
  status: z.enum(REQUEST_STATUSES).default('PENDING'),
  decided_by: z.string().default(''),
  decision_reason: z.string().default(''),
  request_code: z.string().default(''),
  employee_stage: z.string().default('PROBATION'),
  schedule_week_id: z.string().default(''),
  assignment_id: z.string().default(''),
  shift_code: z.string().default('CA_SANG'),
  quota_cycle_used: z.coerce.number().int().default(1),
  quota_cycle_limit: z.coerce.number().int().default(5),
  staffing_after_leave: z.coerce.number().int().default(2),
  min_staff_required: z.coerce.number().int().default(2),
  submitted_at: z.string().default(''),
  store_reviewed_by: z.string().default(''),
  store_reviewed_at: z.string().default(''),
  decided_at: z.string().default(''),
});
export type LeaveRequest = z.infer<typeof zLeaveRequest>;

export const zShiftSwap = zSystemColumns.extend({
  requester_id: z.string(),
  peer_id: z.string(),
  from_assignment_id: z.string(),
  to_assignment_id: z.string().default(''),
  reason: z.string().default(''),
  status: z.enum(SHIFT_SWAP_STATUSES).default('PENDING_PEER'),
  peer_responded_at: z.string().default(''),
  decided_by: z.string().default(''),
  decision_reason: z.string().default(''),
  allowance_eligible: zBool.default(false),
  swap_code: z.string().default(''),
  branch_id: z.string().default(''),
  from_work_date: z.string().default(''),
  from_shift_code: z.string().default('CA_SANG'),
  to_work_date: z.string().default(''),
  to_shift_code: z.string().default('CA_CHIEU'),
  has_conflict: zBool.default(false),
  staffing_valid: zBool.default(true),
  requested_at: z.string().default(''),
  peer_note: z.string().default(''),
  decided_at: z.string().default(''),
  allowance_amount_vnd: z.coerce.number().int().default(30000),
  /** SWAP = đổi 2 ca giữa 2 người (đồng nghiệp đồng ý là đổi ngay); GIVE = nhường ca cho người khác */
  kind: enumOrDefault(['SWAP', 'GIVE'] as const, 'GIVE'),
  /** true khi người nhận ca sẽ vượt quá 2 ca/ngày — bắt buộc HR phê duyệt */
  requires_hr_approval: zBool.default(false),
});
export type ShiftSwap = z.infer<typeof zShiftSwap>;
export type ShiftSwapKind = ShiftSwap['kind'];

export const zAttendanceEvent = zSystemColumns.extend({
  idempotency_key: z.string(),
  employee_id: z.string(),
  assignment_id: z.string().default(''),
  branch_id: z.string(),
  type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
  server_time: z.string(),
  lat: z.coerce.number().default(0),
  lng: z.coerce.number().default(0),
  accuracy_m: z.coerce.number().default(15),
  distance_m: z.coerce.number().default(0),
  within_radius: zBool.default(true),
  photo_id: z.string().default(''),
  photo_sha256: z.string().default(''),
  device_info: z.string().default(''),
  result: z.enum(['VALID', 'OUT_OF_RADIUS', 'LOW_ACCURACY', 'LATE', 'EARLY_LEAVE']).default('VALID'),
  work_date: z.string().default(''),
  shift_code: z.string().default('CA_SANG'),
  scheduled_time: z.string().default('07:00'),
  late_minutes: z.coerce.number().int().default(0),
  early_leave_minutes: z.coerce.number().int().default(0),
  allowed_radius_m: z.coerce.number().default(100),
  gps_status: z.string().default('OK'),
  photo_drive_file_id: z.string().default(''),
  ip_address: z.string().default(''),
  anomaly_flags_json: z.string().default('[]'),
  note: z.string().default(''),
});
export type AttendanceEvent = z.infer<typeof zAttendanceEvent>;

export const zAttendanceAdjustment = zSystemColumns.extend({
  event_id: z.string().default(''),
  assignment_id: z.string().default(''),
  employee_id: z.string(),
  kind: z.enum(['FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'GPS_ERROR', 'CAMERA_ERROR', 'OTHER']).default('FORGOT_CHECK_IN'),
  requested_time: z.string().default(''),
  reason: z.string(),
  evidence_file_id: z.string().default(''),
  store_confirmed_by: z.string().default(''),
  store_confirmed_at: z.string().default(''),
  hr_decision: z.string().default('PENDING'),
  decided_by: z.string().default(''),
  decision_reason: z.string().default(''),
  adjustment_code: z.string().default(''),
  record_id: z.string().default(''),
  branch_id: z.string().default(''),
  work_date: z.string().default(''),
  shift_code: z.string().default('CA_SANG'),
  exception_source: z.string().default('EMPLOYEE'),
  requested_check_in_at: z.string().default('07:00'),
  requested_check_out_at: z.string().default('12:00'),
  requested_hours: z.coerce.number().default(5),
  status: z.enum(['PENDING', 'STORE_CONFIRMED', 'APPROVED', 'REJECTED']).default('PENDING'),
  store_note: z.string().default(''),
  decided_at: z.string().default(''),
  applied_to_record: zBool.default(false),
  /** CHECK_IN = lỗi Vào ca, CHECK_OUT = lỗi Ra ca (kể cả quá hạn 3 giờ), FULL_SHIFT = bù công cả ca */
  punch_type: enumOrDefault(['CHECK_IN', 'CHECK_OUT', 'FULL_SHIFT'] as const, 'FULL_SHIFT'),
});
export type AttendanceAdjustment = z.infer<typeof zAttendanceAdjustment>;
export type AdjustmentPunchType = AttendanceAdjustment['punch_type'];
