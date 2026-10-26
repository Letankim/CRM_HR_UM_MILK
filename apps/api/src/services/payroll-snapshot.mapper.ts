import {
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  PAYROLL_WORK_SOURCE_LABELS,
  type PayrollSnapshot,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveStaffGroupLabel } from '../routes/employee-mapper.js';
import type { ShiftPayrollLog } from './payroll-work-collector.js';

interface SnapshotAdjustmentsDetail {
  source?: keyof typeof PAYROLL_WORK_SOURCE_LABELS;
  workedDays?: number;
  missingProfileShifts?: number;
  checkedInShiftsCount?: number;
  adjustedShiftsCount?: number;
  scheduledOnlyShiftsCount?: number;
  leaveOffCount?: number;
  emergencyLeaveCount?: number;
  swappedOutCount?: number;
  absentCount?: number;
  lateCount?: number;
  lateMinutesTotal?: number;
  shiftLogs?: ShiftPayrollLog[];
  segments?: unknown[];
  items?: unknown[];
}

/** Chuyển Snapshot lương sang dạng hiển thị (kèm chi tiết phân đoạn lương & đối soát chấm công/nghỉ OFF/đổi ca) */
export function mapSnapshot(s: PayrollSnapshot, ctx: AppContext) {
  const rate = s.pay_rate_id ? ctx.db.payRates.get(s.pay_rate_id) : undefined;
  const rateType = rate?.rate_type ?? 'HOURLY';
  let detail: SnapshotAdjustmentsDetail = {};
  let allowanceLines: { code: string; label: string; amount: number }[] = [];
  try {
    detail = JSON.parse(s.adjustments_json || '{}');
    allowanceLines = JSON.parse(s.allowances_json || '[]');
  } catch {
    /* dữ liệu snapshot cũ không có chi tiết */
  }
  return {
    id: s.id,
    periodId: s.period_id,
    periodCode: s.period_code,
    employeeId: s.employee_id,
    employeeCode: s.employee_code,
    fullName: s.full_name,
    branchId: s.branch_id,
    branchName: s.branch_name,
    staffGroupLabel: resolveStaffGroupLabel(ctx, s.staff_group, s.staff_group),
    stage: s.stage,
    stageLabel: EMPLOYEE_STAGE_LABELS[s.stage as keyof typeof EMPLOYEE_STAGE_LABELS] ?? s.stage,
    hasSalaryProfile: !!s.pay_rate_id,
    rateType,
    rateTypeLabel: rate ? PAY_RATE_TYPE_LABELS[rateType] : 'Chưa thiết lập lương',
    unitLabel: PAY_RATE_UNIT_LABELS[rateType],
    rateVnd: s.rate_vnd,
    probationPercent: rate?.probation_percent ?? null,
    probationHours: s.probation_hours,
    probationRateVnd: s.probation_hourly_rate_vnd,
    probationPayVnd: s.probation_pay_vnd,
    officialHours: s.official_hours,
    officialRateVnd: s.official_hourly_rate_vnd,
    officialPayVnd: s.official_pay_vnd,
    approvedHours: s.approved_hours,
    totalShiftsCount: s.total_shifts_count,
    workedDays: detail.workedDays ?? 0,
    missingProfileShifts: detail.missingProfileShifts ?? 0,
    checkedInShiftsCount: detail.checkedInShiftsCount ?? 0,
    adjustedShiftsCount: detail.adjustedShiftsCount ?? 0,
    scheduledOnlyShiftsCount: detail.scheduledOnlyShiftsCount ?? 0,
    leaveOffCount: detail.leaveOffCount ?? 0,
    emergencyLeaveCount: detail.emergencyLeaveCount ?? 0,
    swappedOutCount: detail.swappedOutCount ?? 0,
    absentCount: detail.absentCount ?? 0,
    lateCount: detail.lateCount ?? s.late_count ?? 0,
    lateMinutesTotal: detail.lateMinutesTotal ?? s.late_minutes_total ?? 0,
    shiftLogs: detail.shiftLogs ?? [],
    workSourceLabel: detail.source ? PAYROLL_WORK_SOURCE_LABELS[detail.source] : '',
    segments: detail.segments ?? [],
    items: detail.items ?? [],
    allowanceLines,
    baseSalaryVnd: s.base_salary_vnd,
    otHours: s.ot_hours,
    otRateVnd: s.ot_rate_vnd,
    otPayVnd: s.ot_pay_vnd,
    shiftSwapCount: s.shift_swap_count,
    shiftSwapAllowanceVnd: s.shift_swap_allowance_vnd,
    mealAllowanceVnd: s.meal_allowance_vnd,
    transportAllowanceVnd: s.transport_allowance_vnd,
    attendanceBonusVnd: s.attendance_bonus_vnd,
    kpiBonusVnd: s.kpi_bonus_vnd,
    otherAllowancesVnd: s.other_allowances_vnd,
    positiveAdjustmentsVnd: s.positive_adjustments_vnd,
    approvedDeductionsVnd: s.approved_deductions_vnd,
    advanceDeductionVnd: s.advance_deduction_vnd,
    grossVnd: s.gross_vnd,
    netVnd: s.net_vnd,
    bankName: s.bank_name,
    bankAccountNumber: s.bank_account_number,
    version: s.version,
  };
}
