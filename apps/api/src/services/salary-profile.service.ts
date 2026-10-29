import {
  EMPLOYEE_STAGE_LABELS,
  PAY_PERIOD_STATUS_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  SALARY_PROFILE_STATUS_LABELS,
  SYSTEM_CONFIG,
  type Employee,
  type PayPeriod,
  type PayRate,
} from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';

/**
 * Dịch vụ Hồ sơ lương cá nhân (effective-dated).
 * Mỗi nhân sự có chuỗi mức lương nối tiếp nhau theo ngày hiệu lực; không ghi đè lịch sử.
 */

export const today = () => dayjs().format('YYYY-MM-DD');
const normDate = (v?: string) => (v ?? '').trim().slice(0, 10);

export function findEmployeeByIdOrCode(db: Database, idOrCode: string): Employee | undefined {
  const token = (idOrCode ?? '').trim();
  if (!token) return undefined;
  return (
    db.employees.get(token) ??
    db.employees.find((e) => e.employee_code.trim().toUpperCase() === token.toUpperCase() || Boolean(e.user_id && e.user_id === token))
  );
}

export function matchesEmployeeRef(emp: Employee | undefined, rawRef: string, candidateRef: string): boolean {
  const ref = (rawRef ?? '').trim();
  const cand = (candidateRef ?? '').trim();
  if (!ref || !cand) return false;
  if (ref === cand || ref.toUpperCase() === cand.toUpperCase()) return true;
  if (!emp) return false;
  return cand === emp.id || cand.toUpperCase() === emp.employee_code.trim().toUpperCase() || Boolean(emp.user_id && cand === emp.user_id);
}

export function profilesOf(db: Database, employeeId: string): PayRate[] {
  const emp = findEmployeeByIdOrCode(db, employeeId);
  return db.payRates
    .filter((r) => matchesEmployeeRef(emp, employeeId, r.employee_id))
    .sort((a, b) => {
      const af = normDate(a.effective_from), bf = normDate(b.effective_from);
      return af < bf ? 1 : af > bf ? -1 : b.updated_at.localeCompare(a.updated_at);
    });
}

/** Tự động đồng bộ dòng PAY_RATES cho hồ sơ nhân sự cũ / hệ thống có sẵn base_hourly_rate_vnd nhưng chưa có bản ghi PAY_RATES */
export async function ensureLegacySalaryProfiles(db: Database, actorId = 'system-sync'): Promise<void> {
  const allRates = db.payRates.all(true);
  for (const emp of db.employees.all()) {
    if ((emp.base_hourly_rate_vnd ?? 0) < 10_000) continue;
    if (allRates.some((r) => matchesEmployeeRef(emp, emp.id, r.employee_id))) continue;
    await db.payRates.insert({
      employee_id: emp.id, rate_type: 'HOURLY', amount_vnd: Math.round(emp.base_hourly_rate_vnd),
      effective_from: normDate(emp.probation_start) || '2026-01-01', effective_to: '',
      approved_by: actorId, approved_at: nowIso(), stage: emp.stage, staff_group: emp.staff_group || 'BARISTA',
      ot_multiplier: SYSTEM_CONFIG.defaults.overtimeMultiplier, night_shift_allowance_vnd: 0,
      attendance_bonus_vnd: 0, meal_allowance_per_shift_vnd: 0, transport_allowance_vnd: 0,
      responsibility_allowance_vnd: 0, other_allowance_vnd: 0,
      probation_percent: SYSTEM_CONFIG.defaults.probationSalaryPercent,
      standard_work_days: SYSTEM_CONFIG.defaults.standardWorkDaysPerMonth,
      standard_hours_per_day: SYSTEM_CONFIG.defaults.standardHoursPerDay,
      status: 'ACTIVE', change_reason: 'Đồng bộ hồ sơ lương ban đầu từ hồ sơ nhân sự', previous_rate_id: '', note: '',
    }, actorId);
  }
}

/**
 * Mức lương có hiệu lực tại ngày `date` (YYYY-MM-DD).
 * Nếu ngày công sớm hơn ngày hiệu lực của mức lương đầu tiên (ví dụ thiết lập lương lần đầu giữa kỳ),
 * tự động áp dụng mức lương khởi tạo đầu tiên của nhân sự đó (trừ khi mức đó đã hết hạn trước ngày công).
 */
export function resolveProfileAt(profiles: PayRate[], date: string): PayRate | undefined {
  const d = normDate(date);
  if (!d || profiles.length === 0) return undefined;
  const exact = profiles.find((p) => {
    const from = normDate(p.effective_from), to = normDate(p.effective_to);
    return from <= d && (!to || to >= d);
  });
  if (exact) return exact;
  const earliest = profiles[profiles.length - 1];
  if (!earliest) return undefined;
  const eFrom = normDate(earliest.effective_from), eTo = normDate(earliest.effective_to);
  return d < eFrom && (!eTo || eTo >= d) ? earliest : undefined;
}

/** Mức đang áp dụng hôm nay; nếu chưa tới hiệu lực thì trả về mức sắp hiệu lực gần nhất */
export function currentProfile(profiles: PayRate[]): PayRate | undefined {
  const now = today();
  const exact = profiles.find((p) => {
    const from = normDate(p.effective_from), to = normDate(p.effective_to);
    return from <= now && (!to || to >= now);
  });
  return exact ?? [...profiles].reverse().find((p) => normDate(p.effective_from) > now);
}

export function profileStatus(p: PayRate | undefined): keyof typeof SALARY_PROFILE_STATUS_LABELS {
  if (!p) return 'MISSING';
  const now = today(), from = normDate(p.effective_from), to = normDate(p.effective_to);
  if (from > now) return 'SCHEDULED';
  if (to && to < now) return 'EXPIRED';
  return 'ACTIVE';
}

/** Giai đoạn của nhân sự tại một ngày cụ thể (thử việc / chính thức) */
export function isOfficialAt(emp: Employee, date: string): boolean {
  const off = normDate(emp.official_from);
  if (off) return normDate(date) >= off;
  return emp.stage === 'OFFICIAL';
}

export function probationAmount(p: Pick<PayRate, 'amount_vnd' | 'probation_percent'>): number {
  return Math.round((p.amount_vnd * p.probation_percent) / 100);
}

export function mapSalaryProfile(p: PayRate, db: Database) {
  const emp = findEmployeeByIdOrCode(db, p.employee_id);
  const status = profileStatus(p);
  return {
    id: p.id,
    employeeId: emp?.id ?? p.employee_id,
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

/** Tìm kỳ lương đã chốt (APPROVED / PUBLISHED / PAID) bao phủ ngày công `workDate` */
export function findLockedPayrollPeriodForDate(db: Database, workDate: string): PayPeriod | undefined {
  if (!workDate) return undefined;
  return db.payPeriods.find(
    (p) =>
      (p.status === 'APPROVED' || p.status === 'PUBLISHED' || p.status === 'PAID') &&
      p.from_date <= workDate &&
      p.to_date >= workDate,
  );
}

/** Chặn mọi thao tác thêm/sửa/xóa ca làm việc, điểm danh hoặc đơn từ thuộc kỳ lương đã chốt */
export function assertDateNotLockedByPayroll(
  db: Database,
  workDate: string,
  actionDesc = 'thay đổi dữ liệu ca làm việc',
): void {
  const locked = findLockedPayrollPeriodForDate(db, workDate);
  if (locked) {
    throw Errors.conflict(
      `Ngày ${dayjs(workDate).format('DD/MM/YYYY')} thuộc kỳ lương "${locked.name}" (${locked.period_code}) đã chốt (${PAY_PERIOD_STATUS_LABELS[locked.status]}). Không được phép ${actionDesc} trong kỳ lương đã khóa.`,
    );
  }
}
