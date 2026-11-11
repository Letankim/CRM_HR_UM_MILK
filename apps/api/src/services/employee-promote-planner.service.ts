import {
   DEFAULT_SHIFT_LABELS, mondayOfWeek, weekDates, type AttendanceEvent, type Employee, type LeaveRequest, type ShiftAssignment,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { findBranchShiftTemplate } from '../routes/account-employee-sync.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { getCachedPartitionStore, insertPartitionAwareRecord, resolveTargetMonthForRecord } from './partition-write-router.js';
import { assertShiftNotInPast, isCountedWorkShift, matchEmp, weekLockCode } from './schedule-rules.js';
import { evaluateBranchShiftCapacity } from './schedule-staffing-helper.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

export interface PromoteSchedulePreviewItem {
  id?: string;
  action: 'REMOVE' | 'CREATE';
  workDate: string;
  shiftCode: string;
  shiftLabel: string;
  startAt: string;
  endAt: string;
  hours: number;
  reason?: string;
  note?: string;
  selected?: boolean;
}

export interface PromoteSchedulePreviewResult {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    branchId: string;
    branchName: string;
    stage: string;
    defaultShiftCode: string;
    defaultShiftLabel: string;
  };
  officialFrom: string;
  todayStr: string;
  staleShifts: PromoteSchedulePreviewItem[];
  staleLeaves: { id: string; requestCode: string; leaveDate: string; reason: string }[];
  suggestedShifts: PromoteSchedulePreviewItem[];
  allPreviewItems: PromoteSchedulePreviewItem[];
}

export function buildPromoteSchedulePreview(
  ctx: AppContext,
  emp: Employee,
  officialFrom: string,
): PromoteSchedulePreviewResult {
  const { todayStr, nowHm } = getVnNowDateAndHm();
  const isEmp = matchEmp(emp);
  const branch = ctx.db.branches.get(emp.branch_id);
  const branchName = branch ? `${branch.code} — ${branch.name}` : emp.branch_id;
  const defCode = (emp.default_shift_code || 'CA_SANG').toUpperCase();
  const defTpl = findBranchShiftTemplate(ctx, defCode, emp.branch_id);
  const defLabel = defTpl?.name ?? DEFAULT_SHIFT_LABELS[defCode as keyof typeof DEFAULT_SHIFT_LABELS] ?? defCode;

  const regMonths = readPartitionRegistry(ctx.db).map((r) => r.monthKey);
  const months = regMonths.length > 0 ? Array.from(new Set([...regMonths, ...(ctx.db.partitionMonth ? [ctx.db.partitionMonth] : [])])) : [ctx.db.partitionMonth];

  const staleShifts: PromoteSchedulePreviewItem[] = [];
  const seenShiftIds = new Set<string>();
  const completedDates = new Set<string>();
  for (const mk of months) {
    const shStore = getCachedPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.shiftAssignments : undefined);
    const evStore = getCachedPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.attendanceEvents : undefined);
    if (!shStore) continue;
    for (const s of shStore.all()) {
      if (!isEmp(s.employee_id) || seenShiftIds.has(s.id)) continue;
      seenShiftIds.add(s.id);
      if (isCountedWorkShift(s) && s.status === 'COMPLETED') completedDates.add(s.work_date);
      if (s.employee_stage !== 'PROBATION' || s.work_date < officialFrom || s.status === 'COMPLETED') continue;
      if (evStore?.find((e) => e.assignment_id === s.id)) continue;
      const tpl = findBranchShiftTemplate(ctx, s.shift_code, emp.branch_id);
      staleShifts.push({
        id: s.id,
        action: 'REMOVE',
        workDate: s.work_date,
        shiftCode: s.shift_code,
        shiftLabel: tpl?.name ?? DEFAULT_SHIFT_LABELS[s.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? s.shift_code,
        startAt: s.start_at || tpl?.start_time || '07:00',
        endAt: s.end_at || tpl?.end_time || '12:00',
        hours: s.scheduled_hours || tpl?.standard_hours || 5,
        reason: 'Thu hồi ca thử việc cũ để tránh trùng định biên chính thức',
      });
    }
  }

  const staleLeaves: { id: string; requestCode: string; leaveDate: string; reason: string }[] = [];
  const seenLeaveIds = new Set<string>();
  for (const mk of months) {
    const lvStore = getCachedPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk) ?? (mk === ctx.db.partitionMonth ? ctx.db.leaveRequests : undefined);
    if (!lvStore) continue;
    for (const l of lvStore.all()) {
      if (!isEmp(l.employee_id) || seenLeaveIds.has(l.id)) continue;
      seenLeaveIds.add(l.id);
      if (l.employee_stage === 'PROBATION' && l.leave_date >= officialFrom && (l.status === 'APPROVED' || l.status === 'PENDING')) {
        staleLeaves.push({ id: l.id, requestCode: l.request_code, leaveDate: l.leave_date, reason: l.reason });
      }
    }
  }

  const suggestedShifts: PromoteSchedulePreviewItem[] = [];
  if (defTpl) {
    const mon = mondayOfWeek(officialFrom);
    const weekDays = weekDates(mon);
    for (const d of weekDays) {
      if (d < officialFrom || d < todayStr) continue;
      if (d === todayStr && nowHm >= defTpl.start_time) continue;
      if (completedDates.has(d)) continue;
      const cap = evaluateBranchShiftCapacity(ctx, {
        branchId: emp.branch_id,
        workDate: d,
        shiftCode: defTpl.code,
        startAt: defTpl.start_time,
        endAt: defTpl.end_time,
        emp,
      });
      if (!cap.isFullOrExceeded && !cap.hasOverlappingShift && !cap.alreadyHasShift) {
        suggestedShifts.push({
          action: 'CREATE',
          workDate: d,
          shiftCode: defTpl.code,
          shiftLabel: defTpl.name,
          startAt: defTpl.start_time,
          endAt: defTpl.end_time,
          hours: defTpl.standard_hours || 5,
          reason: `Bổ sung ca chính thức (${defTpl.name}) theo định biên còn trống`,
          note: 'Tự động bổ sung ca chính thức khi chuyển chính thức',
          selected: true,
        });
      }
    }
  }

  const allPreviewItems = [
    ...staleShifts.sort((a, b) => a.workDate.localeCompare(b.workDate)),
    ...suggestedShifts.sort((a, b) => a.workDate.localeCompare(b.workDate)),
  ];

  return {
    employee: {
      id: emp.id,
      employeeCode: emp.employee_code,
      fullName: emp.full_name,
      branchId: emp.branch_id,
      branchName,
      stage: emp.stage,
      defaultShiftCode: defCode,
      defaultShiftLabel: defLabel,
    },
    officialFrom,
    todayStr,
    staleShifts,
    staleLeaves,
    suggestedShifts,
    allPreviewItems,
  };
}

export async function createPromoteOfficialShifts(
  ctx: AppContext,
  emp: Employee,
  _officialFrom: string,
  shiftsToCreate: { work_date: string; shift_code: string; note?: string }[],
  actorId: string,
): Promise<ShiftAssignment[]> {
  const created: ShiftAssignment[] = [];
  const now = nowIso();
  for (const item of shiftsToCreate) {
    const tpl = findBranchShiftTemplate(ctx, item.shift_code, emp.branch_id);
    const startAt = tpl?.start_time || '07:00', endAt = tpl?.end_time || '12:00';
    assertShiftNotInPast(item.work_date, startAt);
    const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: item.work_date }, item.work_date);
    const wkCode = weekLockCode(emp.branch_id, mondayOfWeek(item.work_date), targetMonth);
    const record = await insertPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', {
      schedule_week_id: wkCode,
      employee_id: emp.id,
      branch_id: emp.branch_id,
      work_date: item.work_date,
      shift_template_id: tpl?.id ?? '',
      start_at: startAt,
      end_at: endAt,
      status: 'PUBLISHED',
      source: 'AUTO_PLAN',
      employee_stage: 'OFFICIAL',
      day_type: 'WORK',
      shift_code: item.shift_code,
      scheduled_hours: tpl?.standard_hours || 5,
      swapped_from_employee_id: '',
      replacement_for_employee_id: '',
      published_at: now,
      note: item.note || 'Tự động bổ sung ca làm việc chính thức khi chuyển chính thức',
      linked_assignment_id: '',
    }, item.work_date, actorId);
    created.push(record);
  }
  return created;
}
