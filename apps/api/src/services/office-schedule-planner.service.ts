import { addDaysYmd, mondayOfWeek, OFFICE_WORKDAY_MODE_LABELS, type Employee, type OfficeWorkdayMode, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { emitScheduleRealtime } from '../routes/account-employee-sync.js';
import { ensurePersonalProfile } from '../routes/my-attendance.routes.js';
import { getOperationSettings } from './operations-settings.service.js';

export function isOfficeEmployee(emp: Employee, userRole?: string): boolean {
  return emp.staff_group === 'BACKOFFICE' || emp.staff_group === 'OFFICE' || emp.staff_group === 'STORE_MANAGER'
    || ['HR', 'FINANCE', 'MKT', 'ADMIN', 'STORE'].includes(userRole ?? '');
}

export async function ensureOfficeStaffProfiles(ctx: AppContext) {
  const officeUsers = ctx.db.users.filter((u) => u.status === 'ACTIVE' && ['HR', 'FINANCE', 'MKT', 'ADMIN', 'STORE'].includes(u.role));
  for (const u of officeUsers) {
    await ensurePersonalProfile(ctx, u).catch(() => undefined);
  }
}

export interface OfficeWorkdayItem {
  date: string;
  weekday: number;
  isWorkday: boolean;
  isHalfDay: boolean;
}

export function getOfficeWorkdays(weekStart: string, mode: OfficeWorkdayMode): OfficeWorkdayItem[] {
  const mon = mondayOfWeek(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysYmd(mon, i);
    const weekday = i + 1;
    if (weekday <= 5) return { date, weekday, isWorkday: true, isHalfDay: false };
    if (weekday === 6) {
      if (mode === 'MON_TO_SAT') return { date, weekday, isWorkday: true, isHalfDay: false };
      if (mode === 'MON_TO_SAT_MORNING') return { date, weekday, isWorkday: true, isHalfDay: true };
      return { date, weekday, isWorkday: false, isHalfDay: false };
    }
    return { date, weekday, isWorkday: false, isHalfDay: false };
  });
}

export interface OfficeScheduleShiftPlan {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string;
  workDate: string;
  shiftCode: string;
  startAt: string;
  endAt: string;
  hours: number;
  templateId: string;
  isHalfDay: boolean;
  note: string;
}

export async function planOfficeShiftsForWeek(ctx: AppContext, params: { weekStart: string; branchId?: string; mode?: OfficeWorkdayMode }) {
  await ensureOfficeStaffProfiles(ctx);
  const settings = getOperationSettings(ctx.db);
  const mode = params.mode ?? settings.officeWorkdayMode;
  const mon = mondayOfWeek(params.weekStart);
  const weekEnd = addDaysYmd(mon, 6);
  const workdays = getOfficeWorkdays(mon, mode);
  const usersByEmpId = new Map(ctx.db.users.all().filter((u) => u.employee_id).map((u) => [u.employee_id!, u]));

  let staff = ctx.db.employees.filter((e) => e.status === 'ACTIVE' && isOfficeEmployee(e, usersByEmpId.get(e.id)?.role || usersByEmpId.get(e.employee_code)?.role));
  if (params.branchId && params.branchId !== 'ALL') {
    staff = staff.filter((e) => e.branch_id === params.branchId);
  }

  const hcTpl = ctx.db.shiftTemplates.find((t) => t.code === 'HANH_CHINH' && t.status === 'ACTIVE')
    ?? ctx.db.shiftTemplates.find((t) => t.code === 'HANH_CHINH');
  const tplId = hcTpl?.id ?? '';
  const hcStart = hcTpl?.start_time || '08:00';
  const hcEnd = hcTpl?.end_time || '17:30';
  const hcHours = hcTpl?.standard_hours ?? 8;

  const toCreate: OfficeScheduleShiftPlan[] = [];
  let skippedExisting = 0;
  let skippedOff = 0;

  for (const emp of staff) {
    const branchId = emp.branch_id || ctx.db.branches.find((b) => b.status === 'ACTIVE')?.id || '';
    for (const d of workdays) {
      if (!d.isWorkday) continue;
      const hasOff = ctx.db.leaveRequests.filter((l) => (l.employee_id === emp.id || l.employee_id === emp.employee_code) && l.leave_date === d.date && l.status === 'APPROVED').length > 0;
      if (hasOff) { skippedOff++; continue; }
      const hasShift = ctx.db.shiftAssignments.filter((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === d.date && a.day_type !== 'OFF').length > 0;
      if (hasShift) { skippedExisting++; continue; }

      const startAt = d.isHalfDay ? settings.officeSaturdayStartTime : hcStart;
      const endAt = d.isHalfDay ? settings.officeSaturdayEndTime : hcEnd;
      const hours = d.isHalfDay ? settings.officeSaturdayHours : hcHours;
      const shiftCode = d.isHalfDay ? 'HC_SANG' : 'HANH_CHINH';
      const note = d.isHalfDay ? 'Ca hành chính sáng Thứ 7 khối văn phòng' : 'Ca hành chính khối văn phòng';

      toCreate.push({
        employeeId: emp.id, employeeCode: emp.employee_code, employeeName: emp.full_name, branchId, workDate: d.date,
        shiftCode, startAt, endAt, hours, templateId: tplId, isHalfDay: d.isHalfDay, note,
      });
    }
  }

  return {
    weekStart: mon, weekEnd, mode, modeLabel: OFFICE_WORKDAY_MODE_LABELS[mode],
    staffCount: staff.length, workdays, toCreate, skippedExisting, skippedOff,
    staffSummary: staff.map((e) => ({
      id: e.id, code: e.employee_code, name: e.full_name, branchId: e.branch_id,
      plannedCount: toCreate.filter((c) => c.employeeId === e.id).length,
    })),
  };
}

export async function executePublishOfficeShifts(
  ctx: AppContext,
  params: { weekStart: string; branchId?: string; mode?: OfficeWorkdayMode; note?: string; actorId: string },
) {
  const plan = await planOfficeShiftsForWeek(ctx, params);
  const now = nowIso();
  const created: ShiftAssignment[] = [];

  for (const item of plan.toCreate) {
    const inserted = await ctx.db.shiftAssignments.insert({
      schedule_week_id: '',
      employee_id: item.employeeId,
      branch_id: item.branchId,
      shift_template_id: item.templateId,
      shift_code: item.shiftCode,
      work_date: item.workDate,
      start_at: item.startAt,
      end_at: item.endAt,
      scheduled_hours: item.hours,
      status: 'PUBLISHED',
      source: 'OFFICE_ROSTER',
      employee_stage: 'OFFICIAL',
      day_type: 'WORK',
      published_at: now,
      swapped_from_employee_id: '',
      replacement_for_employee_id: '',
      linked_assignment_id: '',
      note: params.note ? `${item.note} · ${params.note}` : item.note,
    }, params.actorId);
    created.push(inserted);
  }

  const branchIds = Array.from(new Set(plan.toCreate.map((c) => c.branchId)));
  for (const bId of branchIds) {
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, {
      branchId: bId, employeeIds: plan.toCreate.filter((c) => c.branchId === bId).map((c) => c.employeeId),
      kind: 'SHIFT_APPROVED', message: `HR đã phát hành lịch làm việc khối văn phòng tuần ${plan.weekStart}`, actorId: params.actorId,
    });
  }

  return {
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    mode: plan.mode,
    modeLabel: plan.modeLabel,
    createdCount: created.length,
    skippedExistingCount: plan.skippedExisting,
    skippedOffCount: plan.skippedOff,
    staffCount: plan.staffCount,
    createdIds: created.map((c) => c.id),
  };
}
