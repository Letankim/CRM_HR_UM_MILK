import type { NotificationRow } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { parseTicketMessages } from './ticket-notification.service.js';

const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function pickIso(...candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    if (c && ISO_DT_RE.test(c) && !Number.isNaN(Date.parse(c))) return c;
  }
  return '';
}

/**
 * Tra cứu thời điểm phát sinh sự kiện gốc (created_at / updated_at / decided_at / sent_at / published_at)
 * cho các thông báo đồng bộ tự động từ bảng nghiệp vụ, giúp thứ tự "Mới nhất trước" và "Cũ nhất trước"
 * luôn phản ánh đúng thời gian thực tế phát sinh thay vì thời điểm quét đồng bộ hàng loạt.
 */
export function resolveNotificationEventTime(ctx: AppContext, n: Pick<NotificationRow, 'entity_type' | 'entity_id' | 'created_at'>): string {
  const et = n.entity_type || '';
  const eid = n.entity_id || '';
  if (!et || et === 'MANUAL' || !eid) return n.created_at;

  if (et === 'ANNOUNCEMENTS') {
    const anc = ctx.db.announcements.get(eid);
    return pickIso(anc?.sent_at, anc?.updated_at, anc?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'USERS_PENDING') {
    const u = ctx.db.users.get(eid);
    return pickIso(u?.created_at, n.created_at) || n.created_at;
  }

  const rawId = eid.replace(
    /_(PUBLISHED|APPROVED|REJECTED|PENDING|STORE_CONFIRMED|PENDING_PEER|PEER_ACCEPTED|PEER_DECLINED|ESCALATED|RESOLVED|REPLACEMENT_FOUND|PAID)$/,
    '',
  );

  if (et === 'SHIFT_DRAFT_ROLE' || et === 'SCHED_STORE') {
    const a = ctx.db.shiftAssignments.get(rawId);
    return pickIso(a?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'SHIFT_PUB_USER') {
    const a = ctx.db.shiftAssignments.get(rawId);
    return pickIso(a?.published_at, a?.updated_at, a?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'LEAVE_ROLE') {
    const l = ctx.db.leaveRequests.get(rawId);
    return pickIso(l?.submitted_at, l?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'LEAVE_USER') {
    const l = ctx.db.leaveRequests.get(rawId);
    return pickIso(l?.decided_at, l?.updated_at, l?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'SWAP_STORE') {
    const s = ctx.db.shiftSwaps.get(rawId);
    return pickIso(s?.peer_responded_at, s?.updated_at, s?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'SWAP_USER') {
    const s = ctx.db.shiftSwaps.get(rawId);
    if (eid.endsWith('_PENDING_PEER')) return pickIso(s?.requested_at, s?.created_at, n.created_at) || n.created_at;
    if (eid.endsWith('_PEER_ACCEPTED') || eid.endsWith('_PEER_DECLINED')) {
      return pickIso(s?.peer_responded_at, s?.updated_at, s?.created_at, n.created_at) || n.created_at;
    }
    return pickIso(s?.decided_at, s?.updated_at, s?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'ATT_ADJ_HR') {
    const adj = ctx.db.attendanceAdjustments.get(rawId);
    if (eid.endsWith('_STORE_CONFIRMED')) return pickIso(adj?.store_confirmed_at, adj?.updated_at, n.created_at) || n.created_at;
    return pickIso(adj?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'ATT_ADJ_USER' && !eid.startsWith('BULK_')) {
    const adj = ctx.db.attendanceAdjustments.get(rawId);
    if (eid.endsWith('_STORE_CONFIRMED')) return pickIso(adj?.store_confirmed_at, adj?.updated_at, n.created_at) || n.created_at;
    return pickIso(adj?.decided_at, adj?.updated_at, adj?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'PAYSLIP_USER') {
    const ps = ctx.db.payslips.get(rawId);
    if (eid.endsWith('_PAID')) {
      const period = ps ? ctx.db.payPeriods.get(ps.period_id) : undefined;
      return pickIso(period?.paid_at, ps?.updated_at, n.created_at) || n.created_at;
    }
    return pickIso(ps?.published_at, ps?.created_at, n.created_at) || n.created_at;
  }
  if (et === 'TICKET_ASSIGNEE' || et === 'TICKET_REPLY_STAFF' || et === 'TICKET_USER') {
    const tckId = eid.split('::')[0] || '';
    const tck = tckId ? ctx.db.supportTickets.get(tckId) : undefined;
    if (!tck) return n.created_at;
    const msgs = parseTicketMessages(tck.messages_json);
    if (et === 'TICKET_REPLY_STAFF') {
      const lastMsg = msgs[msgs.length - 1];
      return pickIso(lastMsg?.created_at, tck.updated_at, n.created_at) || n.created_at;
    }
    if (et === 'TICKET_USER') {
      const staffMsgs = msgs.filter((m) => m.sender_user_id !== tck.requester_user_id);
      const lastStaff = staffMsgs[staffMsgs.length - 1];
      return pickIso(lastStaff?.created_at, tck.resolved_at, tck.updated_at, n.created_at) || n.created_at;
    }
    return tck.version === 1 ? (pickIso(tck.created_at, n.created_at) || n.created_at) : (pickIso(n.created_at, tck.updated_at, tck.created_at) || n.created_at);
  }
  return n.created_at;
}
