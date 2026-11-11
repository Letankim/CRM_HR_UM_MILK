import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateOffWindow, isEmployeeRole, mondayOfWeek, REQUEST_STATUS_LABELS, zListQueryBase, type Employee, type LeaveRequest, type ShiftAssignment, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueLeaveCreatedEmail, queueLeaveDecisionEmail } from '../services/action-email-dispatcher.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { evaluateLeaveRequestConflict } from '../services/leave-conflict-detector.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { findProbationLock, findWeekLock, matchEmp, resolveProbationCycle, weekLockCode } from '../services/schedule-rules.js';
import { resolveApplicableStaffingRule } from '../services/schedule-staffing-helper.js';
import { assertNoDuplicateShiftWorkflow, clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { isVipOffWindowActive } from '../services/weekly-off-gate.service.js';
import { extractMonthKeyFromDate, findPartitionAwareRecord, getCachedPartitionStore, getPartitionStore, insertPartitionAwareRecord, nextPartitionCode, resolveTargetMonthForRecord } from '../services/partition-write-router.js';
import { emitScheduleRealtime, healBranchConsistency, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';
import { assertEmergencyLeaveAllowed, completeEmergencyLeaveSideEffects, registerLeaveRequestGateRoutes } from './leave-requests.routes.js';

const zYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày nghỉ phải theo định dạng YYYY-MM-DD');
const zCreateLeaveBody = z.object({
  employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân sự'),
  leave_date: zYmd.optional(), leave_dates: z.array(zYmd).optional(),
  kind: z.enum(['PROBATION_OFF', 'WEEKLY_OFF', 'UNPAID_LEAVE', 'DOT_XUAT']).default('WEEKLY_OFF'),
  shift_code: z.string().default('CA_SANG'), reason: z.string().trim().min(2, 'Vui lòng nhập lý do xin nghỉ').max(300),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED']).optional(),
});
const zDecideLeaveBody = z.object({ version: z.coerce.number().int().min(1), decision: z.enum(['APPROVED', 'REJECTED']), decision_reason: z.string().trim().max(300).optional().default('') });
const zWorkflowQuery = zListQueryBase.extend({ branch_id: z.string().trim().optional(), status: z.string().trim().optional(), from_date: z.string().trim().optional(), to_date: z.string().trim().optional() });
const ACTIVE_LEAVE = (s: string) => s !== 'REJECTED' && s !== 'CANCELLED';
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

function assertSelfLeaveAllowed(ctx: AppContext, emp: Employee, leaveDate: string): { limit: number; used: number } {
  const settings = getOperationSettings(ctx.db), { todayStr, nowHm } = getVnNowDateAndHm(), isEmp = matchEmp(emp);
  const mk = extractMonthKeyFromDate(leaveDate);
  const lvStore = (mk ? getCachedPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk) : undefined) ?? ctx.db.leaveRequests;
  if (leaveDate < todayStr) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Không thể đăng ký nghỉ OFF cho ngày đã qua (${vi(leaveDate)})`, leaveDate);
  if (emp.stage === 'PROBATION') {
    const cycle = resolveProbationCycle(emp, todayStr);
    if (!cycle.dates.includes(leaveDate)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Ngày nghỉ phải nằm trong chu kỳ thử việc ${vi(cycle.start)} – ${vi(cycle.end)}`, leaveDate);
    if (findProbationLock(ctx, emp, cycle.start)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', 'HR đã chốt lịch chu kỳ thử việc của bạn, không thể đăng ký thêm ngày OFF', leaveDate);
    const used = lvStore.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && cycle.dates.includes(l.leave_date)).length;
    if (used >= cycle.offLimit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Bạn đã đăng ký đủ ${cycle.offLimit} ngày OFF trong chu kỳ thử việc`, leaveDate);
    return { limit: cycle.offLimit, used };
  }
  const win = evaluateOffWindow(settings, todayStr, nowHm), vipOpen = isVipOffWindowActive(emp);
  if (!win.isOpen && !vipOpen) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', win.message, leaveDate);
  if (leaveDate < win.targetWeekStart || leaveDate > win.targetWeekEnd) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Chỉ được đăng ký nghỉ OFF cho tuần kế tiếp (${vi(win.targetWeekStart)} – ${vi(win.targetWeekEnd)})`, leaveDate);
  if (findWeekLock(ctx, emp.branch_id, win.targetWeekStart)) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', 'HR đã chốt lịch tuần này, không thể đăng ký thêm ngày OFF', leaveDate);
  const used = lvStore.filter((l) => isEmp(l.employee_id) && ACTIVE_LEAVE(l.status) && l.leave_date >= win.targetWeekStart && l.leave_date <= win.targetWeekEnd).length;
  if (used >= settings.officialWeeklyOffLimit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Bạn đã đăng ký đủ ${settings.officialWeeklyOffLimit} ngày OFF cho tuần này`, leaveDate);
  return { limit: settings.officialWeeklyOffLimit, used };
}

export async function leaveSwapRoutes(app: FastifyInstance, ctx: AppContext) {
  registerLeaveRequestGateRoutes(app, ctx);
  const computeLeaveStaffing = (branchId: string, leaveDate: string, shiftCode: string, empId: string) => {
    const mk = extractMonthKeyFromDate(leaveDate);
    const shStore = (mk ? getCachedPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk) : undefined) ?? ctx.db.shiftAssignments;
    const activeShifts = shStore.filter((a) => a.branch_id === branchId && a.work_date === leaveDate && a.shift_code === shiftCode && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'ABSENT');
    const rule = resolveApplicableStaffingRule(ctx, branchId, shiftCode);
    return { staffing_after_leave: activeShifts.filter((a) => a.employee_id !== empId).length, min_staff_required: rule?.min_staff ?? 1 };
  };
  app.get('/api/admin/leave-requests', { preHandler: requirePermission('schedule.read', 'leave.approve', 'self.leave') }, async (request) => {
    await healBranchConsistency(ctx);
    const query = zWorkflowQuery.parse(request.query ?? {}), scoped = filterByBranch(request, ctx.db.leaveRequests.all(), (r) => resolveEmployeeBranchId(ctx, r.employee_id, r.branch_id));
    const mapped = scoped.map((r) => {
      const emp = ctx.db.employees.get(r.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === r.employee_id);
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(r.branch_id), bId = branch?.id ?? r.branch_id;
      const offConflict = evaluateLeaveRequestConflict(ctx, r);
      const staffing = ACTIVE_LEAVE(r.status)
        ? { staffing_after_leave: offConflict.remainingGroupStaff, min_staff_required: offConflict.minStaffRequired }
        : computeLeaveStaffing(bId, r.leave_date, r.shift_code, emp?.id ?? r.employee_id);
      return { ...r, ...resolveShiftTimeDetails(ctx, r.shift_code, r.assignment_id, bId, r.employee_id, r.leave_date), ...staffing, offConflict, branch_id: bId, employeeId: emp?.id ?? r.employee_id, employeeCode: emp?.employee_code ?? r.employee_id, employeeName: emp?.full_name ?? 'Nhân sự', branchName: branch?.name ?? 'Chi nhánh', statusLabel: REQUEST_STATUS_LABELS[r.status], weekStart: mondayOfWeek(r.leave_date) };
    }).filter((r) => (!query.branch_id || query.branch_id === 'ALL' || r.branch_id === query.branch_id) && (!query.status || query.status === 'ALL' || r.status === query.status) && (!query.from_date || r.leave_date >= query.from_date) && (!query.to_date || r.leave_date <= query.to_date));
    return sendPaginated(request, 'Lấy danh sách đơn đăng ký nghỉ OFF thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'leave_date', 'status'], q: query.q, searchExtractor: (i) => [i.request_code, i.employeeCode, i.employeeName, i.reason, i.leave_date], filters: { branch_id: query.branch_id, status: query.status } }));
  });

  app.post('/api/admin/leave-requests', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateLeaveBody.parse(request.body), emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự', body.employee_id);
    const dates = Array.from(new Set([...(body.leave_dates ?? []), ...(body.leave_date ? [body.leave_date] : [])])).sort();
    if (dates.length === 0) throw Errors.fieldValidation('leave_date', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 ngày nghỉ OFF', '');
    for (const d of dates) {
      const m = resolveTargetMonthForRecord(ctx.db, 'LEAVE_REQUESTS', { leave_date: d }, d);
      await getPartitionStore(ctx.db, 'LEAVE_REQUESTS', m, request.auth!.user.id);
      await getPartitionStore(ctx.db, 'SHIFT_ASSIGNMENTS', m, request.auth!.user.id);
    }
    const actor = request.auth!.user, isSelf = findLinkedEmployeeForUser(actor, ctx)?.id === emp.id, isEmp = matchEmp(emp);
    if (isEmployeeRole(actor.role) && !isSelf) throw Errors.forbidden('Bạn chỉ được đăng ký nghỉ OFF cho chính mình');
    if (!isSelf) assertBranchAccess(request, emp.branch_id);
    const isEmergency = body.kind === 'DOT_XUAT';
    if (isEmergency) assertEmergencyLeaveAllowed(emp);
    const quota = isSelf && !isEmergency ? assertSelfLeaveAllowed(ctx, emp, dates[0]!) : { limit: emp.stage === 'PROBATION' ? emp.probation_off_days || 5 : getOperationSettings(ctx.db).officialWeeklyOffLimit, used: 0 };
    if (isSelf && !isEmergency) {
      for (const d of dates.slice(1)) assertSelfLeaveAllowed(ctx, emp, d);
      if (quota.used + dates.length > quota.limit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Bạn chỉ còn được đăng ký tối đa ${Math.max(0, quota.limit - quota.used)} ngày OFF trong kỳ (đã chọn ${dates.length} ngày)`, dates.join(', '));
    }
    for (const d of dates) {
      assertDateNotLockedByPayroll(ctx.db, d, 'đăng ký nghỉ OFF');
      const m = resolveTargetMonthForRecord(ctx.db, 'LEAVE_REQUESTS', { leave_date: d }, d);
      const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', m, actor.id);
      const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', m, actor.id);
      if (lvStore.find((l) => isEmp(l.employee_id) && l.leave_date === d && ACTIVE_LEAVE(l.status))) throw Errors.fieldValidation('leave_date', 'DUPLICATE_VALUE', `Nhân sự đã có đơn đăng ký nghỉ OFF trong ngày ${vi(d)}`, d);
      const exShift = shStore.find((a) => isEmp(a.employee_id) && a.work_date === d && a.day_type !== 'OFF');
      const shiftCode = (exShift?.shift_code || emp.default_shift_code || body.shift_code || 'CA_SANG').toUpperCase();
      assertNoDuplicateShiftWorkflow(ctx.db, emp, 'leave_date', exShift?.id ?? '', d, shiftCode);
      if (!isEmergency) {
        const peerTaken = lvStore.find((l) => {
          if (l.leave_date !== d || !ACTIVE_LEAVE(l.status) || isEmp(l.employee_id)) return false;
          const pEmp = ctx.db.employees.get(l.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === l.employee_id);
          return Boolean(pEmp && pEmp.status === 'ACTIVE' && pEmp.branch_id === emp.branch_id && (pEmp.default_shift_code || l.shift_code || 'CA_SANG').toUpperCase() === shiftCode);
        });
        if (peerTaken) {
          const pEmp = ctx.db.employees.get(peerTaken.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === peerTaken.employee_id);
          throw Errors.fieldValidation('leave_date', 'DUPLICATE_VALUE', `Ngày ${vi(d)} đã có đồng nghiệp cùng khung ca (${pEmp?.full_name || peerTaken.employee_id} · ${shiftCode}) đăng ký nghỉ OFF trước (ai đăng ký trước được trước). Vui lòng chọn ngày khác!`, d);
        }
      }
    }
    const effectiveKind = isEmergency ? 'DOT_XUAT' : emp.stage === 'PROBATION' ? 'PROBATION_OFF' : body.kind;
    const targetStatus = body.status === 'DRAFT' ? 'DRAFT' : 'APPROVED', now = nowIso(), createdList = [];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i]!, m = resolveTargetMonthForRecord(ctx.db, 'LEAVE_REQUESTS', { leave_date: d }, d);
      const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', m, actor.id);
      const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', m, actor.id);
      const exShift = shStore.find((a) => isEmp(a.employee_id) && a.work_date === d && a.day_type !== 'OFF');
      const shiftCode = exShift?.shift_code || emp.default_shift_code || body.shift_code;
      const item = await insertPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', {
        request_code: nextPartitionCode(lvStore, 'OFF-', 'request_code'), employee_id: emp.id, branch_id: emp.branch_id,
        leave_date: d, kind: effectiveKind, shift_code: shiftCode, reason: body.reason, status: targetStatus, employee_stage: emp.stage,
        schedule_week_id: weekLockCode(emp.branch_id, mondayOfWeek(d), m), assignment_id: exShift?.id ?? '',
        quota_cycle_used: quota.used + i + 1, quota_cycle_limit: quota.limit, ...computeLeaveStaffing(emp.branch_id, d, shiftCode, emp.id),
        submitted_at: now, store_reviewed_by: '', store_reviewed_at: '', decided_by: targetStatus === 'APPROVED' ? actor.id : '',
        decision_reason: targetStatus === 'APPROVED' ? 'Tự động duyệt ngay theo cơ chế đăng ký sớm (Ai đăng ký trước được trước)' : '', decided_at: targetStatus === 'APPROVED' ? now : '',
      }, d, actor.id);
      if (isEmergency) await completeEmergencyLeaveSideEffects(ctx, emp, item, actor.id);
      else if (targetStatus === 'APPROVED') {
        for (const a of shStore.filter((x) => isEmp(x.employee_id) && x.work_date === d && x.day_type !== 'OFF')) {
          await clearShiftAttendanceOnWorkflowOverride(ctx.db, a, actor.id, 'Tự động gỡ ca làm việc do đăng ký nghỉ OFF đã được duyệt ngay');
          await shStore.softDelete(a.id, a.version, actor.id);
        }
      }
      queueLeaveCreatedEmail(ctx, item, actor.id);
      createdList.push(item);
    }
    const created = createdList[0]!, reqAudit = auditContext(request), dateSummary = dates.map(vi).join(', ');
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'LEAVE_CREATED', message: `${emp.full_name} đã đăng ký nghỉ OFF ngày ${dateSummary} (Đã duyệt tự động)`, actorId: actor.id });
    await runBackgroundSideEffect(async () => { await ensureSyncedNotifications(ctx); await ctx.audit.record(reqAudit, { action: 'leave.create', entity: 'LEAVE_REQUESTS', entityId: created.id, after: { request_code: created.request_code, leave_dates: dates, status: created.status } }); });
    const payload = createdList.length === 1 ? created : { ...created, items: createdList, count: createdList.length };
    return reply.code(201), sendSuccess(request, `Đã đăng ký và tự động duyệt ${createdList.length} ngày nghỉ OFF (${dateSummary})`, payload);
  });

  app.post('/api/admin/leave-requests/:id/cancel', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, found = await findPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', id), before = found?.record, actor = request.auth!.user;
    if (!found || !before) throw Errors.notFound('Đơn xin nghỉ OFF', id);
    const emp = findLinkedEmployeeForUser(actor, ctx);
    if (!emp || !matchEmp(emp)(before.employee_id)) throw Errors.forbidden('Bạn chỉ được hủy đơn nghỉ OFF của chính mình');
    if (before.status !== 'PENDING' && before.status !== 'DRAFT' && before.status !== 'APPROVED') throw Errors.badRequest('Đơn nghỉ OFF đã được xử lý, không thể hủy');
    if (emp.stage === 'PROBATION' ? Boolean(findProbationLock(ctx, emp, resolveProbationCycle(emp, getVnNowDateAndHm().todayStr).start)) : Boolean(findWeekLock(ctx, emp.branch_id, mondayOfWeek(before.leave_date)))) throw Errors.badRequest('HR đã chốt lịch tuần / chu kỳ này, không thể tự hủy đơn nghỉ OFF');
    const updated = await found.store.update(id, before.version, { status: 'CANCELLED', decided_at: nowIso(), decision_reason: 'Nhân viên tự hủy đơn trước khi HR chốt lịch' }, actor.id);
    await runBackgroundSideEffect(() => ensureSyncedNotifications(ctx));
    return sendSuccess(request, 'Đã hủy đơn đăng ký nghỉ OFF', updated);
  });

  app.post('/api/admin/leave-requests/:id/decide', { preHandler: requirePermission('leave.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecideLeaveBody.parse(request.body), found = await findPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', id), before = found?.record;
    if (!found || !before) throw Errors.notFound('Đơn xin nghỉ OFF', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.leave_date, 'phê duyệt đơn nghỉ OFF');
    if (body.decision === 'REJECTED' && !body.decision_reason.trim()) throw Errors.fieldValidation('decision_reason', 'REQUIRED_FIELD', 'Vui lòng nhập lý do từ chối đơn xin nghỉ OFF', '');
    const actorId = request.auth!.user.id, emp = ctx.db.employees.get(before.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === before.employee_id);
    const beforeConflict = evaluateLeaveRequestConflict(ctx, before), isTargetEmp = (eid: string) => eid === before.employee_id || Boolean(emp && matchEmp(emp)(eid));
    const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', found.monthKey, actorId);
    const swStore = await getPartitionStore<ShiftSwap>(ctx.db, 'SHIFT_SWAPS', found.monthKey, actorId);
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `leave-decide-${id}-v${body.version}`, operation: 'DECIDE_LEAVE_REQUEST', actorId, initialContext: { leave: before },
      steps: [
        { name: 'UPDATE_LEAVE_STATUS', run: async (s) => { s.leave = await found.store.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso() }, actorId); } },
        { name: 'REMOVE_CONFLICTING_SHIFTS_ON_APPROVE', run: async () => {
          if (body.decision !== 'APPROVED') return;
          for (const a of shStore.filter((x) => isTargetEmp(x.employee_id) && x.work_date === before.leave_date)) {
            await clearShiftAttendanceOnWorkflowOverride(ctx.db, a, actorId, 'Tự động hủy do đơn nghỉ OFF đã được phê duyệt');
            await shStore.softDelete(a.id, a.version, actorId);
          }
          for (const sw of swStore.filter((x) => (x.from_work_date === before.leave_date || x.to_work_date === before.leave_date) && (isTargetEmp(x.requester_id) || isTargetEmp(x.peer_id)) && (x.status === 'PENDING_PEER' || x.status === 'PEER_ACCEPTED'))) {
            await swStore.update(sw.id, sw.version, { status: 'REJECTED', decided_by: actorId, decision_reason: 'Tự động hủy do đơn nghỉ OFF đã được phê duyệt', decided_at: nowIso() }, actorId);
          }
        } },
      ],
      resultSelector: (s) => s.leave,
    });
    queueLeaveDecisionEmail(ctx, updated, actorId);
    const reqAudit = auditContext(request);
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: before.branch_id, employeeIds: [before.employee_id], kind: 'LEAVE_DECIDED', message: `Đơn nghỉ OFF ngày ${vi(before.leave_date)} đã ${body.decision === 'APPROVED' ? 'được phê duyệt' : 'bị từ chối'}`, actorId });
    await runBackgroundSideEffect(async () => { await ensureSyncedNotifications(ctx); await ctx.audit.record(reqAudit, { action: 'leave.decide', entity: 'LEAVE_REQUESTS', entityId: id, before: { status: before.status }, after: { status: updated.status, decision_reason: updated.decision_reason, off_conflict: beforeConflict.hasConflict ? beforeConflict.warningMessage : '' } }); });
    const afterConflict = evaluateLeaveRequestConflict(ctx, updated);
    const approveMsg = beforeConflict.hasConflict ? `Đã phê duyệt đơn nghỉ OFF — ${beforeConflict.warningMessage}` : 'Đã phê duyệt đơn nghỉ OFF và tự động gỡ ca làm việc trùng ngày';
    return sendSuccess(request, body.decision === 'APPROVED' ? approveMsg : 'Đã từ chối đơn nghỉ OFF', { ...updated, offConflict: afterConflict });
  });
}
