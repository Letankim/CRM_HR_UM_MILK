import { ROLE_LABELS, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type StaffGroup } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { isSyntheticDemoEmail } from './email.service.js';
import {
  parseInterviewWindowMs,
  parseRawInterviewers,
  resolveInterviewerLabel,
  resolveInterviewerRecipients,
} from './interview-schedule-helper.js';

/** Cửa sổ nhắc trước giờ phỏng vấn: từ 1 đến 10 phút trước khi bắt đầu (bắt trọn mốc 5–10 phút). */
export const INTERVIEW_REMINDER_WINDOW_MINUTES = 10;

let activeReminderSweep: Promise<number> | null = null;

/**
 * Quét các cuộc hẹn phỏng vấn sắp bắt đầu trong vòng 5–10 phút tới (<= 10 phút và chưa bắt đầu):
 * - Gửi thông báo Chuông nội bộ + WebSocket Realtime tới toàn bộ người phỏng vấn được đính kèm, Nhân sự (HR) chi nhánh và người tạo lịch.
 * - Gửi Email nhắc lịch phỏng vấn tới cả Hội đồng phỏng vấn nội bộ, HR và Ứng viên (nếu có email cá nhân thật).
 * - Khóa chống gửi trùng theo `INTERVIEW_REMINDER` + `${interview.id}@${start_at.slice(0,16)}` (an toàn ngay cả khi đổi giờ hẹn mới thì mốc giờ mới vẫn được nhắc lại).
 */
export async function sweepUpcomingInterviewReminders(
  ctx: AppContext,
  nowMs = Date.now(),
  actorId = 'interview-reminder',
): Promise<number> {
  const windowMs = INTERVIEW_REMINDER_WINDOW_MINUTES * 60_000;
  const dueInterviews = ctx.db.interviews.all().filter((iv) => {
    if (iv.status === 'CANCELLED' || iv.status === 'COMPLETED' || iv.decision !== 'PENDING') return false;
    const win = parseInterviewWindowMs(iv.start_at, iv.duration_minutes || 30);
    if (!win) return false;
    const diff = win.startMs - nowMs;
    if (diff <= 0 || diff > windowMs) return false;
    const reminderKey = `${iv.id}@${iv.start_at.slice(0, 16)}`;
    return !ctx.db.notifications.find((n) => n.entity_type === 'INTERVIEW_REMINDER' && n.entity_id === reminderKey);
  });

  if (dueInterviews.length === 0) return 0;
  if (activeReminderSweep) return activeReminderSweep;

  activeReminderSweep = (async () => {
    let sentCount = 0;
    const origin = webOrigin(ctx);

    for (const candidateIv of dueInterviews) {
      const iv = ctx.db.interviews.get(candidateIv.id);
      if (!iv || iv.status === 'CANCELLED' || iv.status === 'COMPLETED' || iv.decision !== 'PENDING') continue;
      const win = parseInterviewWindowMs(iv.start_at, iv.duration_minutes || 30);
      if (!win) continue;
      const diff = win.startMs - nowMs;
      if (diff <= 0 || diff > windowMs) continue;

      const reminderKey = `${iv.id}@${iv.start_at.slice(0, 16)}`;
      if (ctx.db.notifications.find((n) => n.entity_type === 'INTERVIEW_REMINDER' && n.entity_id === reminderKey)) continue;

      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      const branchId = iv.branch_id || cand?.branch_pref || '';
      const branchName = ctx.db.branches.get(branchId)?.name || 'Ụm Bò Milk';
      const candName = cand?.full_name || iv.candidate_id;
      const candCode = cand?.candidate_code || '';
      const candDisplay = candCode ? `${candName} (${candCode})` : candName;
      const posLabel = cand ? (cand.position || STAFF_GROUP_LABELS[cand.staff_group as StaffGroup] || cand.staff_group) : 'Ứng viên tuyển dụng';
      const interviewerLabel = resolveInterviewerLabel(ctx, iv.interviewer_id) || 'Hội đồng phỏng vấn';
      const minsLeft = Math.max(1, Math.ceil(diff / 60_000));

      const rawInterviewers = parseRawInterviewers(undefined, iv.interviewer_id);
      const panelRecipients = resolveInterviewerRecipients(ctx, rawInterviewers);
      const relatedUserIds = new Set<string>(panelRecipients.userIds);

      for (const hrUser of ctx.db.users.filter((u) => {
        if (u.status !== 'ACTIVE' || u.role !== 'HR') return false;
        const scope = ctx.auth.resolveEffectiveBranchScope(u);
        return scope === 'ALL' || !branchId || branchId === 'ALL' || scope.includes(branchId);
      })) {
        relatedUserIds.add(hrUser.id);
      }
      if (iv.created_by) {
        const creator = ctx.db.users.get(iv.created_by);
        if (creator && creator.status === 'ACTIVE') relatedUserIds.add(creator.id);
      }

      const targetUserList = Array.from(relatedUserIds);
      const title = `Nhắc lịch phỏng vấn sau ${minsLeft} phút: ${candDisplay}`;
      const body = `Cuộc phỏng vấn ứng viên ${candDisplay} (${posLabel} · ${branchName}) sẽ diễn ra lúc ${win.startHm} – ${win.endHm} (${win.dateVi}). Hội đồng: ${interviewerLabel}.${iv.meet_link ? ` Phòng họp: ${iv.meet_link}` : ''}`;

      const notif = await ctx.db.notifications.insert({
        recipient_user_id: targetUserList.join(','),
        recipient_role: targetUserList.length === 0 ? 'HR' : '',
        branch_id: branchId || 'ALL',
        category: 'HR',
        title,
        body,
        link: '/admin/employees?section=recruitment&sub=interviews',
        severity: 'WARNING',
        read_at: '',
        entity_type: 'INTERVIEW_REMINDER',
        entity_id: reminderKey,
      }, actorId);

      const wsPayload = {
        kind: 'INTERVIEW_REMINDER',
        id: notif.id,
        interviewId: iv.id,
        code: candCode || iv.id,
        title,
        summary: body,
        priority: 'HIGH',
        scheduled_at: iv.start_at,
        minutes_left: minsLeft,
        meet_link: iv.meet_link,
      };
      if (targetUserList.length > 0) {
        ctx.realtime()?.toTargets({ userIds: targetUserList }, SocketEvents.NOTIFICATION, wsPayload);
      } else {
        ctx.realtime()?.toTargets({ roles: ['HR'] }, SocketEvents.NOTIFICATION, wsPayload);
      }

      let mailQueued = 0;
      const seenEmails = new Set<string>();

      for (const uid of targetUserList) {
        const u = ctx.db.users.get(uid);
        const to = u ? resolveUserPersonalRealEmail(ctx, u) : '';
        if (!u || !to || seenEmails.has(to)) continue;
        seenEmails.add(to);
        ctx.email.enqueue({
          to,
          template: 'INTERVIEW_INVITATION',
          subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Nhắc lịch phỏng vấn sắp bắt đầu sau ${minsLeft} phút: ${candDisplay}`,
          recipientName: `${u.display_name || u.username} (${ROLE_LABELS[u.role]})`,
          referenceCode: `REM-INT-${candCode || iv.id.slice(-6)}`,
          summary: `Cuộc phỏng vấn ứng viên ${candDisplay} (${posLabel} · ${branchName}) sẽ bắt đầu sau khoảng ${minsLeft} phút nữa (${win.startHm} – ${win.endHm} ngày ${win.dateVi}). Vui lòng chuẩn bị vào phòng họp và bảng chấm điểm ứng viên.`,
          metadata: [
            { label: 'Ứng viên phỏng vấn', value: candDisplay },
            { label: 'Vị trí & Chi nhánh', value: `${posLabel} · ${branchName}` },
            { label: 'Khung giờ phỏng vấn', value: `${win.startHm} – ${win.endHm} ngày ${win.dateVi} (còn ${minsLeft} phút)` },
            { label: 'Hội đồng tham gia', value: interviewerLabel },
            { label: 'Phòng họp trực tuyến', value: iv.meet_link || 'Phỏng vấn trực tiếp / Google Meet' },
          ],
          actionLabel: 'Mở Lịch phỏng vấn & Phòng họp',
          actionUrl: `${origin}/admin/employees?section=recruitment&sub=interviews`,
        }, { dedupeKey: `iv_rem_int:${reminderKey}:${to}` });
        mailQueued += 1;
      }

      if (cand?.email && !isSyntheticDemoEmail(cand.email)) {
        const candEmail = cand.email.trim().toLowerCase();
        if (!seenEmails.has(candEmail)) {
          seenEmails.add(candEmail);
          ctx.email.enqueue({
            to: candEmail,
            template: 'INTERVIEW_INVITATION',
            subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Nhắc lịch phỏng vấn sau ${minsLeft} phút tại ${SYSTEM_CONFIG.brandName}`,
            recipientName: candName,
            referenceCode: `REM-CAND-${candCode || iv.id.slice(-6)}`,
            summary: `Buổi phỏng vấn tuyển dụng của bạn với ${SYSTEM_CONFIG.brandName} sẽ bắt đầu sau khoảng ${minsLeft} phút nữa (${win.startHm} ngày ${win.dateVi}). Mời bạn kiểm tra kết nối và tham gia đúng giờ.`,
            metadata: [
              { label: 'Ứng viên', value: candDisplay },
              { label: 'Vị trí & Chi nhánh', value: `${posLabel} · ${branchName}` },
              { label: 'Thời gian bắt đầu', value: `${win.startHm} ngày ${win.dateVi} (${win.durationMinutes} phút)` },
              { label: 'Đường dẫn phòng họp', value: iv.meet_link || 'Trực tiếp tại cửa hàng / Google Meet' },
            ],
            actionLabel: 'Vào phòng họp phỏng vấn',
            actionUrl: iv.meet_link || `${origin}/nv/login`,
          }, { dedupeKey: `iv_rem_cand:${reminderKey}:${candEmail}` });
          mailQueued += 1;
        }
      }

      if (mailQueued > 0) void ctx.email.processQueueBatch(Math.min(8, mailQueued));
      sentCount += 1;
    }

    return sentCount;
  })();

  try {
    return await activeReminderSweep;
  } finally {
    activeReminderSweep = null;
  }
}

export function startInterviewReminderScheduler(
  ctx: AppContext,
  log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void },
  intervalMs = 30_000,
): () => void {
  const timer = setInterval(() => {
    void sweepUpcomingInterviewReminders(ctx)
      .then((count) => {
        if (count > 0) log.info(`Đã tự động gửi ${count} thông báo nhắc lịch phỏng vấn trước 5–10 phút`);
      })
      .catch((err) => {
        log.error({ err }, 'Lỗi quét nhắc lịch phỏng vấn sắp diễn ra');
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
