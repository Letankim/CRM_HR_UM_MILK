import {
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  SYSTEM_CONFIG,
  type Employee,
  type PayRate,
  type PayrollItem,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import type { ShiftPayrollLog } from './payroll-work-collector.js';
import { probationAmount } from './salary-profile.service.js';

export type ShiftEarningCategory = 'COMPLETED' | 'INCOMPLETE' | 'UPCOMING' | 'ABSENT' | 'LEAVE_OFF' | 'SWAPPED_OUT';

export const SHIFT_EARNING_CATEGORY_LABELS: Record<ShiftEarningCategory, string> = {
  COMPLETED: 'Đã hoàn thành (Đã tính tiền)',
  INCOMPLETE: 'Đang làm / Thiếu Ra ca',
  UPCOMING: 'Ca sắp tới (Dự kiến)',
  ABSENT: 'Vắng mặt / Chờ bù công',
  LEAVE_OFF: 'Nghỉ OFF đã duyệt',
  SWAPPED_OUT: 'Đã nhường / đổi ca',
};

export const WEEKDAY_LABELS = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export function classifyShiftLog(status: ShiftPayrollLog['status']): ShiftEarningCategory {
  if (status === 'ATTENDANCE_FULL' || status === 'ADJUSTMENT_APPROVED') return 'COMPLETED';
  if (status === 'ATTENDANCE_CHECKIN') return 'INCOMPLETE';
  if (status === 'SCHEDULE_PUBLISHED') return 'UPCOMING';
  if (status === 'ABSENT') return 'ABSENT';
  if (status === 'LEAVE_OFF') return 'LEAVE_OFF';
  return 'SWAPPED_OUT';
}

export function collectHistoricalSnapshotLogs(
  ctx: AppContext,
  emp: Employee,
  fromDate: string,
  toDate: string,
  liveLogs: ShiftPayrollLog[],
): ShiftPayrollLog[] {
  const activePartitionYm = ctx.db.partitionMonth ? `${ctx.db.partitionMonth.slice(0, 4)}-${ctx.db.partitionMonth.slice(5, 7)}` : '';
  const allActivePartitionAssignments = ctx.db.shiftAssignments.all(true);
  const seenKeys = new Set(liveLogs.map((l) => `${l.date}|${l.shiftCode}|${l.assignmentId ?? ''}`));
  const seenDateShift = new Set(liveLogs.map((l) => `${l.date}|${l.shiftCode}`));
  const merged = [...liveLogs];

  const snaps = ctx.db.payrollSnapshots.filter(
    (s) => s.employee_id === emp.id || Boolean(emp.employee_code && s.employee_code === emp.employee_code),
  );
  for (const snap of snaps) {
    try {
      const parsed = JSON.parse(snap.adjustments_json || '{}') as { shiftLogs?: ShiftPayrollLog[] };
      for (const log of parsed.shiftLogs ?? []) {
        if (!log?.date || log.date < fromDate || log.date > toDate) continue;
        const ym = log.date.slice(0, 7);
        if (activePartitionYm && ym === activePartitionYm) continue;
        if (!activePartitionYm && allActivePartitionAssignments.some((a) => a.work_date.slice(0, 7) === ym)) continue;
        const key = `${log.date}|${log.shiftCode}|${log.assignmentId ?? ''}`;
        const dsKey = `${log.date}|${log.shiftCode}`;
        if (seenKeys.has(key) || seenDateShift.has(dsKey)) continue;
        seenKeys.add(key);
        seenDateShift.add(dsKey);
        merged.push(log);
      }
    } catch {
      // Bỏ qua JSON hỏng nếu có
    }
  }
  return merged;
}

export function filterApprovedPayrollItemsInRange(
  ctx: AppContext,
  emp: Employee,
  fromDate: string,
  toDate: string,
): { item: PayrollItem; effectiveDate: string }[] {
  const empCode = emp.employee_code.trim().toUpperCase();
  const matched: { item: PayrollItem; effectiveDate: string }[] = [];
  for (const item of ctx.db.payrollItems.filter((i) => i.approval_status === 'APPROVED')) {
    const ref = item.employee_id.trim();
    if (ref !== emp.id && (!empCode || ref.toUpperCase() !== empCode)) continue;
    const explicitDate = (item.work_date || '').trim().slice(0, 10);
    if (explicitDate) {
      if (explicitDate >= fromDate && explicitDate <= toDate) matched.push({ item, effectiveDate: explicitDate });
      continue;
    }
    const period = ctx.db.payPeriods.get(item.period_id);
    const fallbackDate = (item.approved_at || item.created_at || '').slice(0, 10) || period?.to_date || '';
    if (period && period.from_date >= fromDate && period.to_date <= toDate) {
      matched.push({ item, effectiveDate: period.to_date });
    } else if (fallbackDate >= fromDate && fallbackDate <= toDate && (!period || (period.from_date <= toDate && period.to_date >= fromDate))) {
      matched.push({ item, effectiveDate: fallbackDate });
    }
  }
  return matched.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

export function formatSalaryProfileOverview(activeProfile: PayRate | undefined, emp: Employee, officialNow: boolean, fixedMonthlyReferenceVnd: number) {
  if (!activeProfile) {
    return {
      hasProfile: false, rateType: null, rateTypeLabel: 'Chưa cấu hình hồ sơ lương', unitLabel: '',
      officialAmountVnd: 0, probationPercent: SYSTEM_CONFIG.defaults.probationSalaryPercent, probationAmountVnd: 0,
      currentAppliedAmountVnd: 0, currentStageLabel: EMPLOYEE_STAGE_LABELS[emp.stage],
      otMultiplier: SYSTEM_CONFIG.defaults.overtimeMultiplier, mealAllowancePerShiftVnd: 0,
      fixedMonthlyReferenceVnd: 0, effectiveFrom: null,
    };
  }
  return {
    hasProfile: true, rateType: activeProfile.rate_type, rateTypeLabel: PAY_RATE_TYPE_LABELS[activeProfile.rate_type],
    unitLabel: PAY_RATE_UNIT_LABELS[activeProfile.rate_type], officialAmountVnd: activeProfile.amount_vnd,
    probationPercent: activeProfile.probation_percent, probationAmountVnd: probationAmount(activeProfile),
    currentAppliedAmountVnd: officialNow ? activeProfile.amount_vnd : probationAmount(activeProfile),
    currentStageLabel: EMPLOYEE_STAGE_LABELS[officialNow ? 'OFFICIAL' : 'PROBATION'],
    otMultiplier: activeProfile.ot_multiplier, mealAllowancePerShiftVnd: activeProfile.meal_allowance_per_shift_vnd,
    fixedMonthlyReferenceVnd, effectiveFrom: activeProfile.effective_from,
  };
}
