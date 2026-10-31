import type { OffWindowState } from '@umbm/shared';
import dayjs from 'dayjs';

/** Đơn OFF trong dữ liệu chốt lịch (tuần chính thức / chu kỳ thử việc). */
export interface PlannerOffItem {
  id: string; version: number; requestCode: string; leaveDate: string; status: string; statusLabel: string; reason: string;
  employeeId: string; employeeCode: string; employeeName: string; stage: string; branchId: string; branchName: string;
}

/** Ca dự kiến sẽ được hệ thống tự động sắp khi HR chốt lịch. */
export interface PlannerShift {
  employeeId: string; employeeCode: string; employeeName: string; stage: string; branchId: string; branchName?: string;
  workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; hours: number; templateId: string; isCoverShift?: boolean;
}

export interface PlannerIssue {
  kind: 'NO_TEMPLATE' | 'CAPACITY_FULL' | 'CONFLICT' | 'MAX_PER_DAY' | 'UNDERSTAFFED' | 'OFF_QUOTA' | 'NOT_ENOUGH_SHIFTS';
  employeeId: string; employeeName: string; workDate: string; shiftCode: string; message: string;
}

export interface PlannerWeekData {
  weekStart: string; weekEnd: string; branchId: string; offWindow: OffWindowState;
  isLocked: boolean; lockedAt: string | null; lockNote: string;
  offRequests: PlannerOffItem[]; planned: PlannerShift[]; issues: PlannerIssue[];
  summary: { plannedCount: number; offCount: number; pendingOffCount: number; issueCount: number };
}

export interface PlannerWeekLockResult { weekStart: string; createdCount: number; approvedOffCount: number; createdIds: string[]; issues: PlannerIssue[] }

export interface PlannerProbationItem {
  employeeId: string; employeeVersion: number; employeeCode: string; employeeName: string; branchId: string; branchName: string; defaultShiftCode: string;
  cycleStart: string; cycleEnd: string; workRequired: number; offLimit: number; existingCount: number; completedCount: number; readyForOfficial: boolean;
  offRequests: PlannerOffItem[]; planned: PlannerShift[]; issues: PlannerIssue[];
  isLocked: boolean; lockedAt: string | null; pendingExtraShifts: number;
}

export interface PlannerProbationLockResult { createdCount: number; approvedOffCount: number; cycleStart: string; cycleEnd: string; issues: PlannerIssue[] }

/** Các loại vướng mắc nghiêm trọng (thiếu hoặc vượt 1 người/ca, không xếp được ca) hiển thị màu đỏ; còn lại là cảnh báo. */
const ERROR_ISSUE_KINDS = new Set<PlannerIssue['kind']>(['NO_TEMPLATE', 'CAPACITY_FULL', 'CONFLICT', 'UNDERSTAFFED', 'NOT_ENOUGH_SHIFTS']);
export const issueSeverity = (i: PlannerIssue): 'error' | 'warning' => (ERROR_ISSUE_KINDS.has(i.kind) ? 'error' : 'warning');

export const fmtYmd = (raw?: string | null) => (raw ? dayjs(raw).format('DD/MM/YYYY') : '—');
export const fmtDm = (raw?: string | null) => (raw ? dayjs(raw).format('DD/MM') : '—');
export const fmtTs = (raw?: string | null) => (raw ? dayjs(raw).format('HH:mm DD/MM/YYYY') : '—');
export const cleanShiftLabel = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
