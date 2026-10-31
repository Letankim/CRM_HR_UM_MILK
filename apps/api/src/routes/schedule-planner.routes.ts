import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDaysYmd, evaluateOffWindow, mondayOfWeek, REQUEST_STATUS_LABELS, type Employee, type LeaveRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { planOfficialWeek, planProbationCycle, type PlanResult } from '../services/schedule-auto-planner.js';
import { findProbationLock, findWeekLock, isCountedWorkShift, matchEmp, probationLockCode, weekLockCode } from '../services/schedule-rules.js';
import { clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, resolveEmployeeBranchId } from './account-employee-sync.js';

const zWeekQuery = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD').optional(), branch_id: z.string().trim().optional().default('ALL') });
const zWeekLockBody = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD'), branch_id: z.string().trim().optional().default('ALL'), note: z.string().trim().max(300).optional().default('') });
const zProbationLockBody = z.object({ employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân viên thử việc') });

function mapOff(ctx: AppContext, l: LeaveRequest) {
  const emp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === l.employee_id);
  return { id: l.id, version: l.version, requestCode: l.request_code, leaveDate: l.leave_date, status: l.status, statusLabel: REQUEST_STATUS_LABELS[l.status], reason: l.reason, employeeId: emp?.id ?? l.employee_id, employeeCode: emp?.employee_code ?? l.employee_id, employeeName: emp?.full_name ?? 'Nhân sự', stage: emp?.stage ?? l.employee_stage, branchId: emp?.branch_id ?? l.branch_id, branchName: ctx.db.branches.get(emp?.branch_id ?? l.branch_id)?.name ?? 'Chi nhánh' };
}

/** Ghi kết quả chốt lịch: duyệt toàn bộ đơn OFF chờ duyệt, gỡ ca cũ trùng ngày OFF / ca nháp trùng ô 1/1, tạo ca chính thức và lưu biên bản chốt tuần / chu kỳ. */
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
    const weekStart = q.week_start ? mondayOfWeek(q.week_start) : offWindow.targetWeekStart;
    const plan = planOfficialWeek(ctx, { weekStart, branchId: q.branch_id });
    const lock = findWeekLock(ctx, q.branch_id, weekStart);
    const offRequests = filterByBranch(request, plan.offRequests.map((l) => mapOff(ctx, l)), (o) => o.branchId);
    return sendSuccess(request, 'Lấy dữ liệu chốt lịch tuần & dự kiến sắp ca thành công', {
      weekStart, weekEnd: addDaysYmd(weekStart, 6), branchId: q.branch_id, offWindow, isLocked: Boolean(lock),
      lockedAt: lock?.locked_at ?? null, lockNote: lock?.note ?? '', offRequests,
      planned: filterByBranch(request, plan.planned, (p) => p.branchId), issues: plan.issues,
      summary: { plannedCount: plan.planned.length, offCount: offRequests.length, pendingOffCount: offRequests.filter((o) => o.status === 'PENDING').length, issueCount: plan.issues.length },
    });
  });

  app.post('/api/admin/schedule-planner/week/lock', { preHandler: requirePermission('schedule.publish') }, async (request) => {
    const body = zWeekLockBody.parse(request.body ?? {});
    if (body.branch_id !== 'ALL') assertBranchAccess(request, body.branch_id);
    const weekStart = mondayOfWeek(body.week_start);
    // Chốt lại tuần đã chốt: chỉ xếp bổ sung các ca còn thiếu (planner bỏ qua ca đã có), không tạo trùng.
    const actorId = request.auth!.user.id, plan = planOfficialWeek(ctx, { weekStart, branchId: body.branch_id });
    const result = await applyPlan(ctx, plan, { code: weekLockCode(body.branch_id, weekStart), branchId: body.branch_id, weekStart, weekEnd: addDaysYmd(weekStart, 6), kind: 'WEEKLY', note: body.note }, actorId);
    await recalculateOpenPeriods(ctx, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'schedule.week.lock', entity: 'SCHEDULE_WEEKS', entityId: weekLockCode(body.branch_id, weekStart), after: { ...result, issues: plan.issues.length } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: body.branch_id, employeeIds: Array.from(new Set(plan.planned.map((p) => p.employeeId))), kind: 'SHIFT_APPROVED', message: `HR đã chốt lịch tuần ${weekStart} và tự động sắp ${result.createdCount} ca`, actorId });
    const warn = plan.issues.length > 0 ? ` — Có ${plan.issues.length} trường hợp không xếp được, vui lòng xem danh sách cảnh báo` : '';
    return sendSuccess(request, `Đã chốt lịch tuần, duyệt ${result.approvedOffCount} đơn OFF và tự động sắp ${result.createdCount} ca theo ca mặc định${warn}`, { weekStart, ...result, issues: plan.issues });
  });

  app.get('/api/admin/schedule-planner/probation', { preHandler: readPerms }, async (request) => {
    const branchId = z.string().trim().optional().default('ALL').parse((request.query as { branch_id?: string } | undefined)?.branch_id);
    const { todayStr } = getVnNowDateAndHm();
    const emps = filterByBranch(request, ctx.db.employees.filter((e) => e.status === 'ACTIVE' && e.stage === 'PROBATION' && (branchId === 'ALL' || e.branch_id === branchId)), (e) => e.branch_id);
    const items = emps.map((emp: Employee) => {
      const plan = planProbationCycle(ctx, emp, todayStr), lock = findProbationLock(ctx, emp, plan.cycle.start), isEmp = matchEmp(emp);
      const completedCount = ctx.db.shiftAssignments.filter((a) => isEmp(a.employee_id) && a.day_type !== 'OFF' && a.status === 'COMPLETED').length;
      return {
        employeeId: emp.id, employeeVersion: emp.version, employeeCode: emp.employee_code, employeeName: emp.full_name, branchId: emp.branch_id, branchName: ctx.db.branches.get(emp.branch_id)?.name ?? 'Chi nhánh',
        defaultShiftCode: emp.default_shift_code, cycleStart: plan.cycle.start, cycleEnd: plan.cycle.end, workRequired: plan.cycle.workRequired, offLimit: plan.cycle.offLimit,
        existingCount: plan.existingCount, completedCount, readyForOfficial: completedCount >= plan.cycle.workRequired,
        offRequests: plan.offRequests.map((l) => mapOff(ctx, l)), planned: plan.planned, issues: plan.issues,
        isLocked: Boolean(lock), lockedAt: lock?.locked_at ?? null,
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
    const code = probationLockCode(emp.employee_code, plan.cycle.start);
    const result = await applyPlan(ctx, plan, { code, branchId: emp.branch_id, weekStart: plan.cycle.start, weekEnd: plan.cycle.end, kind: 'PROBATION_12_DAYS', note: '' }, actorId);
    await recalculateOpenPeriods(ctx, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'schedule.probation.lock', entity: 'SCHEDULE_WEEKS', entityId: code, after: { ...result, issues: plan.issues.length } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_APPROVED', message: `HR đã chốt lịch chu kỳ thử việc của ${emp.full_name}`, actorId });
    return sendSuccess(request, `Đã chốt lịch chu kỳ thử việc của ${emp.full_name}: duyệt ${result.approvedOffCount} ngày OFF, xếp ${result.createdCount} ca${plan.issues.length ? ` (${plan.issues.length} cảnh báo)` : ''}`, { ...result, cycleStart: plan.cycle.start, cycleEnd: plan.cycle.end, issues: plan.issues });
  });
}
