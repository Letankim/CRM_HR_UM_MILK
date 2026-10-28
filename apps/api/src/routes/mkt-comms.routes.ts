import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { STAFF_GROUP_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { buildConfiguredAudienceGroups, doesUserMatchAudience, getMatchingUsersForAudience, jobPositionsAndAudiencesRoutes } from './job-positions-and-audiences.routes.js';

const COMMS_PERMS = ['comms.manage', 'notification.send', 'employee.manage', 'system.config', 'payroll.manage', 'schedule.propose'] as const;
const zCampaignBody = z.object({
  version: z.coerce.number().int().min(1).optional(), code: z.string().trim().optional().default(''), campaign_code: z.string().trim().optional().default(''),
  name: z.string().trim().min(2), status: z.preprocess((v) => (v === 'RUNNING' || v === 'SCHEDULED' || v === 'PAUSED' ? 'ACTIVE' : v || 'ACTIVE'), z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'])).default('ACTIVE'),
  start_at: z.string().optional().default('2026-10-01'), end_at: z.string().optional().default('2026-11-30'), description: z.string().max(400).optional().default(''), note: z.string().max(400).optional().default(''),
});
const zAnnouncementBody = z.object({
  version: z.coerce.number().int().min(1).optional(), campaign_id: z.string().optional().default(''),
  title: z.string().trim().min(3, 'Tiêu đề bản tin tối thiểu 3 ký tự'), summary: z.string().trim().max(300).default(''),
  body_md: z.string().trim().optional(), body: z.string().trim().optional(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), status: z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'FAILED']).optional(),
  publish_now: z.boolean().optional(), scheduled_at: z.string().optional().default(''),
  audience_scope: z.string().optional().default('ALL'), audience_target: z.string().optional().default('ALL'),
  cta_label: z.string().trim().max(80).optional().default(''), cta_link: z.string().trim().max(200).optional().default('/nv/ban-tin'),
  media_ids: z.string().optional().default('[]'), requires_ack: z.boolean().optional().default(false),
});

const zMediaBody = z.object({
  version: z.coerce.number().int().min(1).optional(), code: z.string().trim().optional().default(''),
  file_name: z.string().trim().min(2, 'Tên tệp media tối thiểu 2 ký tự'), mime_type: z.string().trim().default('image/png'),
  size_bytes: z.coerce.number().int().min(0).default(102400),
  drive_file_id: z.string().trim().optional().default(''), drive_url: z.string().trim().optional().default(''),
  category: z.enum(['BANNER', 'SOP_DOC', 'EVENT_PHOTO', 'POLICY_PDF']).default('BANNER'), is_internal_only: z.boolean().default(true),
});

export async function mktCommsRoutes(app: FastifyInstance, ctx: AppContext) {
  const canModify = (u: { id: string; role: string; username: string; display_name?: string }, rec: { created_by: string; approved_by?: string; owner_id?: string; uploaded_by?: string }) =>
    u.role === 'ADMIN' || rec.created_by === u.id || rec.owner_id === u.id || rec.uploaded_by === u.id || Boolean(rec.approved_by && (rec.approved_by === u.username || rec.approved_by === u.display_name));

  const formatAudienceLabel = (scope: string, rawJson: string) => {
    let target = 'ALL';
    try { target = JSON.parse(rawJson || '{}').target || 'ALL'; } catch { target = 'ALL'; }
    if (scope === 'BRANCH') { const b = ctx.db.branches.get(target) ?? ctx.db.branches.find((x) => x.code === target); return `Chi nhánh: ${b ? `${b.code} — ${b.name}` : target}`; }
    if (scope === 'STAGE') return target === 'THU_VIEC' || target === 'PROBATION' ? 'Nhân viên Thử việc' : 'Nhân viên Chính thức';
    if (scope === 'STAFF_GROUP') return `Nhóm vị trí: ${STAFF_GROUP_LABELS[target as keyof typeof STAFF_GROUP_LABELS] ?? target}`;
    if (scope === 'CUSTOM') {
      const [bId = 'ALL', stg = 'ALL', grp = 'ALL'] = target.split('|'), parts: string[] = [];
      if (bId !== 'ALL') { const b = ctx.db.branches.get(bId) ?? ctx.db.branches.find((x) => x.code === bId); parts.push(b ? b.code : bId); }
      if (stg !== 'ALL') parts.push(stg === 'PROBATION' || stg === 'THU_VIEC' ? 'Thử việc' : 'Chính thức');
      if (grp !== 'ALL') parts.push(STAFF_GROUP_LABELS[grp as keyof typeof STAFF_GROUP_LABELS] ?? grp);
      return parts.length ? `Nhóm: ${parts.join(' · ')}` : 'Nhóm tùy chỉnh';
    }
    return 'Toàn công ty (Tất cả nhân sự)';
  };

  const buildAudienceGroups = (scope: 'ALL' | string[] = 'ALL') => buildConfiguredAudienceGroups(ctx, scope);

  const dispatchAnnouncement = async (anc: ReturnType<typeof ctx.db.announcements.all>[number], actorId: string) => {
    let target = 'ALL';
    try { target = JSON.parse(anc.audience_json || '{}').target || 'ALL'; } catch { target = 'ALL'; }
    const isGlobal = !anc.audience_scope || (anc.audience_scope === 'ALL' && target === 'ALL');
    const matchedUsers = isGlobal ? ctx.db.users.filter((u) => u.status === 'ACTIVE') : getMatchingUsersForAudience(ctx, anc.audience_scope || 'ALL', anc.audience_json || target);
    const recipientUserId = isGlobal ? 'ALL' : (matchedUsers.map((u) => u.id).join(',') || 'NONE');
    const recipientRole = isGlobal ? 'ALL' : (anc.audience_scope === 'STAGE' ? (target === 'PROBATION' || target === 'THU_VIEC' ? 'THU_VIEC' : 'CHINH_THUC') : '');
    const branchId = anc.audience_scope === 'BRANCH' ? target : 'ALL';
    const existingNotif = ctx.db.notifications.find((n) => n.entity_type === 'ANNOUNCEMENTS' && n.entity_id === anc.id);
    const notif = existingNotif
      ? await ctx.db.notifications.update(existingNotif.id, existingNotif.version, { recipient_user_id: recipientUserId, recipient_role: recipientRole, branch_id: branchId, title: anc.title, body: anc.summary || anc.title }, actorId)
      : await ctx.db.notifications.insert({ recipient_user_id: recipientUserId, category: 'ANNOUNCEMENT', title: anc.title, body: anc.summary || anc.title, link: anc.cta_link || '/nv/ban-tin', severity: anc.priority === 'URGENT' ? 'CRITICAL' : anc.priority === 'HIGH' ? 'WARNING' : 'INFO', read_at: '', recipient_role: recipientRole, branch_id: branchId, entity_type: 'ANNOUNCEMENTS', entity_id: anc.id }, actorId);
    for (const oldLog of ctx.db.deliveryLogs.filter((l) => l.announcement_id === anc.id && !matchedUsers.some((u) => u.id === l.recipient_user_id))) {
      await ctx.db.deliveryLogs.softDelete(oldLog.id, oldLog.version, actorId);
    }
    const existingLogUserIds = new Set(ctx.db.deliveryLogs.filter((l) => l.announcement_id === anc.id).map((l) => l.recipient_user_id));
    for (const u of matchedUsers) {
      if (!existingLogUserIds.has(u.id)) {
        await ctx.db.deliveryLogs.insert({ announcement_id: anc.id, recipient_user_id: u.id, channel: 'IN_APP_SOCKET', status: 'SENT', attempts: 1, last_error: '', branch_id: u.branch_scope === 'ALL' ? 'ALL' : u.branch_scope.split(',')[0] || 'ALL', sent_at: nowIso(), delivered_at: nowIso(), read_at: '', ack_at: '' }, actorId);
      }
      ctx.email.enqueue({ to: u.email || `${u.username}@umbomilk.vn`, template: 'INTERNAL_ANNOUNCEMENT', recipientName: u.display_name || u.username, referenceCode: anc.code, summary: anc.summary || anc.title, metadata: [{ label: 'Mã bản tin', value: anc.code }, { label: 'Tiêu đề', value: anc.title }, { label: 'Mức độ', value: anc.priority }], actionLabel: anc.cta_label || 'Xem chi tiết bản tin', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}${anc.cta_link || '/nv/ban-tin'}` });
    }
    const payload = { kind: 'ANNOUNCEMENT', id: anc.id, notificationId: notif.id, code: anc.code, title: anc.title, summary: anc.summary, priority: anc.priority, sent_at: anc.sent_at };
    if (isGlobal) ctx.realtime()?.broadcast(SocketEvents.NOTIFICATION, payload);
    else matchedUsers.forEach((u) => ctx.realtime()?.toUser(u.id, SocketEvents.NOTIFICATION, payload));
  };
  const buildCommsPayload = (onlySent = false, u?: { id: string; role: string; username: string; display_name?: string; employee_id?: string; branch_scope?: string }, branchScope: 'ALL' | string[] = 'ALL') => {
    const rawAncs = ctx.db.announcements.all(), allCampaigns = ctx.db.campaigns.all(), allMedia = ctx.db.mediaAssets.all();
    const isGlobalManager = Boolean(u && ['ADMIN', 'MKT', 'HR'].includes(u.role) && !onlySent);
    const allAncs = rawAncs.filter((a) => {
      if (isGlobalManager) return true;
      if (u && (a.created_by === u.id || a.approved_by === u.username || a.approved_by === u.display_name)) return true;
      if (u) return doesUserMatchAudience(ctx, u, a.audience_scope || 'ALL', a.audience_json);
      if (branchScope === 'ALL' || a.audience_scope !== 'BRANCH') return true;
      let target = 'ALL';
      try { target = JSON.parse(a.audience_json || '{}').target || 'ALL'; } catch { target = 'ALL'; }
      return target === 'ALL' || branchScope.includes(target);
    });
    const allLogs = ctx.db.deliveryLogs.all().filter((l) => branchScope === 'ALL' || !l.branch_id || l.branch_id === 'ALL' || branchScope.includes(l.branch_id) || (u && l.recipient_user_id === u.id));
    const campaigns = [...allCampaigns].reverse().map((c) => {
      const cAncs = allAncs.filter((a) => a.campaign_id === c.id);
      return { ...c, campaign_code: c.code, channel: 'IN_APP', totalAnnouncements: cAncs.length, sentCount: cAncs.filter((a) => a.status === 'SENT').length, draftOrScheduledCount: cAncs.filter((a) => a.status !== 'SENT').length, creatorName: ctx.db.users.get(c.owner_id || c.created_by)?.display_name || 'Truyền thông MKT', isMine: Boolean(u && (c.created_by === u.id || c.owner_id === u.id)), canEdit: Boolean(u && canModify(u, c)) };
    });
    const announcements = [...allAncs].reverse().filter((a) => !onlySent || a.status === 'SENT').map((a) => {
      const camp = ctx.db.campaigns.get(a.campaign_id), logs = allLogs.filter((l) => l.announcement_id === a.id);
      let target = 'ALL';
      try { target = JSON.parse(a.audience_json || '{}').target || 'ALL'; } catch { target = 'ALL'; }
      return { ...a, announcement_code: a.code, campaignName: camp?.name || 'Thông báo độc lập', audience_target: target, audienceLabel: formatAudienceLabel(a.audience_scope || 'ALL', a.audience_json), creatorName: ctx.db.users.get(a.created_by)?.display_name || a.approved_by || 'Hệ thống', isMine: Boolean(u && (a.created_by === u.id || a.approved_by === u.username || a.approved_by === u.display_name)), canEdit: Boolean(u && canModify(u, a)), deliveredCount: logs.filter((l) => l.status === 'SENT').length, failedCount: logs.filter((l) => l.status === 'FAILED').length, readConfirmedCount: logs.filter((l) => Boolean(l.read_at || l.ack_at)).length };
    });
    const mediaAssets = [...allMedia].reverse().map((m) => ({ ...m, drive_url: m.drive_file_id, creatorName: ctx.db.users.get(m.uploaded_by || m.created_by)?.display_name || 'Truyền thông MKT', isMine: Boolean(u && (m.created_by === u.id || m.uploaded_by === u.id)), canEdit: Boolean(u && canModify(u, m)) }));
    const deliveryLogs = [...allLogs].reverse().map((l) => {
      const anc = ctx.db.announcements.get(l.announcement_id), recUser = ctx.db.users.get(l.recipient_user_id);
      return { ...l, announcementCode: anc?.code || 'ANC', announcementTitle: anc?.title || 'Bản tin nội bộ', recipientName: recUser?.display_name || l.recipient_user_id, readReceiptStatus: l.read_at || l.ack_at ? 'READ_CONFIRMED' : 'NO_RECEIPT', readReceiptLabel: l.read_at || l.ack_at ? 'Đã xác nhận đọc' : 'Chưa xác nhận đọc' };
    });
    const policies = ctx.db.policies.all().reverse().map((p) => ({ ...p, description: p.title || p.key, content_html: p.note || '', creatorName: ctx.db.users.get(p.created_by)?.display_name || p.approved_by || 'Hệ thống' }));
    const dashboard = { runningCount: allAncs.filter((a) => a.status === 'SENT').length, draftCount: allAncs.filter((a) => a.status === 'DRAFT').length, scheduledCount: allAncs.filter((a) => a.status === 'SCHEDULED').length, failedCount: allAncs.filter((a) => a.status === 'FAILED').length + allLogs.filter((l) => l.status === 'FAILED').length, campaignCount: allCampaigns.length, activeCampaignsCount: allCampaigns.filter((c) => c.status === 'ACTIVE').length, acknowledgedCount: allLogs.filter((l) => Boolean(l.read_at || l.ack_at)).length, mediaCount: allMedia.length };
    return { dashboard, audienceGroups: buildAudienceGroups(branchScope), campaigns, announcements, mediaAssets, deliveryLogs, policies };
  };

  app.get('/api/announcements', { preHandler: requireAuth() }, async (req) => sendSuccess(req, 'Lấy danh sách bản tin truyền thông nội bộ thành công', buildCommsPayload(true, req.auth?.user, req.auth?.branchScope)));
  app.get('/api/admin/comms', { preHandler: requireAuth() }, async (req) => sendSuccess(req, 'Lấy dữ liệu truyền thông nội bộ thành công', buildCommsPayload(false, req.auth?.user, req.auth?.branchScope)));
  app.get('/api/mkt/comms', { preHandler: requirePermission('comms.manage', 'notification.send') }, async (req) => sendSuccess(req, 'Lấy dữ liệu chiến dịch & bản tin truyền thông nội bộ thành công', buildCommsPayload(false, req.auth?.user, req.auth?.branchScope)));

  app.post('/api/mkt/campaigns', { preHandler: requirePermission(...COMMS_PERMS) }, async (req, reply) => {
    const body = zCampaignBody.parse(req.body), code = body.code || body.campaign_code || `CMP-${Date.now().toString().slice(-4)}`;
    const created = await ctx.db.campaigns.insert({ code, name: body.name, status: body.status, start_at: body.start_at, end_at: body.end_at, description: body.description || body.note, owner_id: req.auth!.user.id, total_announcements: 0, note: body.note }, req.auth!.user.id);
    await ctx.audit.record(auditContext(req), { action: 'mkt.campaign.create', entity: 'CAMPAIGNS', entityId: created.id, after: { code: created.code, name: created.name } });
    reply.code(201);
    return sendSuccess(req, 'Đã tạo chiến dịch truyền thông nội bộ mới thành công', created);
  });

  app.put('/api/mkt/campaigns/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, body = zCampaignBody.parse(req.body), before = ctx.db.campaigns.get(id);
    if (!before) throw Errors.notFound('Chiến dịch truyền thông', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép chỉnh sửa chiến dịch do chính mình tạo ra (ngoại trừ Quản trị viên)');
    const updated = await ctx.db.campaigns.update(id, body.version ?? before.version, { code: body.code || body.campaign_code || before.code, name: body.name, status: body.status, start_at: body.start_at, end_at: body.end_at, description: body.description || body.note }, req.auth!.user.id);
    return sendSuccess(req, 'Đã cập nhật chiến dịch truyền thông thành công', updated);
  });

  app.delete('/api/mkt/campaigns/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, before = ctx.db.campaigns.get(id);
    if (!before) throw Errors.notFound('Chiến dịch truyền thông', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép xóa chiến dịch do chính mình tạo ra (ngoại trừ Quản trị viên)');
    await ctx.db.campaigns.softDelete(id, before.version, req.auth!.user.id);
    return sendSuccess(req, 'Đã xóa chiến dịch truyền thông', { id });
  });
  app.post('/api/mkt/announcements', { preHandler: requirePermission(...COMMS_PERMS) }, async (req, reply) => {
    const body = zAnnouncementBody.parse(req.body), actorId = req.auth!.user.id, status = body.status ?? (body.publish_now === false ? (body.scheduled_at ? 'SCHEDULED' : 'DRAFT') : 'SENT');
    const content = body.body || body.body_md || body.summary || '<p>Nội dung bản tin</p>';
    const created = await ctx.db.announcements.insert({ code: `ANC-${String(ctx.db.announcements.all(true).length + 1).padStart(4, '0')}`, campaign_id: body.campaign_id, title: body.title, summary: body.summary, body: content, cta_label: body.cta_label || 'Xem chi tiết', cta_link: body.cta_link || '/nv/ban-tin', media_ids: body.media_ids || '[]', audience_scope: body.audience_scope || 'ALL', audience_json: JSON.stringify({ scope: body.audience_scope || 'ALL', target: body.audience_target || 'ALL' }), priority: body.priority, requires_ack: Boolean(body.requires_ack), scheduled_at: body.scheduled_at, sent_at: status === 'SENT' ? nowIso() : '', status, approved_by: req.auth!.user.display_name || req.auth!.user.username }, actorId);
    if (status === 'SENT') await dispatchAnnouncement(created, actorId);
    await ctx.audit.record(auditContext(req), { action: 'mkt.announcement.create', entity: 'ANNOUNCEMENTS', entityId: created.id, after: { code: created.code, status: created.status } });
    return reply.code(201), sendSuccess(req, status === 'SENT' ? 'Đã phát hành & gửi bản tin tới nhóm người nhận' : status === 'SCHEDULED' ? 'Đã đặt lịch phát thông báo thành công' : 'Đã lưu bản nháp thông báo thành công', created);
  });

  app.put('/api/mkt/announcements/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, body = zAnnouncementBody.parse(req.body), actorId = req.auth!.user.id, before = ctx.db.announcements.get(id);
    if (!before) throw Errors.notFound('Bản tin nội bộ', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép chỉnh sửa bản tin do chính mình tạo ra (ngoại trừ Quản trị viên)');
    const nextStatus = body.status ?? (body.publish_now === true ? 'SENT' : body.publish_now === false ? (body.scheduled_at ? 'SCHEDULED' : 'DRAFT') : before.status);
    const updated = await ctx.db.announcements.update(id, body.version ?? before.version, {
      campaign_id: body.campaign_id ?? before.campaign_id, title: body.title, summary: body.summary, body: body.body || body.body_md || before.body,
      priority: body.priority, status: nextStatus, scheduled_at: body.scheduled_at ?? before.scheduled_at, sent_at: nextStatus === 'SENT' ? (before.sent_at || nowIso()) : '',
      audience_scope: body.audience_scope || before.audience_scope, audience_json: JSON.stringify({ scope: body.audience_scope || before.audience_scope || 'ALL', target: body.audience_target || 'ALL' }),
      cta_label: body.cta_label || before.cta_label, cta_link: body.cta_link || before.cta_link, media_ids: body.media_ids ?? before.media_ids, requires_ack: body.requires_ack ?? before.requires_ack,
    }, actorId);
    if (nextStatus === 'SENT') await dispatchAnnouncement(updated, actorId);
    return sendSuccess(req, nextStatus === 'SENT' ? 'Đã cập nhật & phát hành bản tin thành công' : 'Đã lưu cập nhật bản tin thành công', updated);
  });

  app.delete('/api/mkt/announcements/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, before = ctx.db.announcements.get(id);
    if (!before) throw Errors.notFound('Bản tin nội bộ', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép xóa bản tin do chính mình tạo ra (ngoại trừ Quản trị viên)');
    await ctx.db.announcements.softDelete(id, before.version, req.auth!.user.id);
    return sendSuccess(req, 'Đã xóa bản tin nội bộ', { id });
  });

  app.post('/api/announcements/:id/ack', { preHandler: requireAuth() }, async (req) => {
    const { id } = req.params as { id: string }, uid = req.auth!.user.id, now = nowIso(), existing = ctx.db.deliveryLogs.find((l) => l.announcement_id === id && l.recipient_user_id === uid);
    if (existing) await ctx.db.deliveryLogs.update(existing.id, existing.version, { read_at: existing.read_at || now, ack_at: now, status: 'SENT' }, uid);
    else await ctx.db.deliveryLogs.insert({ announcement_id: id, recipient_user_id: uid, channel: 'IN_APP_PORTAL', status: 'SENT', attempts: 1, last_error: '', branch_id: 'ALL', sent_at: now, delivered_at: now, read_at: now, ack_at: now }, uid);
    return sendSuccess(req, 'Đã ghi nhận xác nhận đọc bản tin thành công', { id, ack_at: now });
  });

  app.post('/api/mkt/media', { preHandler: requirePermission(...COMMS_PERMS) }, async (req, reply) => {
    const body = zMediaBody.parse(req.body), code = body.code || `MED-${String(ctx.db.mediaAssets.all(true).length + 1).padStart(3, '0')}`;
    const created = await ctx.db.mediaAssets.insert({ file_name: body.file_name, mime_type: body.mime_type, size_bytes: body.size_bytes, drive_file_id: body.drive_file_id || body.drive_url || 'drive://internal', category: body.category, is_internal_only: body.is_internal_only, code, uploaded_by: req.auth!.user.id }, req.auth!.user.id);
    reply.code(201);
    return sendSuccess(req, 'Đã lưu tệp vào Kho Media nội bộ an toàn', created);
  });

  app.put('/api/mkt/media/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, body = zMediaBody.parse(req.body), before = ctx.db.mediaAssets.get(id);
    if (!before) throw Errors.notFound('Tệp Media', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép chỉnh sửa tệp Media do chính mình tải lên (ngoại trừ Quản trị viên)');
    const updated = await ctx.db.mediaAssets.update(id, body.version ?? before.version, { file_name: body.file_name, mime_type: body.mime_type, size_bytes: body.size_bytes, drive_file_id: body.drive_file_id || body.drive_url || before.drive_file_id, category: body.category, is_internal_only: body.is_internal_only }, req.auth!.user.id);
    return sendSuccess(req, 'Đã cập nhật thông tin tệp Media', updated);
  });

  app.delete('/api/mkt/media/:id', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, before = ctx.db.mediaAssets.get(id);
    if (!before) throw Errors.notFound('Tệp Media', id);
    if (!canModify(req.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép xóa tệp Media do chính mình tải lên (ngoại trừ Quản trị viên)');
    await ctx.db.mediaAssets.softDelete(id, before.version, req.auth!.user.id);
    return sendSuccess(req, 'Đã xóa tệp Media khỏi kho lưu trữ', { id });
  });

  app.post('/api/mkt/delivery-logs/:id/retry', { preHandler: requirePermission(...COMMS_PERMS) }, async (req) => {
    const { id } = req.params as { id: string }, log = ctx.db.deliveryLogs.get(id);
    if (!log) throw Errors.notFound('Nhật ký gửi thông báo', id);
    const updated = await ctx.db.deliveryLogs.update(id, log.version, { status: 'SENT', attempts: (log.attempts || 1) + 1, last_error: '', sent_at: nowIso(), delivered_at: nowIso() }, req.auth!.user.id);
    return sendSuccess(req, `Đã thử gửi lại thành công (Lần thử thứ ${updated.attempts})`, updated);
  });
  await jobPositionsAndAudiencesRoutes(app, ctx);
}
