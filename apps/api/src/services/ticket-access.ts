import {
  isEmployeeRole, ROLE_LABELS, TICKET_CATEGORY_LABELS, TICKET_DEPARTMENT_LABELS,
  TICKET_DEPARTMENTS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS,
  type Role, type SupportTicket, type TicketDepartment, type TicketMessage, type User,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { findAllLinkedEmployeesForUser, findLinkedEmployeeForUser } from '../routes/employee-mapper.js';

export interface TicketViewerContext {
  user: User;
  branchScope: string[] | 'ALL';
}

export function listTicketAssignees(
  ctx: AppContext,
  caller: User,
  branchScope: string[] | 'ALL',
  query: { department?: string; branch_id?: string },
) {
  const myEmp = findLinkedEmployeeForUser(caller, ctx);
  const callerBranch = query.branch_id || myEmp?.branch_id || (Array.isArray(branchScope) ? branchScope[0] : '') || '';
  const restrictStore = isEmployeeRole(caller.role) || caller.role === 'STORE' || Boolean(query.branch_id);
  return ctx.db.users.all().filter((u) => {
    if (u.status !== 'ACTIVE' || !(TICKET_DEPARTMENTS as readonly string[]).includes(u.role)) return false;
    if (query.department && u.role !== query.department) return false;
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
}

export function parseTicketMessages(raw: string): TicketMessage[] {
  if (!raw || !raw.trim().startsWith('[')) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as TicketMessage[]) : [];
  } catch {
    return [];
  }
}

export function isTicketRequester(ctx: AppContext, user: User, t: SupportTicket): boolean {
  if (t.requester_user_id === user.id) return true;
  if (!t.requester_employee_id) return false;
  const myEmps = findAllLinkedEmployeesForUser(user, ctx);
  return myEmps.some((e) => e.id === t.requester_employee_id);
}

/**
 * Kiểm tra phiếu có đang được giao trực tiếp cho user (hoặc bộ phận tiếp nhận của user) xử lý hay không.
 * Quy tắc nghiệp vụ:
 * - Phiếu do chính mình tạo (isTicketRequester) tuyệt đối KHÔNG coi là phiếu giao cho mình xử lý / chuyển tiếp.
 * - Nếu phiếu chỉ định đích danh assignee_user_id: chỉ đúng user đó được coi là người được giao.
 * - Nếu phiếu giao chung cho bộ phận (assignee_user_id rỗng): nhân sự thuộc đúng target_department (và đúng phạm vi chi nhánh nếu là STORE).
 */
export function isTicketAssignedToUser(
  ctx: AppContext,
  user: User,
  branchScope: string[] | 'ALL',
  t: SupportTicket,
): boolean {
  if (isTicketRequester(ctx, user, t) || isEmployeeRole(user.role)) return false;
  if (t.assignee_user_id) return t.assignee_user_id === user.id;
  if (t.target_department !== user.role) return false;
  if (user.role === 'STORE' && branchScope !== 'ALL' && t.branch_id && t.branch_id !== 'ALL' && !branchScope.includes(t.branch_id)) {
    return false;
  }
  return true;
}

export function canForwardTicket(
  ctx: AppContext,
  user: User,
  branchScope: string[] | 'ALL',
  t: SupportTicket,
): boolean {
  return t.status !== 'CLOSED' && isTicketAssignedToUser(ctx, user, branchScope, t);
}

export function canAccessTicket(ctx: AppContext, user: User, branchScope: string[] | 'ALL', t: SupportTicket): boolean {
  if (user.role === 'ADMIN' || isTicketRequester(ctx, user, t)) return true;
  if (isTicketAssignedToUser(ctx, user, branchScope, t)) return true;
  if (!isEmployeeRole(user.role) && t.target_department === user.role) {
    return !(user.role === 'STORE' && branchScope !== 'ALL' && t.branch_id && t.branch_id !== 'ALL' && !branchScope.includes(t.branch_id));
  }
  return !isEmployeeRole(user.role) && parseTicketMessages(t.messages_json).some((m) => m.sender_user_id === user.id);
}

export function validateAssigneeForDepartment(ctx: AppContext, dept: TicketDepartment, assigneeUserId: string): User | undefined {
  const id = assigneeUserId.trim();
  if (!id) return undefined;
  const u = ctx.db.users.get(id);
  if (!u || u.status !== 'ACTIVE') {
    throw Errors.validation([{ field: 'assignee_user_id', code: 'NOT_FOUND', message: 'Người phụ trách được chọn không tồn tại hoặc chưa kích hoạt', rejected_value: id }]);
  }
  if (u.role !== dept) {
    throw Errors.validation([{ field: 'assignee_user_id', code: 'INVALID_VALUE', message: 'Người phụ trách được chọn không thuộc bộ phận tiếp nhận đã chọn', rejected_value: id }]);
  }
  return u;
}

export function mapSupportTicket(ctx: AppContext, t: SupportTicket, viewer?: TicketViewerContext) {
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
    isRequester: viewer ? isTicketRequester(ctx, viewer.user, t) : false,
    isAssignedToMe: viewer ? isTicketAssignedToUser(ctx, viewer.user, viewer.branchScope, t) : false,
    canForward: viewer ? canForwardTicket(ctx, viewer.user, viewer.branchScope, t) : false,
    messages,
    messageCount: messages.length,
  };
}
