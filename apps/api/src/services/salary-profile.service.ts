import {
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  SALARY_PROFILE_STATUS_LABELS,
  type Employee,
  type PayRate,
} from '@umbm/shared';
import type { Database } from '../data/database.js';
import { dayjs } from '../lib/time.js';

/**
 * Dịch vụ Hồ sơ lương cá nhân (effective-dated).
 * Mỗi nhân sự có chuỗi mức lương nối tiếp nhau theo ngày hiệu lực; không ghi đè lịch sử.
 */

export const today = () => dayjs().format('YYYY-MM-DD');

export function profilesOf(db: Database, employeeId: string): PayRate[] {
  return db.payRates
    .filter((r) => r.employee_id === employeeId)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
}

/** Mức lương có hiệu lực tại ngày `date` (YYYY-MM-DD) */
export function resolveProfileAt(profiles: PayRate[], date: string): PayRate | undefined {
  return profiles.find((p) => p.effective_from <= date && (!p.effective_to || p.effective_to >= date));
}

/** Mức đang áp dụng hôm nay; nếu chưa tới hiệu lực thì trả về mức sắp hiệu lực gần nhất */
export function currentProfile(profiles: PayRate[]): PayRate | undefined {
  const now = today();
  return resolveProfileAt(profiles, now) ?? [...profiles].reverse().find((p) => p.effective_from > now);
}

export function profileStatus(p: PayRate | undefined): keyof typeof SALARY_PROFILE_STATUS_LABELS {
  if (!p) return 'MISSING';
  const now = today();
  if (p.effective_from > now) return 'SCHEDULED';
  if (p.effective_to && p.effective_to < now) return 'EXPIRED';
  return 'ACTIVE';
}

/** Giai đoạn của nhân sự tại một ngày cụ thể (thử việc / chính thức) */
export function isOfficialAt(emp: Employee, date: string): boolean {
  if (emp.official_from) return date >= emp.official_from;
  return emp.stage === 'OFFICIAL';
}

export function probationAmount(p: Pick<PayRate, 'amount_vnd' | 'probation_percent'>): number {
  return Math.round((p.amount_vnd * p.probation_percent) / 100);
}

export function mapSalaryProfile(p: PayRate, db: Database) {
  const emp = db.employees.get(p.employee_id);
  const status = profileStatus(p);
  return {
    id: p.id,
    employeeId: p.employee_id,
    employeeCode: emp?.employee_code ?? '',
    employeeName: emp?.full_name ?? 'Nhân sự đã xóa',
    rateType: p.rate_type,
    rateTypeLabel: PAY_RATE_TYPE_LABELS[p.rate_type],
    unitLabel: PAY_RATE_UNIT_LABELS[p.rate_type],
    amountVnd: p.amount_vnd,
    probationPercent: p.probation_percent,
    probationAmountVnd: probationAmount(p),
    standardWorkDays: p.standard_work_days,
    standardHoursPerDay: p.standard_hours_per_day,
    otMultiplier: p.ot_multiplier,
    attendanceBonusVnd: p.attendance_bonus_vnd,
    mealAllowancePerShiftVnd: p.meal_allowance_per_shift_vnd,
    transportAllowanceVnd: p.transport_allowance_vnd,
    responsibilityAllowanceVnd: p.responsibility_allowance_vnd,
    otherAllowanceVnd: p.other_allowance_vnd,
    effectiveFrom: p.effective_from,
    effectiveTo: p.effective_to || null,
    status,
    statusLabel: SALARY_PROFILE_STATUS_LABELS[status],
    stageAtCreation: p.stage,
    stageAtCreationLabel: EMPLOYEE_STAGE_LABELS[p.stage],
    changeReason: p.change_reason,
    note: p.note,
    approvedBy: db.users.get(p.approved_by)?.display_name || db.users.find((u) => u.username === p.approved_by)?.display_name || p.approved_by || 'Hệ thống nhân sự',
    approvedAt: p.approved_at || null,
    version: p.version,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** Kiểm tra mức lương đã được dùng để chốt kỳ lương (APPROVED / PUBLISHED / PAID) hay chưa */
export function isProfileLocked(db: Database, profileId: string): boolean {
  const lockedPeriodIds = new Set(
    db.payPeriods.filter((p) => p.status === 'APPROVED' || p.status === 'PUBLISHED' || p.status === 'PAID').map((p) => p.id),
  );
  return db.payrollSnapshots.filter((s) => lockedPeriodIds.has(s.period_id)).some((s) => {
    if (s.pay_rate_id === profileId) return true;
    try {
      const parsed = JSON.parse(s.adjustments_json || '{}') as { segments?: { rateId: string }[] };
      return (parsed.segments ?? []).some((seg) => seg.rateId === profileId);
    } catch {
      return false;
    }
  });
}

export const dayBefore = (date: string) => dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
