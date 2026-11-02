import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { parseInterviewWindowMs } from '../services/interview-schedule-helper.js';
import {
  DEFAULT_ZALO_TEMPLATES, ZALO_FRIEND_REQUEST_MAX_CHARS, ZALO_HR_SETTING_CATEGORY, clampZaloFriendGreeting, decryptZaloPayload, encryptZaloPayload, ensureInterviewRsvpUrl,
  listHrZaloAccounts, recordZaloDeliveryLog, renderZaloMessageTemplate, resolveZaloAccountByIdOrDefault, type StoredZaloAccountSecret,
} from '../services/zalo-hr.service.js';
import { getZaloQrSessionState, sendRealZaloMessageIfConnected, startZaloQrLoginSession } from '../services/zalo-qr-session.service.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';

const zQrSessionBody = z.object({
  owner_user_id: z.string().trim().optional(),
  zalo_name: z.string().trim().optional(),
  zalo_phone: z.string().trim().optional(),
  is_default: z.boolean().optional().default(true),
});

const zUpsertZaloAccountBody = z.object({
  owner_user_id: z.string().trim().optional(),
  zalo_name: z.string().trim().min(2, 'Tên hiển thị tài khoản Zalo tối thiểu 2 ký tự').max(120),
  zalo_phone: z.string().trim().min(9, 'Số điện thoại Zalo không hợp lệ'),
  zalo_id: z.string().trim().max(80).optional().default(''), access_token: z.string().trim().max(8000).optional().default(''),
  is_default: z.boolean().optional().default(true), status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  greeting_template: z.string().trim().max(ZALO_FRIEND_REQUEST_MAX_CHARS, 'Mẫu lời mời kết bạn Zalo chỉ được tối đa 150 ký tự').optional().default(''), invite_template: z.string().trim().max(1500).optional().default(''),
  reminder_template: z.string().trim().max(1500).optional().default(''), pass_template: z.string().trim().max(1500).optional().default(''),
});

const zSendZaloNotifyBody = z.object({
  candidate_id: z.string().trim().optional(), interview_id: z.string().trim().optional(),
  zalo_account_id: z.string().trim().min(1, 'Vui lòng chọn tài khoản Zalo gửi thông báo'),
  candidate_zalo_id: z.string().trim().min(2, 'Vui lòng nhập ID Zalo hoặc SĐT Zalo của ứng viên').max(80),
  template_type: z.enum(['GREETING', 'INVITE', 'REMINDER', 'PASS', 'CUSTOM']).optional().default('INVITE'),
  message: z.string().trim().max(2000).optional().default(''), mark_confirmed: z.boolean().optional(),
  mode: z.enum(['SEND', 'COPY_AND_SAVE']).optional().default('SEND'),
});

export async function recruitmentZaloRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/admin/recruitment/zalo-qr-session', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const body = zQrSessionBody.parse(request.body ?? {}), actorId = request.auth!.user.id;
    const state = await startZaloQrLoginSession(ctx, {
      actorId, ownerUserId: body.owner_user_id || actorId, isDefault: body.is_default,
      fallbackName: body.zalo_name, fallbackPhone: body.zalo_phone,
    });
    return sendSuccess(request, 'Đã khởi tạo mã QR đăng nhập Zalo tuyển dụng', {
      session_id: state.session_id, qr_image: state.qr_image, qr_url: state.qr_url,
      session_token: state.session_token, status: state.status, expires_in: state.expires_in,
    });
  });

  app.get('/api/admin/recruitment/zalo-qr-session/:sessionId', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const state = getZaloQrSessionState(sessionId);
    if (!state) return sendSuccess(request, 'Phiên QR đã hết hạn', { session_id: sessionId, status: 'EXPIRED', expires_in: 0 });
    return sendSuccess(request, 'Trạng thái phiên quét QR Zalo', {
      session_id: state.session_id, status: state.status, expires_in: state.expires_in,
      scanned_display_name: state.scanned_display_name, scanned_avatar: state.scanned_avatar,
      zalo_name: state.zalo_name, zalo_phone: state.zalo_phone, zalo_id: state.zalo_id,
      saved_account: state.saved_account ?? null, error_message: state.error_message,
    });
  });

  app.get('/api/admin/recruitment/zalo-accounts', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const items = await listHrZaloAccounts(ctx);
    return sendSuccess(request, 'Lấy danh sách tài khoản Zalo tuyển dụng thành công', { items, default_templates: DEFAULT_ZALO_TEMPLATES });
  });

  app.post('/api/admin/recruitment/zalo-accounts', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request, reply) => {
    const body = zUpsertZaloAccountBody.parse(request.body ?? {});
    const phone = normalizePhone(body.zalo_phone);
    if (!phone) throw Errors.fieldValidation('zalo_phone', 'INVALID_PHONE', 'Số điện thoại Zalo phải gồm 10 chữ số bắt đầu bằng số 0', body.zalo_phone);

    const actor = request.auth!.user, ownerId = body.owner_user_id || actor.id;
    const ownerUser = ctx.db.users.get(ownerId) ?? ctx.db.users.find((u) => u.username === ownerId) ?? actor;

    if (body.is_default) {
      for (const r of ctx.db.systemSettings.filter((s) => s.category === ZALO_HR_SETTING_CATEGORY && s.note === ownerUser.id)) {
        const dec = decryptZaloPayload(ctx, r.value);
        if (dec?.is_default) await ctx.db.systemSettings.update(r.id, r.version, { value: encryptZaloPayload(ctx, { ...dec, is_default: false }) }, actor.id);
      }
    }

    const secret: StoredZaloAccountSecret = {
      owner_user_id: ownerUser.id, zalo_name: body.zalo_name, zalo_phone: phone,
      zalo_id: body.zalo_id || `zalo_${phone}`, access_token: body.access_token || `zalo_session_${phone}_${Date.now()}`,
      is_default: body.is_default, status: body.status,
      greeting_template: body.greeting_template || DEFAULT_ZALO_TEMPLATES.greeting,
      invite_template: body.invite_template || DEFAULT_ZALO_TEMPLATES.invite,
      reminder_template: body.reminder_template || DEFAULT_ZALO_TEMPLATES.reminder,
      pass_template: body.pass_template || DEFAULT_ZALO_TEMPLATES.pass,
    };

    const created = await ctx.db.systemSettings.insert({
      key: `ZALO_ACC_${ownerUser.id}_${Date.now()}`, category: ZALO_HR_SETTING_CATEGORY,
      label: `${ownerUser.display_name} (@${ownerUser.username}) — ${secret.zalo_name} (${phone})`,
      note: ownerUser.id, value_type: 'ENCRYPTED_JSON', value: encryptZaloPayload(ctx, secret),
    }, actor.id);

    await ctx.audit.record(auditContext(request), {
      action: 'recruitment.zalo_account.create', entity: 'SYSTEM_SETTINGS', entityId: created.id,
      after: { owner_user_id: ownerUser.id, zalo_name: secret.zalo_name, zalo_phone: phone, encrypted: true },
    });
    const list = await listHrZaloAccounts(ctx);
    reply.code(201);
    return sendSuccess(request, `Đã liên kết và lưu tài khoản Zalo "${secret.zalo_name}" cho nhân sự ${ownerUser.display_name}`, list.find((a) => a.id === created.id) ?? list[0]);
  });

  app.put('/api/admin/recruitment/zalo-accounts/:id', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const { id } = request.params as { id: string }, body = zUpsertZaloAccountBody.parse(request.body ?? {});
    const before = ctx.db.systemSettings.get(id);
    if (!before || before.category !== ZALO_HR_SETTING_CATEGORY) throw Errors.notFound('Cấu hình tài khoản Zalo', id);
    const prevSecret = decryptZaloPayload(ctx, before.value);
    const phone = normalizePhone(body.zalo_phone);
    if (!phone) throw Errors.fieldValidation('zalo_phone', 'INVALID_PHONE', 'Số điện thoại Zalo phải gồm 10 chữ số bắt đầu bằng số 0', body.zalo_phone);

    const actor = request.auth!.user, ownerId = body.owner_user_id || prevSecret?.owner_user_id || before.note || actor.id;
    const ownerUser = ctx.db.users.get(ownerId) ?? ctx.db.users.find((u) => u.username === ownerId) ?? actor;

    if (body.is_default) {
      for (const r of ctx.db.systemSettings.filter((s) => s.category === ZALO_HR_SETTING_CATEGORY && s.id !== id && s.note === ownerUser.id)) {
        const dec = decryptZaloPayload(ctx, r.value);
        if (dec?.is_default) await ctx.db.systemSettings.update(r.id, r.version, { value: encryptZaloPayload(ctx, { ...dec, is_default: false }) }, actor.id);
      }
    }

    const nextSecret: StoredZaloAccountSecret = {
      owner_user_id: ownerUser.id, zalo_name: body.zalo_name, zalo_phone: phone,
      zalo_id: body.zalo_id || prevSecret?.zalo_id || `zalo_${phone}`,
      access_token: prevSecret?.access_token?.startsWith('{') ? prevSecret.access_token : (body.access_token || prevSecret?.access_token || `zalo_session_${phone}`),
      is_default: body.is_default, status: body.status,
      greeting_template: body.greeting_template || prevSecret?.greeting_template || DEFAULT_ZALO_TEMPLATES.greeting,
      invite_template: body.invite_template || prevSecret?.invite_template || DEFAULT_ZALO_TEMPLATES.invite,
      reminder_template: body.reminder_template || prevSecret?.reminder_template || DEFAULT_ZALO_TEMPLATES.reminder,
      pass_template: body.pass_template || prevSecret?.pass_template || DEFAULT_ZALO_TEMPLATES.pass,
    };

    await ctx.db.systemSettings.update(id, before.version, {
      label: `${ownerUser.display_name} (@${ownerUser.username}) — ${nextSecret.zalo_name} (${phone})`,
      note: ownerUser.id, value_type: 'ENCRYPTED_JSON', value: encryptZaloPayload(ctx, nextSecret),
    }, actor.id);

    const list = await listHrZaloAccounts(ctx);
    return sendSuccess(request, `Đã cập nhật tài khoản Zalo "${nextSecret.zalo_name}" thành công`, list.find((a) => a.id === id) ?? null);
  });

  app.delete('/api/admin/recruitment/zalo-accounts/:id', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const { id } = request.params as { id: string }, before = ctx.db.systemSettings.get(id);
    if (!before || before.category !== ZALO_HR_SETTING_CATEGORY) throw Errors.notFound('Cấu hình tài khoản Zalo', id);
    await ctx.db.systemSettings.softDelete(id, before.version, request.auth!.user.id);
    return sendSuccess(request, 'Đã xóa cấu hình tài khoản Zalo tuyển dụng', { id });
  });

  app.post('/api/admin/recruitment/zalo-send', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const body = zSendZaloNotifyBody.parse(request.body ?? {}), actorId = request.auth!.user.id;
    const zaloResolved = await resolveZaloAccountByIdOrDefault(ctx, body.zalo_account_id, actorId);
    if (!zaloResolved) throw Errors.badRequest('Không tìm thấy tài khoản Zalo hợp lệ để gửi thông báo');

    const iv = body.interview_id ? ctx.db.interviews.get(body.interview_id) : undefined;
    const candId = body.candidate_id || iv?.candidate_id || '';
    const cand = ctx.db.candidates.get(candId) ?? ctx.db.candidates.find((c) => c.candidate_code === candId);
    const activeIv = iv ?? (cand ? ctx.db.interviews.find((x) => (x.candidate_id === cand.id || x.candidate_id === cand.candidate_code) && x.status !== 'CANCELLED') : undefined);
    if (!cand && !activeIv) throw Errors.badRequest('Vui lòng chọn ứng viên hoặc lịch phỏng vấn cần gửi Zalo');

    const branchId = activeIv?.branch_id || cand?.branch_pref || '', branchName = ctx.db.branches.get(branchId)?.name ?? 'Ụm Bò Milk';
    const posLabel = cand ? resolveStaffGroupLabel(ctx, cand.staff_group, cand.position) : 'Nhân viên Cửa hàng';
    const win = activeIv ? parseInterviewWindowMs(activeIv.start_at, activeIv.duration_minutes || 30) : null;
    const rsvp = activeIv ? ensureInterviewRsvpUrl(ctx, activeIv.id, cand?.id ?? activeIv.candidate_id, activeIv.rsvp_token) : { token: '', url: '' };
    const rawTemplate = body.template_type === 'GREETING' ? zaloResolved.dto.greeting_template : body.template_type === 'REMINDER' ? zaloResolved.dto.reminder_template : body.template_type === 'PASS' ? zaloResolved.dto.pass_template : zaloResolved.dto.invite_template;
    if (body.template_type === 'GREETING' && body.message && body.message.trim().length > ZALO_FRIEND_REQUEST_MAX_CHARS) {
      throw Errors.fieldValidation('message', 'TOO_LONG', `Lời mời kết bạn Zalo chỉ được tối đa ${ZALO_FRIEND_REQUEST_MAX_CHARS} ký tự`, body.message);
    }
    const renderedMsg = body.message || renderZaloMessageTemplate(rawTemplate, {
      candidateName: cand?.full_name ?? 'Ứng viên', candidateCode: cand?.candidate_code ?? '', position: posLabel, branchName,
      interviewTime: win ? `${win.startHm} – ${win.endHm} (${win.dateVi})` : (activeIv?.start_at ?? ''),
      meetLink: activeIv?.meet_link || 'https://meet.google.com/umb-milk-hr', rsvpUrl: rsvp.url,
      hrZaloName: zaloResolved.dto.zalo_name, hrZaloPhone: zaloResolved.dto.zalo_phone, minutesLeft: 10,
    });
    const finalMessage = body.template_type === 'GREETING' ? clampZaloFriendGreeting(renderedMsg) : renderedMsg;

    const directSend = body.mode === 'SEND' ? await sendRealZaloMessageIfConnected(zaloResolved.rowId, zaloResolved.secret, body.candidate_zalo_id, finalMessage, body.template_type === 'GREETING') : { deliveredViaZca: false };
    const now = nowIso();
    if (cand) {
      await ctx.db.candidates.update(cand.id, cand.version, {
        candidate_zalo_id: body.candidate_zalo_id, zalo_account_id: zaloResolved.dto.id, zalo_last_sent_at: now,
        ...(cand.status === 'NEW' ? { status: 'CONTACTED', contacted_at: now } : {}),
      }, actorId);
    }
    if (activeIv) {
      const resetForNewInvite = body.template_type === 'INVITE' && body.mark_confirmed === undefined;
      await ctx.db.interviews.update(activeIv.id, activeIv.version, {
        candidate_zalo_id: body.candidate_zalo_id, zalo_account_id: zaloResolved.dto.id, rsvp_token: activeIv.rsvp_token || rsvp.token,
        candidate_confirmed: body.mark_confirmed !== undefined ? body.mark_confirmed : resetForNewInvite ? false : activeIv.candidate_confirmed,
        reschedule_requested: resetForNewInvite ? false : activeIv.reschedule_requested,
        status: body.mark_confirmed === true ? 'CONFIRMED' : resetForNewInvite ? 'SCHEDULED' : activeIv.status,
      }, actorId);
    }

    await recordZaloDeliveryLog(ctx, {
      channel: body.mode === 'COPY_AND_SAVE' ? 'ZALO_COPY_TEMPLATE' : 'ZALO_HR',
      recipientId: body.candidate_zalo_id, branchId: branchId || 'ALL',
      summary: `[${zaloResolved.dto.zalo_name} -> ${body.candidate_zalo_id}] ${finalMessage}`, actorId,
    });

    const cleanPhone = normalizePhone(body.candidate_zalo_id) ?? normalizePhone(cand?.phone ?? '') ?? body.candidate_zalo_id;
    return sendSuccess(request, body.mode === 'COPY_AND_SAVE' ? `Đã sao chép tin nhắn và lưu ID Zalo ứng viên (${body.candidate_zalo_id})` : `Đã gửi tin nhắn Zalo qua "${zaloResolved.dto.zalo_name}" tới ứng viên (${body.candidate_zalo_id})`, {
      sent: true, delivered_direct: directSend.deliveredViaZca, mode: body.mode, zalo_account_id: zaloResolved.dto.id,
      zalo_account_name: zaloResolved.dto.zalo_name, zalo_account_phone: zaloResolved.dto.zalo_phone,
      candidate_zalo_id: body.candidate_zalo_id, zalo_chat_url: `https://zalo.me/${cleanPhone}`, rsvp_url: rsvp.url, message: finalMessage, sent_at: now,
    });
  });
}
