import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addDaysYmd, DEFAULT_SHIFT_LABELS, EMPLOYEE_STAGE_LABELS, evaluateOffWindow, mondayOfWeek,
  REQUEST_STATUS_LABELS, STATUS_VISUAL_MAP, type DefaultShiftCode, type Employee, type EmployeeStage,
  type LeaveRequest, type ShiftAssignment,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { planOfficialWeek, planProbationCycle, type PlannedShift, type PlanIssue, type PlanResult } from '../services/schedule-auto-planner.js';
import { summarizeOfficialEmployeeWeekLoads } from '../services/schedule-fairness.js';
import { findProbationLock, findWeekLock, isCountedWorkShift, matchEmp, probationLockCode, weekLockCode } from '../services/schedule-rules.js';
import { clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, findBranchShiftTemplate, resolveEmployeeBranchId } from './account-employee-sync.js';

const zWeekQuery = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD').optional(), branch_id: z.string().trim().optional().default('ALL') });
const zWeekLockBody = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD'), branch_id: z.string().trim().optional().default('ALL'), note: z.string().trim().max(300).optional().default('') });
const zProbationLockBody = z.object({ employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân viên thử việc') });
const OFF_ACTIVE = new Set(['PENDING', 'DRAFT', 'APPROVED']);

function mapOff(ctx: AppContext, l: LeaveRequest) {
  const emp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === l.employee_id);
  const bId = emp?.branch_id ?? l.branch_id, br = ctx.db.branches.get(bId);
  return { id: l.id, version: l.version, requestCode: l.request_code, leaveDate: l.leave_date, status: l.status, statusLabel: REQUEST_STATUS_LABELS[l.status], reason: l.reason, employeeId: emp?.id ?? l.employee_id, employeeCode: emp?.employee_code ?? l.employee_id, employeeName: emp?.full_name ?? 'Nhân sự', stage: emp?.stage ?? l.employee_stage, branchId: bId, branchCode: br?.code ?? '', branchName: br?.name ?? 'Chi nhánh' };
}

function mapExistingShift(ctx: AppContext, a: ShiftAssignment) {
  const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
  const bId = resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id), br = ctx.db.branches.get(bId);
  const tpl = (a.shift_template_id ? ctx.db.shiftTemplates.get(a.shift_template_id) : undefined) ?? findBranchShiftTemplate(ctx, a.shift_code, bId);
  const stage = (emp?.stage ?? a.employee_stage) as EmployeeStage;
  return {
    id: a.id, employeeId: emp?.id ?? a.employee_id, employeeCode: emp?.employee_code ?? a.employee_id, employeeName: emp?.full_name ?? 'Nhân sự',
    stage, stageLabel: EMPLOYEE_STAGE_LABELS[stage] ?? 'Nhân sự', branchId: bId, branchCode: br?.code ?? '', branchName: br?.name ?? 'Chi nhánh',
    workDate: a.work_date, shiftCode: a.shift_code, shiftLabel: tpl?.name ?? DEFAULT_SHIFT_LABELS[a.shift_code as DefaultShiftCode] ?? a.shift_code,
    startAt: a.start_at || tpl?.start_time || '07:00', endAt: a.end_at || tpl?.end_time || '12:00', hours: a.scheduled_hours || tpl?.standard_hours || 5,
    status: a.status, statusLabel: STATUS_VISUAL_MAP[a.status]?.label ?? a.status, source: a.source, note: a.note ?? '',
  };
}

function enrichPlanned(ctx: AppContext, list: PlannedShift[]) {
  return list.map((p) => {
    const br = ctx.db.branches.get(p.branchId);
    return { ...p, branchCode: br?.code ?? '', branchName: p.branchName ?? br?.name ?? 'Chi nhánh', stageLabel: EMPLOYEE_STAGE_LABELS[p.stage] ?? 'Nhân sự' };
  });
}

async function applyPlan(ctx: AppContext, plan: PlanResult, lock: { code: string; branchId: string; weekStart: string; weekEnd: string; kind: 'WEEKLY' | 'PROBATION_12_DAYS'; note: string }, actorId: string) {
  const now = nowIso();
  const pendingOffs = plan.offRequests.filter((l) => l.status === 'PENDING' || l.status === 'DRAFT');
  if (pendingOffs.length > 0) {
    await ctx.db.leaveRequests.batchUpdate(pendingOffs.map((l) => ({ id: l.id, expectedVersion: l.version, patch: { status: 'APPROVED' as const, decided_by: actorId, decided_at: now, decision_reason: 'Đã duyệt khi HR chốt lịch & tự động sắp ca' } })), actorId);
  }
  for (const off of plan.offRequests) {
    const emp = ctx.db.employees.get(off.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === off.employee_id);
    const staleShifts = ctx.db.shiftAssignments.filter((a) => a.work_date === off.leave_date && isCountedWorkShift(a) && (a.employee_id === off.employee_id || Boolean(emp && matchEmp(emp)(a.employee_id))));
    for (const s of staleShifts) {
      await ctx.db.shiftAssignments.softDelete(s.id, s.version, actorId);
      await clearShiftAttendanceOnWorkflowOverride(ctx.db, s, actorId, 'Đã duyệt đơn nghỉ OFF khi HR chốt lịch');
    }
  }
  for (const p of plan.planned) {
    const staleDrafts = ctx.db.shiftAssignments.filter((a) => a.status === 'DRAFT' && a.work_date === p.workDate && a.shift_code === p.shiftCode && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === p.branchId);
    for (const d of staleDrafts) await ctx.db.shiftAssignments.softDelete(d.id, d.version, actorId);
  }
  const created = await Promise.all(plan.planned.map((p) => ctx.db.shiftAssignments.insert({
    schedule_week_id: lock.code, employee_id: p.employeeId, branch_id: p.branchId, work_date: p.workDate, shift_template_id: p.templateId,
    start_at: p.startAt, end_at: p.endAt, status: 'PUBLISHED', source: 'AUTO_PLAN', employee_stage: p.stage, day_type: 'WORK', shift_code: p.shiftCode,
    scheduled_hours: p.hours, swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: now,
    note: p.isCoverShift ? 'Tự động điều phối bù ca OFF để đủ 1 người/ca khi HR chốt lịch' : 'Tự động sắp ca theo ca mặc định (1 người/ca) khi HR chốt lịch',
    linked_assignment_id: '',
  }, actorId)));
  const existing = ctx.db.scheduleWeeks.find((w) => w.code === lock.code);
  const record = { branch_id: lock.branchId, week_start: lock.weekStart, week_end: lock.weekEnd, status: 'PUBLISHED' as const, published_by: actorId, published_at: now, code: lock.code, schedule_kind: lock.kind, store_confirmed_by: '', store_confirmed_at: '', locked_at: now, note: lock.note || `Đã xếp ${created.length} ca · Duyệt ${pendingOffs.length} đơn OFF · ${plan.issues.length} cảnh báo` };
  if (existing) await ctx.db.scheduleWeeks.update(existing.id, existing.version, record, actorId);
  else await ctx.db.scheduleWeeks.insert(record, actorId);
  return { createdCount: created.length, approvedOffCount: pendingOffs.length, createdIds: created.map((c) => c.id) };
}

export async function schedulePlannerRoutes(app: FastifyInstance, ctx: AppContext) {
  const readPerms = requirePermission('schedule.read', 'schedule.propose', 'schedule.publish', 'leave.approve');

  app.get('/api/admin/schedule-planner/week', { preHandler: readPerms }, async (request) => {
    const q = zWeekQuery.parse(request.query ?? {});
    if (q.branch_id !== 'ALL') assertBranchAccess(request, q.branch_id);
    const settings = getOperationSettings(ctx.db), { todayStr, nowHm } = getVnNowDateAndHm(), offWindow = evaluateOffWindow(settings, todayStr, nowHm);
    const weekStart = q.week_start ? mondayOfWeek(q.week_start) : offWindow.targetWeekStart, weekEnd = addDaysYmd(weekStart, 6);
    const accessibleBranches = filterByBranch(request, ctx.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code)), (b) => b.id);
    const branchStatuses = accessibleBranches.map((b) => {
      const lk = findWeekLock(ctx, b.id, weekStart);
      return { branchId: b.id, branchCode: b.code, branchName: b.name, isLocked: Boolean(lk), lockedAt: lk?.locked_at ?? null, lockNote: lk?.note ?? '' };
    });
    const targetBranches = q.branch_id === 'ALL' ? accessibleBranches : accessibleBranches.filter((b) => b.id === q.branch_id || b.code === q.branch_id);
    const plannedRaw: PlannedShift[] = [], issues: PlanIssue[] = [], offRaw: LeaveRequest[] = [], existingRaw: ShiftAssignment[] = [];

    for (const b of targetBranches) {
      const bLocked = Boolean(findWeekLock(ctx, b.id, weekStart));
      const bEmps = ctx.db.employees.filter((e) => e.branch_id === b.id);
      const bOffs = ctx.db.leaveRequests.filter((l) => OFF_ACTIVE.has(l.status) && l.leave_date >= weekStart && l.leave_date <= weekEnd && bEmps.some((e) => matchEmp(e)(l.employee_id)));
      offRaw.push(...bOffs);
      const bShifts = ctx.db.shiftAssignments.filter((a) => a.work_date >= weekStart && a.work_date <= weekEnd && a.status !== 'DRAFT' && isCountedWorkShift(a) && resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id) === b.id);
      if (bLocked) {
        existingRaw.push(...bShifts);
      } else {
        const bPlan = planOfficialWeek(ctx, { weekStart, branchId: b.id });
        plannedRaw.push(...bPlan.planned);
        issues.push(...bPlan.issues);
        existingRaw.push(...bShifts.filter((a) => !bOffs.some((l) => l.leave_date === a.work_date && (a.employee_id === l.employee_id || bEmps.some((e) => matchEmp(e)(a.employee_id) && matchEmp(e)(l.employee_id))))));
      }
    }

    const directLock = findWeekLock(ctx, q.branch_id, weekStart);
    const allLocked = Boolean(directLock) || (targetBranches.length > 0 && targetBranches.every((b) => Boolean(findWeekLock(ctx, b.id, weekStart))));
    const firstLock = directLock ?? (allLocked ? targetBranches.map((b) => findWeekLock(ctx, b.id, weekStart)).find(Boolean) : undefined);
    const offRequests = offRaw.map((l) => mapOff(ctx, l)), existingShifts = existingRaw.map((a) => mapExistingShift(ctx, a)), planned = enrichPlanned(ctx, plannedRaw);
    const employeeLoads = summarizeOfficialEmployeeWeekLoads(ctx, { weekStart, weekEnd, branchIds: targetBranches.map((b) => b.id), existingShifts: existingRaw, plannedShifts: planned, offEmployeeIdsByDate: offRequests });
    return sendSuccess(request, 'Lấy dữ liệu chốt lịch tuần & dự kiến sắp ca thành công', {
      weekStart, weekEnd, branchId: q.branch_id, offWindow, isLocked: allLocked,
      lockedAt: firstLock?.locked_at ?? null, lockNote: firstLock?.note ?? '',
      branchStatuses, existingShifts, offRequests, planned, issues, employeeLoads,
      summary: { plannedCount: planned.length, existingCount: existingShifts.length, offCount: offRequests.length, pendingOffCount: offRequests.filter((o) => o.status === 'PENDING').length, issueCount: issues.length },
    });
  });

  app.post('/api/admin/schedule-planner/week/lock', { preHandler: requirePermission('schedule.publish') }, async (request) => {
    const body = zWeekLockBody.parse(request.body ?? {});
    if (body.branch_id !== 'ALL') assertBranchAccess(request, body.branch_id);
    const weekStart = mondayOfWeek(body.week_start), weekEnd = addDaysYmd(weekStart, 6), actorId = request.auth!.user.id;
    const accessibleBranches = filterByBranch(request, ctx.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code)), (b) => b.id);
    const targetBranches = body.branch_id === 'ALL' ? accessibleBranches : accessibleBranches.filter((b) => b.id === body.branch_id || b.code === body.branch_id);
    const unlockedBranches = targetBranches.filter((b) => !findWeekLock(ctx, b.id, weekStart));
    if (unlockedBranches.length === 0) {
      return sendSuccess(request, 'Chi nhánh đã chốt lịch cho tuần này — chỉ xem lại dữ liệu lịch đã chốt, không sinh lại lịch', {
        weekStart, createdCount: 0, approvedOffCount: 0, createdIds: [], issues: [], alreadyLocked: true,
      });
    }

    let createdCount = 0, approvedOffCount = 0;
    const createdIds: string[] = [], allIssues: PlanIssue[] = [], empIds = new Set<string>();
    for (const b of unlockedBranches) {
      const bPlan = planOfficialWeek(ctx, { weekStart, branchId: b.id });
      const res = await applyPlan(ctx, bPlan, { code: weekLockCode(b.id, weekStart, ctx.db.partitionMonth), branchId: b.id, weekStart, weekEnd, kind: 'WEEKLY', note: body.note }, actorId);
      createdCount += res.createdCount;
      approvedOffCount += res.approvedOffCount;
      createdIds.push(...res.createdIds);
      allIssues.push(...bPlan.issues);
      bPlan.planned.forEach((p) => empIds.add(p.employeeId));
    }
    const allSystemBranches = ctx.db.branches.filter((b) => b.status === 'ACTIVE');
    if (body.branch_id === 'ALL' && allSystemBranches.length > 0 && allSystemBranches.every((b) => Boolean(findWeekLock(ctx, b.id, weekStart)))) {
      const now = nowIso(), allCode = weekLockCode('ALL', weekStart, ctx.db.partitionMonth), exAll = ctx.db.scheduleWeeks.find((w) => w.code === allCode);
      const rec = { branch_id: 'ALL', week_start: weekStart, week_end: weekEnd, status: 'PUBLISHED' as const, published_by: actorId, published_at: now, code: allCode, schedule_kind: 'WEEKLY' as const, store_confirmed_by: '', store_confirmed_at: '', locked_at: now, note: body.note || `Đã chốt toàn hệ thống (${createdCount} ca)` };
      if (exAll) await ctx.db.scheduleWeeks.update(exAll.id, exAll.version, rec, actorId);
      else await ctx.db.scheduleWeeks.insert(rec, actorId);
    }

    await recalculateOpenPeriods(ctx, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'schedule.week.lock', entity: 'SCHEDULE_WEEKS', entityId: weekLockCode(body.branch_id, weekStart, ctx.db.partitionMonth), after: { createdCount, approvedOffCount, issues: allIssues.length } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: body.branch_id, employeeIds: Array.from(empIds), kind: 'SHIFT_APPROVED', message: `HR đã chốt lịch tuần ${weekStart} và tự động sắp ${createdCount} ca`, actorId });
    const warn = allIssues.length > 0 ? ` — Có ${allIssues.length} trường hợp không xếp được, vui lòng xem danh sách cảnh báo` : '';
    return sendSuccess(request, `Đã chốt lịch tuần, duyệt ${approvedOffCount} đơn OFF và tự động sắp ${createdCount} ca theo ca mặc định${warn}`, { weekStart, createdCount, approvedOffCount, createdIds, issues: allIssues });
  });

  app.get('/api/admin/schedule-planner/probation', { preHandler: readPerms }, async (request) => {
    const branchId = z.string().trim().optional().default('ALL').parse((request.query as { branch_id?: string } | undefined)?.branch_id);
    const { todayStr } = getVnNowDateAndHm();
    const emps = filterByBranch(request, ctx.db.employees.filter((e) => e.status === 'ACTIVE' && e.stage === 'PROBATION' && (branchId === 'ALL' || e.branch_id === branchId)), (e) => e.branch_id);
    const items = emps.map((emp: Employee) => {
      const plan = planProbationCycle(ctx, emp, todayStr), lock = findProbationLock(ctx, emp, plan.cycle.start), isEmp = matchEmp(emp), locked = Boolean(lock);
      const completedCount = ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.day_type !== 'OFF' && a.status === 'COMPLETED').length;
      const existingShifts = ctx.db.shiftAssignments
        .filter((a) => isEmp(a.employee_id) && a.work_date >= plan.cycle.start && a.work_date <= plan.cycle.end && a.status !== 'DRAFT' && isCountedWorkShift(a))
        .map((a) => mapExistingShift(ctx, a));
      const br = ctx.db.branches.get(emp.branch_id);
      return {
        employeeId: emp.id, employeeVersion: emp.version, employeeCode: emp.employee_code, employeeName: emp.full_name, branchId: emp.branch_id, branchCode: br?.code ?? '', branchName: br?.name ?? 'Chi nhánh',
        defaultShiftCode: emp.default_shift_code, cycleStart: plan.cycle.start, cycleEnd: plan.cycle.end, workRequired: plan.cycle.workRequired, offLimit: plan.cycle.offLimit,
        existingCount: plan.existingCount, completedCount, readyForOfficial: completedCount >= plan.cycle.workRequired,
        existingShifts, offRequests: plan.offRequests.map((l) => mapOff(ctx, l)),
        planned: locked ? [] : enrichPlanned(ctx, plan.planned), issues: locked ? [] : plan.issues,
        isLocked: locked, lockedAt: lock?.locked_at ?? null,
        pendingExtraShifts: ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.status === 'DRAFT' && a.source === 'PROBATION_EXTRA').length,
      };
    });
    return sendSuccess(request, 'Lấy danh sách chu kỳ thử việc 12 ngày & dự kiến sắp ca thành công', items);
  });

  app.post('/api/admin/schedule-planner/probation/lock', { preHandler: requirePermission('schedule.publish') }, async (request) => {
    const body = zProbationLockBody.parse(request.body ?? {});
    const emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy hồ sơ nhân viên', body.employee_id);
    if (emp.stage !== 'PROBATION') throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Chỉ áp dụng chốt lịch chu kỳ 12 ngày cho nhân viên thử việc', body.employee_id);
    assertBranchAccess(request, emp.branch_id);
    const { todayStr } = getVnNowDateAndHm(), actorId = request.auth!.user.id, plan = planProbationCycle(ctx, emp, todayStr);
    if (findProbationLock(ctx, emp, plan.cycle.start)) {
      return sendSuccess(request, `Chu kỳ thử việc của ${emp.full_name} đã chốt lịch — chỉ xem lại lịch đã chốt`, {
        createdCount: 0, approvedOffCount: 0, cycleStart: plan.cycle.start, cycleEnd: plan.cycle.end, issues: [], alreadyLocked: true,
      });
    }
    const code = probationLockCode(emp.employee_code, plan.cycle.start, ctx.db.partitionMonth);
    const result = await applyPlan(ctx, plan, { code, branchId: emp.branch_id, weekStart: plan.cycle.start, weekEnd: plan.cycle.end, kind: 'PROBATION_12_DAYS', note: '' }, actorId);
    await recalculateOpenPeriods(ctx, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'schedule.probation.lock', entity: 'SCHEDULE_WEEKS', entityId: code, after: { ...result, issues: plan.issues.length } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_APPROVED', message: `HR đã chốt lịch chu kỳ thử việc của ${emp.full_name}`, actorId });
    return sendSuccess(request, `Đã chốt lịch chu kỳ thử việc của ${emp.full_name}: duyệt ${result.approvedOffCount} ngày OFF, xếp ${result.createdCount} ca${plan.issues.length ? ` (${plan.issues.length} cảnh báo)` : ''}`, { ...result, cycleStart: plan.cycle.start, cycleEnd: plan.cycle.end, issues: plan.issues });
  });
}
