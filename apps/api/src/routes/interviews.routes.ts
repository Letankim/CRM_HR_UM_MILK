import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_LABELS, STAFF_GROUP_LABELS, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';

const LEGACY_INTERVIEWER_MAP: Record<string, { role: Role; label: string }> = {
  'u-hr-01': { role: 'HR', label: 'Nguyễn Thị Nhân Sự (Quản lý Nhân sự)' },
  'u-store-01': { role: 'STORE', label: 'Trần Văn Cửa Hàng (Quản lý cửa hàng)' },
  'u-admin-01': { role: 'ADMIN', label: 'Ban Giám đốc (Quản trị viên)' },
};

const zCreateInterviewBody = z.object({
  candidate_id: z.string().trim().min(1),
  interviewer_id: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  interviewer_ids: z.array(z.string().trim()).optional(),
  scheduled_at: z.string().trim().optional(),
  start_at: z.string().trim().optional(),
  duration_minutes: z.coerce.number().int().min(5).max(240).default(30),
  meet_link: z.string().optional().default(''),
});

const zEvaluateInterviewBody = z.object({
  version: z.coerce.number().int().min(1),
  score: z.coerce.number().min(0).max(100).optional(),
  appearance_score: z.coerce.number().min(0).max(100).default(9),
  attitude_score: z.coerce.number().min(0).max(100).default(9),
  skill_score: z.coerce.number().min(0).max(100).default(9),
  decision: z.enum(['PENDING', 'PASS', 'FAIL', 'PASSED', 'FAILED', 'HOLD']).default('PASS'),
  comment: z.string().trim().optional(),
  result_note: z.string().trim().optional(),
  candidate_confirmed: z.boolean().optional(),
  reschedule_requested: z.boolean().optional(),
  reschedule_reason: z.string().trim().optional(),
  scheduled_at: z.string().trim().optional(),
});

const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional() });

function resolveInterviewerRecipients(ctx: AppContext, rawIds: string[]): { userIds: string[]; roles: string[] } {
  const userIds = new Set<string>();
  const roles = new Set<string>();
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
    if (u) {
      userIds.add(u.id);
      continue;
    }
    const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code.toLowerCase() === id.toLowerCase());
    if (emp) {
      const linked = (emp.user_id ? ctx.db.users.get(emp.user_id) : undefined) ?? ctx.db.users.find((x) => x.employee_id === emp.employee_code || (Boolean(emp.phone) && x.phone === emp.phone));
      if (linked) userIds.add(linked.id);
    }
  }
  return { userIds: Array.from(userIds), roles: Array.from(roles) };
}

export async function interviewRoutes(app: FastifyInstance, ctx: AppContext) {
  const resolveInterviewerLabel = (rawId: string) =>
    rawId
      .split(',')
      .map((part) => {
        const id = part.trim();
        if (LEGACY_INTERVIEWER_MAP[id]) return LEGACY_INTERVIEWER_MAP[id]!.label;
        const u = ctx.db.users.get(id) ?? ctx.db.users.find((x) => x.username === id);
        if (u) {
          const emp = u.employee_id ? ctx.db.employees.get(u.employee_id) : undefined;
          return emp ? `${emp.full_name} (${ROLE_LABELS[u.role]})` : `${u.display_name || u.username} (${ROLE_LABELS[u.role]})`;
        }
        const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
        return emp ? `${emp.full_name} (${emp.employee_code})` : id;
      })
      .join(', ');

  app.get('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'employee.read', 'system.config') }, async (request) => {
    const query = z.object({ q: z.string().trim().optional(), branch_id: z.string().trim().optional(), decision: z.string().trim().optional(), status: z.string().trim().optional() }).parse(request.query ?? {});
    const items = ctx.db.interviews
      .all()
      .map((iv) => {
        const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
        const branchId = iv.branch_id || cand?.branch_pref || '';
        const branch = ctx.db.branches.get(branchId);
        return {
          ...iv, branch_id: branchId, branchName: branch?.name ?? (branchId || 'Chưa phân chi nhánh'),
          scheduled_at: iv.start_at, candidateName: cand?.full_name ?? iv.candidate_id, candidateCode: cand?.candidate_code ?? '',
          candidatePhone: cand?.phone ?? '', candidateEmail: cand?.email ?? '',
          positionLabel: cand ? STAFF_GROUP_LABELS[cand.staff_group as keyof typeof STAFF_GROUP_LABELS] ?? cand.position : '',
          interviewerLabel: resolveInterviewerLabel(iv.interviewer_id),
        };
      })
      .filter((item) => {
        if (query.branch_id && query.branch_id !== 'ALL' && item.branch_id !== query.branch_id) return false;
        if (query.decision && query.decision !== 'ALL' && item.decision !== query.decision) return false;
        if (query.status && query.status !== 'ALL' && item.status !== query.status) return false;
        if (query.q) {
          const needle = query.q.toLowerCase();
          const hay = [item.candidateName, item.candidateCode, item.candidatePhone, item.interviewerLabel, item.branchName, item.comment].join(' ').toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });
    return sendSuccess(request, 'Lấy danh sách lịch phỏng vấn thành công', items);
  });

  app.post('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request, reply) => {
    const body = zCreateInterviewBody.parse(request.body);
    const cand = ctx.db.candidates.get(body.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === body.candidate_id);
    if (!cand) throw Errors.fieldValidation('candidate_id', 'INVALID_VALUE', 'Không tìm thấy ứng viên', body.candidate_id);
    const rawInterviewers = body.interviewer_ids?.length ? body.interviewer_ids : Array.isArray(body.interviewer_id) ? body.interviewer_id : body.interviewer_id ? body.interviewer_id.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (rawInterviewers.length === 0) throw Errors.fieldValidation('interviewer_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 người phỏng vấn', '');
    const startAt = body.start_at || body.scheduled_at || '';
    const startMs = Date.parse(startAt);
    if (Number.isNaN(startMs)) throw Errors.fieldValidation('scheduled_at', 'INVALID_VALUE', 'Thời gian bắt đầu phỏng vấn không hợp lệ', startAt);
    const endMs = startMs + body.duration_minutes * 60_000;
    const endAt = new Date(endMs).toISOString();

    const conflict = ctx.db.interviews.find((iv) => {
      if (iv.status === 'CANCELLED') return false;
      const sharesInterviewer = rawInterviewers.some((id) => iv.interviewer_id.split(',').map((s) => s.trim()).includes(id));
      if (!sharesInterviewer) return false;
      if (iv.start_at === startAt) return true;
      const exStart = Date.parse(iv.start_at);
      const exEnd = Number.isNaN(exStart) ? NaN : exStart + (iv.duration_minutes || 30) * 60_000;
      return !Number.isNaN(exStart) && startMs < exEnd && endMs > exStart;
    });
    if (conflict) throw Errors.fieldValidation('scheduled_at', 'DUPLICATE_VALUE', 'Khung giờ phỏng vấn này đã trùng lịch của người phỏng vấn', startAt);

    const slotLocal = startAt.slice(0, 16).replace('T', ' ');
    const nowLocal = dayjs().format('YYYY-MM-DD HH:mm');
    if (slotLocal < nowLocal) {
      throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian phỏng vấn trong quá khứ', startAt);
    }

    const meetLink = body.meet_link || 'https://meet.google.com/umb-milk-hr';
    const actorId = request.auth!.user.id;
    const created = await ctx.db.interviews.insert(
      {
        candidate_id: cand.id, branch_id: cand.branch_pref, start_at: startAt, end_at: endAt,
        duration_minutes: body.duration_minutes, meet_link: meetLink,
        interviewer_id: rawInterviewers.join(', '), status: 'SCHEDULED', candidate_confirmed: true, reschedule_requested: false,
        reschedule_reason: '', appearance_score: 0, attitude_score: 0, skill_score: 0, score: 0,
        comment: '', decision: 'PENDING', calendar_event_id: `CAL-${Date.now()}`, decided_at: '',
      },
      actorId,
    );
    await ctx.db.candidates.update(cand.id, cand.version, { status: 'INTERVIEW_SCHEDULED' }, actorId);

    const recipients = resolveInterviewerRecipients(ctx, rawInterviewers);
    const notifTitle = `Lịch phỏng vấn mới: ${cand.full_name} (${cand.candidate_code})`;
    const notifBody = `Bạn được đính kèm tham gia phỏng vấn ứng viên ${cand.full_name} vào lúc ${slotLocal} (${body.duration_minutes} phút). Link họp: ${meetLink}`;
    const notif = await ctx.db.notifications.insert(
      {
        recipient_user_id: recipients.userIds.join(','),
        recipient_role: recipients.userIds.length === 0 ? (recipients.roles.join(',') || 'HR') : '',
        branch_id: cand.branch_pref || 'ALL',
        category: 'HR',
        title: notifTitle,
        body: notifBody,
        link: '/admin/employees?section=recruitment&sub=interviews',
        severity: 'INFO',
        read_at: '',
        entity_type: 'INTERVIEWS',
        entity_id: created.id,
      },
      actorId,
    );
    const wsPayload = { kind: 'INTERVIEW_SCHEDULED', id: notif.id, code: cand.candidate_code, title: notifTitle, summary: notifBody, priority: 'NORMAL' };
    recipients.userIds.forEach((uid) => ctx.realtime()?.toUser(uid, SocketEvents.NOTIFICATION, wsPayload));
    if (recipients.userIds.length === 0) recipients.roles.forEach((r) => ctx.realtime()?.toRole(r, SocketEvents.NOTIFICATION, wsPayload));

    await ctx.audit.record(auditContext(request), { action: 'interview.create', entity: 'INTERVIEWS', entityId: created.id, after: { candidate_id: created.candidate_id, start_at: created.start_at, interviewers: rawInterviewers, notified_users: recipients.userIds } });
    reply.code(201);
    return sendSuccess(request, 'Đã đặt lịch phỏng vấn và gửi thông báo tới tất cả người tham gia phỏng vấn thành công', created);
  });

  app.put('/api/admin/interviews/:id/evaluate', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zEvaluateInterviewBody.parse(request.body);
    const before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);

    if (body.reschedule_requested !== undefined || body.candidate_confirmed !== undefined || body.scheduled_at) {
      const nextStart = body.scheduled_at || before.start_at;
      if (body.scheduled_at && body.scheduled_at.slice(0, 16) !== before.start_at.slice(0, 16)) {
        const slotLocal = nextStart.slice(0, 16).replace('T', ' ');
        if (slotLocal < dayjs().format('YYYY-MM-DD HH:mm')) {
          throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian đổi lịch phỏng vấn trong quá khứ', nextStart);
        }
      }
      const startMs = Date.parse(nextStart);
      const nextEnd = Number.isNaN(startMs) ? before.end_at : new Date(startMs + (before.duration_minutes || 30) * 60_000).toISOString();
      const nextStatus = body.reschedule_requested ? 'RESCHEDULE_NEEDED' : body.candidate_confirmed ? 'CONFIRMED' : before.status;
      const updatedConfirm = await ctx.db.interviews.update(id, body.version, { start_at: nextStart, end_at: nextEnd, status: nextStatus, candidate_confirmed: body.candidate_confirmed ?? before.candidate_confirmed, reschedule_requested: body.reschedule_requested ?? before.reschedule_requested, reschedule_reason: body.reschedule_reason ?? before.reschedule_reason, ...(body.comment ? { comment: body.comment } : {}) }, request.auth!.user.id);
      await ctx.audit.record(auditContext(request), { action: 'interview.update_status', entity: 'INTERVIEWS', entityId: id, before: { status: before.status }, after: { status: updatedConfirm.status, reschedule_requested: updatedConfirm.reschedule_requested } });
      return sendSuccess(request, body.reschedule_requested ? 'Đã ghi nhận yêu cầu đổi lịch phỏng vấn của ứng viên' : 'Đã cập nhật trạng thái xác nhận lịch phỏng vấn', updatedConfirm);
    }

    const normalizedDecision = body.decision === 'PASSED' || body.decision === 'PASS' ? 'PASS' : body.decision === 'HOLD' ? 'HOLD' : 'FAIL';
    const computedScore = body.score ?? Math.round(((body.appearance_score + body.attitude_score + body.skill_score) / 3) * 10) / 10;
    const updated = await ctx.db.interviews.update(id, body.version, { status: 'COMPLETED', score: computedScore, appearance_score: body.appearance_score, attitude_score: body.attitude_score, skill_score: body.skill_score, decision: normalizedDecision, comment: body.comment || body.result_note || '', decided_at: nowIso() }, request.auth!.user.id);
    const cand = ctx.db.candidates.get(before.candidate_id);
    if (cand && normalizedDecision !== 'HOLD') {
      await ctx.db.candidates.update(cand.id, cand.version, { status: normalizedDecision === 'PASS' ? 'HIRED' : 'REJECTED' }, request.auth!.user.id);
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
    await ctx.audit.record(auditContext(request), { action: 'interview.delete', entity: 'INTERVIEWS', entityId: id, before: { candidate_id: before.candidate_id, start_at: before.start_at } });
    return sendSuccess(request, 'Đã xóa lịch phỏng vấn', { id });
  });
}
