import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateOffWindow, isEmployeeRole, mondayOfWeek, REQUEST_STATUS_LABELS, zListQueryBase, type Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueLeaveCreatedEmail, queueLeaveDecisionEmail } from '../services/action-email-dispatcher.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { findProbationLock, findWeekLock, matchEmp, resolveProbationCycle } from '../services/schedule-rules.js';
import { resolveApplicableStaffingRule } from '../services/schedule-staffing-helper.js';
import { assertNoDuplicateShiftWorkflow, clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, healBranchConsistency, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';

const zCreateLeaveBody = z.object({ employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân sự'), leave_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày nghỉ phải theo định dạng YYYY-MM-DD'), kind: z.enum(['PROBATION_OFF', 'WEEKLY_OFF', 'UNPAID_LEAVE']).default('WEEKLY_OFF'), shift_code: z.string().default('CA_SANG'), reason: z.string().trim().min(2, 'Vui lòng nhập lý do xin nghỉ').max(300), status: z.enum(['DRAFT', 'PENDING']).default('PENDING') });
const zDecideLeaveBody = z.object({ version: z.coerce.number().int().min(1), decision: z.enum(['APPROVED', 'REJECTED']), decision_reason: z.string().trim().max(300).optional().default('') });
const zWorkflowQuery = zListQueryBase.extend({ branch_id: z.string().trim().optional(), status: z.string().trim().optional(), from_date: z.string().trim().optional(), to_date: z.string().trim().optional() });
const ACTIVE_LEAVE = (s: string) => s !== 'REJECTED' && s !== 'CANCELLED';
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

/**
 * Quy tắc tự đăng ký nghỉ OFF của nhân viên:
 * - Chính thức: chỉ trong cổng mở (mặc định 09:00 Thứ 6 → 09:00 Thứ 7), cho tuần kế tiếp, tối đa N ngày / tuần, tuần chưa bị HR chốt.
 * - Thử việc: trong chu kỳ 12 ngày, không quá 5 ngày OFF, chưa bị HR chốt lịch chu kỳ, không đăng ký ngày đã qua.
 */
function assertSelfLeaveAllowed(ctx: AppContext, emp: Employee, leaveDate: string): { limit: number; used: number } {
  const settings = getOperationSettings(ctx.db), { todayStr, nowHm } = getVnNowDateAndHm(), isEmp = matchEmp(emp);
  if (leaveDate < todayStr) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Không thể đăng ký nghỉ OFF cho ngày đã qua (${vi(leaveDate)})`, leaveDate);
  if (emp.stage === 'PROBATION') {
    const cycle = resolveProbationCycle(emp, todayStr);
    if (!cycle.dates.includes(leaveDate)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Ngày nghỉ phải nằm trong chu kỳ thử việc ${vi(cycle.start)} – ${vi(cycle.end)}`, leaveDate);
    if (findProbationLock(ctx, emp, cycle.start)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', 'HR đã chốt lịch chu kỳ thử việc của bạn, không thể đăng ký thêm ngày OFF', leaveDate);
    const used = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && cycle.dates.includes(l.leave_date)).length;
    if (used >= cycle.offLimit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Bạn đã đăng ký đủ ${cycle.offLimit} ngày OFF trong chu kỳ thử việc (7 ca làm + 5 ngày OFF)`, leaveDate);
    return { limit: cycle.offLimit, used };
  }
  const win = evaluateOffWindow(settings, todayStr, nowHm);
  if (!win.isOpen) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', win.message, leaveDate);
  if (leaveDate < win.targetWeekStart || leaveDate > win.targetWeekEnd) {
    throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Chỉ được đăng ký nghỉ OFF cho tuần kế tiếp (${vi(win.targetWeekStart)} – ${vi(win.targetWeekEnd)})`, leaveDate);
  }
  if (findWeekLock(ctx, emp.branch_id, win.targetWeekStart)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', 'HR đã chốt lịch tuần này, không thể đăng ký thêm ngày OFF', leaveDate);
  const used = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && l.leave_date >= win.targetWeekStart && l.leave_date <= win.targetWeekEnd).length;
  if (used >= settings.officialWeeklyOffLimit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Bạn đã đăng ký đủ ${settings.officialWeeklyOffLimit} ngày OFF cho tuần này`, leaveDate);
  return { limit: settings.officialWeeklyOffLimit, used };
}

export async function leaveSwapRoutes(app: FastifyInstance, ctx: AppContext) {
  const computeLeaveStaffing = (branchId: string, leaveDate: string, shiftCode: string, empId: string) => {
    const activeShifts = ctx.db.shiftAssignments.filter((a) => a.branch_id === branchId && a.work_date === leaveDate && a.shift_code === shiftCode && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'ABSENT');
    const rule = resolveApplicableStaffingRule(ctx, branchId, shiftCode);
    return { staffing_after_leave: activeShifts.filter((a) => a.employee_id !== empId).length, min_staff_required: rule?.min_staff ?? 1 };
  };
  app.get('/api/admin/leave-requests', { preHandler: requirePermission('schedule.read', 'leave.approve', 'self.leave') }, async (request) => {
    await healBranchConsistency(ctx);
    const query = zWorkflowQuery.parse(request.query ?? {}), scoped = filterByBranch(request, ctx.db.leaveRequests.all(), (r) => resolveEmployeeBranchId(ctx, r.employee_id, r.branch_id));
    const mapped = scoped.map((r) => {
      const emp = ctx.db.employees.get(r.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === r.employee_id);
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(r.branch_id), bId = branch?.id ?? r.branch_id;
      return { ...r, ...resolveShiftTimeDetails(ctx, r.shift_code, r.assignment_id, bId, r.employee_id, r.leave_date), ...computeLeaveStaffing(bId, r.leave_date, r.shift_code, emp?.id ?? r.employee_id), branch_id: bId, employeeId: emp?.id ?? r.employee_id, employeeCode: emp?.employee_code ?? r.employee_id, employeeName: emp?.full_name ?? 'Nhân sự', branchName: branch?.name ?? 'Chi nhánh', statusLabel: REQUEST_STATUS_LABELS[r.status], weekStart: mondayOfWeek(r.leave_date) };
    }).filter((r) => (!query.branch_id || query.branch_id === 'ALL' || r.branch_id === query.branch_id) && (!query.status || query.status === 'ALL' || r.status === query.status) && (!query.from_date || r.leave_date >= query.from_date) && (!query.to_date || r.leave_date <= query.to_date));
    return sendPaginated(request, 'Lấy danh sách đơn đăng ký nghỉ OFF thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'leave_date', 'status'], q: query.q, searchExtractor: (i) => [i.request_code, i.employeeCode, i.employeeName, i.reason, i.leave_date], filters: { branch_id: query.branch_id, status: query.status } }));
  });

  app.post('/api/admin/leave-requests', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateLeaveBody.parse(request.body), emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự', body.employee_id);
    const actor = request.auth!.user, isSelf = findLinkedEmployeeForUser(actor, ctx)?.id === emp.id;
    if (isEmployeeRole(actor.role) && !isSelf) throw Errors.forbidden('Bạn chỉ được đăng ký nghỉ OFF cho chính mình');
    if (!isSelf) assertBranchAccess(request, emp.branch_id);
    assertDateNotLockedByPayroll(ctx.db, body.leave_date, 'đăng ký nghỉ OFF');
    if (ctx.db.leaveRequests.find((l) => matchEmp(emp)(l.employee_id) && l.leave_date === body.leave_date && ACTIVE_LEAVE(l.status))) throw Errors.fieldValidation('leave_date', 'DUPLICATE_VALUE', `Nhân sự đã có đơn đăng ký nghỉ OFF trong ngày ${vi(body.leave_date)}`, body.leave_date);
    const quota = isSelf ? assertSelfLeaveAllowed(ctx, emp, body.leave_date) : { limit: emp.stage === 'PROBATION' ? emp.probation_off_days || 5 : getOperationSettings(ctx.db).officialWeeklyOffLimit, used: 0 };
    const existingShift = ctx.db.shiftAssignments.find((a) => matchEmp(emp)(a.employee_id) && a.work_date === body.leave_date && a.day_type !== 'OFF'), shiftCode = existingShift?.shift_code || emp.default_shift_code || body.shift_code;
    assertNoDuplicateShiftWorkflow(ctx.db, emp, 'leave_date', existingShift?.id ?? '', body.leave_date, shiftCode);
    const created = await ctx.db.leaveRequests.insert({ request_code: `OFF-${String(ctx.db.leaveRequests.all(true).length + 1).padStart(4, '0')}`, employee_id: emp.id, branch_id: emp.branch_id, leave_date: body.leave_date, kind: emp.stage === 'PROBATION' ? 'PROBATION_OFF' : body.kind, shift_code: shiftCode, reason: body.reason, status: body.status, employee_stage: emp.stage, schedule_week_id: `WK-${mondayOfWeek(body.leave_date)}`, assignment_id: existingShift?.id ?? '', quota_cycle_used: quota.used + 1, quota_cycle_limit: quota.limit, ...computeLeaveStaffing(emp.branch_id, body.leave_date, shiftCode, emp.id), submitted_at: nowIso(), store_reviewed_by: '', store_reviewed_at: '', decided_by: '', decision_reason: '', decided_at: '' }, actor.id);
    queueLeaveCreatedEmail(ctx, created, actor.id);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'leave.create', entity: 'LEAVE_REQUESTS', entityId: created.id, after: { request_code: created.request_code, leave_date: created.leave_date, status: created.status } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'LEAVE_CREATED', message: `${emp.full_name} gửi đơn nghỉ OFF ngày ${vi(created.leave_date)}`, actorId: actor.id });
    return reply.code(201), sendSuccess(request, `Đã đăng ký nghỉ OFF ngày ${vi(created.leave_date)} — chờ HR chốt lịch`, created);
  });

  app.post('/api/admin/leave-requests/:id/cancel', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, before = ctx.db.leaveRequests.get(id), actor = request.auth!.user;
    if (!before) throw Errors.notFound('Đơn xin nghỉ OFF', id);
    const emp = findLinkedEmployeeForUser(actor, ctx);
    if (!emp || !matchEmp(emp)(before.employee_id)) throw Errors.forbidden('Bạn chỉ được hủy đơn nghỉ OFF của chính mình');
    if (before.status !== 'PENDING' && before.status !== 'DRAFT') throw Errors.badRequest('Đơn nghỉ OFF đã được xử lý / chốt lịch, không thể hủy');
    const updated = await ctx.db.leaveRequests.update(id, before.version, { status: 'CANCELLED', decided_at: nowIso(), decision_reason: 'Nhân viên tự hủy đơn trước khi HR chốt lịch' }, actor.id);
    await ensureSyncedNotifications(ctx);
    return sendSuccess(request, 'Đã hủy đơn đăng ký nghỉ OFF', updated);
  });

  app.post('/api/admin/leave-requests/:id/decide', { preHandler: requirePermission('leave.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecideLeaveBody.parse(request.body), before = ctx.db.leaveRequests.get(id);
    if (!before) throw Errors.notFound('Đơn xin nghỉ OFF', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.leave_date, 'phê duyệt đơn nghỉ OFF');
    if (body.decision === 'REJECTED' && !body.decision_reason.trim()) throw Errors.fieldValidation('decision_reason', 'REQUIRED_FIELD', 'Vui lòng nhập lý do từ chối đơn xin nghỉ OFF', '');
    const actorId = request.auth!.user.id, emp = ctx.db.employees.get(before.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === before.employee_id);
    const isTargetEmp = (eid: string) => eid === before.employee_id || Boolean(emp && matchEmp(emp)(eid));
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `leave-decide-${id}-v${body.version}`, operation: 'DECIDE_LEAVE_REQUEST', actorId, initialContext: { leave: before },
      steps: [
        { name: 'UPDATE_LEAVE_STATUS', run: async (s) => { s.leave = await ctx.db.leaveRequests.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso() }, actorId); } },
        { name: 'REMOVE_CONFLICTING_SHIFTS_ON_APPROVE', run: async () => {
          if (body.decision !== 'APPROVED') return;
          for (const a of ctx.db.shiftAssignments.filter((x) => isTargetEmp(x.employee_id) && x.work_date === before.leave_date)) {
            await clearShiftAttendanceOnWorkflowOverride(ctx.db, a, actorId, 'Tự động hủy do đơn nghỉ OFF đã được phê duyệt');
            await ctx.db.shiftAssignments.softDelete(a.id, a.version, actorId);
          }
          for (const sw of ctx.db.shiftSwaps.filter((x) => (x.from_work_date === before.leave_date || x.to_work_date === before.leave_date) && (isTargetEmp(x.requester_id) || isTargetEmp(x.peer_id)) && (x.status === 'PENDING_PEER' || x.status === 'PEER_ACCEPTED'))) {
            await ctx.db.shiftSwaps.update(sw.id, sw.version, { status: 'REJECTED', decided_by: actorId, decision_reason: 'Tự động hủy do đơn nghỉ OFF đã được phê duyệt', decided_at: nowIso() }, actorId);
          }
        } },
      ],
      resultSelector: (s) => s.leave,
    });
    queueLeaveDecisionEmail(ctx, updated, actorId);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'leave.decide', entity: 'LEAVE_REQUESTS', entityId: id, before: { status: before.status }, after: { status: updated.status, decision_reason: updated.decision_reason } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: before.branch_id, employeeIds: [before.employee_id], kind: 'LEAVE_DECIDED', message: `Đơn nghỉ OFF ngày ${vi(before.leave_date)} đã ${body.decision === 'APPROVED' ? 'được phê duyệt' : 'bị từ chối'}`, actorId });
    return sendSuccess(request, body.decision === 'APPROVED' ? 'Đã phê duyệt đơn nghỉ OFF và tự động gỡ ca làm việc trùng ngày' : 'Đã từ chối đơn nghỉ OFF', updated);
  });
}
