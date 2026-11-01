import { ROLE_LABELS, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { parseScheduledAtEpochMs } from './announcement-scheduler.service.js';

export const LEGACY_INTERVIEWER_MAP: Record<string, { role: Role; label: string }> = {
  'u-hr-01': { role: 'HR', label: 'Nguyễn Thị Nhân Sự (Quản lý Nhân sự)' },
  'u-store-01': { role: 'STORE', label: 'Trần Văn Cửa Hàng (Quản lý cửa hàng)' },
  'u-admin-01': { role: 'ADMIN', label: 'Ban Giám đốc (Quản trị viên)' },
};

export interface InterviewOverlapDetail {
  interviewId: string;
  candidateId: string;
  candidateCode: string;
  candidateName: string;
  dateStr: string;
  startHm: string;
  endHm: string;
  durationMinutes: number;
  interviewerLabel: string;
  sharesInterviewer: boolean;
  message: string;
}

export function parseRawInterviewers(ids?: string[], singleOrArr?: string | string[], fallbackCsv = ''): string[] {
  if (ids?.length) return ids.map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(singleOrArr) && singleOrArr.length) return singleOrArr.map((s) => s.trim()).filter(Boolean);
  if (typeof singleOrArr === 'string' && singleOrArr.trim()) return singleOrArr.split(',').map((s) => s.trim()).filter(Boolean);
  return fallbackCsv.split(',').map((s) => s.trim()).filter(Boolean);
}

export function resolveInterviewerRecipients(ctx: AppContext, rawIds: string[]): { userIds: string[]; roles: string[] } {
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

export function resolveInterviewerLabel(ctx: AppContext, rawCsv: string): string {
  return rawCsv
    .split(',')
    .map((part) => {
      const id = part.trim();
      if (!id) return '';
      if (LEGACY_INTERVIEWER_MAP[id]) return LEGACY_INTERVIEWER_MAP[id]!.label;
      const u = ctx.db.users.get(id) ?? ctx.db.users.find((x) => x.username === id);
      if (u) {
        const emp = u.employee_id ? ctx.db.employees.get(u.employee_id) : undefined;
        return emp ? `${emp.full_name} (${ROLE_LABELS[u.role]})` : `${u.display_name || u.username} (${ROLE_LABELS[u.role]})`;
      }
      const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
      return emp ? `${emp.full_name} (${emp.employee_code})` : id;
    })
    .filter(Boolean)
    .join(', ');
}

export function parseInterviewWindowMs(startAtRaw: string, durationMinutes = 30) {
  const startMs = parseScheduledAtEpochMs(startAtRaw);
  if (startMs === null) return null;
  const dur = Math.max(5, Number(durationMinutes) || 30);
  const endMs = startMs + dur * 60_000;
  const startVn = dayjs(startMs).tz('Asia/Ho_Chi_Minh');
  const endVn = dayjs(endMs).tz('Asia/Ho_Chi_Minh');
  return {
    startMs,
    endMs,
    durationMinutes: dur,
    dateStr: startVn.format('YYYY-MM-DD'),
    dateVi: startVn.format('DD/MM/YYYY'),
    startHm: startVn.format('HH:mm'),
    endHm: endVn.format('HH:mm'),
  };
}

/**
 * Kiểm tra giao thoa khoảng thời gian phỏng vấn [startA, endA) ∩ [startB, endB)
 * cho cả hội đồng người phỏng vấn lẫn các lịch phỏng vấn khác đang mở cùng khung giờ.
 */
export function findInterviewTimeOverlaps(
  ctx: AppContext,
  params: { startAt: string; durationMinutes: number; rawInterviewers: string[]; excludeInterviewId?: string },
): { interviewerConflicts: InterviewOverlapDetail[]; slotOverlaps: InterviewOverlapDetail[] } {
  const win = parseInterviewWindowMs(params.startAt, params.durationMinutes);
  if (!win) return { interviewerConflicts: [], slotOverlaps: [] };

  const targetResolved = resolveInterviewerRecipients(ctx, params.rawInterviewers);
  const targetUserSet = new Set(targetResolved.userIds);
  const targetRawSet = new Set(params.rawInterviewers.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const interviewerConflicts: InterviewOverlapDetail[] = [];
  const slotOverlaps: InterviewOverlapDetail[] = [];

  for (const iv of ctx.db.interviews.all()) {
    if (iv.id === params.excludeInterviewId || iv.status === 'CANCELLED' || iv.status === 'COMPLETED') continue;
    const exWin = parseInterviewWindowMs(iv.start_at, iv.duration_minutes || 30);
    if (!exWin) continue;
    if (!(win.startMs < exWin.endMs && win.endMs > exWin.startMs)) continue;

    const exRaw = parseRawInterviewers(undefined, iv.interviewer_id);
    const exResolved = resolveInterviewerRecipients(ctx, exRaw);
    const sharesCanonicalUser = exResolved.userIds.some((uid) => targetUserSet.has(uid));
    const sharesRawToken = exRaw.some((r) => targetRawSet.has(r.toLowerCase()));
    const sharesInterviewer = sharesCanonicalUser || sharesRawToken;

    const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
    const candidateName = cand?.full_name ?? iv.candidate_id;
    const candidateCode = cand?.candidate_code ?? '';
    const ivLabel = resolveInterviewerLabel(ctx, iv.interviewer_id);
    const candDisplay = candidateCode ? `${candidateName} (${candidateCode})` : candidateName;
    const message = sharesInterviewer
      ? `Khung giờ ${win.startHm} – ${win.endHm} ngày ${win.dateVi} bị trùng lịch người phỏng vấn với cuộc phỏng vấn ứng viên ${candDisplay} (${exWin.startHm} – ${exWin.endHm}, ${exWin.durationMinutes} phút · Hội đồng: ${ivLabel})`
      : `Khung giờ ${win.startHm} – ${win.endHm} ngày ${win.dateVi} giao thoa với cuộc phỏng vấn của ứng viên ${candDisplay} (${exWin.startHm} – ${exWin.endHm}, ${exWin.durationMinutes} phút)`;

    const detail: InterviewOverlapDetail = {
      interviewId: iv.id, candidateId: iv.candidate_id, candidateCode, candidateName,
      dateStr: exWin.dateStr, startHm: exWin.startHm, endHm: exWin.endHm, durationMinutes: exWin.durationMinutes,
      interviewerLabel: ivLabel, sharesInterviewer, message,
    };
    if (sharesInterviewer) interviewerConflicts.push(detail);
    else slotOverlaps.push(detail);
  }
  return { interviewerConflicts, slotOverlaps };
}

export async function notifyInterviewParticipants(
  ctx: AppContext,
  actorId: string,
  params: { rawIds: string[]; branchId: string; interviewId: string; code: string; title: string; body: string; kind: string },
): Promise<string[]> {
  const recipients = resolveInterviewerRecipients(ctx, params.rawIds);
  const notif = await ctx.db.notifications.insert({
    recipient_user_id: recipients.userIds.join(','),
    recipient_role: recipients.userIds.length === 0 ? (recipients.roles.join(',') || 'HR') : '',
    branch_id: params.branchId || 'ALL',
    category: 'HR',
    title: params.title,
    body: params.body,
    link: '/admin/employees?section=recruitment&sub=interviews',
    severity: 'INFO',
    read_at: '',
    entity_type: 'INTERVIEWS',
    entity_id: params.interviewId,
  }, actorId);
  const wsPayload = { kind: params.kind, id: notif.id, code: params.code, title: params.title, summary: params.body, priority: 'NORMAL' };
  recipients.userIds.filter((uid) => uid !== actorId).forEach((uid) => ctx.realtime()?.toUser(uid, SocketEvents.NOTIFICATION, wsPayload));
  if (recipients.userIds.length === 0 && recipients.roles.length > 0) {
    ctx.realtime()?.toTargets({ roles: recipients.roles as Role[], excludeUserId: actorId }, SocketEvents.NOTIFICATION, wsPayload);
  }
  return recipients.userIds;
}
