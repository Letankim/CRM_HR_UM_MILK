import {
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  PAYROLL_WORK_SOURCE_LABELS,
  type PayrollSnapshot,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveStaffGroupLabel } from '../routes/employee-mapper.js';
import { collectWorkEntries, type ShiftPayrollLog } from './payroll-work-collector.js';

export interface MissingShiftDetailItem {
  assignmentId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  branchName: string;
  date: string;
  shiftCode: string;
  shiftLabel: string;
  shiftTime: string;
  hours: number;
  checkInHm: string;
  checkOutHm: string;
  issueType: 'ABSENT' | 'MISSING_CHECKOUT' | 'MISSING_CHECKIN' | 'PENDING_ADJUSTMENT';
  issueLabel: string;
  pendingAdjustmentCode: string | null;
  pendingAdjustmentStatus: string | null;
  actionGuide: string;
}

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
  const period = ctx.db.payPeriods.get(s.period_id);
  const fromDate = period?.from_date || '2000-01-01';
  const toDate = period?.to_date || '2099-12-31';
  const isEmp = (val?: string) => Boolean(val && (val === s.employee_id || val === s.employee_code));
  const empShifts = ctx.db.shiftAssignments.filter((sh) => isEmp(sh.employee_id) && sh.work_date >= fromDate && sh.work_date <= toDate);
  const deletedShifts = ctx.db.shiftAssignments.all(true).filter((sh) => sh.is_deleted && isEmp(sh.employee_id) && sh.work_date >= fromDate && sh.work_date <= toDate);
  const isDeletedRef = (assignId?: string, workDate?: string, shiftCode?: string) => {
    if (assignId) return !ctx.db.shiftAssignments.get(assignId);
    if (workDate && shiftCode && !empShifts.some((a) => a.work_date === workDate && a.shift_code === shiftCode)) {
      if (deletedShifts.some((a) => a.work_date === workDate && a.shift_code === shiftCode)) return true;
    }
    return false;
  };
  const empAdjs = ctx.db.attendanceAdjustments.filter(
    (a) => isEmp(a.employee_id) && a.work_date >= fromDate && a.work_date <= toDate && !isDeletedRef(a.assignment_id, a.work_date, a.shift_code),
  );
  const isLockedFinal = period?.status === 'PUBLISHED' || period?.status === 'PAID';
  const liveWork = !isLockedFinal ? collectWorkEntries(ctx, s.employee_id || s.employee_code, fromDate, toDate) : null;
  const shiftLogs = (liveWork ? liveWork.shiftLogs : (detail.shiftLogs ?? [])).filter(
    (log) => !isDeletedRef(log.assignmentId, log.date, log.shiftCode),
  );
  const standardHours = empShifts.filter((sh) => sh.day_type !== 'OFF' && sh.status !== 'ON_LEAVE' && sh.status !== 'DRAFT').reduce((sum, sh) => sum + (Number(sh.scheduled_hours) || 5), 0) || s.approved_hours;
  const missingLogs = shiftLogs.filter(
    (log) => log.status === 'ABSENT' || log.status === 'ATTENDANCE_CHECKIN' || log.status === 'SCHEDULE_PUBLISHED',
  );
  const missingCheckoutCount = missingLogs.length;
  const pendingAdjs = empAdjs.filter((a) => a.status === 'PENDING' || a.status === 'STORE_CONFIRMED');
  const pendingAdjCount = pendingAdjs.length;
  const approvedAdjCount = empAdjs.filter((a) => a.status === 'APPROVED').length;
  const hasAnomaly = missingCheckoutCount > 0 || pendingAdjCount > 0;

  const missingShifts: MissingShiftDetailItem[] = shiftLogs
    .filter((log) => log.status === 'ABSENT' || log.status === 'ATTENDANCE_CHECKIN' || log.status === 'SCHEDULE_PUBLISHED' || Boolean(log.pendingAdjustmentCode))
    .map((log) => {
      const issueType: MissingShiftDetailItem['issueType'] = log.status === 'ABSENT' || log.status === 'SCHEDULE_PUBLISHED'
        ? 'ABSENT'
        : log.status === 'ATTENDANCE_CHECKIN'
          ? (log.checkInHm && !log.checkOutHm ? 'MISSING_CHECKOUT' : 'MISSING_CHECKIN')
          : 'PENDING_ADJUSTMENT';
      const issueLabel = log.status === 'ABSENT'
        ? 'Vắng mặt (Chưa chấm công Vào & Ra ca)'
        : log.status === 'SCHEDULE_PUBLISHED'
          ? 'Chưa chấm công Vào & Ra ca (Ca phân công trong kỳ chưa hoàn thành)'
          : issueType === 'MISSING_CHECKOUT'
            ? `Quên chấm công Ra ca (Đã vào ca lúc ${log.checkInHm})`
            : issueType === 'MISSING_CHECKIN'
              ? `Thiếu chấm công Vào ca (Chỉ có giờ Ra ${log.checkOutHm})`
              : `Đang chờ duyệt phiếu bổ sung công (${log.pendingAdjustmentCode})`;
      const bName = log.branchName || s.branch_name || 'Chi nhánh';
      const actionGuide = log.pendingAdjustmentCode
        ? `Đã có phiếu bù công ${log.pendingAdjustmentCode} (${log.pendingAdjustmentStatus === 'STORE_CONFIRMED' ? 'Cửa hàng đã xác nhận — Chờ HR duyệt' : 'Đang chờ Cửa hàng / HR duyệt'}) — Báo HR / Cửa hàng phê duyệt.`
        : issueType === 'ABSENT'
          ? `Chưa có phiếu bù công — Báo Quản lý ${bName} hoặc HR tạo phiếu bổ sung công (nếu có đi làm) hoặc xóa ca (nếu phân nhầm).`
          : `Chưa có phiếu bù công — Báo Quản lý ${bName} hoặc HR tạo phiếu bổ sung giờ Ra ca hoặc chuyển ca sang Đã hoàn thành.`;
      return {
        assignmentId: log.assignmentId || `${log.date}-${log.shiftCode}`,
        employeeId: s.employee_id, employeeCode: s.employee_code, fullName: s.full_name, branchName: bName,
        date: log.date, shiftCode: log.shiftCode, shiftLabel: log.shiftLabel, shiftTime: log.shiftTime, hours: log.hours,
        checkInHm: log.checkInHm || '', checkOutHm: log.checkOutHm || '',
        issueType, issueLabel,
        pendingAdjustmentCode: log.pendingAdjustmentCode ?? null,
        pendingAdjustmentStatus: log.pendingAdjustmentStatus ?? null,
        actionGuide,
      };
    });

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
    standardHours,
    actualHours: s.approved_hours,
    approvedPayrollHours: s.approved_hours,
    totalShiftsCount: s.total_shifts_count,
    workedDays: detail.workedDays ?? 0,
    missingProfileShifts: detail.missingProfileShifts ?? 0,
    checkedInShiftsCount: liveWork?.checkedInShiftsCount ?? detail.checkedInShiftsCount ?? 0,
    adjustedShiftsCount: liveWork?.adjustedShiftsCount ?? detail.adjustedShiftsCount ?? 0,
    scheduledOnlyShiftsCount: liveWork?.scheduledOnlyShiftsCount ?? detail.scheduledOnlyShiftsCount ?? 0,
    leaveOffCount: liveWork?.leaveOffCount ?? detail.leaveOffCount ?? 0,
    emergencyLeaveCount: liveWork?.emergencyLeaveCount ?? detail.emergencyLeaveCount ?? 0,
    swappedOutCount: liveWork?.swappedOutCount ?? detail.swappedOutCount ?? 0,
    absentCount: liveWork?.absentCount ?? detail.absentCount ?? 0,
    lateCount: liveWork?.lateCount ?? detail.lateCount ?? s.late_count ?? 0,
    lateMinutesTotal: liveWork?.lateMinutesTotal ?? detail.lateMinutesTotal ?? s.late_minutes_total ?? 0,
    missingCheckoutCount,
    pendingAdjCount,
    approvedAdjCount,
    hasAnomaly,
    missingShifts,
    shiftLogs,
    workSourceLabel: (liveWork?.source ?? detail.source) ? PAYROLL_WORK_SOURCE_LABELS[(liveWork?.source ?? detail.source)!] : '',
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
