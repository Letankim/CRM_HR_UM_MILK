import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  computeInterviewWeightedScore, evaluateInterviewRubric13, inferCandidateExperienceTrack,
  INTERVIEW_EXPERIENCE_TRACK_LABELS, INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS, INTERVIEW_EXPERIENCE_TRACKS,
  INTERVIEW_RUBRIC_BLOCKS, zListQueryBase, type InterviewExperienceTrack, type InterviewRubricBlock,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { queueInterviewEmails } from '../services/action-email-dispatcher.js';
import { sweepUpcomingInterviewReminders } from '../services/interview-reminder.service.js';
import {
  findInterviewTimeOverlaps, notifyInterviewParticipants, parseInterviewWindowMs,
  parseRawInterviewers, resolveInterviewerLabel, resolveInterviewerRecipients,
} from '../services/interview-schedule-helper.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';

const zCreateInterviewBody = z.object({
  candidate_id: z.string().trim().min(1), interviewer_id: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  interviewer_ids: z.array(z.string().trim()).optional(), scheduled_at: z.string().trim().optional(),
  start_at: z.string().trim().optional(), duration_minutes: z.coerce.number().int().min(5).max(240).default(30),
  meet_link: z.string().optional().default(''),
});

const zEvaluateInterviewBody = z.object({
  version: z.coerce.number().int().min(1), experience_track: z.enum(INTERVIEW_EXPERIENCE_TRACKS).optional(),
  rubric_block: z.enum(INTERVIEW_RUBRIC_BLOCKS).optional(), rubric_scores: z.record(z.coerce.number()).optional(),
  red_flags: z.array(z.string()).optional(), score: z.coerce.number().min(0).max(100).optional(),
  appearance_score: z.coerce.number().min(0).max(100).default(90), attitude_score: z.coerce.number().min(0).max(100).default(90),
  skill_score: z.coerce.number().min(0).max(100).default(85), decision: z.enum(['PENDING', 'PASS', 'FAIL', 'PASSED', 'FAILED', 'HOLD']).default('PASS'),
  comment: z.string().trim().optional(), result_note: z.string().trim().optional(),
  candidate_confirmed: z.boolean().optional(), reschedule_requested: z.boolean().optional(),
  reschedule_reason: z.string().trim().optional(), scheduled_at: z.string().trim().optional(),
  interviewer_ids: z.array(z.string().trim()).optional(), interviewer_id: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  duration_minutes: z.coerce.number().int().min(5).max(240).optional(), meet_link: z.string().trim().optional(),
});

const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional() });

export async function interviewRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/interviews', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    void sweepUpcomingInterviewReminders(ctx).catch(() => undefined);
    const query = zListQueryBase.extend({
      branch_id: z.string().trim().optional(), decision: z.string().trim().optional(),
      status: z.string().trim().optional(), experience_track: z.string().trim().optional(),
    }).parse(request.query ?? {});

    const items = ctx.db.interviews.all().map((iv) => {
      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      const branchId = iv.branch_id || cand?.branch_pref || '', branch = ctx.db.branches.get(branchId);
      const track: InterviewExperienceTrack = iv.decision !== 'PENDING'
        ? (iv.experience_track || inferCandidateExperienceTrack(cand?.experience_note))
        : (iv.experience_track === 'EXPERIENCED' ? 'EXPERIENCED' : inferCandidateExperienceTrack(cand?.experience_note));
      const rawIvIds = parseRawInterviewers(undefined, iv.interviewer_id);
      const resolvedUserIds = resolveInterviewerRecipients(ctx, rawIvIds).userIds;
      return {
        ...iv, experience_track: track,
        experienceTrackLabel: INTERVIEW_EXPERIENCE_TRACK_LABELS[track],
        experienceTrackShortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS[track],
        candidateExperienceNote: cand?.experience_note ?? '', branch_id: branchId,
        branchName: branch?.name ?? (branchId || 'Chưa phân chi nhánh'), scheduled_at: iv.start_at,
        candidateName: cand?.full_name ?? iv.candidate_id, candidateCode: cand?.candidate_code ?? '',
        candidatePhone: cand?.phone ?? '', candidateEmail: cand?.email ?? '',
        positionLabel: cand ? resolveStaffGroupLabel(ctx, cand.staff_group, cand.position) : '',
        interviewerLabel: resolveInterviewerLabel(ctx, iv.interviewer_id), interviewerUserIds: resolvedUserIds,
      };
    }).filter((item) =>
      (!query.branch_id || query.branch_id === 'ALL' || item.branch_id === query.branch_id)
      && (!query.decision || query.decision === 'ALL' || item.decision === query.decision)
      && (!query.status || query.status === 'ALL' || item.status === query.status)
      && (!query.experience_track || query.experience_track === 'ALL' || item.experience_track === query.experience_track),
    );
    return sendPaginated(request, 'Lấy danh sách lịch phỏng vấn thành công', paginateAndSort(items, {
      page: query.page, perPage: query.per_page ?? 20, defaultSortBy: 'created_at', defaultSortOrder: 'desc',
      allowedSortFields: ['created_at', 'start_at', 'score', 'decision'], q: query.q,
      searchExtractor: (i) => [i.candidateName, i.candidateCode, i.candidatePhone, i.interviewerLabel, i.branchName, i.comment, i.experienceTrackLabel],
      filters: { branch_id: query.branch_id, status: query.status, decision: query.decision, experience_track: query.experience_track },
    }));
  });

  app.post('/api/admin/interviews', { preHandler: requirePermission('interview.manage') }, async (request, reply) => {
    const body = zCreateInterviewBody.parse(request.body);
    const cand = ctx.db.candidates.get(body.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === body.candidate_id);
    if (!cand) throw Errors.fieldValidation('candidate_id', 'INVALID_VALUE', 'Không tìm thấy ứng viên', body.candidate_id);
    if (ctx.db.interviews.find((iv) => (iv.candidate_id === cand.id || iv.candidate_id === cand.candidate_code) && iv.status !== 'CANCELLED')) {
      throw Errors.fieldValidation('candidate_id', 'DUPLICATE_VALUE', 'Ứng viên này đã có lịch phỏng vấn. Vui lòng chỉnh sửa lịch phỏng vấn hiện có.', body.candidate_id);
    }
    const rawInterviewers = parseRawInterviewers(body.interviewer_ids, body.interviewer_id);
    if (rawInterviewers.length === 0) throw Errors.fieldValidation('interviewer_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 người phỏng vấn', '');
    const startAt = body.start_at || body.scheduled_at || '';
    const win = parseInterviewWindowMs(startAt, body.duration_minutes);
    if (!win) throw Errors.fieldValidation('scheduled_at', 'INVALID_VALUE', 'Thời gian bắt đầu phỏng vấn không hợp lệ', startAt);

    const overlaps = findInterviewTimeOverlaps(ctx, { startAt, durationMinutes: body.duration_minutes, rawInterviewers });
    if (overlaps.interviewerConflicts.length > 0) {
      throw Errors.fieldValidation('scheduled_at', 'DUPLICATE_VALUE', overlaps.interviewerConflicts[0]!.message, startAt);
    }
    const slotLocal = `${win.dateStr} ${win.startHm}`;
    if (slotLocal < dayjs().format('YYYY-MM-DD HH:mm')) {
      throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian phỏng vấn trong quá khứ', startAt);
    }

    const meetLink = body.meet_link || 'https://meet.google.com/umb-milk-hr', actorId = request.auth!.user.id;
    const initialTrack = inferCandidateExperienceTrack(cand.experience_note);
    const created = await ctx.db.interviews.insert({
      candidate_id: cand.id, branch_id: cand.branch_pref, start_at: startAt, end_at: new Date(win.endMs).toISOString(),
      duration_minutes: body.duration_minutes, meet_link: meetLink, interviewer_id: rawInterviewers.join(', '),
      status: 'SCHEDULED', candidate_confirmed: true, reschedule_requested: false, reschedule_reason: '',
      appearance_score: 0, attitude_score: 0, skill_score: 0, score: 0, comment: '', decision: 'PENDING',
      calendar_event_id: `CAL-${Date.now()}`, decided_at: '', experience_track: initialTrack,
    }, actorId);
    await ctx.db.candidates.update(cand.id, cand.version, { status: 'INTERVIEW_SCHEDULED' }, actorId);

    const notifiedUsers = await notifyInterviewParticipants(ctx, actorId, {
      rawIds: rawInterviewers, branchId: cand.branch_pref, interviewId: created.id, code: cand.candidate_code, kind: 'INTERVIEW_SCHEDULED',
      title: `Lịch phỏng vấn mới: ${cand.full_name} (${cand.candidate_code})`,
      body: `Bạn được đính kèm tham gia phỏng vấn ứng viên ${cand.full_name} vào lúc ${slotLocal} (${body.duration_minutes} phút). Link họp: ${meetLink}`,
    });
    queueInterviewEmails(ctx, { candidate: cand, interview: created, interviewerUserIds: notifiedUsers, actorId });
    void sweepUpcomingInterviewReminders(ctx).catch(() => undefined);
    await ctx.audit.record(auditContext(request), { action: 'interview.create', entity: 'INTERVIEWS', entityId: created.id, after: { candidate_id: created.candidate_id, start_at: created.start_at, interviewers: rawInterviewers, notified_users: notifiedUsers } });
    reply.code(201);
    const slotWarn = overlaps.slotOverlaps.length > 0 ? ` (Lưu ý: ${overlaps.slotOverlaps[0]!.message})` : '';
    return sendSuccess(request, `Đã đặt lịch phỏng vấn và gửi thông báo tới tất cả người tham gia phỏng vấn thành công${slotWarn}`, { ...created, slotOverlaps: overlaps.slotOverlaps });
  });

  app.put('/api/admin/interviews/:id/evaluate', { preHandler: requirePermission('interview.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zEvaluateInterviewBody.parse(request.body);
    const before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    const cand = ctx.db.candidates.get(before.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === before.candidate_id);
    const actorId = request.auth!.user.id;

    if (body.reschedule_requested !== undefined || body.candidate_confirmed !== undefined || body.scheduled_at || body.interviewer_ids || body.interviewer_id || body.duration_minutes !== undefined || body.meet_link !== undefined) {
      const nextStart = body.scheduled_at || before.start_at;
      const nextDuration = body.duration_minutes ?? (before.duration_minutes || 30);
      const win = parseInterviewWindowMs(nextStart, nextDuration);
      if (!win) throw Errors.fieldValidation('scheduled_at', 'INVALID_VALUE', 'Thời gian phỏng vấn không hợp lệ', nextStart);
      const slotLocal = `${win.dateStr} ${win.startHm}`;
      if (body.scheduled_at && body.scheduled_at.slice(0, 16) !== before.start_at.slice(0, 16) && slotLocal < dayjs().format('YYYY-MM-DD HH:mm')) {
        throw Errors.fieldValidation('scheduled_at', 'OUT_OF_RANGE', 'Không được chọn thời gian đổi lịch phỏng vấn trong quá khứ', nextStart);
      }
      const nextInterviewers = parseRawInterviewers(body.interviewer_ids, body.interviewer_id, before.interviewer_id);
      if (nextInterviewers.length === 0) throw Errors.fieldValidation('interviewer_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 người phỏng vấn', '');
      const overlaps = findInterviewTimeOverlaps(ctx, { startAt: nextStart, durationMinutes: nextDuration, rawInterviewers: nextInterviewers, excludeInterviewId: id });
      if (overlaps.interviewerConflicts.length > 0) {
        throw Errors.fieldValidation('scheduled_at', 'DUPLICATE_VALUE', overlaps.interviewerConflicts[0]!.message, nextStart);
      }
      const nextMeet = body.meet_link ?? before.meet_link;
      const nextStatus = body.reschedule_requested ? 'RESCHEDULE_NEEDED' : body.candidate_confirmed ? 'CONFIRMED' : before.status;
      const updatedConfirm = await ctx.db.interviews.update(id, body.version, {
        start_at: nextStart, end_at: new Date(win.endMs).toISOString(), duration_minutes: nextDuration, meet_link: nextMeet,
        interviewer_id: nextInterviewers.join(', '), status: nextStatus, candidate_confirmed: body.candidate_confirmed ?? before.candidate_confirmed,
        reschedule_requested: body.reschedule_requested ?? before.reschedule_requested, reschedule_reason: body.reschedule_reason ?? before.reschedule_reason,
        ...(body.comment ? { comment: body.comment } : {}),
      }, actorId);
      const allRelatedIds = Array.from(new Set([...before.interviewer_id.split(',').map((s) => s.trim()), ...nextInterviewers].filter(Boolean)));
      const updatedUserIds = await notifyInterviewParticipants(ctx, actorId, {
        rawIds: allRelatedIds, branchId: before.branch_id || cand?.branch_pref || 'ALL', interviewId: id, code: cand?.candidate_code || id, kind: 'INTERVIEW_UPDATED',
        title: `Cập nhật lịch phỏng vấn: ${cand?.full_name ?? before.candidate_id}${cand?.candidate_code ? ` (${cand.candidate_code})` : ''}`,
        body: `Lịch phỏng vấn ứng viên ${cand?.full_name ?? before.candidate_id} đã được chỉnh sửa sang ${slotLocal} (${nextDuration} phút)${updatedConfirm.reschedule_reason ? ` — Ghi chú: ${updatedConfirm.reschedule_reason}` : ''}. Link họp: ${nextMeet}`,
      });
      if (cand) queueInterviewEmails(ctx, { candidate: cand, interview: updatedConfirm, isUpdate: true, interviewerUserIds: updatedUserIds, actorId });
      void sweepUpcomingInterviewReminders(ctx).catch(() => undefined);
      await ctx.audit.record(auditContext(request), { action: 'interview.update_status', entity: 'INTERVIEWS', entityId: id, before: { start_at: before.start_at, interviewer_id: before.interviewer_id, status: before.status }, after: { start_at: updatedConfirm.start_at, interviewer_id: updatedConfirm.interviewer_id, status: updatedConfirm.status } });
      return sendSuccess(request, 'Đã cập nhật lịch phỏng vấn và gửi thông báo đến những người liên quan', { ...updatedConfirm, slotOverlaps: overlaps.slotOverlaps });
    }

    const hasRubric13 = Boolean(body.rubric_scores || (body.red_flags && body.red_flags.length > 0));
    const block: InterviewRubricBlock = body.rubric_block ?? ((before.rubric_block === 'OFFICE' ? 'OFFICE' : 'STORE') as InterviewRubricBlock);
    const eval13 = hasRubric13 ? evaluateInterviewRubric13(block, body.rubric_scores ?? {}, body.red_flags ?? []) : null;
    const normalizedDecision = eval13?.hasRedFlag ? 'FAIL' : (body.decision === 'PASSED' || body.decision === 'PASS' ? 'PASS' : body.decision === 'HOLD' ? 'HOLD' : 'FAIL');
    const track: InterviewExperienceTrack = body.experience_track ?? before.experience_track ?? inferCandidateExperienceTrack(cand?.experience_note);
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    const hasComponentScores = rawBody.appearance_score !== undefined || rawBody.attitude_score !== undefined || rawBody.skill_score !== undefined;
    const recalcScore = body.experience_track
      ? computeInterviewWeightedScore(body.experience_track, body.appearance_score, body.attitude_score, body.skill_score)
      : Number(((body.appearance_score + body.attitude_score + body.skill_score) / 3).toFixed(1));
    const computedScore = eval13 && !hasComponentScores ? eval13.normalizedScore100 : hasComponentScores ? recalcScore : (body.score ?? recalcScore);
    const updated = await ctx.db.interviews.update(id, body.version, {
      status: 'COMPLETED', experience_track: track, rubric_block: block,
      score_13: eval13 ? eval13.totalScore13 : before.score_13,
      rubric_details_json: eval13 ? JSON.stringify({ block, scores: body.rubric_scores ?? {}, redFlags: body.red_flags ?? [], totalScore13: eval13.totalScore13, isPerfect13: eval13.isPerfect13 }) : before.rubric_details_json,
      score: computedScore, appearance_score: body.appearance_score,
      attitude_score: body.attitude_score, skill_score: body.skill_score, decision: normalizedDecision,
      comment: body.comment || body.result_note || '', decided_at: nowIso(),
    }, actorId);
    if (cand && normalizedDecision !== 'HOLD') {
      await ctx.db.candidates.update(cand.id, cand.version, { status: normalizedDecision === 'PASS' ? 'HIRED' : 'REJECTED' }, actorId);
    }
    await ctx.audit.record(auditContext(request), { action: 'interview.evaluate', entity: 'INTERVIEWS', entityId: id, before: { decision: before.decision }, after: { decision: updated.decision, score: updated.score, experience_track: track } });
    const trackLabel = INTERVIEW_EXPERIENCE_TRACK_LABELS[track];
    return sendSuccess(
      request,
      normalizedDecision === 'PASS'
        ? `Đã chấm ĐẠT phỏng vấn (${trackLabel} · ${computedScore} điểm) và chuyển ứng viên sang bước Tiếp nhận thử việc`
        : normalizedDecision === 'HOLD'
          ? `Đã lưu kết quả phỏng vấn (${trackLabel} · ${computedScore} điểm) ở trạng thái Cân nhắc thêm`
          : `Đã cập nhật kết quả phỏng vấn (${trackLabel} · ${computedScore} điểm): Không đạt`,
      updated,
    );
  });

  app.delete('/api/admin/interviews/:id', { preHandler: requirePermission('interview.manage') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDeleteBody.parse(request.body ?? {}), before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    await ctx.db.interviews.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    const cand = ctx.db.candidates.get(before.candidate_id);
    if (cand && cand.status === 'INTERVIEW_SCHEDULED') await ctx.db.candidates.update(cand.id, cand.version, { status: 'CONTACTED' }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'interview.delete', entity: 'INTERVIEWS', entityId: id, before: { candidate_id: before.candidate_id, start_at: before.start_at } });
    return sendSuccess(request, 'Đã xóa lịch phỏng vấn', { id });
  });
}
