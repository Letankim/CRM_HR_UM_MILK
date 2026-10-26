import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_SHIFT_LABELS, REQUEST_STATUS_LABELS, SHIFT_SWAP_STATUS_LABELS, SYSTEM_CONFIG, zListQueryBase } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { healBranchConsistency, resolveEmployeeBranchId, resolveShiftTimeDetails } from './account-employee-sync.js';

const zCreateLeaveBody = z.object({ employee_id: z.string().trim().min(1, 'Vui lòng chọn nhân sự'), leave_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày nghỉ phải theo định dạng YYYY-MM-DD'), kind: z.enum(['PROBATION_OFF', 'WEEKLY_OFF', 'UNPAID_LEAVE']).default('WEEKLY_OFF'), shift_code: z.string().default('CA_SANG'), reason: z.string().trim().min(2, 'Vui lòng nhập lý do xin nghỉ').max(300), status: z.enum(['DRAFT', 'PENDING']).default('PENDING') });
const zDecideLeaveBody = z.object({ version: z.coerce.number().int().min(1), decision: z.enum(['APPROVED', 'REJECTED']), decision_reason: z.string().trim().max(300).optional().default('') });
const zCreateSwapBody = z.object({ requester_id: z.string().trim().min(1), peer_id: z.string().trim().min(1), from_assignment_id: z.string().trim().min(1), to_assignment_id: z.string().trim().optional().default(''), reason: z.string().trim().min(2).max(300) });
const zPeerRespondBody = z.object({ version: z.coerce.number().int().min(1), accept: z.boolean(), peer_note: z.string().trim().max(200).optional().default('') });
const zDecideSwapBody = z.object({ version: z.coerce.number().int().min(1), decision: z.enum(['APPROVED', 'REJECTED']), decision_reason: z.string().trim().max(300).optional().default('') });
const zCreateEmergencyBody = z.object({ employee_id: z.string().trim().min(1), assignment_id: z.string().trim().optional().default(''), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shift_code: z.string().default('CA_SANG'), reason: z.string().trim().min(2).max(300) });
const zHandleEmergencyBody = z.object({ version: z.coerce.number().int().min(1), action: z.enum(['ASSIGN_REPLACEMENT', 'ESCALATE', 'RESOLVE']), replacement_id: z.string().trim().optional().default(''), resolution_note: z.string().trim().max(300).optional().default('') });

export async function leaveSwapRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/leave-requests', { preHandler: requirePermission('schedule.read', 'leave.approve', 'self.leave') }, async (request) => {
    await healBranchConsistency(ctx);
    const query = zListQueryBase.parse(request.query);
    const scoped = filterByBranch(request, ctx.db.leaveRequests.all(), (r) => resolveEmployeeBranchId(ctx, r.employee_id, r.branch_id));
    const mapped = scoped.map((r) => {
      const emp = ctx.db.employees.get(r.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === r.employee_id);
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(r.branch_id);
      return { ...r, ...resolveShiftTimeDetails(ctx, r.shift_code, r.assignment_id), branch_id: branch?.id ?? r.branch_id, employeeId: emp?.id ?? r.employee_id, employeeCode: emp?.employee_code ?? r.employee_id, employeeName: emp?.full_name ?? 'Nhân sự', branchName: branch?.name ?? 'Chi nhánh', statusLabel: REQUEST_STATUS_LABELS[r.status] };
    });
    return sendPaginated(request, 'Lấy danh sách đơn đăng ký nghỉ OFF thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'leave_date', 'status'], q: query.q, searchExtractor: (i) => [i.request_code, i.employeeCode, i.employeeName, i.reason, i.leave_date] }));
  });

  app.post('/api/admin/leave-requests', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateLeaveBody.parse(request.body);
    const emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự', body.employee_id);
    assertBranchAccess(request, emp.branch_id);
    const dupLeave = ctx.db.leaveRequests.find((l) => (l.employee_id === emp.id || l.employee_id === emp.employee_code) && l.leave_date === body.leave_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED');
    if (dupLeave) throw Errors.fieldValidation('leave_date', 'DUPLICATE_VALUE', `Nhân sự đã có đơn đăng ký nghỉ OFF trong ngày ${body.leave_date}`, body.leave_date);
    const usedCount = ctx.db.leaveRequests.filter((l) => (l.employee_id === emp.id || l.employee_id === emp.employee_code) && l.status !== 'REJECTED' && l.status !== 'CANCELLED').length;
    const limit = emp.stage === 'PROBATION' ? SYSTEM_CONFIG.defaults.probationOffDays : 4;
    if (usedCount >= limit) throw Errors.fieldValidation('leave_date', 'OUT_OF_RANGE', `Nhân sự đã dùng hết định mức ${limit} ngày nghỉ OFF trong chu kỳ`, body.leave_date);
    const existingShift = ctx.db.shiftAssignments.find((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === body.leave_date && a.day_type !== 'OFF');
    const created = await ctx.db.leaveRequests.insert({
      request_code: `OFF-${String(ctx.db.leaveRequests.all(true).length + 1).padStart(4, '0')}`, employee_id: emp.id, branch_id: emp.branch_id, leave_date: body.leave_date, kind: body.kind,
      shift_code: existingShift?.shift_code || body.shift_code, reason: body.reason, status: body.status, employee_stage: emp.stage, schedule_week_id: `WK-${body.leave_date.slice(0, 7)}`,
      assignment_id: existingShift?.id ?? '', quota_cycle_used: usedCount + 1, quota_cycle_limit: limit, staffing_after_leave: 3, min_staff_required: 2, submitted_at: nowIso(), store_reviewed_by: '', store_reviewed_at: '', decided_by: '', decision_reason: '', decided_at: '',
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'leave.create', entity: 'LEAVE_REQUESTS', entityId: created.id, after: { request_code: created.request_code, leave_date: created.leave_date, status: created.status } });
    return reply.code(201), sendSuccess(request, 'Đã gửi đơn đăng ký nghỉ OFF thành công', created);
  });

  app.post('/api/admin/leave-requests/:id/decide', { preHandler: requirePermission('leave.approve') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDecideLeaveBody.parse(request.body);
    const before = ctx.db.leaveRequests.get(id);
    if (!before) throw Errors.notFound('Đơn xin nghỉ OFF', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    if (body.decision === 'REJECTED' && !body.decision_reason.trim()) throw Errors.fieldValidation('decision_reason', 'REQUIRED_FIELD', 'Vui lòng nhập lý do từ chối đơn xin nghỉ OFF', '');
    const actorId = request.auth!.user.id;
    const emp = ctx.db.employees.get(before.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === before.employee_id);
    const isTargetEmp = (eid: string) => eid === before.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `leave-decide-${id}-v${body.version}`, operation: 'DECIDE_LEAVE_REQUEST', actorId, initialContext: { leave: before },
      steps: [
        { name: 'UPDATE_LEAVE_STATUS', run: async (s) => { s.leave = await ctx.db.leaveRequests.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso() }, actorId); } },
        { name: 'REMOVE_CONFLICTING_SHIFTS_ON_APPROVE', run: async () => {
          if (body.decision !== 'APPROVED') return;
          for (const a of ctx.db.shiftAssignments.filter((x) => isTargetEmp(x.employee_id) && x.work_date === before.leave_date)) {
            if (!ctx.db.attendanceEvents.find((ev) => ev.assignment_id === a.id)) await ctx.db.shiftAssignments.softDelete(a.id, a.version, actorId);
          }
          for (const sw of ctx.db.shiftSwaps.filter((x) => x.from_work_date === before.leave_date && (isTargetEmp(x.requester_id) || isTargetEmp(x.peer_id)) && (x.status === 'PENDING_PEER' || x.status === 'PEER_ACCEPTED'))) {
            await ctx.db.shiftSwaps.update(sw.id, sw.version, { status: 'REJECTED', decided_by: actorId, decision_reason: 'Tự động hủy do đơn nghỉ OFF đã được phê duyệt', decided_at: nowIso() }, actorId);
          }
        } },
      ],
      resultSelector: (s) => s.leave,
    });
    await ctx.audit.record(auditContext(request), { action: 'leave.decide', entity: 'LEAVE_REQUESTS', entityId: id, before: { status: before.status }, after: { status: updated.status, decision_reason: updated.decision_reason } });
    return sendSuccess(request, body.decision === 'APPROVED' ? 'Đã phê duyệt đơn nghỉ OFF và tự động gỡ ca làm việc trùng ngày' : 'Đã từ chối đơn nghỉ OFF', updated);
  });

  app.get('/api/admin/shift-swaps', { preHandler: requirePermission('schedule.read', 'swap.approve', 'self.swap') }, async (request) => {
    const query = zListQueryBase.parse(request.query);
    const scoped = filterByBranch(request, ctx.db.shiftSwaps.all(), (s) => resolveEmployeeBranchId(ctx, s.requester_id, s.branch_id));
    const mapped = scoped.map((s) => {
      const reqEmp = ctx.db.employees.get(s.requester_id) ?? ctx.db.employees.find((e) => e.employee_code === s.requester_id);
      const peerEmp = ctx.db.employees.get(s.peer_id) ?? ctx.db.employees.find((e) => e.employee_code === s.peer_id);
      const branch = (reqEmp ? ctx.db.branches.get(reqEmp.branch_id) : undefined) ?? ctx.db.branches.get(s.branch_id);
      return { ...s, ...resolveShiftTimeDetails(ctx, s.from_shift_code, s.from_assignment_id), branchName: branch?.name ?? 'Chi nhánh', requesterCode: reqEmp?.employee_code ?? s.requester_id, peerCode: peerEmp?.employee_code ?? s.peer_id, requesterName: reqEmp ? `${reqEmp.full_name} (${reqEmp.employee_code})` : s.requester_id, peerName: peerEmp ? `${peerEmp.full_name} (${peerEmp.employee_code})` : s.peer_id, statusLabel: SHIFT_SWAP_STATUS_LABELS[s.status] };
    });
    return sendPaginated(request, 'Lấy danh sách yêu cầu đổi ca 3 bước thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'from_work_date', 'status'], q: query.q, searchExtractor: (i) => [i.swap_code, i.requesterName, i.peerName, i.reason] }));
  });

  app.post('/api/admin/shift-swaps', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateSwapBody.parse(request.body);
    const fromAssign = ctx.db.shiftAssignments.get(body.from_assignment_id);
    if (!fromAssign) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca làm việc gốc cần đổi', body.from_assignment_id);
    if (fromAssign.status !== 'PUBLISHED') throw Errors.badRequest('Chỉ được phép tạo yêu cầu đổi ca đối với những ca đã được Quản lý cửa hàng hoặc HR duyệt phân ca chính thức');
    const reqEmp = ctx.db.employees.get(body.requester_id) ?? ctx.db.employees.find((e) => e.employee_code === body.requester_id);
    const peerEmp = ctx.db.employees.get(body.peer_id) ?? ctx.db.employees.find((e) => e.employee_code === body.peer_id);
    if (!peerEmp) throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Không tìm thấy đồng nghiệp nhận ca thay', body.peer_id);
    if (body.requester_id === body.peer_id || (reqEmp && reqEmp.id === peerEmp.id)) throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Người nhận đổi ca phải khác người xin đổi ca', body.peer_id);
    const peerConflict = ctx.db.shiftAssignments.find((a) => (a.employee_id === peerEmp.id || a.employee_id === peerEmp.employee_code) && a.work_date === fromAssign.work_date && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'ABSENT');
    if (peerConflict) {
      const shiftName = resolveShiftTimeDetails(ctx, peerConflict.shift_code, peerConflict.id, peerConflict.branch_id).shiftLabel;
      throw Errors.fieldValidation('peer_id', 'DUPLICATE_VALUE', `Đồng nghiệp ${peerEmp.full_name} (${peerEmp.employee_code}) đã có ca làm việc (${shiftName}) trong ngày ${fromAssign.work_date}. Bắt buộc người nhận ca thay phải không có ca làm việc nào trong ngày hôm đó.`, body.peer_id);
    }
    const peerOnLeave = ctx.db.leaveRequests.find((l) => (l.employee_id === peerEmp.id || l.employee_id === peerEmp.employee_code) && l.leave_date === fromAssign.work_date && (l.status === 'APPROVED' || l.status === 'PENDING'));
    if (peerOnLeave) throw Errors.fieldValidation('peer_id', 'DUPLICATE_VALUE', `Đồng nghiệp ${peerEmp.full_name} (${peerEmp.employee_code}) đã đăng ký nghỉ OFF trong ngày ${fromAssign.work_date}, không thể nhận ca thay.`, body.peer_id);
    const dupPending = ctx.db.shiftSwaps.find((s) => (s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && (s.from_assignment_id === fromAssign.id || ((s.peer_id === peerEmp.id || s.peer_id === peerEmp.employee_code) && s.from_work_date === fromAssign.work_date)));
    if (dupPending) throw Errors.fieldValidation('peer_id', 'DUPLICATE_VALUE', dupPending.from_assignment_id === fromAssign.id ? 'Ca làm việc này đang có yêu cầu đổi ca chờ xử lý' : `Đồng nghiệp ${peerEmp.full_name} đang có yêu cầu nhận ca khác chờ duyệt trong ngày ${fromAssign.work_date}`, body.peer_id);
    const created = await ctx.db.shiftSwaps.insert({
      swap_code: `SWP-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`, requester_id: reqEmp?.id ?? body.requester_id, peer_id: peerEmp.id,
      from_assignment_id: fromAssign.id, to_assignment_id: body.to_assignment_id, branch_id: fromAssign.branch_id, from_work_date: fromAssign.work_date, from_shift_code: fromAssign.shift_code,
      to_work_date: fromAssign.work_date, to_shift_code: fromAssign.shift_code, reason: body.reason, status: 'PENDING_PEER', has_conflict: false, staffing_valid: true, requested_at: nowIso(),
      peer_responded_at: '', peer_note: '', decided_by: '', decision_reason: '', decided_at: '', allowance_eligible: false, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'swap.create', entity: 'SHIFT_SWAPS', entityId: created.id, after: { swap_code: created.swap_code, status: created.status } });
    reply.code(201);
    return sendSuccess(request, 'Đã tạo yêu cầu đổi ca (Bước 1/3: Chờ đồng nghiệp xác nhận — lịch chính thức chưa thay đổi)', created);
  });

  app.post('/api/admin/shift-swaps/:id/peer-respond', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zPeerRespondBody.parse(request.body);
    const before = ctx.db.shiftSwaps.get(id);
    if (!before) throw Errors.notFound('Yêu cầu đổi ca', id);
    if (body.accept) {
      const peerEmp = ctx.db.employees.get(before.peer_id) ?? ctx.db.employees.find((e) => e.employee_code === before.peer_id);
      const conflict = peerEmp && ctx.db.shiftAssignments.find((a) => (a.employee_id === peerEmp.id || a.employee_id === peerEmp.employee_code) && a.work_date === before.from_work_date && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'ABSENT');
      if (conflict) throw Errors.badRequest(`Không thể nhận ca thay vì đã có lịch làm việc trong ngày ${before.from_work_date}`);
      const onLeave = peerEmp && ctx.db.leaveRequests.find((l) => (l.employee_id === peerEmp.id || l.employee_id === peerEmp.employee_code) && l.leave_date === before.from_work_date && l.status === 'APPROVED');
      if (onLeave) throw Errors.badRequest(`Không thể nhận ca thay vì đã có đơn nghỉ OFF được duyệt trong ngày ${before.from_work_date}`);
    }
    const nextStatus = body.accept ? 'PEER_ACCEPTED' : 'PEER_DECLINED';
    const updated = await ctx.db.shiftSwaps.update(id, body.version, { status: nextStatus, peer_responded_at: nowIso(), peer_note: body.peer_note }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, before: { status: before.status }, after: { status: updated.status } });
    return sendSuccess(request, body.accept ? 'Đồng nghiệp đã xác nhận nhận ca (Bước 2/3: Chờ Quản lý duyệt — lịch chính thức chưa thay đổi)' : 'Đồng nghiệp đã từ chối nhận đổi ca', updated);
  });

  app.post('/api/admin/shift-swaps/:id/decide', { preHandler: requirePermission('swap.approve') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDecideSwapBody.parse(request.body);
    const before = ctx.db.shiftSwaps.get(id);
    if (!before) throw Errors.notFound('Yêu cầu đổi ca', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.requester_id, before.branch_id));
    if (body.decision === 'APPROVED') {
      if (before.status !== 'PEER_ACCEPTED') throw Errors.badRequest('Chỉ được duyệt đổi ca sau khi đồng nghiệp nhận ca đã xác nhận đồng ý (Bước 2)');
      const peerEmp = ctx.db.employees.get(before.peer_id) ?? ctx.db.employees.find((e) => e.employee_code === before.peer_id);
      const conflict = peerEmp && ctx.db.shiftAssignments.find((a) => (a.employee_id === peerEmp.id || a.employee_id === peerEmp.employee_code) && a.work_date === before.from_work_date && a.day_type !== 'OFF' && a.status !== 'ON_LEAVE' && a.status !== 'ABSENT');
      if (conflict) throw Errors.badRequest(`Đồng nghiệp nhận ca đã có lịch làm việc trong ngày ${before.from_work_date}, không thể duyệt đổi ca trùng ngày`);
      const onLeave = peerEmp && ctx.db.leaveRequests.find((l) => (l.employee_id === peerEmp.id || l.employee_id === peerEmp.employee_code) && l.leave_date === before.from_work_date && l.status === 'APPROVED');
      if (onLeave) throw Errors.badRequest(`Đồng nghiệp nhận ca đã được duyệt nghỉ OFF trong ngày ${before.from_work_date}, không thể duyệt đổi ca`);
    }
    const actorId = request.auth!.user.id;
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `swap-decide-${id}-v${body.version}`, operation: 'APPROVE_SHIFT_SWAP', actorId, initialContext: { swap: before },
      steps: [
        { name: 'UPDATE_SWAP_STATUS', run: async (s) => { s.swap = await ctx.db.shiftSwaps.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso(), allowance_eligible: body.decision === 'APPROVED' }, actorId); } },
        { name: 'APPLY_TO_OFFICIAL_SCHEDULE_ON_APPROVE', run: async () => {
          if (body.decision !== 'APPROVED') return;
          const assign = ctx.db.shiftAssignments.get(before.from_assignment_id);
          if (assign) await ctx.db.shiftAssignments.update(assign.id, assign.version, { employee_id: before.peer_id, swapped_from_employee_id: before.requester_id, status: 'PUBLISHED', note: `Đã đổi ca từ ${before.swap_code}` }, actorId);
        } },
      ],
      resultSelector: (s) => s.swap,
    });
    await ctx.audit.record(auditContext(request), { action: 'swap.decide', entity: 'SHIFT_SWAPS', entityId: id, before: { status: before.status }, after: { status: updated.status, decision_reason: updated.decision_reason } });
    return sendSuccess(request, body.decision === 'APPROVED' ? 'Đã duyệt đổi ca (Bước 3/3): Lịch chính thức đã được cập nhật sang người nhận ca' : 'Đã từ chối yêu cầu đổi ca', updated);
  });

  app.get('/api/admin/emergency-leaves', { preHandler: requirePermission('schedule.read', 'emergency.handle', 'self.leave') }, async (request) => {
    const scoped = filterByBranch(request, ctx.db.emergencyLeaves.all(), (e) => resolveEmployeeBranchId(ctx, e.employee_id, e.branch_id));
    const mapped = scoped.map((e) => {
      const emp = ctx.db.employees.get(e.employee_id);
      const rep = e.replacement_id ? ctx.db.employees.get(e.replacement_id) : undefined;
      const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(e.branch_id);
      return { ...e, ...resolveShiftTimeDetails(ctx, e.shift_code, e.assignment_id), branchName: branch?.name ?? 'Chi nhánh', employeeName: emp ? `${emp.full_name} (${emp.employee_code})` : e.employee_id, replacementName: rep ? `${rep.full_name} (${rep.employee_code})` : null };
    });
    return sendSuccess(request, 'Lấy danh sách báo nghỉ đột xuất thành công', mapped);
  });

  app.post('/api/admin/emergency-leaves', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateEmergencyBody.parse(request.body);
    const emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự', body.employee_id);
    const existingShift = (body.assignment_id ? ctx.db.shiftAssignments.get(body.assignment_id) : undefined) ?? ctx.db.shiftAssignments.find((a) => (a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === body.work_date && a.day_type !== 'OFF');
    const created = await ctx.db.emergencyLeaves.insert({
      emergency_code: `EMG-${String(ctx.db.emergencyLeaves.all(true).length + 1).padStart(4, '0')}`, employee_id: emp.id, assignment_id: existingShift?.id || body.assignment_id,
      branch_id: emp.branch_id, work_date: body.work_date, shift_code: existingShift?.shift_code || body.shift_code, reason: body.reason, replacement_id: '', status: 'REPORTED',
      escalated: false, handled_by: '', reported_at: nowIso(), minutes_before_shift: 60, evidence_file_id: '', replacement_confirmed_at: '', shift_coverage_status: 'UNCOVERED', escalated_at: '', escalated_to_role: '', handled_at: '', resolution_note: '',
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'emergency.create', entity: 'EMERGENCY_LEAVES', entityId: created.id, after: { emergency_code: created.emergency_code, status: created.status } });
    reply.code(201);
    return sendSuccess(request, 'Đã ghi nhận báo nghỉ đột xuất và phát cảnh báo tới Quản lý', created);
  });

  app.post('/api/admin/emergency-leaves/:id/handle', { preHandler: requirePermission('emergency.handle') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zHandleEmergencyBody.parse(request.body);
    const before = ctx.db.emergencyLeaves.get(id);
    if (!before) throw Errors.notFound('Báo nghỉ đột xuất', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    const actorId = request.auth!.user.id;
    const isEscalate = body.action === 'ESCALATE';
    const nextStatus = body.action === 'ASSIGN_REPLACEMENT' ? 'REPLACEMENT_FOUND' : isEscalate ? 'ESCALATED' : 'RESOLVED';
    const updated = await ctx.db.emergencyLeaves.update(id, body.version, { status: nextStatus, escalated: isEscalate || before.escalated, replacement_id: body.replacement_id || before.replacement_id, shift_coverage_status: body.replacement_id ? 'COVERED' : isEscalate ? 'SHORT_STAFFED_ESCALATED' : 'RESOLVED', escalated_at: isEscalate ? nowIso() : before.escalated_at, escalated_to_role: isEscalate ? 'HR' : before.escalated_to_role, handled_by: actorId, handled_at: nowIso(), resolution_note: body.resolution_note }, actorId);
    if (!isEscalate) {
      const emp = ctx.db.employees.get(before.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === before.employee_id);
      const targetShift = (before.assignment_id ? ctx.db.shiftAssignments.get(before.assignment_id) : undefined) ?? ctx.db.shiftAssignments.find((a) => (a.employee_id === before.employee_id || Boolean(emp && (a.employee_id === emp.id || a.employee_id === emp.employee_code))) && a.work_date === before.work_date);
      if (targetShift && !ctx.db.attendanceEvents.find((ev) => ev.assignment_id === targetShift.id)) {
        if (body.replacement_id) await ctx.db.shiftAssignments.update(targetShift.id, targetShift.version, { employee_id: body.replacement_id, replacement_for_employee_id: before.employee_id, status: 'PUBLISHED', note: `Thay ca nghỉ đột xuất ${before.emergency_code}` }, actorId);
        else await ctx.db.shiftAssignments.softDelete(targetShift.id, targetShift.version, actorId);
      }
    }
    await ctx.audit.record(auditContext(request), { action: 'emergency.handle', entity: 'EMERGENCY_LEAVES', entityId: id, before: { status: before.status }, after: { status: updated.status, escalated: updated.escalated } });
    return sendSuccess(request, isEscalate ? 'Đã chuyển cảnh báo thiếu ca lên cấp trên (Escalated) để điều phối vận hành' : 'Đã cập nhật phương án xử lý ca nghỉ đột xuất và đồng bộ lịch ca', updated);
  });
}
