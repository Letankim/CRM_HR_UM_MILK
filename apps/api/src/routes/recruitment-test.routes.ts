import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone, ROLE_LABELS, STAFF_GROUP_LABELS, zListQueryBase } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { testBankRoutes } from './test-bank.routes.js';

const zCreateCandidateBody = z.object({
  full_name: z.string().trim().min(2, 'Họ tên ứng viên tối thiểu 2 ký tự'),
  phone: z.string().trim().min(9),
  email: z.string().trim().email('Email ứng viên không hợp lệ').or(z.literal('')).optional().default(''),
  applied_branch_id: z.string().trim().optional(),
  branch_pref: z.string().trim().optional(),
  applied_position: z.string().optional(),
  staff_group: z.string().default('BARISTA'),
  source_channel: z.string().default('GOOGLE_FORM'),
  hr_note: z.string().max(400).optional().default(''),
});

const zUpdateCandidateBody = z.object({
  version: z.coerce.number().int().min(1),
  full_name: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  branch_pref: z.string().trim().optional(),
  staff_group: z.string().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'INTERVIEW_SCHEDULED', 'HIRED', 'REJECTED']).optional(),
  hr_note: z.string().max(400).optional(),
});

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
  score: z.coerce.number().min(0).max(100),
  attitude_score: z.coerce.number().min(0).max(100).default(9),
  skill_score: z.coerce.number().min(0).max(100).default(9),
  decision: z.enum(['PASS', 'FAIL', 'PASSED', 'FAILED']),
  comment: z.string().trim().optional(),
  result_note: z.string().trim().optional(),
});

const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional() });

export async function recruitmentTestRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/candidates', { preHandler: requirePermission('candidate.manage', 'employee.read', 'system.config') }, async (request) => {
    const query = zListQueryBase.parse(request.query);
    const items = ctx.db.candidates.all().map((c) => ({
      ...c,
      stage: c.status,
      branchName: ctx.db.branches.get(c.branch_pref)?.name ?? c.branch_pref,
      positionLabel: STAFF_GROUP_LABELS[c.staff_group as keyof typeof STAFF_GROUP_LABELS] ?? c.position,
    }));
    return sendPaginated(
      request,
      'Lấy danh sách ứng viên tuyển dụng thành công',
      paginateAndSort(items, {
        page: query.page, perPage: query.per_page, defaultSortBy: 'created_at', defaultSortOrder: 'desc',
        allowedSortFields: ['created_at', 'full_name', 'status'], q: query.q,
        searchExtractor: (i) => [i.candidate_code, i.full_name, i.phone, i.email, i.branchName],
      }),
    );
  });

  app.post('/api/admin/candidates', { preHandler: requirePermission('candidate.manage', 'system.config') }, async (request, reply) => {
    const body = zCreateCandidateBody.parse(request.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Số điện thoại ứng viên không hợp lệ (10 số bắt đầu bằng 0)', body.phone);
    if (ctx.db.candidates.find((c) => c.phone === phone) || ctx.db.employees.find((e) => e.phone === phone)) {
      throw Errors.fieldValidation('phone', 'DUPLICATE_VALUE', `Số điện thoại ${phone} đã tồn tại trong danh sách ứng viên hoặc nhân sự`, body.phone);
    }
    if (body.email && (ctx.db.candidates.find((c) => c.email.trim().toLowerCase() === body.email.trim().toLowerCase()) || ctx.db.employees.find((e) => e.email.trim().toLowerCase() === body.email.trim().toLowerCase()))) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${body.email} đã tồn tại trong danh sách ứng viên hoặc nhân sự`, body.email);
    }
    const branchId = body.branch_pref || body.applied_branch_id || '';
    const staffGroup = body.applied_position || body.staff_group || 'BARISTA';
    const created = await ctx.db.candidates.insert({
      candidate_code: `UV${String(ctx.db.candidates.all(true).length + 1).padStart(4, '0')}`,
      source_row: `WEB-${Date.now()}`, full_name: body.full_name, phone, email: body.email,
      position: STAFF_GROUP_LABELS[staffGroup as keyof typeof STAFF_GROUP_LABELS] ?? staffGroup,
      staff_group: staffGroup, branch_pref: branchId, shift_pref: 'CA_SANG',
      status: 'NEW', source_channel: body.source_channel, birth_year: '2003', gender: '',
      experience_note: '', hr_note: body.hr_note, cv_file_id: '', assigned_hr_id: request.auth!.user.username, contacted_at: nowIso(),
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.create', entity: 'CANDIDATES', entityId: created.id, after: { candidate_code: created.candidate_code, full_name: created.full_name } });
    reply.code(201);
    return sendSuccess(request, 'Đã tiếp nhận hồ sơ ứng viên mới thành công', created);
  });

  app.put('/api/admin/candidates/:id', { preHandler: requirePermission('candidate.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateCandidateBody.parse(request.body);
    const before = ctx.db.candidates.get(id);
    if (!before) throw Errors.notFound('Hồ sơ ứng viên', id);
    const phone = body.phone ? normalizePhone(body.phone) : before.phone;
    if (body.phone && !phone) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Số điện thoại không hợp lệ', body.phone);
    if (body.phone && (ctx.db.candidates.find((c) => c.id !== id && c.phone === phone) || ctx.db.employees.find((e) => e.phone === phone))) {
      throw Errors.fieldValidation('phone', 'DUPLICATE_VALUE', `Số điện thoại ${phone} đã tồn tại ở hồ sơ khác`, body.phone);
    }
    if (body.email && (ctx.db.candidates.find((c) => c.id !== id && c.email.trim().toLowerCase() === body.email!.trim().toLowerCase()) || ctx.db.employees.find((e) => e.email.trim().toLowerCase() === body.email!.trim().toLowerCase()))) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${body.email} đã tồn tại ở hồ sơ khác`, body.email);
    }
    const staffGroup = body.staff_group ?? before.staff_group;
    const updated = await ctx.db.candidates.update(id, body.version, {
      full_name: body.full_name ?? before.full_name, phone: phone || before.phone, email: body.email ?? before.email,
      branch_pref: body.branch_pref ?? before.branch_pref, staff_group: staffGroup,
      position: STAFF_GROUP_LABELS[staffGroup as keyof typeof STAFF_GROUP_LABELS] ?? before.position,
      status: body.status ?? before.status, hr_note: body.hr_note ?? before.hr_note,
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.update', entity: 'CANDIDATES', entityId: id, before: { status: before.status }, after: { status: updated.status } });
    return sendSuccess(request, 'Đã cập nhật hồ sơ ứng viên thành công', updated);
  });

  app.delete('/api/admin/candidates/:id', { preHandler: requirePermission('candidate.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteBody.parse(request.body ?? {});
    const before = ctx.db.candidates.get(id);
    if (!before) throw Errors.notFound('Hồ sơ ứng viên', id);
    await ctx.db.candidates.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.delete', entity: 'CANDIDATES', entityId: id, before: { candidate_code: before.candidate_code, full_name: before.full_name } });
    return sendSuccess(request, 'Đã xóa hồ sơ ứng viên', { id });
  });

  const resolveInterviewerLabel = (rawId: string) =>
    rawId.split(',').map((part) => {
      const id = part.trim();
      const u = ctx.db.users.get(id) ?? ctx.db.users.find((x) => x.username === id);
      if (u) {
        const emp = u.employee_id ? ctx.db.employees.get(u.employee_id) : undefined;
        return emp ? `${emp.full_name} (${ROLE_LABELS[u.role]})` : `${u.username} (${ROLE_LABELS[u.role]})`;
      }
      const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
      return emp ? `${emp.full_name} (${emp.employee_code})` : id;
    }).join(', ');

  app.get('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'employee.read', 'system.config') }, async (request) => {
    const items = ctx.db.interviews.all().map((iv) => {
      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      return { ...iv, scheduled_at: iv.start_at, candidateName: cand?.full_name ?? iv.candidate_id, candidateCode: cand?.candidate_code ?? '', interviewerLabel: resolveInterviewerLabel(iv.interviewer_id) };
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
    const endMs = Number.isNaN(startMs) ? NaN : startMs + body.duration_minutes * 60_000;
    const endAt = Number.isNaN(endMs) ? startAt : new Date(endMs).toISOString();

    const conflict = ctx.db.interviews.find((iv) => {
      if (iv.status === 'CANCELLED') return false;
      const sharesInterviewer = rawInterviewers.some((id) => iv.interviewer_id.split(',').map((s) => s.trim()).includes(id));
      if (!sharesInterviewer) return false;
      if (iv.start_at === startAt) return true;
      const exStart = Date.parse(iv.start_at);
      const exEnd = Number.isNaN(exStart) ? NaN : exStart + (iv.duration_minutes || 30) * 60_000;
      return !Number.isNaN(startMs) && !Number.isNaN(exStart) && startMs < exEnd && endMs > exStart;
    });
    if (conflict) throw Errors.fieldValidation('scheduled_at', 'DUPLICATE_VALUE', 'Khung giờ phỏng vấn này đã trùng lịch của người phỏng vấn', startAt);

    const created = await ctx.db.interviews.insert({
      candidate_id: cand.id, branch_id: cand.branch_pref, start_at: startAt, end_at: endAt,
      duration_minutes: body.duration_minutes, meet_link: body.meet_link || 'https://meet.google.com/umb-milk-hr',
      interviewer_id: rawInterviewers.join(', '), status: 'SCHEDULED', candidate_confirmed: true, reschedule_requested: false,
      reschedule_reason: '', appearance_score: 0, attitude_score: 0, skill_score: 0, score: 0,
      comment: '', decision: 'PENDING', calendar_event_id: `CAL-${Date.now()}`, decided_at: '',
    }, request.auth!.user.id);
    await ctx.db.candidates.update(cand.id, cand.version, { status: 'INTERVIEW_SCHEDULED' }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'interview.create', entity: 'INTERVIEWS', entityId: created.id, after: { candidate_id: created.candidate_id, start_at: created.start_at, duration_minutes: created.duration_minutes } });
    reply.code(201);
    return sendSuccess(request, `Đã đặt lịch phỏng vấn (${body.duration_minutes} phút) và gửi thư mời Google Meet thành công`, created);
  });

  app.put('/api/admin/interviews/:id/evaluate', { preHandler: requirePermission('interview.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zEvaluateInterviewBody.parse(request.body);
    const before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    const normalizedDecision = body.decision === 'PASSED' || body.decision === 'PASS' ? 'PASS' : 'FAIL';
    const updated = await ctx.db.interviews.update(id, body.version, {
      status: 'COMPLETED', score: body.score, attitude_score: body.attitude_score, skill_score: body.skill_score,
      decision: normalizedDecision, comment: body.comment || body.result_note || '', decided_at: nowIso(),
    }, request.auth!.user.id);
    const cand = ctx.db.candidates.get(before.candidate_id);
    if (cand) await ctx.db.candidates.update(cand.id, cand.version, { status: normalizedDecision === 'PASS' ? 'HIRED' : 'REJECTED' }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'interview.evaluate', entity: 'INTERVIEWS', entityId: id, before: { decision: before.decision }, after: { decision: updated.decision, score: updated.score } });
    return sendSuccess(request, normalizedDecision === 'PASS' ? 'Đã chấm ĐẠT phỏng vấn và chuyển ứng viên sang bước Tiếp nhận thử việc' : 'Đã cập nhật kết quả phỏng vấn: Không đạt', updated);
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

  await testBankRoutes(app, ctx);
}
