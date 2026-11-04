import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, SYSTEM_CONFIG, validateDispatchDateRange, zListQueryBase, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso, todayLocal } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueSwapEventEmail } from '../services/action-email-dispatcher.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { cancelDispatchAnnouncement, publishDispatchAnnouncement } from '../services/shift-dispatch.service.js';
import { applySwapToSchedule, evaluateSwapRequest, findEmp, isOfficialSwapEligibleEmployee } from '../services/shift-swap-rules.js';
import { emitScheduleRealtime, resolveEmployeeBranchId } from './account-employee-sync.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';
import { auditOutOfWeekSwaps, enrichSwapKindLabel, registerShiftSwapAllowanceRoute, resolveSwapAllowance, zDecideSwapBody } from './shift-swap-helpers.js';
import { executeHrDispatchClaim, executeHrSupportDispatch, revertSwapSchedule } from '../services/shift-swap-audit.service.js';

const zCreateSwapBody = z.object({
  kind: z.enum(['SWAP', 'GIVE', 'HR_DISPATCH', 'HR_SUPPORT'], { errorMap: () => ({ message: 'Loại yêu cầu phải là Đổi ca 2 chiều, Nhường ca, Điều phối khẩn cấp hoặc Hỗ trợ liên chi nhánh' }) }).default('GIVE'),
  requester_id: z.string().trim().optional().default(''), peer_id: z.string().trim().optional().default(''),
  from_assignment_id: z.string().trim().optional().default(''), to_assignment_id: z.string().trim().optional().default(''),
  branch_id: z.string().trim().optional().default(''), target_branch_id: z.string().trim().optional().default(''),
  work_date: z.string().trim().optional().default(''), shift_code: z.string().trim().optional().default(''),
  reason: z.string().trim().min(2, 'Vui lòng nhập lý do').max(300, 'Lý do tối đa 300 ký tự'),
});
const zPeerRespondBody = z.object({ version: z.coerce.number().int().min(1).optional(), accept: z.boolean().optional().default(true), peer_id: z.string().trim().optional(), peer_note: z.string().trim().max(200).optional().default('') });
const zWorkflowQuery = zListQueryBase.extend({ branch_id: z.string().trim().optional(), status: z.string().trim().optional(), kind: z.string().trim().optional() });
const ACTIVE = new Set(['PENDING_PEER', 'PEER_ACCEPTED']);

function assertDispatchDateInRange(workDate: string, field = 'work_date'): void {
  const check = validateDispatchDateRange(workDate, todayLocal());
  if (!check.valid) throw Errors.fieldValidation(field, 'INVALID_VALUE', check.message!, workDate);
}

export async function shiftSwapRoutes(app: FastifyInstance, ctx: AppContext) {
  const loadPair = (s: ShiftSwap) => {
    const requester = findEmp(ctx, s.requester_id), peer = findEmp(ctx, s.peer_id), from = ctx.db.shiftAssignments.get(s.from_assignment_id), to = s.to_assignment_id ? ctx.db.shiftAssignments.get(s.to_assignment_id) : undefined;
    if (!requester || !peer || !from) throw Errors.badRequest('Ca làm việc hoặc nhân sự liên quan không còn tồn tại, yêu cầu không thể xử lý');
    return { requester, peer, from, to };
  };
  const notify = async (request: Parameters<typeof auditContext>[0], s: ShiftSwap, stage: 'CREATED' | 'PEER_RESPONDED' | 'DECIDED', message: string, ids: string[], auditFn?: () => Promise<unknown>) => {
    queueSwapEventEmail(ctx, s, stage, request.auth!.user.id);
    const kind = stage === 'DECIDED' ? 'SWAP_DECIDED' : stage === 'CREATED' ? 'SWAP_CREATED' : s.status === 'PEER_ACCEPTED' ? 'SWAP_PEER_ACCEPTED' : 'SWAP_PEER_DECLINED';
    emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: s.branch_id, employeeIds: ids.filter(Boolean), kind, message, actorId: request.auth!.user.id });
    await runBackgroundSideEffect(async () => { await ensureSyncedNotifications(ctx); if (auditFn) await auditFn(); });
  };

  app.get('/api/admin/shift-swaps', { preHandler: requirePermission('schedule.read', 'swap.approve', 'self.swap') }, async (request) => {
    const query = zWorkflowQuery.parse(request.query ?? {});
    const scoped = filterByBranch(request, ctx.db.shiftSwaps.all(), (s) => resolveEmployeeBranchId(ctx, s.requester_id, s.branch_id));
    const mapped = scoped.map((s) => enrichSwapKindLabel(ctx, s)).filter((s) => (!query.branch_id || query.branch_id === 'ALL' || s.branch_id === query.branch_id) && (!query.status || query.status === 'ALL' || s.status === query.status) && (!query.kind || query.kind === 'ALL' || s.kind === query.kind));
    return sendPaginated(request, 'Lấy danh sách yêu cầu đổi ca / nhường ca thành công', paginateAndSort(mapped, { page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc', allowedSortFields: ['created_at', 'from_work_date', 'status'], q: query.q, searchExtractor: (i) => [i.swap_code, i.requesterName, i.peerName, i.reason], filters: { branch_id: query.branch_id, status: query.status, kind: query.kind } }));
  });

  app.post('/api/admin/shift-swaps', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateSwapBody.parse(request.body), actor = request.auth!.user;
    const from = body.from_assignment_id ? ctx.db.shiftAssignments.get(body.from_assignment_id) : undefined;
    if (body.from_assignment_id && !from) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca làm việc được chọn', body.from_assignment_id);

    if (body.kind === 'HR_SUPPORT') {
      const workDate = body.work_date || from?.work_date || '';
      if (workDate) { assertDispatchDateInRange(workDate); assertDateNotLockedByPayroll(ctx.db, workDate, 'điều phối hỗ trợ ca'); }
      if (!body.target_branch_id) throw Errors.fieldValidation('target_branch_id', 'REQUIRED_FIELD', 'Vui lòng chọn chi nhánh tiếp nhận hỗ trợ', '');
      const created = await executeHrSupportDispatch(ctx, { fromAssignmentId: from?.id, targetBranchId: body.target_branch_id, workDate: body.work_date || undefined, shiftCode: body.shift_code || undefined, reason: body.reason, requesterId: body.requester_id || from?.employee_id }, actor.id);
      reply.code(201);
      return sendSuccess(request, 'Đã tạo phiếu điều động hỗ trợ liên chi nhánh và tự động tạo ca tại chi nhánh đích', enrichSwapKindLabel(ctx, created));
    }
    if (body.kind === 'HR_DISPATCH') {
      const branchId = from?.branch_id || body.branch_id || body.target_branch_id || '';
      const workDate = from?.work_date || body.work_date || '', shiftCode = from?.shift_code || body.shift_code || '';
      if (!branchId) throw Errors.fieldValidation('branch_id', 'REQUIRED_FIELD', 'Vui lòng chọn chi nhánh cần điều phối khẩn cấp', '');
      if (!workDate || !shiftCode) throw Errors.fieldValidation(!workDate ? 'work_date' : 'shift_code', 'REQUIRED_FIELD', !workDate ? 'Vui lòng chọn ngày làm việc cần điều phối' : 'Vui lòng chọn khung ca cần điều phối', '');
      assertDispatchDateInRange(workDate);
      assertBranchAccess(request, branchId);
      assertDateNotLockedByPayroll(ctx.db, workDate, 'điều phối ca');
      const requester = (body.requester_id || from?.employee_id) ? findEmp(ctx, body.requester_id || from!.employee_id) : undefined;
      const created = await ctx.db.shiftSwaps.insert({
        swap_code: `DSP-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`,
        kind: 'HR_DISPATCH', requires_hr_approval: false, requester_id: requester?.id ?? from?.employee_id ?? '', peer_id: '',
        from_assignment_id: from?.id ?? '', to_assignment_id: '', branch_id: branchId, target_branch_id: branchId,
        from_work_date: workDate, from_shift_code: shiftCode, to_work_date: workDate, to_shift_code: shiftCode,
        reason: body.reason, status: 'PENDING_PEER', has_conflict: false, staffing_valid: true, requested_at: nowIso(),
        peer_responded_at: '', peer_note: '', decided_by: '', decision_reason: '', decided_at: '',
        allowance_eligible: true, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
      }, actor.id);
      await publishDispatchAnnouncement(ctx, created, { branch_id: branchId, work_date: workDate, shift_code: shiftCode, start_at: from?.start_at, end_at: from?.end_at }, actor);
      reply.code(201);
      return sendSuccess(request, 'Đã phát lệnh điều phối khẩn cấp lên bảng tin chi nhánh (+30.000đ)', enrichSwapKindLabel(ctx, created));
    }

    if (!from) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca làm việc được chọn', body.from_assignment_id);
    assertDateNotLockedByPayroll(ctx.db, from.work_date, 'đổi / nhường ca');

    const requester = findEmp(ctx, body.requester_id), peer = findEmp(ctx, body.peer_id);
    if (!requester || !peer) throw Errors.fieldValidation(!requester ? 'requester_id' : 'peer_id', 'INVALID_VALUE', !requester ? 'Không tìm thấy nhân sự gửi yêu cầu' : 'Không tìm thấy đồng nghiệp', !requester ? body.requester_id : body.peer_id);
    if (isEmployeeRole(actor.role) && findLinkedEmployeeForUser(actor, ctx)?.id !== requester.id) throw Errors.forbidden('Bạn chỉ được gửi yêu cầu đổi / nhường ca của chính mình');
    if (!isEmployeeRole(actor.role)) assertBranchAccess(request, requester.branch_id);
    if (from.employee_id !== requester.id && from.employee_id !== requester.employee_code) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Ca được chọn không thuộc lịch làm việc của bạn', body.from_assignment_id);
    const to = body.to_assignment_id ? ctx.db.shiftAssignments.get(body.to_assignment_id) : undefined;
    if (body.kind === 'SWAP' && body.to_assignment_id && !to) throw Errors.fieldValidation('to_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca của đồng nghiệp', body.to_assignment_id);
    if (to) assertDateNotLockedByPayroll(ctx.db, to.work_date, 'đổi ca');
    const dup = ctx.db.shiftSwaps.find((s) => ACTIVE.has(s.status) && [s.from_assignment_id, s.to_assignment_id].some((id) => id && (id === from.id || id === to?.id)));
    if (dup) throw Errors.fieldValidation('from_assignment_id', 'DUPLICATE_VALUE', `Ca làm việc này đang có yêu cầu ${dup.swap_code} chờ xử lý`, from.id);
    const evalRes = evaluateSwapRequest(ctx, { kind: body.kind, requester, peer, from, to: body.kind === 'SWAP' ? to : undefined }), isSwap = body.kind === 'SWAP';
    const created = await ctx.db.shiftSwaps.insert({
      swap_code: `${isSwap ? 'DCA' : 'NCA'}-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`, kind: body.kind, requires_hr_approval: evalRes.requiresHr,
      requester_id: requester.id, peer_id: peer.id, from_assignment_id: from.id, to_assignment_id: isSwap ? to!.id : '', branch_id: from.branch_id, target_branch_id: '',
      from_work_date: from.work_date, from_shift_code: from.shift_code, to_work_date: isSwap ? to!.work_date : from.work_date, to_shift_code: isSwap ? to!.shift_code : from.shift_code,
      reason: body.reason, status: 'PENDING_PEER', has_conflict: false, staffing_valid: true, requested_at: nowIso(), peer_responded_at: '', peer_note: '',
      decided_by: '', decision_reason: '', decided_at: '', allowance_eligible: false, allowance_amount_vnd: isSwap ? 0 : SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
    }, actor.id);
    const reqAudit = auditContext(request);
    await notify(request, created, 'CREATED', `${requester.full_name} gửi yêu cầu ${isSwap ? 'đổi ca' : 'nhường ca'} (${created.swap_code}) cho bạn`, [peer.id], () => ctx.audit.record(reqAudit, { action: 'swap.create', entity: 'SHIFT_SWAPS', entityId: created.id, after: { swap_code: created.swap_code, kind: created.kind, requires_hr_approval: created.requires_hr_approval } }));
    reply.code(201);
    const hrNote = evalRes.requiresHr ? ' Người nhận sẽ vượt 2 ca/ngày nên sau khi đồng nghiệp đồng ý cần HR phê duyệt.' : '';
    return sendSuccess(request, `Đã gửi yêu cầu ${isSwap ? 'đổi ca 2 chiều' : 'nhường ca'} — chờ ${peer.full_name} xác nhận.${hrNote}`, enrichSwapKindLabel(ctx, created));
  });

  const handlePeerOrClaim = async (request: Parameters<typeof auditContext>[0] & { params: unknown; body: unknown }) => {
    const { id } = request.params as { id: string }, body = zPeerRespondBody.parse(request.body ?? {}), before = ctx.db.shiftSwaps.get(id), actor = request.auth!.user;
    if (!before || before.status !== 'PENDING_PEER') throw !before ? Errors.notFound('Yêu cầu đổi / nhường ca', id) : Errors.badRequest('Yêu cầu này đã được xử lý trước đó');
    const ver = body.version ?? before.version;

    if (before.kind === 'HR_DISPATCH' || before.kind === 'HR_SUPPORT') {
      const receiver = (body.peer_id ? findEmp(ctx, body.peer_id) : undefined) ?? findLinkedEmployeeForUser(actor, ctx) ?? (before.peer_id ? findEmp(ctx, before.peer_id) : undefined);
      if (!receiver) throw Errors.badRequest('Không xác định được nhân sự nhận ca điều phối');
      if (!body.accept) {
        if (before.kind === 'HR_DISPATCH' && !before.peer_id) return sendSuccess(request, 'Đã bỏ qua lệnh điều phối, lệnh vẫn mở cho đồng nghiệp khác trong chi nhánh', enrichSwapKindLabel(ctx, before));
        const declined = await ctx.db.shiftSwaps.update(id, ver, { status: 'PEER_DECLINED', peer_responded_at: nowIso(), peer_note: body.peer_note }, actor.id);
        return sendSuccess(request, 'Đã từ chối nhận ca điều phối', enrichSwapKindLabel(ctx, declined));
      }
      if (before.kind === 'HR_DISPATCH') {
        if (before.requester_id && (receiver.id === before.requester_id || receiver.employee_code === before.requester_id)) throw Errors.badRequest('Bạn không thể tự nhận ca điều phối của chính mình');
        if (isEmployeeRole(actor.role) && receiver.branch_id !== before.branch_id) throw Errors.forbidden('Chỉ nhân viên thuộc chi nhánh phát lệnh mới được nhận ca điều phối này');
        if (isEmployeeRole(actor.role) && !isOfficialSwapEligibleEmployee(ctx, receiver)) throw Errors.forbidden('Chỉ Nhân viên Chính thức mới được nhận ca điều phối khẩn cấp');
      }
      const claimed = await executeHrDispatchClaim(ctx, before, receiver, body.peer_note, actor.id);
      return sendSuccess(request, before.kind === 'HR_DISPATCH' ? 'Đã nhận ca điều phối khẩn cấp (+30.000đ) và tạo ca mới trên lịch chính thức của bạn' : 'Đã xác nhận điều động hỗ trợ liên chi nhánh', enrichSwapKindLabel(ctx, claimed));
    }

    const actorEmp = findLinkedEmployeeForUser(actor, ctx);
    if (!actorEmp || (actorEmp.id !== before.peer_id && actorEmp.employee_code !== before.peer_id)) throw Errors.forbidden('Chỉ đồng nghiệp được đề nghị mới có quyền xác nhận yêu cầu này');
    if (!body.accept) {
      const declined = await ctx.db.shiftSwaps.update(id, ver, { status: 'PEER_DECLINED', peer_responded_at: nowIso(), peer_note: body.peer_note }, actor.id), reqAudit = auditContext(request);
      await notify(request, declined, 'PEER_RESPONDED', `Đồng nghiệp đã từ chối yêu cầu ${before.swap_code}${body.peer_note ? ` — Lý do: ${body.peer_note}` : ''}`, [before.requester_id], () => ctx.audit.record(reqAudit, { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: declined.status, peer_note: body.peer_note } }));
      return sendSuccess(request, 'Bạn đã từ chối yêu cầu đổi / nhường ca', enrichSwapKindLabel(ctx, declined));
    }
    const pair = loadPair(before), evalRes = evaluateSwapRequest(ctx, { kind: before.kind, requester: pair.requester, peer: pair.peer, from: pair.from, to: pair.to });
    if (evalRes.requiresHr) {
      const waiting = await ctx.db.shiftSwaps.update(id, ver, { status: 'PEER_ACCEPTED', requires_hr_approval: true, peer_responded_at: nowIso(), peer_note: body.peer_note }, actor.id), reqAudit = auditContext(request);
      await notify(request, waiting, 'PEER_RESPONDED', `Yêu cầu nhường ca ${before.swap_code} cần HR phê duyệt vì người nhận vượt 2 ca/ngày`, [before.requester_id], () => ctx.audit.record(reqAudit, { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: waiting.status, requires_hr_approval: true, peer_note: body.peer_note } }));
      return sendSuccess(request, `Bạn đã đồng ý nhận ca. Vì sẽ làm ${evalRes.receiverCountAfter} ca trong ngày nên yêu cầu được chuyển HR phê duyệt.`, enrichSwapKindLabel(ctx, waiting));
    }
    const allowance = before.kind === 'GIVE' ? resolveSwapAllowance({ decision: 'APPROVED' }) : { allowance_eligible: false, allowance_amount_vnd: 0 };
    const autoDecisionReason = body.peer_note ? `Đồng nghiệp đồng ý (${body.peer_note}) — tự động cập nhật lịch` : 'Đồng nghiệp đồng ý — tự động cập nhật lịch';
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `swap-peer-apply-${id}-v${ver}`, operation: 'APPLY_SHIFT_SWAP', actorId: actor.id, initialContext: { swap: before }, resultSelector: (s) => s.swap,
      steps: [
        { name: 'UPDATE_SWAP_STATUS', run: async (s) => { s.swap = await ctx.db.shiftSwaps.update(id, ver, { status: 'APPROVED', peer_responded_at: nowIso(), peer_note: body.peer_note, decided_by: actor.id, decided_at: nowIso(), decision_reason: autoDecisionReason, ...allowance }, actor.id); } },
        { name: 'APPLY_TO_OFFICIAL_SCHEDULE', run: async (s) => { await applySwapToSchedule(ctx, s.swap, actor.id); } },
      ],
    });
    const reqAudit = auditContext(request);
    await recalculateOpenPeriods(ctx, actor.id);
    await notify(request, updated, 'DECIDED', `Yêu cầu ${before.swap_code} đã được đồng nghiệp đồng ý và cập nhật lịch chính thức`, [before.requester_id, before.peer_id], () => ctx.audit.record(reqAudit, { action: 'swap.peer_respond', entity: 'SHIFT_SWAPS', entityId: id, after: { status: updated.status, applied: true } }));
    return sendSuccess(request, before.kind === 'SWAP' ? 'Đã đồng ý đổi ca — lịch của hai bạn đã được cập nhật ngay' : 'Đã nhận ca được nhường — ca đã được thêm vào lịch của bạn', enrichSwapKindLabel(ctx, updated));
  };
  app.post('/api/admin/shift-swaps/:id/peer-respond', { preHandler: requireAuth() }, handlePeerOrClaim);
  app.post('/api/admin/shift-swaps/:id/claim', { preHandler: requireAuth() }, handlePeerOrClaim);
  app.post('/api/admin/shift-swaps/:id/decide', { preHandler: requirePermission('swap.approve') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecideSwapBody.parse(request.body), before = ctx.db.shiftSwaps.get(id);
    if (!before) throw Errors.notFound('Yêu cầu nhường ca', id);
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.requester_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.from_work_date, 'duyệt nhường ca');
    if (before.status !== 'PEER_ACCEPTED') throw Errors.badRequest('Chỉ duyệt các yêu cầu nhường ca vượt 2 ca/ngày đã được người nhận đồng ý');
    if (body.decision === 'APPROVED' && (before.kind === 'SWAP' || before.kind === 'GIVE')) { const pair = loadPair(before); evaluateSwapRequest(ctx, { kind: before.kind, ...pair, hrOverride: true }); }
    const actorId = request.auth!.user.id, allowancePatch = resolveSwapAllowance(body);
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `swap-decide-${id}-v${body.version}`, operation: 'APPROVE_SHIFT_SWAP', actorId, initialContext: { swap: before }, resultSelector: (s) => s.swap,
      steps: [
        { name: 'UPDATE_SWAP_STATUS', run: async (s) => { s.swap = await ctx.db.shiftSwaps.update(id, body.version, { status: body.decision, decided_by: actorId, decision_reason: body.decision_reason, decided_at: nowIso(), ...allowancePatch }, actorId); } },
        { name: 'APPLY_TO_OFFICIAL_SCHEDULE_ON_APPROVE', run: async (s) => { if (body.decision === 'APPROVED') await applySwapToSchedule(ctx, s.swap, actorId); } },
      ],
    });
    if (body.decision === 'APPROVED') await recalculateOpenPeriods(ctx, actorId);
    const reqAudit = auditContext(request);
    await notify(request, updated, 'DECIDED', `Yêu cầu nhường ca ${before.swap_code} đã ${body.decision === 'APPROVED' ? 'được HR phê duyệt' : 'bị HR từ chối'}`, [before.requester_id, before.peer_id], () => ctx.audit.record(reqAudit, { action: 'swap.decide', entity: 'SHIFT_SWAPS', entityId: id, before: { status: before.status }, after: { status: updated.status, allowance_eligible: updated.allowance_eligible, allowance_amount_vnd: updated.allowance_amount_vnd } }));
    return sendSuccess(request, body.decision === 'APPROVED' ? 'Đã phê duyệt nhường ca — lịch chính thức đã chuyển sang người nhận' : 'Đã từ chối yêu cầu nhường ca, lịch giữ nguyên', enrichSwapKindLabel(ctx, updated));
  });

  app.post('/api/admin/shift-swaps/:id/cancel', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, before = ctx.db.shiftSwaps.get(id), actor = request.auth!.user;
    if (!before) throw Errors.notFound('Yêu cầu đổi / nhường ca', id);
    const actorEmp = findLinkedEmployeeForUser(actor, ctx);
    const isOwner = actorEmp && (actorEmp.id === before.requester_id || actorEmp.employee_code === before.requester_id);
    const isDispatchOrSupport = before.kind === 'HR_DISPATCH' || before.kind === 'HR_SUPPORT';
    if (!isOwner && !(isDispatchOrSupport && ['ADMIN', 'HR', 'STORE'].includes(actor.role))) throw Errors.forbidden('Chỉ người phát lệnh hoặc Quản lý chi nhánh mới được hủy yêu cầu');
    if (!ACTIVE.has(before.status) && !((before.kind === 'HR_SUPPORT' || before.kind === 'HR_DISPATCH') && before.status === 'APPROVED')) throw Errors.badRequest('Yêu cầu đã được xử lý, không thể hủy');
    assertDateNotLockedByPayroll(ctx.db, before.from_work_date, 'hủy yêu cầu đổi / điều động ca');
    const updated = await ctx.db.shiftSwaps.update(id, before.version, { status: 'CANCELLED', decided_at: nowIso(), decision_reason: 'Đã hủy yêu cầu' }, actor.id);
    if (before.kind === 'HR_DISPATCH') { await cancelDispatchAnnouncement(ctx, before.swap_code, actor.id); if (before.status === 'APPROVED') await revertSwapSchedule(ctx, before, actor.id); }
    if (before.kind === 'HR_SUPPORT') await revertSwapSchedule(ctx, before, actor.id);
    await runBackgroundSideEffect(() => ensureSyncedNotifications(ctx));
    const cancelMsg = before.kind === 'HR_DISPATCH' ? (before.status === 'APPROVED' ? 'Đã hủy lệnh điều phối khẩn cấp và xóa ca đã tạo cho người nhận' : 'Đã hủy lệnh điều phối khẩn cấp') : before.kind === 'HR_SUPPORT' ? 'Đã hủy điều động hỗ trợ liên chi nhánh và hoàn trả lịch gốc' : 'Đã hủy yêu cầu đổi / nhường ca';
    return sendSuccess(request, cancelMsg, enrichSwapKindLabel(ctx, updated));
  });

  app.post('/api/admin/shift-swaps/audit-out-of-week', { preHandler: requireAuth() }, async (request) => {
    const res = await auditOutOfWeekSwaps(ctx, request.auth!.user.id);
    return sendSuccess(request, `Đã rà soát và tự động hủy ${res.cancelledCount} phiếu đổi ca khác tuần`, res);
  });
  registerShiftSwapAllowanceRoute(app, ctx);
}
