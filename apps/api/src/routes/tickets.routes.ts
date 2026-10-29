import {
  isEmployeeRole, ROLE_LABELS, TICKET_CATEGORIES, TICKET_DEPARTMENT_LABELS,
  TICKET_DEPARTMENTS, TICKET_PRIORITIES, TICKET_STATUSES,
  type SupportTicket, type TicketDepartment, type TicketMessage, type User,
} from '@umbm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { newId, nowIso } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import {
  emitAndEmailTicketEvent, healOpenPayslipDisputesToTickets, mapSupportTicket,
  parseTicketMessages, syncPayslipOnTicketStatusChange,
} from '../services/ticket-notification.service.js';
import { findAllLinkedEmployeesForUser, findLinkedEmployeeForUser } from './employee-mapper.js';

const zCreateTicket = z.object({
  category: z.enum(TICKET_CATEGORIES).default('OTHER'), priority: z.enum(TICKET_PRIORITIES).default('NORMAL'),
  target_department: z.enum(TICKET_DEPARTMENTS), assignee_user_id: z.string().optional().default(''),
  subject: z.string({ required_error: 'Tiêu đề phiếu hỗ trợ là bắt buộc' }).trim().min(4, 'Tiêu đề phiếu hỗ trợ tối thiểu 4 ký tự').max(200),
  description: z.string({ required_error: 'Nội dung chi tiết là bắt buộc' }).trim().min(5, 'Nội dung chi tiết tối thiểu 5 ký tự').max(2500),
  branch_id: z.string().optional().default(''), related_entity_type: z.string().optional().default(''),
  related_entity_id: z.string().optional().default(''), related_label: z.string().optional().default(''),
});
const zUpdateTicket = z.object({
  version: z.coerce.number().int().min(1).optional(), category: z.enum(TICKET_CATEGORIES).optional(), priority: z.enum(TICKET_PRIORITIES).optional(),
  target_department: z.enum(TICKET_DEPARTMENTS).optional(), assignee_user_id: z.string().optional(),
  subject: z.string().trim().min(4, 'Tiêu đề phiếu hỗ trợ tối thiểu 4 ký tự').max(200).optional(),
  description: z.string().trim().min(5, 'Nội dung chi tiết tối thiểu 5 ký tự').max(2500).optional(),
  status: z.enum(TICKET_STATUSES).optional(), resolution_note: z.string().trim().max(1500).optional(),
});
const zReplyTicket = z.object({
  content: z.string({ required_error: 'Nội dung phản hồi là bắt buộc' }).trim().min(2, 'Nội dung phản hồi tối thiểu 2 ký tự').max(2500),
  status: z.enum(TICKET_STATUSES).optional(),
});

export function canAccessTicket(ctx: AppContext, user: User, branchScope: string[] | 'ALL', t: SupportTicket): boolean {
  const myEmps = findAllLinkedEmployeesForUser(user, ctx);
  const isReq = t.requester_user_id === user.id || Boolean(t.requester_employee_id && myEmps.some((e) => e.id === t.requester_employee_id));
  if (user.role === 'ADMIN' || isReq || (t.assignee_user_id && t.assignee_user_id === user.id)) return true;
  if (isEmployeeRole(user.role) || t.target_department !== user.role) return false;
  return !(user.role === 'STORE' && branchScope !== 'ALL' && t.branch_id && t.branch_id !== 'ALL' && !branchScope.includes(t.branch_id));
}

export function validateAssigneeForDepartment(ctx: AppContext, dept: TicketDepartment, assigneeUserId: string): User | undefined {
  const id = assigneeUserId.trim();
  if (!id) return undefined;
  const u = ctx.db.users.get(id);
  if (!u || u.status !== 'ACTIVE') throw Errors.validation([{ field: 'assignee_user_id', code: 'NOT_FOUND', message: 'Người phụ trách được chọn không tồn tại hoặc chưa kích hoạt', rejected_value: id }]);
  if (u.role !== dept) throw Errors.validation([{ field: 'assignee_user_id', code: 'INVALID_VALUE', message: 'Người phụ trách được chọn không thuộc bộ phận tiếp nhận đã chọn', rejected_value: id }]);
  return u;
}

export async function ticketRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/tickets/assignees', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const caller = request.auth!.user, myEmp = findLinkedEmployeeForUser(caller, ctx);
    const callerBranch = q.branch_id || myEmp?.branch_id || (Array.isArray(request.auth!.branchScope) ? request.auth!.branchScope[0] : '') || '';
    const restrictStore = isEmployeeRole(caller.role) || caller.role === 'STORE' || Boolean(q.branch_id);
    const items = ctx.db.users.all().filter((u) => {
      if (u.status !== 'ACTIVE' || !(TICKET_DEPARTMENTS as readonly string[]).includes(u.role)) return false;
      if (q.department && u.role !== q.department) return false;
      if (u.role === 'STORE' && restrictStore && callerBranch && callerBranch !== 'ALL') {
        const uScope = ctx.auth.resolveEffectiveBranchScope(u);
        return uScope === 'ALL' || (Array.isArray(uScope) && uScope.includes(callerBranch));
      }
      return true;
    }).map((u) => {
      const emp = findLinkedEmployeeForUser(u, ctx), br = emp ? ctx.db.branches.get(emp.branch_id) : undefined;
      return {
        id: u.id, username: u.username, displayName: emp?.full_name || u.display_name || u.username,
        role: u.role as TicketDepartment, roleLabel: ROLE_LABELS[u.role],
        department: u.role as TicketDepartment, departmentLabel: TICKET_DEPARTMENT_LABELS[u.role as TicketDepartment],
        branchId: emp?.branch_id || u.branch_scope || 'ALL', branchName: br?.name || (u.branch_scope === 'ALL' ? 'Toàn hệ thống' : u.branch_scope),
      };
    });
    return sendSuccess(request, 'Lấy danh sách bộ phận và người phụ trách hỗ trợ thành công', items);
  });

  app.get('/api/tickets', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    if (q.refresh === '1' || q.refresh === 'true') await Promise.all([ctx.db.supportTickets.refreshIfIdle(), ctx.db.payslips.refreshIfIdle(), ctx.db.users.refreshIfIdle(), ctx.db.employees.refreshIfIdle()]);
    await healOpenPayslipDisputesToTickets(ctx);
    const user = request.auth!.user, scope = request.auth!.branchScope;
    const accessible = ctx.db.supportTickets.all()
      .filter((t) => canAccessTicket(ctx, user, scope, t))
      .filter((t) => q.scope === 'ASSIGNED_TO_ME' ? (t.assignee_user_id === user.id || (!t.assignee_user_id && t.target_department === user.role)) : q.scope === 'CREATED_BY_ME' ? t.requester_user_id === user.id : q.scope === 'DIRECT_TO_ME' ? t.assignee_user_id === user.id : true)
      .map((t) => mapSupportTicket(ctx, t));
    const result = paginateAndSort(accessible, {
      page: Number(q.page) || 1, perPage: Number(q.per_page) || 12, maxPerPage: 200,
      sortBy: q.sort_by, sortOrder: q.sort_order === 'asc' ? 'asc' : q.sort_order === 'desc' ? 'desc' : undefined, defaultSortBy: 'created_at', defaultSortOrder: 'desc',
      allowedSortFields: ['created_at', 'updated_at', 'ticket_code', 'priority', 'status', 'target_department', 'category'],
      q: q.q, searchExtractor: (t) => [t.ticket_code, t.subject, t.description, t.requesterName, t.requesterCode, t.assigneeName, t.departmentLabel, t.related_label],
      filters: { target_department: q.target_department, category: q.category, priority: q.priority, status: q.status, branch_id: q.branch_id },
    });
    result.meta.filters.open_count = String(accessible.filter((t) => t.status === 'OPEN').length);
    result.meta.filters.in_progress_count = String(accessible.filter((t) => t.status === 'IN_PROGRESS').length);
    result.meta.filters.resolved_count = String(accessible.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED').length);
    return sendPaginated(request, 'Lấy danh sách phiếu hỗ trợ thành công', result);
  });

  app.get('/api/tickets/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, t = ctx.db.supportTickets.get(id);
    if (!t) throw Errors.notFound('Phiếu hỗ trợ', id);
    if (!canAccessTicket(ctx, request.auth!.user, request.auth!.branchScope, t)) throw Errors.forbidden('Bạn không có quyền xem phiếu hỗ trợ này');
    return sendSuccess(request, 'Lấy chi tiết phiếu hỗ trợ thành công', mapSupportTicket(ctx, t));
  });

  app.post('/api/tickets', { preHandler: requireAuth() }, async (request, reply) => {
    const body = zCreateTicket.parse(request.body), user = request.auth!.user;
    validateAssigneeForDepartment(ctx, body.target_department, body.assignee_user_id);
    const emp = findLinkedEmployeeForUser(user, ctx);
    let relType = body.related_entity_type, relId = body.related_entity_id, relLabel = body.related_label;
    if (body.category === 'PAYSLIP_INQUIRY' && relId) {
      const slip = ctx.db.payslips.get(relId);
      if (slip) {
        relType = 'PAYSLIP'; relLabel = relLabel || `${slip.payslip_code} — ${slip.period_name}`;
        await ctx.db.payslips.update(slip.id, slip.version, { dispute_status: 'OPEN', dispute_reason: body.description, viewed_by_employee_at: slip.viewed_by_employee_at || nowIso() }, user.id);
      }
    }
    const nextNo = ctx.db.supportTickets.all(true).length + 1;
    const msg: TicketMessage = { id: newId(), sender_user_id: user.id, sender_name: emp?.full_name || user.display_name || user.username, sender_role: ROLE_LABELS[user.role], content: body.description, created_at: nowIso() };
    const created = await ctx.db.supportTickets.insert({
      ticket_code: `TCK-${String(nextNo).padStart(4, '0')}`, requester_user_id: user.id, requester_employee_id: emp?.id || '',
      branch_id: body.branch_id || emp?.branch_id || (Array.isArray(request.auth!.branchScope) ? request.auth!.branchScope[0] : 'ALL') || 'ALL',
      category: body.category, priority: body.priority, target_department: body.target_department, assignee_user_id: body.assignee_user_id.trim(),
      subject: body.subject, description: body.description, related_entity_type: relType, related_entity_id: relId, related_label: relLabel,
      status: 'OPEN', messages_json: JSON.stringify([msg]), resolution_note: '', resolved_by: '', resolved_at: '', closed_at: '',
    }, user.id);
    await ensureSyncedNotifications(ctx);
    emitAndEmailTicketEvent(ctx, created, 'CREATED', user.id);
    await ctx.audit.record(auditContext(request), { action: 'ticket.create', entity: 'SUPPORT_TICKETS', entityId: created.id, after: { code: created.ticket_code, dept: created.target_department, assignee: created.assignee_user_id } });
    reply.code(201);
    return sendSuccess(request, 'Đã tạo và gửi phiếu hỗ trợ tới đúng bộ phận tiếp nhận', mapSupportTicket(ctx, created));
  });

  app.put('/api/tickets/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, body = zUpdateTicket.parse(request.body), user = request.auth!.user, t = ctx.db.supportTickets.get(id);
    if (!t) throw Errors.notFound('Phiếu hỗ trợ', id);
    if (!canAccessTicket(ctx, user, request.auth!.branchScope, t)) throw Errors.forbidden('Bạn không có quyền cập nhật phiếu hỗ trợ này');
    if (isEmployeeRole(user.role) && body.status && body.status !== 'CLOSED' && body.status !== t.status) throw Errors.forbidden('Nhân viên chỉ được đóng phiếu hỗ trợ hoặc gửi phản hồi bổ sung');
    const nextDept = body.target_department ?? t.target_department;
    const nextAssigneeId = body.assignee_user_id !== undefined ? body.assignee_user_id.trim() : (body.target_department && body.target_department !== t.target_department ? '' : t.assignee_user_id);
    const nextAssignee = validateAssigneeForDepartment(ctx, nextDept, nextAssigneeId);
    const nextStatus = body.status ?? t.status, now = nowIso(), msgs = parseTicketMessages(t.messages_json);
    const routingChanged = nextDept !== t.target_department || nextAssigneeId !== t.assignee_user_id;
    if (routingChanged) {
      const emp = findLinkedEmployeeForUser(user, ctx);
      msgs.push({ id: newId(), sender_user_id: user.id, sender_name: emp?.full_name || user.display_name || user.username, sender_role: ROLE_LABELS[user.role], content: `Đã điều phối phiếu hỗ trợ sang ${TICKET_DEPARTMENT_LABELS[nextDept]}${nextAssignee ? ` (Người phụ trách: ${nextAssignee.display_name || nextAssignee.username})` : ' (Toàn bộ phận)'}.`, created_at: now });
    }
    const isResolved = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED';
    const updated = await ctx.db.supportTickets.update(t.id, body.version ?? t.version, {
      category: body.category ?? t.category, priority: body.priority ?? t.priority, target_department: nextDept, assignee_user_id: nextAssigneeId,
      subject: body.subject ?? t.subject, description: body.description ?? t.description, status: nextStatus, messages_json: JSON.stringify(msgs),
      resolution_note: body.resolution_note ?? t.resolution_note, resolved_by: isResolved ? (t.resolved_by || user.id) : '', resolved_at: isResolved ? (t.resolved_at || now) : '', closed_at: nextStatus === 'CLOSED' ? (t.closed_at || now) : '',
    }, user.id);
    await syncPayslipOnTicketStatusChange(ctx, updated, user.id);
    await ensureSyncedNotifications(ctx);
    if (isResolved && t.status !== 'RESOLVED' && t.status !== 'CLOSED') emitAndEmailTicketEvent(ctx, updated, 'RESOLVED', user.id, updated.resolution_note);
    else if (routingChanged) emitAndEmailTicketEvent(ctx, updated, 'ASSIGNED', user.id);
    await ctx.audit.record(auditContext(request), { action: routingChanged ? 'ticket.assign' : 'ticket.update', entity: 'SUPPORT_TICKETS', entityId: updated.id, before: { status: t.status, dept: t.target_department, assignee: t.assignee_user_id }, after: { status: updated.status, dept: updated.target_department, assignee: updated.assignee_user_id } });
    return sendSuccess(request, 'Cập nhật phiếu hỗ trợ thành công', mapSupportTicket(ctx, updated));
  });

  app.post('/api/tickets/:id/reply', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, body = zReplyTicket.parse(request.body), user = request.auth!.user, t = ctx.db.supportTickets.get(id);
    if (!t) throw Errors.notFound('Phiếu hỗ trợ', id);
    if (!canAccessTicket(ctx, user, request.auth!.branchScope, t)) throw Errors.forbidden('Bạn không có quyền phản hồi phiếu hỗ trợ này');
    const emp = findLinkedEmployeeForUser(user, ctx), now = nowIso(), isReq = t.requester_user_id === user.id;
    const msgs = [...parseTicketMessages(t.messages_json), { id: newId(), sender_user_id: user.id, sender_name: emp?.full_name || user.display_name || user.username, sender_role: ROLE_LABELS[user.role], content: body.content, created_at: now }];
    const nextStatus = isReq ? (body.status === 'CLOSED' ? 'CLOSED' : (t.status === 'RESOLVED' ? 'IN_PROGRESS' : t.status)) : (body.status ?? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status));
    const isResolved = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED';
    const updated = await ctx.db.supportTickets.update(t.id, t.version, {
      assignee_user_id: !isReq && !t.assignee_user_id && user.role === t.target_department ? user.id : t.assignee_user_id,
      status: nextStatus, messages_json: JSON.stringify(msgs), resolution_note: !isReq && isResolved ? body.content : t.resolution_note,
      resolved_by: isResolved ? (!isReq ? user.id : (t.resolved_by || user.id)) : '', resolved_at: isResolved ? (t.resolved_at || now) : '', closed_at: nextStatus === 'CLOSED' ? (t.closed_at || now) : '',
    }, user.id);
    await syncPayslipOnTicketStatusChange(ctx, updated, user.id);
    await ensureSyncedNotifications(ctx);
    emitAndEmailTicketEvent(ctx, updated, isReq ? 'REQUESTER_REPLIED' : (isResolved ? 'RESOLVED' : 'STAFF_REPLIED'), user.id, body.content);
    await ctx.audit.record(auditContext(request), { action: isResolved ? 'ticket.resolve' : 'ticket.reply', entity: 'SUPPORT_TICKETS', entityId: updated.id, after: { status: updated.status, by: user.username } });
    return sendSuccess(request, isResolved ? 'Đã gửi phản hồi và hoàn tất xử lý phiếu hỗ trợ' : 'Đã gửi phản hồi vào phiếu hỗ trợ thành công', mapSupportTicket(ctx, updated));
  });

  app.delete('/api/tickets/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, user = request.auth!.user, t = ctx.db.supportTickets.get(id);
    if (!t) throw Errors.notFound('Phiếu hỗ trợ', id);
    if (user.role !== 'ADMIN' && user.role !== 'HR' && t.requester_user_id !== user.id) throw Errors.forbidden('Chỉ Quản trị viên, Nhân sự hoặc người tạo mới được xóa phiếu hỗ trợ');
    await ctx.db.supportTickets.softDelete(t.id, t.version, user.id);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'ticket.delete', entity: 'SUPPORT_TICKETS', entityId: t.id, before: { code: t.ticket_code } });
    return sendSuccess(request, 'Đã xóa phiếu hỗ trợ thành công', { id: t.id });
  });

  app.post('/api/tickets/bulk-action', { preHandler: requireAuth() }, async (request) => {
    const body = z.object({ ids: z.array(z.string()).min(1, 'Vui lòng chọn ít nhất 1 phiếu hỗ trợ'), action: z.enum(['IN_PROGRESS', 'RESOLVE', 'CLOSE', 'DELETE']), note: z.string().optional().default('') }).parse(request.body);
    const user = request.auth!.user, scope = request.auth!.branchScope, now = nowIso();
    let count = 0;
    for (const id of body.ids) {
      const t = ctx.db.supportTickets.get(id);
      if (!t || !canAccessTicket(ctx, user, scope, t)) continue;
      if (body.action === 'DELETE' && (user.role === 'ADMIN' || user.role === 'HR' || t.requester_user_id === user.id)) { await ctx.db.supportTickets.softDelete(t.id, t.version, user.id); count++; }
      else if (body.action !== 'DELETE' && !isEmployeeRole(user.role)) {
        const st = body.action === 'IN_PROGRESS' ? 'IN_PROGRESS' : body.action === 'RESOLVE' ? 'RESOLVED' : 'CLOSED';
        const updated = await ctx.db.supportTickets.update(t.id, t.version, { status: st, resolution_note: body.note || t.resolution_note, resolved_by: st !== 'IN_PROGRESS' ? (t.resolved_by || user.id) : '', resolved_at: st !== 'IN_PROGRESS' ? (t.resolved_at || now) : '', closed_at: st === 'CLOSED' ? now : '' }, user.id);
        await syncPayslipOnTicketStatusChange(ctx, updated, user.id);
        if (st === 'RESOLVED') emitAndEmailTicketEvent(ctx, updated, 'RESOLVED', user.id, body.note || updated.resolution_note);
        count++;
      }
    }
    await ensureSyncedNotifications(ctx);
    return sendSuccess(request, `Đã thực hiện thao tác hàng loạt trên ${count} phiếu hỗ trợ`, { count });
  });
}
