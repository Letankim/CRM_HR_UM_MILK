import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_LABELS, zListQueryBase, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';

const LEGACY_INTERVIEWER_MAP: Record<string, { role: Role; label: string }> = {
  'u-hr-01': { role: 'HR', label: 'Nguyễn Thị Nhân Sự (Quản lý Nhân sự)' },
  'u-store-01': { role: 'STORE', label: 'Trần Văn Cửa Hàng (Quản lý cửa hàng)' },
  'u-admin-01': { role: 'ADMIN', label: 'Ban Giám đốc (Quản trị viên)' },
};

const zCreateInterviewBody = z.object({
  candidate_id: z.string().trim().min(1), interviewer_id: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  interviewer_ids: z.array(z.string().trim()).optional(), scheduled_at: z.string().trim().optional(), start_at: z.string().trim().optional(),
  duration_minutes: z.coerce.number().int().min(5).max(240).default(30), meet_link: z.string().optional().default(''),
});

const zEvaluateInterviewBody = z.object({
  version: z.coerce.number().int().min(1), score: z.coerce.number().min(0).max(100).optional(),
  appearance_score: z.coerce.number().min(0).max(100).default(9), attitude_score: z.coerce.number().min(0).max(100).default(9),
  skill_score: z.coerce.number().min(0).max(100).default(9), decision: z.enum(['PENDING', 'PASS', 'FAIL', 'PASSED', 'FAILED', 'HOLD']).default('PASS'),
  comment: z.string().trim().optional(), result_note: z.string().trim().optional(),
  candidate_confirmed: z.boolean().optional(), reschedule_requested: z.boolean().optional(), reschedule_reason: z.string().trim().optional(),
  scheduled_at: z.string().trim().optional(), interviewer_ids: z.array(z.string().trim()).optional(),
  interviewer_id: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  duration_minutes: z.coerce.number().int().min(5).max(240).optional(), meet_link: z.string().trim().optional(),
});

const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional() });

function parseRawInterviewers(ids?: string[], singleOrArr?: string | string[], fallbackCsv = ''): string[] {
  if (ids?.length) return ids.map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(singleOrArr) && singleOrArr.length) return singleOrArr.map((s) => s.trim()).filter(Boolean);
  if (typeof singleOrArr === 'string' && singleOrArr.trim()) return singleOrArr.split(',').map((s) => s.trim()).filter(Boolean);
  return fallbackCsv.split(',').map((s) => s.trim()).filter(Boolean);
}

function resolveInterviewerRecipients(ctx: AppContext, rawIds: string[]): { userIds: string[]; roles: string[] } {
  const userIds = new Set<string>(), roles = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (!id) continue;
    const legacy = LEGACY_INTERVIEWER_MAP[id];
    if (legacy) {
      roles.add(legacy.role);
      for (const u of ctx.db.users.filter((x) => x.role === legacy.role && x.status === 'ACTIVE')) userIds.add(u.id);
      continue;
    }
    const u = ctx.db.users.get(id) ?? ctx.db.users.find((x) => x.username.toLowerCase() === id.toLowerCase());
    if (u) { userIds.add(u.id); continue; }
    const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code.toLowerCase() === id.toLowerCase());
    if (emp) {
      const linked = (emp.user_id ? ctx.db.users.get(emp.user_id) : undefined) ?? ctx.db.users.find((x) => x.employee_id === emp.employee_code || (Boolean(emp.phone) && x.phone === emp.phone));
      if (linked) userIds.add(linked.id);
    }
  }
  return { userIds: Array.from(userIds), roles: Array.from(roles) };
}

async function notifyInterviewParticipants(ctx: AppContext, actorId: string, params: { rawIds: string[]; branchId: string; interviewId: string; code: string; title: string; body: string; kind: string }) {
  const recipients = resolveInterviewerRecipients(ctx, params.rawIds);
  const notif = await ctx.db.notifications.insert({
    recipient_user_id: recipients.userIds.join(','), recipient_role: recipients.userIds.length === 0 ? (recipients.roles.join(',') || 'HR') : '',
    branch_id: params.branchId || 'ALL', category: 'HR', title: params.title, body: params.body, link: '/admin/employees?section=recruitment&sub=interviews',
    severity: 'INFO', read_at: '', entity_type: 'INTERVIEWS', entity_id: params.interviewId,
  }, actorId);
  const wsPayload = { kind: params.kind, id: notif.id, code: params.code, title: params.title, summary: params.body, priority: 'NORMAL' };
  recipients.userIds.forEach((uid) => ctx.realtime()?.toUser(uid, SocketEvents.NOTIFICATION, wsPayload));
  if (recipients.userIds.length === 0) recipients.roles.forEach((r) => ctx.realtime()?.toRole(r, SocketEvents.NOTIFICATION, wsPayload));
  return recipients.userIds;
}

export async function interviewRoutes(app: FastifyInstance, ctx: AppContext) {
  const resolveInterviewerLabel = (rawId: string) =>
    rawId.split(',').map((part) => {
      const id = part.trim();
      if (LEGACY_INTERVIEWER_MAP[id]) return LEGACY_INTERVIEWER_MAP[id]!.label;
      const u = ctx.db.users.get(id) ?? ctx.db.users.find((x) => x.username === id);
      if (u) {
        const emp = u.employee_id ? ctx.db.employees.get(u.employee_id) : undefined;
        return emp ? `${emp.full_name} (${ROLE_LABELS[u.role]})` : `${u.display_name || u.username} (${ROLE_LABELS[u.role]})`;
      }
      const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
      return emp ? `${emp.full_name} (${emp.employee_code})` : id;
    }).join(', ');

  app.get('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'employee.read', 'system.config') }, async (request) => {
    const query = zListQueryBase.extend({ branch_id: z.string().trim().optional(), decision: z.string().trim().optional(), status: z.string().trim().optional() }).parse(request.query ?? {});
    const items = ctx.db.interviews.all().map((iv) => {
      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      const branchId = iv.branch_id || cand?.branch_pref || '', branch = ctx.db.branches.get(branchId);
      return {
        ...iv, branch_id: branchId, branchName: branch?.name ?? (branchId || 'Chưa phân chi nhánh'),
        scheduled_at: iv.start_at, candidateName: cand?.full_name ?? iv.candidate_id, candidateCode: cand?.candidate_code ?? '',
        candidatePhone: cand?.phone ?? '', candidateEmail: cand?.email ?? '',
        positionLabel: cand ? resolveStaffGroupLabel(ctx, cand.staff_group, cand.position) : '',
        interviewerLabel: resolveInterviewerLabel(iv.interviewer_id),
      };
    }).filter((item) => (!query.branch_id || query.branch_id === 'ALL' || item.branch_id === query.branch_id) && (!query.decision || query.decision === 'ALL' || item.decision === query.decision) && (!query.status || query.status === 'ALL' || item.status === query.status));
    return sendPaginated(request, 'Lấy danh sách lịch phỏng vấn thành công', paginateAndSort(items, {
      page: query.page, perPage: query.per_page ?? 20, defaultSortBy: 'created_at', defaultSortOrder: 'desc',
      allowedSortFields: ['created_at', 'start_at', 'score', 'decision'], q: query.q,
      searchExtractor: (i) => [i.candidateName, i.candidateCode, i.candidatePhone, i.interviewerLabel, i.branchName, i.comment],
      filters: { branch_id: query.branch_id, status: query.status, decision: query.decision },
    }));
  });

  app.post('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request, reply) => {
    const body = zCreateInterviewBody.parse(request.body);
    const cand = ctx.db.candidates.get(body.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === body.candidate_id);
    if (!cand) throw Errors.fieldValidation('candidate_id', 'INVALID_VALUE', 'Không tìm thấy ứng viên', body.candidate_id);
    if (ctx.db.interviews.find((iv) => (iv.candidate_id === cand.id || iv.candidate_id === cand.candidate_code) && iv.status !== 'CANCELLED')) {
      throw Errors.fieldValidation('candidate_id', 'DUPLICATE_VALUE', 'Ứng viên này đã có lịch phỏng vấn. Vui lòng chỉnh sửa lịch phỏng vấn hiện có.', body.candidate_id);
    }
    const rawInterviewers = parseRawInterviewers(body.interviewer_ids, body.interviewer_id);
    if (rawInterviewers.length === 0) throw Errors.fieldValidation('interviewer_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 người phỏng vấn', '');
    const startAt = body.start_at || body.scheduled_at || '', startMs = Date.parse(startAt);
    if (Number.isNaN(startMs)) throw Errors.fieldValidation('scheduled_at', 'INVALID_VALUE', 'Thời gian bắt đầu phỏng vấn không hợp lệ', startAt);
    const endMs = startMs + body.duration_minutes * 60_000, endAt = new Date(endMs).toISOString();

    const conflict = ctx.db.interviews.find((iv) => {
      if (iv.status === 'CANCELLED' || !rawInterviewers.some((id) => iv.interviewer_id.split(',').map((s) => s.trim()).includes(id))) return false;
      if (iv.start_at === startAt) return true;
      const exStart = Date.parse(iv.start_at), exEnd = Number.isNaN(exStart) ? NaN : exStart + (iv.duration_minutes || 30) * 60_000;
      return !Number.isNaN(exStart) && startMs < exEnd && endMs > exStart;
    });
    if (conflict) throw Errors.fieldValidation('scheduled_at', 'DUPLICATE_VALUE', 'Khung giờ phỏng vấn này đã trùng lịch của người phỏng vấn', startAt);

    const slotLocal = startAt.slice(0, 16).replace('T', ' ');
    if (slotLocal < dayjs().format('YYYY-MM-DD HH:mm')) throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian phỏng vấn trong quá khứ', startAt);

    const meetLink = body.meet_link || 'https://meet.google.com/umb-milk-hr', actorId = request.auth!.user.id;
    const created = await ctx.db.interviews.insert({
      candidate_id: cand.id, branch_id: cand.branch_pref, start_at: startAt, end_at: endAt, duration_minutes: body.duration_minutes,
      meet_link: meetLink, interviewer_id: rawInterviewers.join(', '), status: 'SCHEDULED', candidate_confirmed: true, reschedule_requested: false,
      reschedule_reason: '', appearance_score: 0, attitude_score: 0, skill_score: 0, score: 0, comment: '', decision: 'PENDING', calendar_event_id: `CAL-${Date.now()}`, decided_at: '',
    }, actorId);
    await ctx.db.candidates.update(cand.id, cand.version, { status: 'INTERVIEW_SCHEDULED' }, actorId);

    const notifiedUsers = await notifyInterviewParticipants(ctx, actorId, {
      rawIds: rawInterviewers, branchId: cand.branch_pref, interviewId: created.id, code: cand.candidate_code, kind: 'INTERVIEW_SCHEDULED',
      title: `Lịch phỏng vấn mới: ${cand.full_name} (${cand.candidate_code})`,
      body: `Bạn được đính kèm tham gia phỏng vấn ứng viên ${cand.full_name} vào lúc ${slotLocal} (${body.duration_minutes} phút). Link họp: ${meetLink}`,
    });
    await ctx.audit.record(auditContext(request), { action: 'interview.create', entity: 'INTERVIEWS', entityId: created.id, after: { candidate_id: created.candidate_id, start_at: created.start_at, interviewers: rawInterviewers, notified_users: notifiedUsers } });
    reply.code(201);
    return sendSuccess(request, 'Đã đặt lịch phỏng vấn và gửi thông báo tới tất cả người tham gia phỏng vấn thành công', created);
  });

  app.put('/api/admin/interviews/:id/evaluate', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zEvaluateInterviewBody.parse(request.body);
    const before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    const cand = ctx.db.candidates.get(before.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === before.candidate_id);
    const actorId = request.auth!.user.id;

    if (body.reschedule_requested !== undefined || body.candidate_confirmed !== undefined || body.scheduled_at || body.interviewer_ids || body.interviewer_id || body.duration_minutes !== undefined || body.meet_link !== undefined) {
      const nextStart = body.scheduled_at || before.start_at;
      const slotLocal = nextStart.slice(0, 16).replace('T', ' ');
      if (body.scheduled_at && body.scheduled_at.slice(0, 16) !== before.start_at.slice(0, 16) && slotLocal < dayjs().format('YYYY-MM-DD HH:mm')) {
        throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian đổi lịch phỏng vấn trong quá khứ', nextStart);
      }
      const nextInterviewers = parseRawInterviewers(body.interviewer_ids, body.interviewer_id, before.interviewer_id);
      if (nextInterviewers.length === 0) throw Errors.fieldValidation('interviewer_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 người phỏng vấn', '');
      const nextDuration = body.duration_minutes ?? (before.duration_minutes || 30);
      const startMs = Date.parse(nextStart);
      const nextEnd = Number.isNaN(startMs) ? before.end_at : new Date(startMs + nextDuration * 60_000).toISOString();
      const nextMeet = body.meet_link ?? before.meet_link;
      const nextStatus = body.reschedule_requested ? 'RESCHEDULE_NEEDED' : body.candidate_confirmed ? 'CONFIRMED' : before.status;
      const updatedConfirm = await ctx.db.interviews.update(id, body.version, {
        start_at: nextStart, end_at: nextEnd, duration_minutes: nextDuration, meet_link: nextMeet, interviewer_id: nextInterviewers.join(', '),
        status: nextStatus, candidate_confirmed: body.candidate_confirmed ?? before.candidate_confirmed, reschedule_requested: body.reschedule_requested ?? before.reschedule_requested,
        reschedule_reason: body.reschedule_reason ?? before.reschedule_reason, ...(body.comment ? { comment: body.comment } : {}),
      }, actorId);
      const allRelatedIds = Array.from(new Set([...before.interviewer_id.split(',').map((s) => s.trim()), ...nextInterviewers].filter(Boolean)));
      await notifyInterviewParticipants(ctx, actorId, {
        rawIds: allRelatedIds, branchId: before.branch_id || cand?.branch_pref || 'ALL', interviewId: id, code: cand?.candidate_code || id, kind: 'INTERVIEW_UPDATED',
        title: `Cập nhật lịch phỏng vấn: ${cand?.full_name ?? before.candidate_id}${cand?.candidate_code ? ` (${cand.candidate_code})` : ''}`,
        body: `Lịch phỏng vấn ứng viên ${cand?.full_name ?? before.candidate_id} đã được chỉnh sửa sang ${slotLocal} (${nextDuration} phút)${updatedConfirm.reschedule_reason ? ` — Ghi chú: ${updatedConfirm.reschedule_reason}` : ''}. Link họp: ${nextMeet}`,
      });
      await ctx.audit.record(auditContext(request), { action: 'interview.update_status', entity: 'INTERVIEWS', entityId: id, before: { start_at: before.start_at, interviewer_id: before.interviewer_id, status: before.status }, after: { start_at: updatedConfirm.start_at, interviewer_id: updatedConfirm.interviewer_id, status: updatedConfirm.status } });
      return sendSuccess(request, 'Đã cập nhật lịch phỏng vấn và gửi thông báo đến những người liên quan', updatedConfirm);
    }

    const normalizedDecision = body.decision === 'PASSED' || body.decision === 'PASS' ? 'PASS' : body.decision === 'HOLD' ? 'HOLD' : 'FAIL';
    const computedScore = body.score ?? Math.round(((body.appearance_score + body.attitude_score + body.skill_score) / 3) * 10) / 10;
    const updated = await ctx.db.interviews.update(id, body.version, { status: 'COMPLETED', score: computedScore, appearance_score: body.appearance_score, attitude_score: body.attitude_score, skill_score: body.skill_score, decision: normalizedDecision, comment: body.comment || body.result_note || '', decided_at: nowIso() }, actorId);
    if (cand && normalizedDecision !== 'HOLD') {
      await ctx.db.candidates.update(cand.id, cand.version, { status: normalizedDecision === 'PASS' ? 'HIRED' : 'REJECTED' }, actorId);
    }
    await ctx.audit.record(auditContext(request), { action: 'interview.evaluate', entity: 'INTERVIEWS', entityId: id, before: { decision: before.decision }, after: { decision: updated.decision, score: updated.score } });
    return sendSuccess(request, normalizedDecision === 'PASS' ? 'Đã chấm ĐẠT phỏng vấn và chuyển ứng viên sang bước Tiếp nhận thử việc' : normalizedDecision === 'HOLD' ? 'Đã lưu kết quả phỏng vấn ở trạng thái Cân nhắc thêm' : 'Đã cập nhật kết quả phỏng vấn: Không đạt', updated);
  });

  app.delete('/api/admin/interviews/:id', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteBody.parse(request.body ?? {});
    const before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    await ctx.db.interviews.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    const cand = ctx.db.candidates.get(before.candidate_id);
    if (cand && cand.status === 'INTERVIEW_SCHEDULED') await ctx.db.candidates.update(cand.id, cand.version, { status: 'CONTACTED' }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'interview.delete', entity: 'INTERVIEWS', entityId: id, before: { candidate_id: before.candidate_id, start_at: before.start_at } });
    return sendSuccess(request, 'Đã xóa lịch phỏng vấn', { id });
  });
}
