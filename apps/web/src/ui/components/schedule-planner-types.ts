import type { OffWindowState } from '@umbm/shared';
import dayjs from 'dayjs';

/** Đơn OFF trong dữ liệu chốt lịch (tuần chính thức / chu kỳ thử việc). */
export interface PlannerOffItem {
  id: string; version: number; requestCode: string; leaveDate: string; status: string; statusLabel: string; reason: string;
  employeeId: string; employeeCode: string; employeeName: string; stage: string; branchId: string; branchCode?: string; branchName: string;
}

/** Ca làm việc đã được lưu chính thức trên bảng phân ca trong tuần / chu kỳ. */
export interface PlannerExistingShift {
  id: string; employeeId: string; employeeCode: string; employeeName: string; stage: string; stageLabel: string;
  branchId: string; branchCode: string; branchName: string; workDate: string; shiftCode: string; shiftLabel: string;
  startAt: string; endAt: string; hours: number; status: string; statusLabel: string; source: string; note: string;
}

/** Ca dự kiến sẽ được hệ thống tự động sắp khi HR chốt lịch. */
export interface PlannerShift {
  employeeId: string; employeeCode: string; employeeName: string; stage: string; stageLabel?: string;
  branchId: string; branchCode?: string; branchName?: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; hours: number; templateId: string; isCoverShift?: boolean;
}

/** Trạng thái chốt lịch theo từng chi nhánh trong tuần đang xem. */
export interface PlannerBranchStatus {
  branchId: string; branchCode: string; branchName: string; isLocked: boolean; lockedAt: string | null; lockNote: string;
}

/** Thống kê phân bổ số ca tuần này & tích lũy 4 tuần trước của từng nhân sự chính thức theo nhóm ca mặc định. */
export interface PlannerEmployeeLoadItem {
  employeeId: string; employeeCode: string; employeeName: string;
  branchId: string; branchCode: string; branchName: string;
  defaultShiftCode: string; defaultShiftLabel: string; groupSize: number;
  existingShiftsCount: number; plannedShiftsCount: number;
  totalWeekShifts: number; totalWeekHours: number;
  offDaysCount: number; recent4WeeksShifts: number;
}

/** Phần tử hiển thị trong ô Lưới Lịch Tuần (kết hợp ca đã có và ca dự kiến tự sinh). */
export interface PlannerMatrixCellItem {
  key: string; employeeId: string; employeeCode: string; employeeName: string; stage: string; stageLabel: string;
  branchId: string; branchCode: string; branchName: string; workDate: string; shiftCode: string; shiftLabel: string;
  startAt: string; endAt: string; hours: number; status: string; statusLabel: string;
  isPlanned: boolean; isCoverShift: boolean; note: string;
}

export interface PlannerIssue {
  kind: 'NO_TEMPLATE' | 'CAPACITY_FULL' | 'CONFLICT' | 'MAX_PER_DAY' | 'UNDERSTAFFED' | 'OFF_QUOTA' | 'NOT_ENOUGH_SHIFTS';
  employeeId: string; employeeName: string; workDate: string; shiftCode: string; message: string;
}

export interface PlannerWeekData {
  weekStart: string; weekEnd: string; branchId: string; offWindow: OffWindowState;
  isLocked: boolean; lockedAt: string | null; lockNote: string;
  branchStatuses?: PlannerBranchStatus[];
  existingShifts?: PlannerExistingShift[];
  employeeLoads?: PlannerEmployeeLoadItem[];
  offRequests: PlannerOffItem[]; planned: PlannerShift[]; issues: PlannerIssue[];
  summary: { plannedCount: number; existingCount?: number; offCount: number; pendingOffCount: number; issueCount: number };
}

export interface PlannerWeekLockResult {
  weekStart: string; createdCount: number; approvedOffCount: number; createdIds: string[]; issues: PlannerIssue[]; alreadyLocked?: boolean;
}

export interface PlannerProbationItem {
  employeeId: string; employeeVersion: number; employeeCode: string; employeeName: string;
  branchId: string; branchCode?: string; branchName: string; defaultShiftCode: string;
  cycleStart: string; cycleEnd: string; workRequired: number; offLimit: number; existingCount: number; completedCount: number; readyForOfficial: boolean;
  existingShifts?: PlannerExistingShift[];
  offRequests: PlannerOffItem[]; planned: PlannerShift[]; issues: PlannerIssue[];
  isLocked: boolean; lockedAt: string | null; pendingExtraShifts: number;
}

export interface PlannerProbationLockResult {
  createdCount: number; approvedOffCount: number; cycleStart: string; cycleEnd: string; issues: PlannerIssue[]; alreadyLocked?: boolean;
}

/** Gộp danh sách ca đã lưu + ca dự kiến tự động sinh (khi chưa chốt) thành dữ liệu hiển thị Lưới Lịch Tuần. */
export function buildPlannerMatrixItems(existingShifts: PlannerExistingShift[] = [], planned: PlannerShift[] = [], isLocked = false): PlannerMatrixCellItem[] {
  const committed: PlannerMatrixCellItem[] = existingShifts.map((s) => ({
    key: `ex-${s.id}`, employeeId: s.employeeId, employeeCode: s.employeeCode, employeeName: s.employeeName,
    stage: s.stage, stageLabel: s.stageLabel, branchId: s.branchId, branchCode: s.branchCode, branchName: s.branchName,
    workDate: s.workDate, shiftCode: s.shiftCode, shiftLabel: s.shiftLabel, startAt: s.startAt, endAt: s.endAt,
    hours: s.hours, status: s.status, statusLabel: s.statusLabel, isPlanned: false, isCoverShift: false, note: s.note,
  }));
  if (isLocked) return committed;
  const preview: PlannerMatrixCellItem[] = planned.map((p, idx) => ({
    key: `pl-${p.branchId}-${p.employeeId}-${p.workDate}-${p.shiftCode}-${idx}`,
    employeeId: p.employeeId, employeeCode: p.employeeCode, employeeName: p.employeeName,
    stage: p.stage, stageLabel: p.stageLabel ?? (p.stage === 'OFFICIAL' ? 'Nhân viên chính thức' : 'Nhân viên thử việc'),
    branchId: p.branchId, branchCode: p.branchCode ?? '', branchName: p.branchName ?? 'Chi nhánh',
    workDate: p.workDate, shiftCode: p.shiftCode, shiftLabel: p.shiftLabel, startAt: p.startAt, endAt: p.endAt,
    hours: p.hours, status: 'PUBLISHED', statusLabel: p.isCoverShift ? 'Tự động bù OFF' : 'Dự kiến tự động sắp',
    isPlanned: true, isCoverShift: Boolean(p.isCoverShift),
    note: p.isCoverShift ? 'Điều phối bù ca OFF để đủ 1 người/ca' : 'Sắp theo ca mặc định (1 người/ca)',
  }));
  return [...committed, ...preview];
}

const ERROR_ISSUE_KINDS = new Set<PlannerIssue['kind']>(['NO_TEMPLATE', 'CAPACITY_FULL', 'CONFLICT', 'UNDERSTAFFED', 'NOT_ENOUGH_SHIFTS']);
export const issueSeverity = (i: PlannerIssue): 'error' | 'warning' => (ERROR_ISSUE_KINDS.has(i.kind) ? 'error' : 'warning');

export const fmtYmd = (raw?: string | null) => (raw ? dayjs(raw).format('DD/MM/YYYY') : '—');
export const fmtDm = (raw?: string | null) => (raw ? dayjs(raw).format('DD/MM') : '—');
export const fmtTs = (raw?: string | null) => (raw ? dayjs(raw).format('HH:mm DD/MM/YYYY') : '—');
export const cleanShiftLabel = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
