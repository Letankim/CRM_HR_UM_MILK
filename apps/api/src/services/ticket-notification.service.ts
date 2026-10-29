import {
  ROLE_LABELS, SYSTEM_CONFIG, TICKET_CATEGORY_LABELS, TICKET_DEPARTMENT_LABELS,
  TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS,
  type NotificationRow, type Payslip, type Role, type SupportTicket, type TicketDepartment, type TicketMessage, type User,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { newId, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { findLinkedEmployeeForUser, findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { resolveRolePortalPath, resolveSystemHrMailbox, resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { tolerantWrite } from './background-write.js';

export function parseTicketMessages(raw: string): TicketMessage[] {
  if (!raw || !raw.trim().startsWith('[')) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? (arr as TicketMessage[]) : []; } catch { return []; }
}

export function mapSupportTicket(ctx: AppContext, t: SupportTicket) {
  const reqUser = ctx.db.users.get(t.requester_user_id);
  const reqEmp = (t.requester_employee_id ? ctx.db.employees.get(t.requester_employee_id) : undefined) ?? (reqUser ? findLinkedEmployeeForUser(reqUser, ctx) : undefined);
  const assignee = t.assignee_user_id ? ctx.db.users.get(t.assignee_user_id) : undefined;
  const resolver = t.resolved_by ? ctx.db.users.get(t.resolved_by) : undefined;
  const branch = (t.branch_id && t.branch_id !== 'ALL' ? ctx.db.branches.get(t.branch_id) : undefined) ?? (reqEmp ? ctx.db.branches.get(reqEmp.branch_id) : undefined);
  const messages = parseTicketMessages(t.messages_json);
  const reqRole = (reqUser?.role ?? (reqEmp?.stage === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC')) as Role;
  return {
    ...t,
    branch_id: branch?.id ?? t.branch_id ?? 'ALL',
    branchName: branch?.name ?? 'Toàn hệ thống',
    requesterName: reqEmp?.full_name || reqUser?.display_name || reqUser?.username || 'Nhân sự',
    requesterCode: reqEmp?.employee_code || reqUser?.employee_id || reqUser?.username || '',
    requesterRole: reqRole,
    requesterRoleLabel: ROLE_LABELS[reqRole] ?? reqRole,
    categoryLabel: TICKET_CATEGORY_LABELS[t.category] ?? t.category,
    priorityLabel: TICKET_PRIORITY_LABELS[t.priority] ?? t.priority,
    departmentLabel: TICKET_DEPARTMENT_LABELS[t.target_department] ?? t.target_department,
    statusLabel: TICKET_STATUS_LABELS[t.status] ?? t.status,
    assigneeName: assignee ? (assignee.display_name || assignee.username) : 'Toàn bộ phận tiếp nhận',
    assigneeRoleLabel: assignee ? ROLE_LABELS[assignee.role] : TICKET_DEPARTMENT_LABELS[t.target_department],
    resolvedByName: resolver ? (resolver.display_name || resolver.username) : (t.resolved_by || ''),
    messages,
    messageCount: messages.length,
  };
}

export async function healOpenPayslipDisputesToTickets(ctx: AppContext): Promise<void> {
  const existingSlipIds = new Set(ctx.db.supportTickets.filter((t) => t.related_entity_type === 'PAYSLIP' && Boolean(t.related_entity_id)).map((t) => t.related_entity_id));
  const openSlips = ctx.db.payslips.filter((p) => p.status !== 'REVISED' && p.dispute_status === 'OPEN' && Boolean(p.dispute_reason) && !existingSlipIds.has(p.id));
  for (const slip of openSlips) {
    const emp = ctx.db.employees.get(slip.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === slip.employee_code);
    const reqUser = emp ? findLinkedUserForEmployee(emp, ctx) : undefined;
    const reqUserId = reqUser?.id || slip.updated_by || 'system';
    const nextNo = ctx.db.supportTickets.all(true).length + 1;
    const msg: TicketMessage = { id: newId(), sender_user_id: reqUserId, sender_name: emp?.full_name || reqUser?.display_name || slip.full_name || 'Nhân sự', sender_role: reqUser ? ROLE_LABELS[reqUser.role] : 'Nhân viên', content: slip.dispute_reason, created_at: slip.updated_at || nowIso() };
    await tolerantWrite(() => ctx.db.supportTickets.insert({
      ticket_code: `TCK-${String(nextNo).padStart(4, '0')}`, requester_user_id: reqUserId, requester_employee_id: emp?.id || slip.employee_id,
      branch_id: emp?.branch_id || slip.branch_id || 'ALL', category: 'PAYSLIP_INQUIRY', priority: 'HIGH', target_department: 'FINANCE', assignee_user_id: '',
      subject: `Thắc mắc phiếu lương ${slip.payslip_code} (${slip.period_name})`, description: slip.dispute_reason,
      related_entity_type: 'PAYSLIP', related_entity_id: slip.id, related_label: `${slip.payslip_code} — ${slip.period_name}`,
      status: 'OPEN', messages_json: JSON.stringify([msg]), resolution_note: '', resolved_by: '', resolved_at: '', closed_at: '',
    }, reqUserId));
  }
}

export async function upsertPayslipDisputeTicket(
  ctx: AppContext, slip: Payslip, actorUser: User,
  opts: { reason: string; targetDepartment?: TicketDepartment; assigneeUserId?: string },
): Promise<SupportTicket> {
  const emp = findLinkedEmployeeForUser(actorUser, ctx) ?? ctx.db.employees.get(slip.employee_id);
  const dept: TicketDepartment = opts.targetDepartment ?? 'FINANCE', assigneeId = opts.assigneeUserId?.trim() || '';
  const msg: TicketMessage = { id: newId(), sender_user_id: actorUser.id, sender_name: emp?.full_name || actorUser.display_name || actorUser.username, sender_role: ROLE_LABELS[actorUser.role], content: opts.reason, created_at: nowIso() };
  const activeExisting = ctx.db.supportTickets.find((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === slip.id && t.status !== 'CLOSED');
  if (activeExisting) {
    const msgs = [...parseTicketMessages(activeExisting.messages_json), msg];
    return ctx.db.supportTickets.update(activeExisting.id, activeExisting.version, {
      target_department: dept, assignee_user_id: assigneeId || activeExisting.assignee_user_id, description: opts.reason,
      status: activeExisting.status === 'RESOLVED' ? 'OPEN' : activeExisting.status, messages_json: JSON.stringify(msgs),
    }, actorUser.id);
  }
  const nextNo = ctx.db.supportTickets.all(true).length + 1;
  return ctx.db.supportTickets.insert({
    ticket_code: `TCK-${String(nextNo).padStart(4, '0')}`, requester_user_id: actorUser.id, requester_employee_id: emp?.id || slip.employee_id,
    branch_id: emp?.branch_id || slip.branch_id || 'ALL', category: 'PAYSLIP_INQUIRY', priority: 'HIGH', target_department: dept, assignee_user_id: assigneeId,
    subject: `Thắc mắc phiếu lương ${slip.payslip_code} (${slip.period_name})`, description: opts.reason,
    related_entity_type: 'PAYSLIP', related_entity_id: slip.id, related_label: `${slip.payslip_code} — ${slip.period_name}`,
    status: 'OPEN', messages_json: JSON.stringify([msg]), resolution_note: '', resolved_by: '', resolved_at: '', closed_at: '',
  }, actorUser.id);
}

export async function syncPayslipOnTicketStatusChange(ctx: AppContext, ticket: SupportTicket, actorId: string): Promise<void> {
  if (ticket.related_entity_type !== 'PAYSLIP' || !ticket.related_entity_id) return;
  const slip = ctx.db.payslips.get(ticket.related_entity_id);
  if (!slip) return;
  const nextDisputeStatus = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? 'RESOLVED' : 'OPEN';
  if (slip.dispute_status !== nextDisputeStatus) await ctx.db.payslips.update(slip.id, slip.version, { dispute_status: nextDisputeStatus }, actorId);
}

export function isStaleTicketNotification(ctx: AppContext, n: NotificationRow): boolean {
  if (n.entity_type !== 'TICKET_ASSIGNEE' && n.entity_type !== 'TICKET_REPLY_STAFF') return false;
  const tckId = (n.entity_id || '').split('::')[0] || '';
  const tck = tckId ? ctx.db.supportTickets.get(tckId) : undefined;
  if (!tck || (tck.status !== 'OPEN' && tck.status !== 'IN_PROGRESS')) return true;
  return n.entity_type === 'TICKET_ASSIGNEE' && n.entity_id !== `${tck.id}::${tck.target_department}::${tck.assignee_user_id || 'DEPT'}`;
}

export async function syncSupportTicketBellNotifications(
  ctx: AppContext,
  ins: (data: Omit<Parameters<typeof ctx.db.notifications.insert>[0], 'read_at'>, actorId?: string) => Promise<void>,
): Promise<void> {
  for (const t of ctx.db.supportTickets.all().slice(-100)) {
    const mapped = mapSupportTicket(ctx, t), msgs = mapped.messages;
    const cat = t.category === 'PAYSLIP_INQUIRY' ? 'PAYROLL' : 'WORKFLOW';
    const sev = t.priority === 'URGENT' ? 'CRITICAL' : t.priority === 'HIGH' ? 'WARNING' : 'INFO';
    const staffUid = t.assignee_user_id || '', staffRole = t.assignee_user_id ? '' : t.target_department;
    const brId = t.target_department === 'STORE' ? (mapped.branch_id || 'ALL') : 'ALL';
    if (t.status === 'OPEN' || t.status === 'IN_PROGRESS') {
      await ins({
        recipient_user_id: staffUid, recipient_role: staffRole, branch_id: brId, category: cat, severity: sev,
        title: `Phiếu hỗ trợ cần xử lý (${t.ticket_code}): ${t.subject}`,
        body: `Người gửi: ${mapped.requesterName} (${mapped.branchName}) · Bộ phận: ${mapped.departmentLabel}${t.assignee_user_id ? ` · Phụ trách: ${mapped.assigneeName}` : ''} — ${t.description}`,
        link: '/admin/tickets', entity_type: 'TICKET_ASSIGNEE', entity_id: `${t.id}::${t.target_department}::${t.assignee_user_id || 'DEPT'}`,
      }, t.requester_user_id);
      const lastMsg = msgs[msgs.length - 1];
      if (msgs.length > 1 && lastMsg && lastMsg.sender_user_id === t.requester_user_id) {
        await ins({
          recipient_user_id: staffUid, recipient_role: staffRole, branch_id: brId, category: cat, severity: sev,
          title: `Phản hồi bổ sung từ người gửi (${t.ticket_code}): ${t.subject}`,
          body: `${lastMsg.sender_name}: ${lastMsg.content}`,
          link: '/admin/tickets', entity_type: 'TICKET_REPLY_STAFF', entity_id: `${t.id}::REQ::${msgs.length}`,
        }, t.requester_user_id);
      }
    }
    const staffMsgs = msgs.filter((m) => m.sender_user_id !== t.requester_user_id);
    const lastStaffMsg = staffMsgs[staffMsgs.length - 1];
    const isResolvedByStaff = (t.status === 'RESOLVED' || t.status === 'CLOSED') && Boolean(t.resolved_by && t.resolved_by !== t.requester_user_id);
    if (t.requester_user_id && (staffMsgs.length > 0 || isResolvedByStaff)) {
      const done = t.status === 'RESOLVED' || t.status === 'CLOSED';
      await ins({
        recipient_user_id: t.requester_user_id, recipient_role: '', branch_id: mapped.branch_id || 'ALL', category: cat, severity: 'INFO',
        title: done ? `Phiếu hỗ trợ (${t.ticket_code}) đã được phản hồi & giải quyết` : `Phản hồi mới cho phiếu hỗ trợ (${t.ticket_code})`,
        body: lastStaffMsg ? `${lastStaffMsg.sender_name}: ${lastStaffMsg.content}` : (t.resolution_note || `${mapped.departmentLabel} đã hoàn tất xử lý phiếu hỗ trợ.`),
        link: '/nv/ho-tro', entity_type: 'TICKET_USER', entity_id: `${t.id}::STAFF::${staffMsgs.length}::${done ? 'RESOLVED' : 'REPLY'}`,
      }, lastStaffMsg?.sender_user_id || t.resolved_by || t.updated_by);
    }
  }
}

export function emitAndEmailTicketEvent(
  ctx: AppContext, ticket: SupportTicket,
  eventKind: 'CREATED' | 'ASSIGNED' | 'STAFF_REPLIED' | 'REQUESTER_REPLIED' | 'RESOLVED',
  actorId: string, latestMessage?: string,
): void {
  const mapped = mapSupportTicket(ctx, ticket), rt = ctx.realtime();
  const notifyRequester = eventKind === 'STAFF_REPLIED' || eventKind === 'RESOLVED';
  const staffTargets = ticket.assignee_user_id
    ? { userIds: [ticket.assignee_user_id], excludeUserId: actorId }
    : { branchId: ticket.target_department === 'STORE' ? mapped.branch_id : 'ALL', roles: [ticket.target_department], excludeUserId: actorId };
  const targets = notifyRequester ? { userIds: [ticket.requester_user_id], excludeUserId: actorId } : staffTargets;
  const title = eventKind === 'CREATED' ? `Phiếu hỗ trợ mới (${ticket.ticket_code}): ${ticket.subject}`
    : eventKind === 'ASSIGNED' ? `Điều phối phiếu hỗ trợ (${ticket.ticket_code}): ${ticket.subject}`
    : eventKind === 'RESOLVED' ? `Phiếu hỗ trợ (${ticket.ticket_code}) đã được giải quyết`
    : `Phản hồi mới trên phiếu hỗ trợ (${ticket.ticket_code})`;
  const payload = { kind: `TICKET_${eventKind}`, entityId: ticket.id, code: ticket.ticket_code, branchId: mapped.branch_id, title, summary: latestMessage || ticket.description, actorId };
  rt?.toTargets(targets, SocketEvents.TICKET_UPDATED, payload);
  rt?.toTargets(targets, SocketEvents.NOTIFICATION, payload);
  if (ticket.related_entity_type === 'PAYSLIP') rt?.broadcast(SocketEvents.PAYROLL_UPDATED, { periodId: '', ticketId: ticket.id });

  const origin = webOrigin(ctx);
  if (notifyRequester) {
    const reqUser = ctx.db.users.get(ticket.requester_user_id), to = reqUser ? resolveUserPersonalRealEmail(ctx, reqUser) : '';
    if (!to || ticket.requester_user_id === actorId) return;
    ctx.email.enqueue({
      to, template: 'INTERNAL_ANNOUNCEMENT', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${title}`,
      recipientName: mapped.requesterName, referenceCode: ticket.ticket_code,
      summary: `${mapped.departmentLabel} vừa ${eventKind === 'RESOLVED' ? 'phản hồi & hoàn tất xử lý' : 'gửi phản hồi mới cho'} phiếu hỗ trợ ${ticket.ticket_code} của bạn.`,
      metadata: [{ label: 'Mã phiếu hỗ trợ', value: ticket.ticket_code }, { label: 'Tiêu đề', value: ticket.subject }, { label: 'Bộ phận xử lý', value: `${mapped.departmentLabel} (${mapped.assigneeName})` }, { label: 'Trạng thái', value: mapped.statusLabel }, { label: 'Nội dung phản hồi', value: latestMessage || ticket.resolution_note || 'Đã cập nhật trên hệ thống' }],
      actionLabel: 'Xem phản hồi phiếu hỗ trợ', actionUrl: `${origin}${resolveRolePortalPath(mapped.requesterRole, 'tickets')}`,
    }, { dedupeKey: `tck_req:${ticket.id}:v${ticket.version}:${to}` });
    return;
  }

  const candidates = ticket.assignee_user_id
    ? [ctx.db.users.get(ticket.assignee_user_id)].filter((u): u is User => Boolean(u && u.status === 'ACTIVE' && u.id !== actorId))
    : ctx.db.users.filter((u) => {
        if (u.status !== 'ACTIVE' || u.id === actorId || u.role !== ticket.target_department) return false;
        if (u.role === 'STORE' && mapped.branch_id && mapped.branch_id !== 'ALL') {
          const scope = ctx.auth.resolveEffectiveBranchScope(u);
          return scope === 'ALL' || (Array.isArray(scope) && scope.includes(mapped.branch_id));
        }
        return true;
      });
  const seen = new Set<string>();
  for (const u of candidates) {
    const to = resolveUserPersonalRealEmail(ctx, u);
    if (!to || seen.has(to)) continue;
    seen.add(to);
    ctx.email.enqueue({
      to, template: 'INTERNAL_ANNOUNCEMENT', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${title}`,
      recipientName: `${u.display_name || u.username} (${ROLE_LABELS[u.role]})`, referenceCode: ticket.ticket_code,
      summary: `Nhân sự ${mapped.requesterName}${mapped.requesterCode ? ` (${mapped.requesterCode})` : ''} vừa gửi ${eventKind === 'REQUESTER_REPLIED' ? 'phản hồi bổ sung cho ' : ''}phiếu hỗ trợ ${ticket.ticket_code} tới ${mapped.departmentLabel}.`,
      metadata: [{ label: 'Mã phiếu & Ưu tiên', value: `${ticket.ticket_code} · ${mapped.priorityLabel}` }, { label: 'Người gửi & Chi nhánh', value: `${mapped.requesterName} · ${mapped.branchName}` }, { label: 'Phân loại', value: `${mapped.categoryLabel}${ticket.related_label ? ` (${ticket.related_label})` : ''}` }, { label: 'Người phụ trách', value: mapped.assigneeName }, { label: 'Nội dung yêu cầu', value: latestMessage || ticket.description }],
      actionLabel: 'Mở Trung tâm Phiếu hỗ trợ để xử lý', actionUrl: `${origin}${resolveRolePortalPath(u.role, 'tickets')}`,
    }, { dedupeKey: `tck_staff:${ticket.id}:v${ticket.version}:${to}` });
  }
  if (seen.size === 0 && ['HR', 'FINANCE', 'ADMIN'].includes(ticket.target_department)) {
    const actorUser = ctx.db.users.get(actorId), fallback = resolveSystemHrMailbox(ctx), actorMail = actorUser ? resolveUserPersonalRealEmail(ctx, actorUser) : '';
    if (fallback && fallback !== actorMail) {
      ctx.email.enqueue({
        to: fallback, template: 'INTERNAL_ANNOUNCEMENT', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${title}`,
        recipientName: `${mapped.departmentLabel} — ${SYSTEM_CONFIG.brandName}`, referenceCode: ticket.ticket_code,
        summary: `Nhân sự ${mapped.requesterName} vừa gửi phiếu hỗ trợ ${ticket.ticket_code} tới ${mapped.departmentLabel}.`,
        metadata: [{ label: 'Mã phiếu & Phân loại', value: `${ticket.ticket_code} · ${mapped.categoryLabel}` }, { label: 'Người gửi', value: `${mapped.requesterName} (${mapped.branchName})` }, { label: 'Nội dung', value: latestMessage || ticket.description }],
        actionLabel: 'Mở Trung tâm Phiếu hỗ trợ', actionUrl: `${origin}/admin/tickets`,
      }, { dedupeKey: `tck_fb:${ticket.id}:v${ticket.version}:${fallback}` });
    }
  }
}
