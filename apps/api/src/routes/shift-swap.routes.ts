import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, SYSTEM_CONFIG, zListQueryBase, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueSwapEventEmail } from '../services/action-email-dispatcher.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { applySwapToSchedule, evaluateSwapRequest, findEmp } from '../services/shift-swap-rules.js';
import { emitScheduleRealtime, resolveEmployeeBranchId } from './account-employee-sync.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';
import { mapShiftSwapRecord, registerShiftSwapAllowanceRoute, resolveSwapAllowance, zDecideSwapBody } from './shift-swap-helpers.js';

const zCreateSwapBody = z.object({
  kind: z.enum(['SWAP', 'GIVE'], { errorMap: () => ({ message: 'Loại yêu cầu phải là Đổi ca 2 chiều hoặc Nhường ca' }) }).default('GIVE'),
  requester_id: z.string().trim().min(1, 'Thiếu nhân sự gửi yêu cầu'), peer_id: z.string().trim().min(1, 'Vui lòng chọn đồng nghiệp'),
  from_assignment_id: z.string().trim().min(1, 'Vui lòng chọn ca của bạn'), to_assignment_id: z.string().trim().optional().default(''),
  reason: z.string().trim().min(2, 'Vui lòng nhập lý do').max(300, 'Lý do tối đa 300 ký tự'),
});
const zPeerRespondBody = z.object({ version: z.coerce.number().int().min(1), accept: z.boolean(), peer_note: z.string().trim().max(200).optional().default('') });
const zWorkflowQuery = zListQueryBase.extend({ branch_id: z.string().trim().optional(), status: z.string().trim().optional(), kind: z.string().trim().optional() });
const ACTIVE = new Set(['PENDING_PEER', 'PEER_ACCEPTED']);

export async function shiftSwapRoutes(app: FastifyInstance, ctx: AppContext) {
  const loadPair = (s: ShiftSwap) => {
    const requester = findEmp(ctx, s.requester_id), peer = findEmp(ctx, s.peer_id);
    const from = ctx.db.shiftAssignments.get(s.from_assignment_id), to = s.to_assignment_id ? ctx.db.shiftAssignments.get(s.to_assignment_id) : undefined;
    if (!requester || !peer || !from) throw Errors.badRequest('Ca làm việc hoặc nhân sự liên quan không còn tồn tại, yêu cầu không thể xử lý');
    return { requester, peer, from, to };
  };
  const notify = async (request: Parameters<typeof auditContext>[0], s: ShiftSwap, stage: 'CREATED' | 'PEER_RESPONDED' | 'DECIDED', message: string, ids: string[]) => {
    queueSwapEventEmail(ctx, s, stage, request.auth!.user.id);
    await ensureSyncedNotifications(ctx);
    emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: s.branch_id, employeeIds: ids, kind: stage === 'DECIDED' ? 'SWAP_DECIDED' : stage === 'CREATED' ? 'SWAP_CREATED' : 'SWAP_PEER', message, actorId: request.auth!.user.id });
  };

  app.get('/api/admin/shift-swaps', { preHandler: requirePermission('schedule.read', 'swap.approve', 'self.swap') }, async (request) => {
    const query = zWorkflowQuery.parse(request.query ?? {});
    const scoped = filterByBranch(request, ctx.db.shiftSwaps.all(), (s) => resolveEmployeeBranchId(ctx, s.requester_id, s.branch_id));
    const mapped = scoped.map((s) => mapShiftSwapRecord(ctx, s)).filter((s) => (!query.branch_id || query.branch_id === 'ALL' || s.branch_id === query.branch_id) && (!query.status || query.status === 'ALL' || s.status === query.status) && (!query.kind || query.kind === 'ALL' || s.kind === query.kind));
    return sendPaginated(request, 'Lấy danh sách yêu cầu đổi ca / nhường ca thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'from_work_date', 'status'], q: query.q, searchExtractor: (i) => [i.swap_code, i.requesterName, i.peerName, i.reason], filters: { branch_id: query.branch_id, status: query.status, kind: query.kind } }));
  });

  app.post('/api/admin/shift-swaps', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateSwapBody.parse(request.body), actor = request.auth!.user;
    const requester = findEmp(ctx, body.requester_id), peer = findEmp(ctx, body.peer_id);
    if (!requester) throw Errors.fieldValidation('requester_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự gửi yêu cầu', body.requester_id);
    if (!peer) throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Không tìm thấy đồng nghiệp', body.peer_id);
    if (isEmployeeRole(actor.role) && findLinkedEmployeeForUser(actor, ctx)?.id !== requester.id) throw Errors.forbidden('Bạn chỉ được gửi yêu cầu đổi / nhường ca của chính mình');
    if (!isEmployeeRole(actor.role)) assertBranchAccess(request, requester.branch_id);
    const from = ctx.db.shiftAssignments.get(body.from_assignment_id);
    if (!from || (from.employee_id !== requester.id && from.employee_id !== requester.employee_code)) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Ca được chọn không thuộc lịch làm việc của bạn', body.from_assignment_id);
    const to = body.to_assignment_id ? ctx.db.shiftAssignments.get(body.to_assignment_id) : undefined;
    if (body.kind === 'SWAP' && body.to_assignment_id && !to) throw Errors.fieldValidation('to_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca của đồng nghiệp', body.to_assignment_id);
    assertDateNotLockedByPayroll(ctx.db, from.work_date, 'đổi / nhường ca');
    if (to) assertDateNotLockedByPayroll(ctx.db, to.work_date, 'đổi ca');
    const dup = ctx.db.shiftSwaps.find((s) => ACTIVE.has(s.status) && [s.from_assignment_id, s.to_assignment_id].some((id) => id && (id === from.id || id === to?.id)));
    if (dup) throw Errors.fieldValidation('from_assignment_id', 'DUPLICATE_VALUE', `Ca làm việc này đang có yêu cầu ${dup.swap_code} chờ xử lý`, from.id);
    const evalRes = evaluateSwapRequest(ctx, { kind: body.kind, requester, peer, from, to: body.kind === 'SWAP' ? to : undefined });
    const isSwap = body.kind === 'SWAP';
    const created = await ctx.db.shiftSwaps.insert({
      swap_code: `${isSwap ? 'DCA' : 'NCA'}-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`, kind: body.kind, requires_hr_approval: evalRes.requiresHr,
      requester_id: requester.id, peer_id: peer.id, from_assignment_id: from.id, to_assignment_id: isSwap ? to!.id : '', branch_id: from.branch_id,
      from_work_date: from.work_date, from_shift_code: from.shift_code, to_work_date: isSwap ? to!.work_date : from.work_date, to_shift_code: isSwap ? to!.shift_code : from.shift_code,
      reason: body.reason, status: 'PENDING_PEER', has_conflict: false, staffing_valid: true, requested_at: nowIso(), peer_responded_at: '', peer_note: '',
      decided_by: '', decision_reason: '', decided_at: '', allowance_eligible: false, allowance_amount_vnd: isSwap ? 0 : SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
    }, actor.id);
    await ctx.audit.record(auditContext(request), { action: 'swap.create', entity: 'SHIFT_SWAPS', entityId: created.id, after: { swap_code: created.swap_code, kind: created.kind, requires_hr_approval: created.requires_hr_approval } });
    await notify(request, created, 'CREATED', `${requester.full_name} gửi yêu cầu ${isSwap ? 'đổi ca' : 'nhường ca'} (${created.swap_code}) cho bạn`, [peer.id]);
    reply.code(201);
    const hrNote = evalRes.requiresHr ? ' Người nhận sẽ vượt 2 ca/ngày nên sau khi đồng nghiệp đồng ý cần HR phê duyệt.' : '';
    return sendSuccess(request, `Đã gửi yêu cầu ${isSwap ? 'đổi ca 2 chiều' : 'nhường ca'} — chờ ${peer.full_name} xác nhận.${hrNote}`, mapShiftSwapRecord(ctx, created));
  });

  app.post('/api/admin/shift-swaps/:id/peer-respond', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, body = zPeerRespondBody.parse(request.body), before = ctx.db.shiftSwaps.get(id), actor = request.auth!.user;
    if (!before) throw Errors.notFound('Yêu cầu đổi / nhường ca', id);
    if (before.status !== 'PENDING_PEER') throw Errors.badRequest('Yêu cầu này đã được xử lý trước đó');
    const actorEmp = findLinkedEmployeeForUser(actor, ctx);
    if (!actorEmp || (actorEmp.id !== before.peer_id && actorEmp.employee_code !== before.peer_id)) throw Errors.forbidden('Chỉ đồng nghiệp được đề nghị mới có quyền xác nhận yêu cầu này');
    if (!body.accept) {
      const declined = await ctx.db.shiftSwaps.update(id, body.version, { status: 'PEER_DECLINED', peer_responded_at: nowIso(), peer_note: body.peer_note }, actor.id);
      await ctx.audit.record(auditContext(request), { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: declined.status } });
      await notify(request, declined, 'PEER_RESPONDED', `Đồng nghiệp đã từ chối yêu cầu ${before.swap_code}`, [before.requester_id]);
      return sendSuccess(request, 'Bạn đã từ chối yêu cầu đổi / nhường ca', mapShiftSwapRecord(ctx, declined));
    }
    const pair = loadPair(before);
    const evalRes = evaluateSwapRequest(ctx, { kind: before.kind, requester: pair.requester, peer: pair.peer, from: pair.from, to: pair.to });
    if (evalRes.requiresHr) {
      const waiting = await ctx.db.shiftSwaps.update(id, body.version, { status: 'PEER_ACCEPTED', requires_hr_approval: true, peer_responded_at: nowIso(), peer_note: body.peer_note }, actor.id);
      await ctx.audit.record(auditContext(request), { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: waiting.status, requires_hr_approval: true } });
      await notify(request, waiting, 'PEER_RESPONDED', `Yêu cầu nhường ca ${before.swap_code} cần HR phê duyệt vì người nhận vượt 2 ca/ngày`, [before.requester_id]);
      return sendSuccess(request, `Bạn đã đồng ý nhận ca. Vì sẽ làm ${evalRes.receiverCountAfter} ca trong ngày nên yêu cầu được chuyển HR phê duyệt.`, mapShiftSwapRecord(ctx, waiting));
    }
    const allowance = before.kind === 'GIVE' ? resolveSwapAllowance({ decision: 'APPROVED' }) : { allowance_eligible: false, allowance_amount_vnd: 0 };
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `swap-peer-apply-${id}-v${body.version}`, operation: 'APPLY_SHIFT_SWAP', actorId: actor.id, initialContext: { swap: before },
      steps: [
        { name: 'UPDATE_SWAP_STATUS', run: async (s) => { s.swap = await ctx.db.shiftSwaps.update(id, body.version, { status: 'APPROVED', peer_responded_at: nowIso(), peer_note: body.peer_note, decided_by: actor.id, decided_at: nowIso(), decision_reason: 'Đồng nghiệp đồng ý — tự động cập nhật lịch', ...allowance }, actor.id); } },
        { name: 'APPLY_TO_OFFICIAL_SCHEDULE', run: async (s) => { await applySwapToSchedule(ctx, s.swap, actor.id); } },
      ],
      resultSelector: (s) => s.swap,
    });
    await recalculateOpenPeriods(ctx, actor.id);
    await ctx.audit.record(auditContext(request), { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: updated.status, applied: true } });
    await notify(request, updated, 'DECIDED', `Yêu cầu ${before.swap_code} đã được đồng nghiệp đồng ý và cập nhật lịch chính thức`, [before.requester_id, before.peer_id]);
    return sendSuccess(request, before.kind === 'SWAP' ? 'Đã đồng ý đổi ca — lịch của hai bạn đã được cập nhật ngay' : 'Đã nhận ca được nhường — ca đã được thêm vào lịch của bạn', mapShiftSwapRecord(ctx, updated));
  });

  app.post('/api/admin/shift-swaps/:id/decide', { preHandler: requirePermission('swap.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecideSwapBody.parse(request.body), before = ctx.db.shiftSwaps.get(id);
    if (!before) throw Errors.notFound('Yêu cầu nhường ca', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.requester_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.from_work_date, 'duyệt nhường ca');
    if (before.status !== 'PEER_ACCEPTED') throw Errors.badRequest('Chỉ duyệt các yêu cầu nhường ca vượt 2 ca/ngày đã được người nhận đồng ý');
    if (body.decision === 'APPROVED') { const pair = loadPair(before); evaluateSwapRequest(ctx, { kind: before.kind, ...pair, hrOverride: true }); }
    const actorId = request.auth!.user.id, allowancePatch = resolveSwapAllowance(body);
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `swap-decide-${id}-v${body.version}`, operation: 'APPROVE_SHIFT_SWAP', actorId, initialContext: { swap: before },
      steps: [
        { name: 'UPDATE_SWAP_STATUS', run: async (s) => { s.swap = await ctx.db.shiftSwaps.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso(), ...allowancePatch }, actorId); } },
        { name: 'APPLY_TO_OFFICIAL_SCHEDULE_ON_APPROVE', run: async (s) => { if (body.decision === 'APPROVED') await applySwapToSchedule(ctx, s.swap, actorId); } },
      ],
      resultSelector: (s) => s.swap,
    });
    if (body.decision === 'APPROVED') await recalculateOpenPeriods(ctx, actorId);
    await ctx.audit.record(auditContext(request), { action: 'swap.decide', entity: 'SHIFT_SWAPS', entityId: id, before: { status: before.status }, after: { status: updated.status, allowance_eligible: updated.allowance_eligible, allowance_amount_vnd: updated.allowance_amount_vnd } });
    await notify(request, updated, 'DECIDED', `Yêu cầu nhường ca ${before.swap_code} đã ${body.decision === 'APPROVED' ? 'được HR phê duyệt' : 'bị HR từ chối'}`, [before.requester_id, before.peer_id]);
    return sendSuccess(request, body.decision === 'APPROVED' ? 'Đã phê duyệt nhường ca — lịch chính thức đã chuyển sang người nhận' : 'Đã từ chối yêu cầu nhường ca, lịch giữ nguyên', mapShiftSwapRecord(ctx, updated));
  });

  app.post('/api/admin/shift-swaps/:id/cancel', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, before = ctx.db.shiftSwaps.get(id), actor = request.auth!.user;
    if (!before) throw Errors.notFound('Yêu cầu đổi / nhường ca', id);
    const actorEmp = findLinkedEmployeeForUser(actor, ctx);
    if (!actorEmp || (actorEmp.id !== before.requester_id && actorEmp.employee_code !== before.requester_id)) throw Errors.forbidden('Chỉ người gửi mới được hủy yêu cầu');
    if (!ACTIVE.has(before.status)) throw Errors.badRequest('Yêu cầu đã được xử lý, không thể hủy');
    const updated = await ctx.db.shiftSwaps.update(id, before.version, { status: 'CANCELLED', decided_at: nowIso(), decision_reason: 'Người gửi đã hủy yêu cầu' }, actor.id);
    await ensureSyncedNotifications(ctx);
    return sendSuccess(request, 'Đã hủy yêu cầu đổi / nhường ca', mapShiftSwapRecord(ctx, updated));
  });

  registerShiftSwapAllowanceRoute(app, ctx);
}
