'use client';

import dayjs, { type Dayjs } from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';

export type ShiftEarningCategory = 'COMPLETED' | 'INCOMPLETE' | 'UPCOMING' | 'ABSENT' | 'LEAVE_OFF' | 'SWAPPED_OUT';
export type EarningsFilterMode = 'DAY' | 'WEEK' | 'MONTH' | 'RANGE';
export type EarningsCategoryFilter = 'ALL' | 'COMPLETED' | 'INCOMPLETE' | 'UPCOMING' | 'OTHER';

export interface MyEarningsShiftRow {
  key: string;
  assignmentId: string | null;
  date: string;
  weekdayLabel: string;
  shiftCode: string;
  shiftLabel: string;
  shiftTime: string;
  branchName: string;
  category: ShiftEarningCategory;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  isCountedInEarned: boolean;
  stage: 'PROBATION' | 'OFFICIAL';
  stageLabel: string;
  percent: number;
  rateTypeLabel: string;
  unitRateVnd: number;
  unitLabel: string;
  hours: number;
  otHours: number;
  checkInHm: string;
  checkOutHm: string;
  lateMinutes: number;
  isSwapIn: boolean;
  basePayVnd: number;
  otPayVnd: number;
  mealAllowanceVnd: number;
  swapAllowanceVnd: number;
  totalShiftPayVnd: number;
  pendingAdjustmentCode: string | null;
  note: string;
}

export interface MyEarningsPayrollItemRow {
  id: string;
  date: string;
  type: string;
  typeLabel: string;
  title: string;
  direction: 'ADD' | 'DEDUCT';
  amountVnd: number;
  note: string;
}

export interface MyEarningsSummary {
  range: { fromDate: string; toDate: string; daysInRange: number; isFullMonthRange: boolean; todayDate: string };
  employee: { id: string; employeeCode: string; fullName: string; branchName: string; stage: string; stageLabel: string; officialFrom: string | null };
  salaryProfile: {
    hasProfile: boolean;
    rateType: string | null;
    rateTypeLabel: string;
    unitLabel: string;
    officialAmountVnd: number;
    probationPercent: number;
    probationAmountVnd: number;
    currentAppliedAmountVnd: number;
    currentStageLabel: string;
    otMultiplier: number;
    mealAllowancePerShiftVnd: number;
    fixedMonthlyReferenceVnd: number;
    effectiveFrom: string | null;
  };
  counts: {
    totalRows: number;
    completedShiftsCount: number;
    completedProbationShiftsCount: number;
    completedOfficialShiftsCount: number;
    workedDaysCount: number;
    completedHours: number;
    completedProbationHours: number;
    completedOfficialHours: number;
    completedOtHours: number;
    swapInCompletedCount: number;
    incompleteShiftsCount: number;
    upcomingShiftsCount: number;
    absentShiftsCount: number;
    leaveOffCount: number;
    swappedOutCount: number;
    lateShiftsCount: number;
    lateMinutesTotal: number;
    missingProfileShiftsCount: number;
  };
  earned: {
    probationBasePayVnd: number;
    officialBasePayVnd: number;
    basePayVnd: number;
    otPayVnd: number;
    mealAllowanceVnd: number;
    swapAllowanceVnd: number;
    shiftSubtotalVnd: number;
    fixedAllowanceAppliedVnd: number;
    fixedMonthlyReferenceVnd: number;
    bonusAndAddItemsVnd: number;
    deductionItemsVnd: number;
    grossVnd: number;
    netVnd: number;
  };
  projected: {
    totalProjectedShiftsCount: number;
    totalProjectedHours: number;
    pendingOrUpcomingPayVnd: number;
    projectedGrossVnd: number;
    projectedNetVnd: number;
  };
  payrollItems: MyEarningsPayrollItemRow[];
  shifts: MyEarningsShiftRow[];
}

export const CATEGORY_TAG_COLOR: Record<ShiftEarningCategory, string> = {
  COMPLETED: 'green',
  INCOMPLETE: 'orange',
  UPCOMING: 'blue',
  ABSENT: 'red',
  LEAVE_OFF: 'cyan',
  SWAPPED_OUT: 'default',
};

export function startOfVnWeek(d: Dayjs): Dayjs {
  return d.startOf('day').subtract((d.day() + 6) % 7, 'day');
}

export function computePeriodBounds(
  mode: EarningsFilterMode,
  anchor: Dayjs,
  customFrom: Dayjs,
  customTo: Dayjs,
): { fromDate: string; toDate: string; label: string } {
  if (mode === 'DAY') {
    const s = anchor.format('YYYY-MM-DD');
    return { fromDate: s, toDate: s, label: `Ngày ${anchor.format('DD/MM/YYYY')}` };
  }
  if (mode === 'WEEK') {
    const mon = startOfVnWeek(anchor);
    const sun = mon.add(6, 'day');
    return { fromDate: mon.format('YYYY-MM-DD'), toDate: sun.format('YYYY-MM-DD'), label: `Tuần ${mon.format('DD/MM')} – ${sun.format('DD/MM/YYYY')}` };
  }
  if (mode === 'MONTH') {
    const start = anchor.startOf('month');
    const end = anchor.endOf('month');
    return { fromDate: start.format('YYYY-MM-DD'), toDate: end.format('YYYY-MM-DD'), label: `Tháng ${anchor.format('MM/YYYY')}` };
  }
  const f = customFrom.isAfter(customTo, 'day') ? customTo : customFrom;
  const t = customFrom.isAfter(customTo, 'day') ? customFrom : customTo;
  return { fromDate: f.format('YYYY-MM-DD'), toDate: t.format('YYYY-MM-DD'), label: `Từ ${f.format('DD/MM/YYYY')} đến ${t.format('DD/MM/YYYY')}` };
}

export function exportMyEarningsExcel(summary: MyEarningsSummary, rows: MyEarningsShiftRow[]): void {
  const f = dayjs(summary.range.fromDate).format('DD-MM-YYYY');
  const t = dayjs(summary.range.toDate).format('DD-MM-YYYY');
  exportToExcel<MyEarningsShiftRow>({
    fileName: `Thu_nhap_ca_lam_${summary.employee.employeeCode}_${f}_${t}`,
    sheetTitle: `BẢNG KÊ CA ĐÃ LÀM & THU NHẬP CÁ NHÂN (${summary.employee.fullName} - ${summary.employee.employeeCode})`,
    subtitle: `Khoảng lọc: ${dayjs(summary.range.fromDate).format('DD/MM/YYYY')} - ${dayjs(summary.range.toDate).format('DD/MM/YYYY')} | Đã hoàn thành: ${summary.counts.completedShiftsCount} ca (${summary.counts.completedHours}h) | Tiền hiện tại nhận được: ${summary.earned.netVnd.toLocaleString('vi-VN')} đ`,
    rows,
    columns: [
      { header: 'Ngày làm', render: (r) => `${r.weekdayLabel}, ${dayjs(r.date).format('DD/MM/YYYY')}` },
      { header: 'Khung ca', render: (r) => `${r.shiftLabel} (${r.shiftTime})` },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Vào / Ra ca', render: (r) => (r.checkInHm || r.checkOutHm ? `${r.checkInHm || '—'} - ${r.checkOutHm || '—'}` : '—'), align: 'center' },
      { header: 'Giờ công', render: (r) => `${r.hours}h${r.otHours > 0 ? ` (+OT ${r.otHours}h)` : ''}`, align: 'center' },
      { header: 'Giai đoạn & Đơn giá', render: (r) => (r.unitRateVnd > 0 ? `${r.stageLabel} (${r.percent}%) - ${r.unitRateVnd.toLocaleString('vi-VN')} đ/${r.unitLabel}` : r.stageLabel) },
      { header: 'Lương ca cơ bản', render: (r) => (r.isCountedInEarned ? r.basePayVnd : 0), isCurrency: true },
      { header: 'OT + Phụ cấp ca', render: (r) => (r.isCountedInEarned ? r.otPayVnd + r.mealAllowanceVnd + r.swapAllowanceVnd : 0), isCurrency: true },
      { header: 'Tiền đã tích lũy', render: (r) => (r.isCountedInEarned ? r.totalShiftPayVnd : 0), isCurrency: true },
      { header: 'Trạng thái', key: 'statusLabel' },
    ],
    summaryRow: [
      'TỔNG CA ĐÃ HOÀN THÀNH (THỰC NHẬN)',
      `${summary.counts.completedShiftsCount} ca đã làm`,
      summary.employee.branchName,
      `${summary.counts.workedDaysCount} ngày công`,
      `${summary.counts.completedHours}h${summary.counts.completedOtHours > 0 ? ` (+OT ${summary.counts.completedOtHours}h)` : ''}`,
      summary.salaryProfile.rateTypeLabel,
      summary.earned.basePayVnd,
      summary.earned.otPayVnd + summary.earned.mealAllowanceVnd + summary.earned.swapAllowanceVnd + summary.earned.fixedAllowanceAppliedVnd,
      summary.earned.netVnd,
      'Tiền hiện tại nhận được',
    ],
  });
}
