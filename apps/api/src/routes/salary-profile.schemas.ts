import { z } from 'zod';
import { PAY_RATE_TYPES, SYSTEM_CONFIG } from '@umbm/shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const D = SYSTEM_CONFIG.defaults;

/** Body tạo / điều chỉnh Hồ sơ lương cá nhân (dùng chung cho tạo hồ sơ nhân sự & màn Kỳ lương) */
export const zSalaryProfileFields = z.object({
  rate_type: z.enum(PAY_RATE_TYPES, { errorMap: () => ({ message: 'Hình thức tính lương không hợp lệ' }) }).default('HOURLY'),
  amount_vnd: z.coerce.number({ invalid_type_error: 'Mức lương phải là số' }).min(0, 'Mức lương không được âm'),
  probation_percent: z.coerce.number().min(1, 'Tỷ lệ lương thử việc tối thiểu 1%').max(100, 'Tỷ lệ lương thử việc tối đa 100%').default(D.probationSalaryPercent),
  effective_from: z.string().regex(DATE_RE, 'Ngày hiệu lực phải theo định dạng YYYY-MM-DD').optional(),
  standard_work_days: z.coerce.number().min(1, 'Công chuẩn tối thiểu 1 ngày').max(31, 'Công chuẩn tối đa 31 ngày').default(D.standardWorkDaysPerMonth),
  standard_hours_per_day: z.coerce.number().min(1).max(24).default(D.standardHoursPerDay),
  ot_multiplier: z.coerce.number().min(1, 'Hệ số tăng ca tối thiểu 1.0').max(5, 'Hệ số tăng ca tối đa 5.0').default(D.overtimeMultiplier),
  attendance_bonus_vnd: z.coerce.number().min(0).default(0),
  meal_allowance_per_shift_vnd: z.coerce.number().min(0).default(0),
  transport_allowance_vnd: z.coerce.number().min(0).default(0),
  responsibility_allowance_vnd: z.coerce.number().min(0).default(0),
  other_allowance_vnd: z.coerce.number().min(0).default(0),
  change_reason: z.string().trim().max(200).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});
export type SalaryProfileFields = z.infer<typeof zSalaryProfileFields>;

export const zCreateSalaryProfileBody = zSalaryProfileFields.extend({
  employee_id: z.string({ required_error: 'Vui lòng chọn nhân sự' }).trim().min(1, 'Vui lòng chọn nhân sự'),
});

export const zUpdateSalaryProfileBody = zSalaryProfileFields.partial().extend({
  version: z.coerce.number().int().min(1),
});

/** Mức lương tối thiểu theo hình thức (chặn nhập nhầm đơn vị: nhập lương tháng vào ô lương giờ...) */
export const MIN_AMOUNT_BY_TYPE: Record<(typeof PAY_RATE_TYPES)[number], { min: number; message: string }> = {
  HOURLY: { min: 1_000, message: 'Đơn giá theo giờ tối thiểu 1.000 đ' },
  SHIFT: { min: 10_000, message: 'Đơn giá theo ca tối thiểu 10.000 đ' },
  MONTHLY: { min: 100_000, message: 'Lương tháng tối thiểu 100.000 đ' },
};
export const MAX_AMOUNT_BY_TYPE: Record<(typeof PAY_RATE_TYPES)[number], { max: number; message: string }> = {
  HOURLY: { max: 2_000_000, message: 'Đơn giá theo giờ vượt quá 2.000.000 đ, vui lòng kiểm tra lại đơn vị (giờ / tháng)' },
  SHIFT: { max: 10_000_000, message: 'Đơn giá theo ca vượt quá 10.000.000 đ, vui lòng kiểm tra lại' },
  MONTHLY: { max: 500_000_000, message: 'Lương tháng vượt quá 500.000.000 đ, vui lòng kiểm tra lại' },
};
