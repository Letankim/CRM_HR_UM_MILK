import type { PayPeriodStatus } from '@umbm/shared';

export type PayRateType = 'HOURLY' | 'MONTHLY' | 'SHIFT';

export interface SalaryProfile {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  rateType: PayRateType;
  rateTypeLabel: string;
  unitLabel: string;
  amountVnd: number;
  probationPercent: number;
  probationAmountVnd: number;
  standardWorkDays: number;
  standardHoursPerDay: number;
  otMultiplier: number;
  attendanceBonusVnd: number;
  mealAllowancePerShiftVnd: number;
  transportAllowanceVnd: number;
  responsibilityAllowanceVnd: number;
  otherAllowanceVnd: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'SCHEDULED';
  statusLabel: string;
  changeReason: string;
  note: string;
  version: number;
  locked?: boolean;
}

export interface SalaryProfileRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  branchName: string;
  stage: 'PROBATION' | 'OFFICIAL';
  stageLabel: string;
  staffGroupLabel: string;
  officialFrom: string | null;
  profileStatus: 'ACTIVE' | 'EXPIRED' | 'SCHEDULED' | 'MISSING';
  profileStatusLabel: string;
  historyCount: number;
  profile: SalaryProfile | null;
}

export interface SalarySegment {
  rateId: string;
  rateType: PayRateType;
  stage: 'PROBATION' | 'OFFICIAL';
  percent: number;
  unitRateVnd: number;
  quantity: number;
  unit: string;
  hours: number;
  amountVnd: number;
  fromDate: string;
  toDate: string;
}

export interface ShiftPayrollLog {
  assignmentId?: string;
  date: string;
  shiftCode: string;
  shiftLabel: string;
  shiftTime: string;
  branchName?: string;
  status: 'ATTENDANCE_FULL' | 'ATTENDANCE_CHECKIN' | 'ADJUSTMENT_APPROVED' | 'SCHEDULE_PUBLISHED' | 'LEAVE_OFF' | 'SWAPPED_OUT' | 'EMERGENCY_LEAVE' | 'ABSENT';
  statusLabel: string;
  hours: number;
  otHours: number;
  isSwapIn: boolean;
  lateMinutes: number;
  checkInHm: string;
  checkOutHm: string;
  pendingAdjustmentCode?: string;
  pendingAdjustmentStatus?: string;
  note: string;
}

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

export interface PayrollSnapshotItem {
  id: string;
  periodId: string;
  periodCode: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  branchId?: string;
  branchName: string;
  staffGroupLabel: string;
  stageLabel: string;
  hasSalaryProfile: boolean;
  rateType: PayRateType;
  rateTypeLabel: string;
  unitLabel: string;
  rateVnd: number;
  probationPercent: number | null;
  probationHours: number;
  probationRateVnd: number;
  probationPayVnd: number;
  officialHours: number;
  officialRateVnd: number;
  officialPayVnd: number;
  approvedHours: number;
  standardHours?: number;
  actualHours?: number;
  approvedPayrollHours?: number;
  totalShiftsCount: number;
  workedDays: number;
  missingProfileShifts: number;
  checkedInShiftsCount?: number;
  adjustedShiftsCount?: number;
  scheduledOnlyShiftsCount?: number;
  leaveOffCount?: number;
  emergencyLeaveCount?: number;
  swappedOutCount?: number;
  absentCount?: number;
  lateCount?: number;
  lateMinutesTotal?: number;
  missingCheckoutCount?: number;
  pendingAdjCount?: number;
  approvedAdjCount?: number;
  hasAnomaly?: boolean;
  missingShifts?: MissingShiftDetailItem[];
  shiftLogs?: ShiftPayrollLog[];
  workSourceLabel: string;
  segments: SalarySegment[];
  items: { id: string; label: string; title: string; direction: 'ADD' | 'DEDUCT'; amount: number }[];
  allowanceLines: { code: string; label: string; amount: number }[];
  baseSalaryVnd: number;
  otHours: number;
  otRateVnd: number;
  otPayVnd: number;
  shiftSwapCount: number;
  shiftSwapAllowanceVnd: number;
  mealAllowanceVnd: number;
  transportAllowanceVnd: number;
  attendanceBonusVnd: number;
  kpiBonusVnd: number;
  otherAllowancesVnd: number;
  positiveAdjustmentsVnd: number;
  approvedDeductionsVnd: number;
  advanceDeductionVnd: number;
  grossVnd: number;
  netVnd: number;
  bankName: string;
  bankAccountNumber: string;
}

export interface PayPeriodRow {
  id: string;
  period_code: string;
  name: string;
  from_date: string;
  to_date: string;
  status: PayPeriodStatus;
  statusLabel: string;
  total_employees: number;
  total_approved_hours: number;
  total_gross_vnd: number;
  total_deductions_vnd: number;
  total_net_vnd: number;
  unreconciled_records_count: number;
  published_at?: string | null; published_by?: string | null;
  paid_at?: string | null; paid_by?: string | null; paid_by_name?: string;
  note?: string; version: number;
}

export interface PayrollItemRow {
  id: string; periodId: string; employeeId: string; employeeCode: string; employeeName: string;
  itemType: string; itemTypeLabel: string; direction: 'ADD' | 'DEDUCT'; title: string;
  quantity: number; unitAmountVnd: number; totalAmountVnd: number; note: string; version: number;
}

export const fmtVnd = (n: number) => `${Math.round(n || 0).toLocaleString('vi-VN')} đ`;
export const MONEY_INPUT_PROPS = {
  formatter: (v?: number | string) => {
    if (v === undefined || v === null || v === '') return '';
    const str = String(v);
    const neg = str.startsWith('-') ? '-' : '';
    const digits = str.replace(/[^\d]/g, '');
    return digits ? `${neg}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : neg;
  },
  parser: (v?: string) => {
    const raw = (v ?? '').replace(/\./g, '').replace(/,/g, '').trim();
    if (!raw || raw === '-') return '' as unknown as number;
    const n = Number(raw);
    return Number.isNaN(n) ? ('' as unknown as number) : n;
  },
};
export const allowancesOf = (r: PayrollSnapshotItem) => r.mealAllowanceVnd + r.transportAllowanceVnd + r.otherAllowancesVnd + r.shiftSwapAllowanceVnd;
export const bonusesOf = (r: PayrollSnapshotItem) => r.attendanceBonusVnd + r.kpiBonusVnd + r.positiveAdjustmentsVnd;
export const deductionsOf = (r: PayrollSnapshotItem) => r.approvedDeductionsVnd + r.advanceDeductionVnd;
