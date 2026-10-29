import type { Employee, PayRate } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { MAX_AMOUNT_BY_TYPE, MIN_AMOUNT_BY_TYPE, type SalaryProfileFields } from '../routes/salary-profile.schemas.js';
import { dayBefore, isProfileLocked, profilesOf, today } from './salary-profile.service.js';

export function assertAmountInRange(rateType: PayRate['rate_type'], amount: number) {
  const min = MIN_AMOUNT_BY_TYPE[rateType];
  const max = MAX_AMOUNT_BY_TYPE[rateType];
  if (amount < min.min) throw Errors.fieldValidation('amount_vnd', 'OUT_OF_RANGE', min.message, amount);
  if (amount > max.max) throw Errors.fieldValidation('amount_vnd', 'OUT_OF_RANGE', max.message, amount);
}

/** Dòng PAY_RATES mới từ dữ liệu form (dùng chung cho tạo hồ sơ nhân sự & điều chỉnh lương) */
export function newProfileRow(emp: Employee, fields: SalaryProfileFields, actorId: string, effectiveFrom: string, previousId: string, defaultReason: string) {
  return {
    employee_id: emp.id,
    rate_type: fields.rate_type,
    amount_vnd: Math.round(fields.amount_vnd),
    effective_from: effectiveFrom,
    effective_to: '',
    approved_by: actorId,
    approved_at: nowIso(),
    stage: emp.stage,
    staff_group: emp.staff_group,
    ot_multiplier: fields.ot_multiplier,
    night_shift_allowance_vnd: 0,
    attendance_bonus_vnd: fields.attendance_bonus_vnd,
    meal_allowance_per_shift_vnd: fields.meal_allowance_per_shift_vnd,
    transport_allowance_vnd: fields.transport_allowance_vnd,
    responsibility_allowance_vnd: fields.responsibility_allowance_vnd,
    other_allowance_vnd: fields.other_allowance_vnd,
    probation_percent: fields.probation_percent,
    standard_work_days: fields.standard_work_days,
    standard_hours_per_day: fields.standard_hours_per_day,
    status: 'ACTIVE' as const,
    change_reason: fields.change_reason || defaultReason,
    previous_rate_id: previousId,
    note: fields.note,
  };
}

/**
 * Tạo mức lương mới có hiệu lực cho 1 nhân sự.
 * Mức đang mở (không có ngày kết thúc) sẽ được đóng lại tại ngày trước ngày hiệu lực mới.
 * Bọc Saga để hoàn tác nếu ghi Google Sheets lỗi giữa chừng.
 */
export async function createSalaryProfile(ctx: AppContext, emp: Employee, fields: SalaryProfileFields, actorId: string): Promise<PayRate> {
  assertAmountInRange(fields.rate_type, fields.amount_vnd);
  const history = profilesOf(ctx.db, emp.id);
  const latest = history[0];
  const defaultInitialFrom = (emp.probation_start || '').trim().slice(0, 10) || dayjs().startOf('month').format('YYYY-MM-DD');
  const effectiveFrom = (fields.effective_from || '').trim().slice(0, 10) || (latest ? today() : defaultInitialFrom);
  if (latest && effectiveFrom <= latest.effective_from) {
    throw Errors.fieldValidation(
      'effective_from',
      'INVALID_VALUE',
      `Ngày hiệu lực phải sau ngày hiệu lực của mức lương gần nhất (${latest.effective_from}). Để sửa mức hiện tại, vui lòng dùng chức năng Chỉnh sửa.`,
      effectiveFrom,
    );
  }

  return ctx.reconciliation.executeSaga({
    sagaKey: `salary-profile-${emp.id}-${effectiveFrom}-${Date.now()}`,
    operation: 'PAYROLL_SALARY_PROFILE_CHANGE',
    actorId,
    initialContext: { closed: null as PayRate | null, created: null as PayRate | null },
    steps: [
      {
        name: 'CLOSE_PREVIOUS_PROFILE',
        run: async (s) => {
          if (!latest || (latest.effective_to && latest.effective_to < effectiveFrom)) return;
          s.closed = await ctx.db.payRates.update(latest.id, latest.version, { effective_to: dayBefore(effectiveFrom), status: 'EXPIRED' }, actorId);
        },
        compensate: async (s) => {
          if (!s.closed || !latest) return;
          await ctx.db.payRates.update(latest.id, s.closed.version, { effective_to: latest.effective_to, status: latest.status }, actorId);
        },
      },
      {
        name: 'INSERT_NEW_PROFILE',
        run: async (s) => {
          s.created = await ctx.db.payRates.insert(
            newProfileRow(emp, fields, actorId, effectiveFrom, latest?.id ?? '', latest ? 'Điều chỉnh lương' : 'Thiết lập lương ban đầu'),
            actorId,
          );
        },
      },
    ],
    resultSelector: (s) => s.created!,
  });
}

/** Xóa mức lương mới nhất (chưa dùng chốt kỳ lương) và mở lại mức liền trước */
export async function deleteLatestSalaryProfile(ctx: AppContext, target: PayRate, version: number, actorId: string) {
  if (isProfileLocked(ctx.db, target.id)) {
    throw Errors.conflict('Mức lương này đã được dùng để chốt kỳ lương (Đã phê duyệt / Phát hành / Thanh toán), không thể xóa. Vui lòng tạo mức lương mới có ngày hiệu lực.');
  }
  const history = profilesOf(ctx.db, target.employee_id);
  if (history[0]?.id !== target.id) {
    throw Errors.badRequest('Chỉ được xóa mức lương có ngày hiệu lực mới nhất để đảm bảo lịch sử lương liên tục');
  }
  const previous = history[1];
  await ctx.reconciliation.executeSaga({
    sagaKey: `salary-profile-delete-${target.id}-v${version}`,
    operation: 'PAYROLL_SALARY_PROFILE_DELETE',
    actorId,
    initialContext: {},
    steps: [
      { name: 'SOFT_DELETE_PROFILE', run: async () => { await ctx.db.payRates.softDelete(target.id, version, actorId); } },
      {
        name: 'REOPEN_PREVIOUS_PROFILE',
        run: async () => {
          if (!previous) return;
          await ctx.db.payRates.update(previous.id, previous.version, { effective_to: '', status: 'ACTIVE' }, actorId);
        },
      },
    ],
    resultSelector: () => true,
  });
}
