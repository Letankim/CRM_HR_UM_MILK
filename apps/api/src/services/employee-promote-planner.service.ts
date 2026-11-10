import {
  addDaysYmd, DEFAULT_SHIFT_LABELS, mondayOfWeek, weekDates, type Employee, type LeaveRequest, type ShiftAssignment,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs, nowIso } from '../lib/time.js';
import { findBranchShiftTemplate, resolveEmployeeBranchId } from '../routes/account-employee-sync.js';
import { isCountedWorkShift, matchEmp, weekLockCode } from './schedule-rules.js';
import { assertShiftNotInPast } from './schedule-rules.js';
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

  // 1. Tìm các ca thử việc cũ cần thu hồi (tô đỏ)
  const staleShifts: PromoteSchedulePreviewItem[] = [];
  const candidateStale = ctx.db.shiftAssignments.filter(
    (a) => isEmp(a.employee_id) && a.employee_stage === 'PROBATION' && a.work_date >= officialFrom && a.status !== 'COMPLETED',
  );
  for (const s of candidateStale) {
    if (ctx.db.attendanceEvents.find((e) => e.assignment_id === s.id)) continue;
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

  // 2. Tìm các đơn nghỉ OFF thử việc cũ cần thu hồi
  const staleLeaves = ctx.db.leaveRequests
    .filter((l) => isEmp(l.employee_id) && l.employee_stage === 'PROBATION' && l.leave_date >= officialFrom && (l.status === 'APPROVED' || l.status === 'PENDING'))
    .map((l) => ({ id: l.id, requestCode: l.request_code, leaveDate: l.leave_date, reason: l.reason }));

  // 3. Dự kiến các ca chính thức bổ sung trong tuần hiện tại (tô xanh)
  const suggestedShifts: PromoteSchedulePreviewItem[] = [];
  if (defTpl) {
    const mon = mondayOfWeek(officialFrom);
    const weekDays = weekDates(mon);
    const existingWorkDates = new Set(
      ctx.db.shiftAssignments
        .filter((a) => isEmp(a.employee_id) && isCountedWorkShift(a) && a.status === 'COMPLETED')
        .map((a) => a.work_date),
    );

    for (const d of weekDays) {
      // TUYỆT ĐỐI KHÔNG TẠO LỊCH TRONG QUÁ KHỨ
      if (d < officialFrom || d < todayStr) continue;
      if (d === todayStr && nowHm >= defTpl.start_time) continue; // Ca hôm nay đã bắt đầu hoặc kết thúc
      if (existingWorkDates.has(d)) continue; // Ngày này đã có ca hoàn thành

      // Kiểm tra định biên tại chi nhánh
      const cap = evaluateBranchShiftCapacity(ctx, {
        branchId: emp.branch_id,
        workDate: d,
        shiftCode: defTpl.code,
        startAt: defTpl.start_time,
        endAt: defTpl.end_time,
        emp,
      });

      // Chỉ đề xuất khi còn chỗ định biên chính thức và không trùng giờ
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
  officialFrom: string,
  shiftsToCreate: { work_date: string; shift_code: string; note?: string }[],
  actorId: string,
): Promise<ShiftAssignment[]> {
  const created: ShiftAssignment[] = [];
  const now = nowIso();
  for (const item of shiftsToCreate) {
    const tpl = findBranchShiftTemplate(ctx, item.shift_code, emp.branch_id);
    const startAt = tpl?.start_time || '07:00', endAt = tpl?.end_time || '12:00';
    // Chặn nghiêm ngặt ca trong quá khứ
    assertShiftNotInPast(item.work_date, startAt);
    const wkCode = weekLockCode(emp.branch_id, mondayOfWeek(item.work_date), ctx.db.partitionMonth);
    const record = await ctx.db.shiftAssignments.insert({
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
    }, actorId);
    created.push(record);
  }
  return created;
}
