import { isEmployeeRole, type Announcement, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { APP_TZ, dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { getMatchingUsersForAudience } from '../routes/job-positions-and-audiences.routes.js';
import { resolveRolePortalPath, resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { resolveAnnouncementMediaAttachments } from './comms-media-helper.js';

/**
 * Chuyển chuỗi lịch phát (VD: "2026-10-29 22:30", "2026-10-29", hoặc ISO có offset)
 * về epoch milliseconds chuẩn theo múi giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7),
 * đảm bảo chính xác tuyệt đối ngay cả khi server Render chạy ở múi giờ UTC.
 */
export function parseScheduledAtEpochMs(rawScheduledAt: string | undefined | null): number | null {
  const raw = String(rawScheduledAt || '').trim();
  if (!raw) return null;

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }

  const localDateTimeMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (localDateTimeMatch) {
    const [, datePart, hmPart, secPart] = localDateTimeMatch;
    const ms = Date.parse(`${datePart}T${hmPart}:${secPart || '00'}+07:00`);
    return Number.isNaN(ms) ? null : ms;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ms = Date.parse(`${raw}T08:00:00+07:00`);
    return Number.isNaN(ms) ? null : ms;
  }

  const parsed = dayjs.tz(raw, APP_TZ);
  return parsed.isValid() ? parsed.valueOf() : null;
}

export function isScheduledAnnouncementDue(rawScheduledAt: string | undefined | null, nowEpochMs = Date.now()): boolean {
  const dueMs = parseScheduledAtEpochMs(rawScheduledAt);
  return dueMs !== null && dueMs <= nowEpochMs;
}

export async function dispatchAnnouncement(ctx: AppContext, anc: Announcement, actorId: string): Promise<void> {
  let target = 'ALL';
  try {
    target = JSON.parse(anc.audience_json || '{}').target || 'ALL';
  } catch {
    target = 'ALL';
  }
  const isGlobal = !anc.audience_scope || (anc.audience_scope === 'ALL' && target === 'ALL');
  const matchedUsers = isGlobal
    ? ctx.db.users.filter((u) => u.status === 'ACTIVE')
    : getMatchingUsersForAudience(ctx, anc.audience_scope || 'ALL', anc.audience_json || target);
  const recipientUserId = isGlobal ? 'ALL' : (matchedUsers.map((u) => u.id).join(',') || 'NONE');
  const recipientRole = isGlobal
    ? 'ALL'
    : (anc.audience_scope === 'STAGE' ? (target === 'PROBATION' || target === 'THU_VIEC' ? 'THU_VIEC' : 'CHINH_THUC') : '');
  const branchId = anc.audience_scope === 'BRANCH' ? target : 'ALL';

  const existingNotif = ctx.db.notifications.find((n) => n.entity_type === 'ANNOUNCEMENTS' && n.entity_id === anc.id);
  const notif = existingNotif
    ? await ctx.db.notifications.update(existingNotif.id, existingNotif.version, {
        recipient_user_id: recipientUserId,
        recipient_role: recipientRole,
        branch_id: branchId,
        title: anc.title,
        body: anc.summary || anc.title,
      }, actorId)
    : await ctx.db.notifications.insert({
        recipient_user_id: recipientUserId,
        category: 'ANNOUNCEMENT',
        title: anc.title,
        body: anc.summary || anc.title,
        link: anc.cta_link || '/nv/ban-tin',
        severity: anc.priority === 'URGENT' ? 'CRITICAL' : anc.priority === 'HIGH' ? 'WARNING' : 'INFO',
        read_at: '',
        recipient_role: recipientRole,
        branch_id: branchId,
        entity_type: 'ANNOUNCEMENTS',
        entity_id: anc.id,
      }, actorId);

  const obsoleteLogs = ctx.db.deliveryLogs.filter((l) => l.announcement_id === anc.id && !matchedUsers.some((u) => u.id === l.recipient_user_id));
  if (obsoleteLogs.length > 0) {
    await ctx.db.deliveryLogs.batchUpdate(obsoleteLogs.map((l) => ({ id: l.id, expectedVersion: l.version, patch: { is_deleted: true } })), actorId);
  }
  const existingLogUserIds = new Set(ctx.db.deliveryLogs.filter((l) => l.announcement_id === anc.id).map((l) => l.recipient_user_id));
  const prioLabel = anc.priority === 'URGENT' ? 'Khẩn cấp' : anc.priority === 'HIGH' ? 'Quan trọng' : 'Thông thường';
  const now = anc.sent_at || nowIso();
  const attachedMedia = resolveAnnouncementMediaAttachments(ctx, anc.media_ids);
  const pendingLogInserts: Promise<unknown>[] = [];
  const seenAncEmails = new Set<string>();
  const origin = webOrigin(ctx);

  for (const u of matchedUsers) {
    if (!existingLogUserIds.has(u.id)) {
      pendingLogInserts.push(ctx.db.deliveryLogs.insert({
        announcement_id: anc.id,
        recipient_user_id: u.id,
        channel: 'IN_APP_SOCKET',
        status: 'SENT',
        attempts: 1,
        last_error: '',
        branch_id: u.branch_scope === 'ALL' ? 'ALL' : u.branch_scope.split(',')[0] || 'ALL',
        sent_at: now,
        delivered_at: now,
        read_at: '',
        ack_at: '',
      }, actorId));
    }
    const personalEmail = resolveUserPersonalRealEmail(ctx, u);
    if (!personalEmail || seenAncEmails.has(personalEmail)) continue;
    seenAncEmails.add(personalEmail);
    const ctaPath = (!anc.cta_link || anc.cta_link === '/nv/ban-tin' || (u.role === 'MKT' && anc.cta_link.startsWith('/nv')) || (isEmployeeRole(u.role as Role) && anc.cta_link.startsWith('/admin')))
      ? resolveRolePortalPath(u.role as Role, 'comms')
      : anc.cta_link;
    ctx.email.enqueue({
      to: personalEmail,
      template: 'INTERNAL_ANNOUNCEMENT',
      recipientName: u.display_name || u.username,
      referenceCode: anc.code,
      summary: anc.summary || anc.title,
      metadata: [
        { label: 'Mã bản tin', value: anc.code },
        { label: 'Tiêu đề', value: anc.title },
        { label: 'Mức độ ưu tiên', value: prioLabel },
        ...(attachedMedia.length ? [{ label: 'Tệp đính kèm', value: attachedMedia.map((m) => `${m.file_name} (${m.mimeLabel}, ${m.sizeFormatted})`).join('; ') }] : []),
      ],
      actionLabel: anc.cta_label || 'Xem chi tiết bản tin',
      actionUrl: `${origin}${ctaPath}`,
    });
  }

  if (seenAncEmails.size > 0) void ctx.email.processQueueBatch(Math.min(6, seenAncEmails.size));
  if (pendingLogInserts.length > 0) await Promise.all(pendingLogInserts);

  const payload = { kind: 'ANNOUNCEMENT', id: anc.id, notificationId: notif.id, code: anc.code, title: anc.title, summary: anc.summary, priority: anc.priority, sent_at: now };
  const rt = ctx.realtime();
  if (rt) {
    if (isGlobal) {
      rt.broadcast(SocketEvents.NOTIFICATION, payload);
    } else {
      const notifiedIds = new Set<string>();
      for (const u of matchedUsers) {
        notifiedIds.add(u.id);
        rt.toUser(u.id, SocketEvents.NOTIFICATION, payload);
      }
      if (anc.created_by && !notifiedIds.has(anc.created_by)) rt.toUser(anc.created_by, SocketEvents.NOTIFICATION, payload);
      rt.toRole('ADMIN', SocketEvents.NOTIFICATION, payload);
      rt.toRole('MKT', SocketEvents.NOTIFICATION, payload);
    }
  }
}

let activeSweepPromise: Promise<number> | null = null;

export async function sweepDueScheduledAnnouncements(ctx: AppContext, actorId = 'announcement-scheduler'): Promise<number> {
  const checkNow = Date.now();
  const hasDue = ctx.db.announcements.all().some(
    (a) => a.status === 'SCHEDULED' && Boolean(a.scheduled_at) && isScheduledAnnouncementDue(a.scheduled_at, checkNow),
  );
  if (!hasDue) return 0;
  if (activeSweepPromise) return activeSweepPromise;

  activeSweepPromise = (async () => {
    let publishedCount = 0;
    const candidates = ctx.db.announcements.all().filter(
      (a) => a.status === 'SCHEDULED' && Boolean(a.scheduled_at) && isScheduledAnnouncementDue(a.scheduled_at, Date.now()),
    );
    for (const candidate of candidates) {
      const fresh = ctx.db.announcements.get(candidate.id);
      if (!fresh || fresh.status !== 'SCHEDULED' || !isScheduledAnnouncementDue(fresh.scheduled_at, Date.now())) continue;
      const effectiveActor = fresh.created_by || actorId;
      const sentAt = fresh.sent_at || nowIso();
      const updated = await ctx.db.announcements.update(fresh.id, fresh.version, { status: 'SENT', sent_at: sentAt }, effectiveActor);
      await dispatchAnnouncement(ctx, updated, effectiveActor);
      await ctx.audit.record(
        { actorUserId: effectiveActor, actorRole: 'MKT', ip: '127.0.0.1', userAgent: 'announcement-scheduler', requestId: `req_sched_${fresh.id.slice(-10)}` },
        { action: 'mkt.announcement.scheduled_publish', entity: 'ANNOUNCEMENTS', entityId: updated.id, after: { code: updated.code, scheduled_at: updated.scheduled_at, sent_at: sentAt } },
      ).catch(() => undefined);
      publishedCount += 1;
    }
    return publishedCount;
  })();

  try {
    return await activeSweepPromise;
  } finally {
    activeSweepPromise = null;
  }
}

export function startAnnouncementScheduler(
  ctx: AppContext,
  log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void },
  intervalMs = 20_000,
): () => void {
  const timer = setInterval(() => {
    void sweepDueScheduledAnnouncements(ctx).then((count) => {
      if (count > 0) log.info(`Đã tự động phát hành ${count} bản tin đến giờ hẹn (Announcement Scheduler)`);
    }).catch((err) => {
      log.error({ err }, 'Lỗi quét và phát hành bản tin hẹn giờ');
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
