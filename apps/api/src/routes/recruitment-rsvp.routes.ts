import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  computeInterviewWeightedScore, evaluateInterviewRubric13, formatUbmEmployeeCode, inferCandidateExperienceTrack,
  INTERVIEW_EXPERIENCE_TRACKS, INTERVIEW_RUBRIC_BLOCKS, normalizePhone, parseEmployeeCodeSeq, type InterviewRubricBlock,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { createRsvpToken, scoreCandidateForm14, sendZaloInterviewInvite, verifyRsvpToken } from '../services/candidate-form-scorer.js';
import { getRecruitmentFormSheetConfig, saveRecruitmentFormSheetConfig, syncRecruitmentFormFromGoogleSheet } from '../services/recruitment-form-sync.service.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';

const zSyncFormBody = z.union([
  z.array(z.record(z.unknown())),
  z.object({ rows: z.array(z.record(z.unknown())).optional(), items: z.array(z.record(z.unknown())).optional() }),
]);
const zFormSheetConfigBody = z.object({
  sheet_url: z.string().trim().min(5, 'Vui lòng nhập đường dẫn Google Sheet Form tuyển dụng'),
  tab_name: z.string().trim().max(120).optional().default('FROM_NHAN_VIEN'),
  hourly_auto_sync: z.boolean().optional().default(true),
  sync_interval_minutes: z.coerce.number().int().min(15).max(1440).optional().default(60),
});
const zSyncSheetBody = z.object({
  sheet_url: z.string().trim().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
});
const zVipBody = z.object({ version: z.coerce.number().int().min(1).optional(), is_vip: z.boolean(), vip_rank: z.coerce.number().int().min(0).max(999).optional() });
const zDecisionBody = z.object({
  version: z.coerce.number().int().min(1).optional(), rubric_block: z.enum(INTERVIEW_RUBRIC_BLOCKS).optional(),
  rubric_scores: z.record(z.coerce.number()).optional(), red_flags: z.array(z.string()).optional(),
  experience_track: z.enum(INTERVIEW_EXPERIENCE_TRACKS).optional(), appearance_score: z.coerce.number().min(0).max(100).optional(),
  attitude_score: z.coerce.number().min(0).max(100).optional(), skill_score: z.coerce.number().min(0).max(100).optional(),
  score: z.coerce.number().min(0).max(100).optional(), decision: z.enum(['PENDING', 'PASS', 'FAIL', 'PASSED', 'FAILED', 'HOLD']).optional(),
  comment: z.string().trim().optional(), create_employee: z.boolean().optional(),
});
const zRsvpActionBody = z.object({ action: z.enum(['CONFIRM', 'RESCHEDULE']), reason: z.string().trim().max(400).optional(), reschedule_reason: z.string().trim().max(400).optional() });

function resolveInterviewByRsvpToken(ctx: AppContext, token: string) {
  const verified = verifyRsvpToken(token);
  if (verified.expired) throw Errors.badRequest('Đường dẫn xác nhận phỏng vấn đã hết hạn hiệu lực 7 ngày');
  const byId = verified.valid && verified.interviewId ? ctx.db.interviews.get(verified.interviewId) : undefined;
  const iv = byId ?? ctx.db.interviews.find((i) => i.rsvp_token === token);
  if (!iv) throw Errors.badRequest('Đường dẫn xác nhận phỏng vấn không hợp lệ hoặc đã hết hạn 7 ngày');
  return iv;
}

export async function recruitmentRsvpRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/candidates/form-sync-config', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    return sendSuccess(request, 'Lấy cấu hình đồng bộ Google Sheet Form tuyển dụng thành công', getRecruitmentFormSheetConfig(ctx));
  });

  app.put('/api/admin/candidates/form-sync-config', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const body = zFormSheetConfigBody.parse(request.body ?? {});
    const saved = await saveRecruitmentFormSheetConfig(ctx, body, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.form_sync_config', entity: 'SYSTEM_SETTINGS', entityId: 'RECRUITMENT_FORM_SHEET_CONFIG', after: saved });
    return sendSuccess(request, 'Đã lưu cấu hình đường dẫn Google Sheet Form và chế độ tự động đồng bộ hàng giờ', saved);
  });

  app.post('/api/admin/candidates/sync-google-sheet', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const body = zSyncSheetBody.parse(request.body ?? {});
    const res = await syncRecruitmentFormFromGoogleSheet(ctx, { actorId: request.auth!.user.id, sheetUrl: body.sheet_url, customRows: body.rows });
    await ctx.audit.record(auditContext(request), { action: 'candidate.sync_google_sheet', entity: 'CANDIDATES', entityId: 'SHEET_SYNC', after: { newCount: res.newCount, skippedCount: res.skippedCount } });
    return sendSuccess(request, res.message, res);
  });

  app.post('/api/admin/candidates/sync-form', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request, reply) => {
    const parsedBody = zSyncFormBody.parse(request.body ?? {});
    const rawRows = Array.isArray(parsedBody) ? parsedBody : (parsedBody.rows ?? parsedBody.items ?? []);
    if (rawRows.length === 0) throw Errors.fieldValidation('rows', 'REQUIRED_FIELD', 'Vui lòng cung cấp danh sách dòng dữ liệu từ Google Form FROM_NHAN_VIEN', []);
    const branches = ctx.db.branches.all(), actorId = request.auth!.user.id, syncedItems = [];

    for (const [idx, row] of rawRows.entries()) {
      const scored = scoreCandidateForm14(row, branches);
      const validPhone = normalizePhone(scored.raw_phone || scored.phone);
      if (!validPhone) throw Errors.fieldValidation('phone', 'INVALID_PHONE', `Số điện thoại ứng viên dòng ${idx + 1} không hợp lệ (10 chữ số bắt đầu bằng 0)`, scored.raw_phone || scored.phone);
      const existing = ctx.db.candidates.find((c) => c.phone === validPhone);
      const status = scored.red_flag_reason ? 'REJECTED' : (existing?.status ?? 'NEW');
      const isVip = row.is_vip !== undefined ? Boolean(row.is_vip) : (existing?.is_vip ?? false);
      const vipRank = row.vip_rank !== undefined ? Number(row.vip_rank) : (existing?.vip_rank ?? 0);

      if (existing) {
        const updated = await ctx.db.candidates.update(existing.id, existing.version, {
          full_name: scored.full_name || existing.full_name, email: scored.email || existing.email,
          branch_pref: scored.branch_pref || existing.branch_pref, shift_pref: scored.shift_pref || existing.shift_pref,
          staff_group: scored.staff_group || existing.staff_group, position: resolveStaffGroupLabel(ctx, scored.staff_group, scored.position),
          birth_year: scored.birth_year || existing.birth_year, gender: scored.gender || existing.gender,
          experience_note: scored.experience_note || existing.experience_note, status, is_vip: isVip, vip_rank: vipRank,
          ai_score_14: scored.ai_score_14, ai_qualified: scored.ai_qualified, red_flag_reason: scored.red_flag_reason,
          form_payload_json: JSON.stringify(scored),
        }, actorId);
        syncedItems.push(updated);
      } else {
        const created = await ctx.db.candidates.insert({
          candidate_code: `UV${String(ctx.db.candidates.all(true).length + 1).padStart(4, '0')}`,
          source_row: scored.source_row || `GF-${Date.now()}-${idx + 1}`,
          full_name: scored.full_name, phone: validPhone, email: scored.email,
          position: resolveStaffGroupLabel(ctx, scored.staff_group, scored.position),
          staff_group: scored.staff_group, branch_pref: scored.branch_pref, shift_pref: scored.shift_pref,
          status, source_channel: scored.source_channel || 'GOOGLE_FORM', birth_year: scored.birth_year, gender: scored.gender,
          experience_note: scored.experience_note, hr_note: scored.red_flag_reason || scored.self_intro || '',
          cv_file_id: '', assigned_hr_id: request.auth!.user.username, contacted_at: nowIso(),
          is_vip: isVip, vip_rank: vipRank, ai_score_14: scored.ai_score_14, ai_qualified: scored.ai_qualified,
          red_flag_reason: scored.red_flag_reason, form_payload_json: JSON.stringify(scored),
        }, actorId);
        syncedItems.push(created);
      }
    }

    await ctx.audit.record(auditContext(request), { action: 'candidate.sync_form', entity: 'CANDIDATES', entityId: 'BATCH', after: { count: syncedItems.length } });
    reply.code(201);
    return sendSuccess(request, `Đã đồng bộ và chấm điểm AI ${syncedItems.length} hồ sơ ứng viên từ Google Form thành công`, {
      syncedCount: syncedItems.length, qualifiedCount: syncedItems.filter((i) => i.ai_qualified).length,
      redFlagCount: syncedItems.filter((i) => Boolean(i.red_flag_reason)).length, items: syncedItems,
    });
  });

  app.put('/api/admin/candidates/:id/vip', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const { id } = request.params as { id: string }, body = zVipBody.parse(request.body ?? {}), before = ctx.db.candidates.get(id);
    if (!before) throw Errors.notFound('Hồ sơ ứng viên', id);
    const sameBranchVips = ctx.db.candidates.filter((c) => c.id !== id && c.branch_pref === before.branch_pref && c.is_vip);
    const nextRank = body.is_vip ? (body.vip_rank ?? (sameBranchVips.reduce((m, c) => Math.max(m, c.vip_rank || 0), 0) + 1)) : 0;
    const updated = await ctx.db.candidates.update(id, body.version ?? before.version, { is_vip: body.is_vip, vip_rank: nextRank }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.vip', entity: 'CANDIDATES', entityId: id, after: { is_vip: updated.is_vip, vip_rank: updated.vip_rank } });
    return sendSuccess(request, body.is_vip ? `Đã gắn nhãn Ưu tiên VIP (Hạng #${nextRank}) cho ứng viên ${updated.full_name}` : `Đã gỡ nhãn VIP của ứng viên ${updated.full_name}`, updated);
  });

  app.post('/api/admin/interviews/:id/decision', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string }, body = zDecisionBody.parse(request.body ?? {}), before = ctx.db.interviews.get(id);
    if (!before) throw Errors.notFound('Lịch phỏng vấn', id);
    const cand = ctx.db.candidates.get(before.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === before.candidate_id);
    const actorId = request.auth!.user.id;
    const block: InterviewRubricBlock = body.rubric_block ?? ((before.rubric_block === 'OFFICE' ? 'OFFICE' : 'STORE') as InterviewRubricBlock);
    const redFlags = body.red_flags ?? [], hasRubric13 = Boolean(body.rubric_scores || body.rubric_block || redFlags.length > 0);
    const eval13 = evaluateInterviewRubric13(block, body.rubric_scores ?? {}, redFlags);
    const track = body.experience_track ?? before.experience_track ?? inferCandidateExperienceTrack(cand?.experience_note);
    const appScore = body.appearance_score ?? (before.appearance_score || 90), attScore = body.attitude_score ?? (before.attitude_score || 90), sklScore = body.skill_score ?? (before.skill_score || 85);
    const weighted100 = hasRubric13 ? eval13.normalizedScore100 : (body.score ?? computeInterviewWeightedScore(track, appScore, attScore, sklScore));
    const finalDecision = eval13.hasRedFlag ? 'FAIL' : hasRubric13 && !body.decision ? eval13.autoDecision : (body.decision === 'PASSED' || body.decision === 'PASS' ? 'PASS' : body.decision === 'HOLD' ? 'HOLD' : body.decision === 'FAIL' || body.decision === 'FAILED' ? 'FAIL' : eval13.autoDecision);

    const updated = await ctx.db.interviews.update(id, body.version ?? before.version, {
      status: 'COMPLETED', experience_track: track, rubric_block: block, score_13: hasRubric13 ? eval13.totalScore13 : before.score_13,
      score: weighted100, appearance_score: appScore, attitude_score: attScore, skill_score: sklScore,
      decision: finalDecision, comment: body.comment ?? before.comment, decided_at: nowIso(),
      rubric_details_json: JSON.stringify({ block, scores: body.rubric_scores ?? {}, redFlags, totalScore13: eval13.totalScore13, isPerfect13: eval13.isPerfect13 }),
    }, actorId);

    let suggestedEmployeeCode = '';
    if (cand && finalDecision !== 'HOLD') {
      await ctx.db.candidates.update(cand.id, cand.version, { status: finalDecision === 'PASS' ? 'HIRED' : 'REJECTED' }, actorId);
    }
    if (finalDecision === 'PASS') {
      const maxSeq = ctx.db.employees.all(true).reduce((m, e) => Math.max(m, parseEmployeeCodeSeq(e.employee_code)), 0);
      suggestedEmployeeCode = formatUbmEmployeeCode(maxSeq + 1);
      if (body.create_employee && cand) {
        await ctx.db.employees.insert({
          employee_code: suggestedEmployeeCode, full_name: cand.full_name, phone: cand.phone, email: cand.email,
          branch_id: before.branch_id || cand.branch_pref, staff_group: cand.staff_group || 'BARISTA',
          position_title: cand.position || 'Pha chế', stage: 'PROBATION', status: 'ACTIVE', candidate_id: cand.id,
          default_shift_code: cand.shift_pref || 'CA_SANG', employment_type: 'PROBATION',
        }, actorId);
      }
    }
    return sendSuccess(request, finalDecision === 'PASS' ? `Đã chấm ĐẠT phỏng vấn (${eval13.totalScore13}/13 điểm)` : 'Đã lưu kết quả đánh giá phỏng vấn', {
      ...updated, isPerfect13: eval13.isPerfect13, hasRedFlag: eval13.hasRedFlag, suggested_employee_code: suggestedEmployeeCode,
    });
  });

  app.post('/api/admin/interviews/:id/send-zalo', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string }, iv = ctx.db.interviews.get(id);
    if (!iv) throw Errors.notFound('Lịch phỏng vấn', id);
    const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
    const token = iv.rsvp_token || createRsvpToken({ interviewId: iv.id, candidateId: cand?.id ?? iv.candidate_id });
    await ctx.db.interviews.update(iv.id, iv.version, {
      rsvp_token: token,
      status: 'SCHEDULED',
      candidate_confirmed: false,
      reschedule_requested: false,
    }, request.auth!.user.id);
    const rsvpUrl = `${ctx.env.API_PUBLIC_ORIGIN || 'http://localhost:3000'}/rsvp/${token}`;
    const branchName = ctx.db.branches.get(iv.branch_id || cand?.branch_pref || '')?.name ?? 'Ụm Bò Milk';
    const zaloRes = sendZaloInterviewInvite({ phone: cand?.phone ?? '', candidateName: cand?.full_name ?? iv.candidate_id, branchName, startAt: iv.start_at, meetLink: iv.meet_link, rsvpUrl });
    return sendSuccess(request, 'Đã gửi lời mời kết bạn và tin nhắn mời phỏng vấn qua Zalo thành công', { ...zaloRes, rsvp_token: token, rsvp_url: rsvpUrl });
  });

  app.get('/api/public/rsvp/:token', async (request) => {
    const { token } = request.params as { token: string }, iv = resolveInterviewByRsvpToken(ctx, token);
    const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
    const branch = ctx.db.branches.get(iv.branch_id || cand?.branch_pref || '');
    return sendSuccess(request, 'Lấy thông tin xác nhận lịch phỏng vấn thành công', {
      interview_id: iv.id, candidate_id: cand?.id ?? iv.candidate_id, candidate_name: cand?.full_name ?? 'Ứng viên',
      candidate_code: cand?.candidate_code ?? '', position: cand?.position ?? 'Nhân viên Cửa hàng',
      branch_id: branch?.id ?? iv.branch_id, branch_name: branch?.name ?? 'Ụm Bò Milk', branch_address: branch?.address ?? '',
      start_at: iv.start_at, end_at: iv.end_at, duration_minutes: iv.duration_minutes, meet_link: iv.meet_link,
      status: iv.status, candidate_confirmed: iv.candidate_confirmed, reschedule_requested: iv.reschedule_requested, reschedule_reason: iv.reschedule_reason,
    });
  });

  app.post('/api/public/rsvp/:token', async (request) => {
    const { token } = request.params as { token: string }, body = zRsvpActionBody.parse(request.body ?? {}), iv = resolveInterviewByRsvpToken(ctx, token);
    if (iv.status !== 'SCHEDULED') {
      throw Errors.badRequest('Bạn đã phản hồi lịch phỏng vấn này trước đó. Nếu cần thay đổi, vui lòng chờ bộ phận Nhân sự cập nhật và gửi lại lịch mới.');
    }
    const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
    if (body.action === 'CONFIRM') {
      const updated = await ctx.db.interviews.update(iv.id, iv.version, { candidate_confirmed: true, reschedule_requested: false, status: 'CONFIRMED' }, 'candidate-rsvp');
      return sendSuccess(request, 'Đã xác nhận tham gia buổi phỏng vấn thành công', updated);
    }
    const reason = body.reschedule_reason || body.reason || 'Ứng viên xin dời lịch phỏng vấn qua trang RSVP';
    const updated = await ctx.db.interviews.update(iv.id, iv.version, { candidate_confirmed: false, reschedule_requested: true, reschedule_reason: reason, status: 'RESCHEDULE_NEEDED' }, 'candidate-rsvp');
    if (cand && cand.status === 'INTERVIEW_SCHEDULED') await ctx.db.candidates.update(cand.id, cand.version, { status: 'CONTACTED' }, 'candidate-rsvp');
    return sendSuccess(request, 'Đã ghi nhận yêu cầu xin dời lịch phỏng vấn. Phòng Nhân sự sẽ liên hệ sắp xếp lịch mới cho bạn.', updated);
  });
}
