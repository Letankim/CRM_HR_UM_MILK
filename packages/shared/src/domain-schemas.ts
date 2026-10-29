import { z } from 'zod';
import { PAY_PERIOD_STATUSES } from './roles.js';
import { EMPLOYEE_STAGES, STAFF_GROUPS } from './enums.js';
import { zSystemColumns } from './schemas.js';
import { SYSTEM_CONFIG } from './system-config.js';

export * from './domain-workflow-schemas.js';
export * from './domain-comms-test-schemas.js';

/**
 * Bộ Schema chuẩn xác cho Hồ sơ Nhân sự, Lịch ca, Chấm công, Kỳ lương Snapshot & Phiếu lương
 * theo đúng tài liệu bàn giao IT V5.1 (UM_BO_MILK_HR_V5_1_HOAN_CHINH_BAN_GIAO_IT.pdf).
 */

const nonEmptyOrDefault = (fallback: string) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? fallback : v ?? fallback), z.string().trim().min(1));

const enumOrDefault = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return (values as readonly string[]).includes(s) ? s : fallback;
  }, z.enum(values));

export const zEmployee = zSystemColumns.extend({
  employee_code: z.string().min(2),
  full_name: z.string().min(2),
  phone: z.string().default(''),
  branch_id: z.string().default(''),
  staff_group: nonEmptyOrDefault('BARISTA'),
  stage: enumOrDefault(EMPLOYEE_STAGES, 'PROBATION'),
  probation_start: z.string().default(''),
  probation_end: z.string().default(''),
  official_from: z.string().default(''),
  status: enumOrDefault(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'SUSPENDED'] as const, 'ACTIVE'),
  user_id: z.string().default(''),
  candidate_id: z.string().default(''),
  email: z.string().default(''),
  date_of_birth: z.string().default(''),
  gender: z.string().default(''),
  citizen_id: z.string().default(''),
  citizen_issue_date: z.string().default(''),
  permanent_address: z.string().default(''),
  current_address: z.string().default(''),
  emergency_contact_name: z.string().default(''),
  emergency_contact_phone: z.string().default(''),
  position_title: z.string().default(''),
  employment_type: enumOrDefault(['FULL_TIME', 'PART_TIME', 'PROBATION'] as const, 'PROBATION'),
  default_shift_code: z.string().default('CA_SANG'),
  probation_cycle_days: z.coerce.number().int().default(12),
  probation_work_days: z.coerce.number().int().default(7),
  probation_off_days: z.coerce.number().int().default(5),
  resigned_at: z.string().default(''),
  resign_reason: z.string().default(''),
  bank_name: z.string().default(''),
  bank_account_number: z.string().default(''),
  bank_account_holder: z.string().default(''),
  tax_code: z.string().default(''),
  base_hourly_rate_vnd: z.coerce.number().min(0).default(0),
  note: z.string().default(''),
});
export type Employee = z.infer<typeof zEmployee>;

export const zEmployeeStageHistory = zSystemColumns.extend({
  employee_id: z.string(),
  from_stage: z.string().default('PROBATION'),
  to_stage: z.string().default('OFFICIAL'),
  effective_from: z.string(),
  decided_by: z.string().default(''),
  note: z.string().default(''),
  change_type: z.string().default('PROMOTE_OFFICIAL'),
  from_branch_id: z.string().default(''),
  to_branch_id: z.string().default(''),
  from_shift_code: z.string().default(''),
  to_shift_code: z.string().default(''),
  probation_hours_completed: z.coerce.number().default(0),
  test_score_percent: z.coerce.number().default(0),
  evaluation_summary: z.string().default(''),
  approved_by: z.string().default(''),
});
export type EmployeeStageHistory = z.infer<typeof zEmployeeStageHistory>;

/**
 * Hồ sơ lương CÁ NHÂN theo từng nhân sự (bảng PAY_RATES), có ngày hiệu lực (effective-dated).
 * - amount_vnd: mức lương CHÍNH THỨC theo đơn vị (giờ / tháng / ca).
 * - probation_percent: % lương áp dụng trong giai đoạn thử việc (ví dụ 85%).
 * - Mỗi lần điều chỉnh lương tạo 1 dòng mới; dòng cũ được đóng effective_to (không sửa đè lịch sử).
 */
const positiveOrDefault = (fallback: number, min = 1, max?: number) =>
  z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = Number(val);
    return Number.isNaN(n) || n < min ? fallback : n;
  }, max !== undefined ? z.number().min(min).max(max) : z.number().min(min));

export const zPayRate = zSystemColumns.extend({
  employee_id: z.string().trim().min(1),
  rate_type: enumOrDefault(['HOURLY', 'SHIFT', 'MONTHLY'] as const, 'HOURLY'),
  amount_vnd: z.coerce.number().min(0),
  effective_from: z.string().transform((v) => v.trim().slice(0, 10)),
  effective_to: z.string().default('').transform((v) => v.trim().slice(0, 10)),
  approved_by: z.string().default(''),
  stage: enumOrDefault(EMPLOYEE_STAGES, 'PROBATION'),
  staff_group: nonEmptyOrDefault('BARISTA'),
  ot_multiplier: positiveOrDefault(SYSTEM_CONFIG.defaults.overtimeMultiplier, 1),
  night_shift_allowance_vnd: z.coerce.number().min(0).default(0),
  attendance_bonus_vnd: z.coerce.number().min(0).default(0),
  meal_allowance_per_shift_vnd: z.coerce.number().min(0).default(0),
  transport_allowance_vnd: z.coerce.number().min(0).default(0),
  responsibility_allowance_vnd: z.coerce.number().min(0).default(0),
  approved_at: z.string().default(''),
  status: enumOrDefault(['ACTIVE', 'EXPIRED'] as const, 'ACTIVE'),
  note: z.string().default(''),
  probation_percent: positiveOrDefault(SYSTEM_CONFIG.defaults.probationSalaryPercent, 1, 100),
  standard_work_days: positiveOrDefault(SYSTEM_CONFIG.defaults.standardWorkDaysPerMonth, 1, 31),
  standard_hours_per_day: positiveOrDefault(SYSTEM_CONFIG.defaults.standardHoursPerDay, 1, 24),
  other_allowance_vnd: z.coerce.number().min(0).default(0),
  change_reason: z.string().default(''),
  previous_rate_id: z.string().default(''),
});
export type PayRate = z.infer<typeof zPayRate>;

export const zPayPeriod = zSystemColumns.extend({
  name: z.string(),
  from_date: z.string(),
  to_date: z.string(),
  status: z.enum(PAY_PERIOD_STATUSES).default('DRAFT'),
  snapshot_hash: z.string().default(''),
  approved_by: z.string().default(''),
  published_at: z.string().default(''),
  paid_at: z.string().default(''),
  period_code: z.string().default(''),
  month_key: z.string().default(''),
  branch_scope: z.string().default('ALL'),
  total_employees: z.coerce.number().int().min(0).default(0),
  total_approved_hours: z.coerce.number().min(0).default(0),
  total_ot_hours: z.coerce.number().min(0).default(0),
  total_gross_vnd: z.coerce.number().min(0).default(0),
  total_deductions_vnd: z.coerce.number().min(0).default(0),
  total_net_vnd: z.coerce.number().min(0).default(0),
  unreconciled_records_count: z.coerce.number().int().min(0).default(0),
  reconciled_by: z.string().default(''),
  reconciled_at: z.string().default(''),
  approved_at: z.string().default(''),
  published_by: z.string().default(''),
  paid_by: z.string().default(''),
  note: z.string().default(''),
});
export type PayPeriod = z.infer<typeof zPayPeriod>;

export const zPayrollSnapshot = zSystemColumns.extend({
  period_id: z.string(),
  employee_id: z.string(),
  approved_hours: z.coerce.number().min(0),
  rate_vnd: z.coerce.number().min(0),
  ot_hours: z.coerce.number().min(0).default(0),
  allowances_json: z.string().default('[]'),
  adjustments_json: z.string().default('[]'),
  gross_vnd: z.coerce.number().min(0),
  net_vnd: z.coerce.number().min(0),
  data_hash: z.string(),
  period_code: z.string().default(''),
  employee_code: z.string().default(''),
  full_name: z.string().default(''),
  branch_id: z.string().default(''),
  branch_name: z.string().default(''),
  staff_group: z.string().default(''),
  stage: z.string().default(''),
  pay_rate_id: z.string().default(''),
  probation_hours: z.coerce.number().min(0).default(0),
  probation_hourly_rate_vnd: z.coerce.number().min(0).default(0),
  probation_pay_vnd: z.coerce.number().min(0).default(0),
  official_hours: z.coerce.number().min(0).default(0),
  official_hourly_rate_vnd: z.coerce.number().min(0).default(0),
  official_pay_vnd: z.coerce.number().min(0).default(0),
  total_shifts_count: z.coerce.number().int().min(0).default(0),
  base_salary_vnd: z.coerce.number().min(0).default(0),
  ot_rate_vnd: z.coerce.number().min(0).default(0),
  ot_pay_vnd: z.coerce.number().min(0).default(0),
  shift_swap_count: z.coerce.number().int().min(0).default(0),
  shift_swap_allowance_vnd: z.coerce.number().min(0).default(0),
  meal_allowance_vnd: z.coerce.number().min(0).default(0),
  transport_allowance_vnd: z.coerce.number().min(0).default(0),
  attendance_bonus_vnd: z.coerce.number().min(0).default(0),
  kpi_bonus_vnd: z.coerce.number().min(0).default(0),
  other_allowances_vnd: z.coerce.number().min(0).default(0),
  positive_adjustments_vnd: z.coerce.number().min(0).default(0),
  approved_deductions_vnd: z.coerce.number().min(0).default(0),
  advance_deduction_vnd: z.coerce.number().min(0).default(0),
  late_count: z.coerce.number().int().min(0).default(0),
  late_minutes_total: z.coerce.number().int().min(0).default(0),
  bank_name: z.string().default(''),
  bank_account_number: z.string().default(''),
  bank_account_holder: z.string().default(''),
  snapshot_at: z.string().default(''),
});
export type PayrollSnapshot = z.infer<typeof zPayrollSnapshot>;
