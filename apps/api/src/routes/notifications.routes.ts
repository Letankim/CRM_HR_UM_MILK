import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isEmployeeRole, ROLE_LABELS, ROLES, type NotificationRow, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { resolveRolePortalPath, resolveUserPersonalRealEmail, webOrigin } from '../services/account-email-dispatcher.js';
import { ensureSyncedNotifications, isNotificationCreatedByOrSelfAction } from '../services/notification-sync.service.js';
import { resolveEmployeeBranchId } from './account-employee-sync.js';
import { doesUserMatchAudience } from './job-positions-and-audiences.routes.js';

function resolveNotificationLinkForRole(n: NotificationRow, role: Role): string {
  const isEmp = isEmployeeRole(role), raw = (n.link || '').replace('/nv/cong-cua-toi', '/nv/cong');
  if (n.entity_type === 'ANNOUNCEMENTS') return resolveRolePortalPath(role, 'comms');
  if (n.entity_type === 'ATT_ADJ_USER') return resolveRolePortalPath(role, 'attendance');
  if (n.entity_type === 'LEAVE_USER' || n.entity_type === 'EMG_USER') return resolveRolePortalPath(role, 'leave');
  if (n.entity_type === 'SWAP_USER') return resolveRolePortalPath(role, 'swap');
  if (n.entity_type === 'SHIFT_PUB_USER') return resolveRolePortalPath(role, 'schedule');
  if (n.entity_type === 'PAYSLIP_USER') return resolveRolePortalPath(role, 'payslip');
  if (n.entity_type === 'TICKET_ASSIGNEE' || n.entity_type === 'TICKET_REPLY_STAFF' || n.entity_type === 'TICKET_USER') return resolveRolePortalPath(role, 'tickets');
  if (isEmp) {
    if (raw.startsWith('/nv')) return raw;
    if (raw.includes('tickets')) return '/nv/ho-tro';
    if (raw.includes('my-attendance')) return '/nv/cong';
    if (raw.includes('payroll')) return '/nv/phieu-luong';
    if (raw.includes('schedules')) return '/nv/lich';
    return '/nv/thong-bao';
  }
  if (raw.startsWith('/nv/cong') || raw.startsWith('/nv/lich') || raw.startsWith('/nv/nghi-phep') || raw.startsWith('/nv/doi-ca') || raw.startsWith('/nv/diem-danh')) {
    return role === 'MKT' ? '/dashboard' : '/admin/my-attendance';
  }
  if (raw === '/nv/ho-tro') return '/admin/tickets';
  if (raw === '/nv/ban-tin') return resolveRolePortalPath(role, 'comms');
  if (raw === '/nv/thong-bao') return '/admin/notifications';
  if (raw === '/nv/phieu-luong' && (role === 'ADMIN' || role === 'HR' || role === 'FINANCE')) return '/admin/payroll';
  return raw || '/admin/notifications';
}

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  ANNOUNCEMENT: 'Bản tin truyền thông nội bộ', WORKFLOW: 'Lịch ca, Nghỉ phép & Đổi ca',
  ATTENDANCE: 'Điểm danh GPS & Bổ sung công', PAYROLL: 'Kỳ lương & Phiếu lương',
  HR: 'Nhân sự, Tuyển dụng & Đào tạo', SYSTEM: 'Hệ thống & Tài khoản', ACCOUNT: 'Hệ thống & Tài khoản',
};
export const NOTIFICATION_SEVERITY_LABELS: Record<string, string> = { INFO: 'Thông thường', WARNING: 'Quan trọng', CRITICAL: 'Khẩn cấp' };

function parseReadMap(raw: string): Record<string, string> {
  if (!raw || !raw.trim().startsWith('{')) return {};
  try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, string>) : {}; } catch { return {}; }
}
const getUserReadAt = (rawReadAt: string, userId: string) => parseReadMap(rawReadAt)[userId] || '';
const zListQuery = z.object({ page: z.coerce.number().int().min(1).default(1), per_page: z.coerce.number().int().min(1).max(100).default(12), q: z.string().optional(), category: z.string().optional(), severity: z.string().optional(), read_status: z.string().optional(), scope_type: z.string().optional(), sort_by: z.string().default('created_at'), sort_order: z.enum(['asc', 'desc']).default('desc'), refresh: z.string().optional() });
const zCreateNotificationBody = z.object({ title: z.string().trim().min(3, 'Tiêu đề thông báo tối thiểu 3 ký tự'), body: z.string().trim().min(3, 'Nội dung thông báo tối thiểu 3 ký tự'), category: z.enum(['ANNOUNCEMENT', 'WORKFLOW', 'ATTENDANCE', 'PAYROLL', 'HR', 'SYSTEM']).default('SYSTEM'), severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'), target_scope: z.enum(['ALL', 'ROLE', 'USER']).default('ALL'), recipient_role: z.string().optional().default(''), recipient_roles: z.array(z.string()).optional().default([]), recipient_user_id: z.string().optional().default(''), recipient_user_ids: z.array(z.string()).optional().default([]), link: z.string().optional().default('/dashboard') });
const zBulkIdsBody = z.object({ ids: z.array(z.string()).optional() });

export async function notificationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/notifications/recipients', { preHandler: requireAuth() }, async (request) => {
    const scope = request.auth!.branchScope;
    const items = ctx.db.users.all().filter((u) => {
      if (u.status !== 'ACTIVE') return false;
      if (scope === 'ALL' || u.branch_scope === 'ALL') return true;
      const uBranches = (u.branch_scope || '').split(',').map((s) => s.trim()).filter(Boolean);
      return uBranches.some((b) => scope.includes(b));
    }).map((u) => ({
      id: u.id, username: u.username, displayName: u.display_name || u.username,
      role: u.role, roleLabel: ROLE_LABELS[u.role as Role] ?? u.role,
    }));
    return sendSuccess(request, 'Lấy danh sách người nhận thông báo thành công', items);
  });

  app.get('/api/notifications', { preHandler: requireAuth() }, async (request) => {
    const query = zListQuery.parse(request.query);
    const user = request.auth!.user;
    const branchScope = request.auth!.branchScope;
    if (query.refresh === '1') await Promise.all([ctx.db.notifications.refreshIfIdle(), ctx.db.users.refreshIfIdle()]);
    await ensureSyncedNotifications(ctx);

    const usersMap = new Map(ctx.db.users.all().map((u) => [u.id, u]));
    const ancsMap = new Map(ctx.db.announcements.all().map((a) => [a.id, a]));
    const splitCsv = (raw: string) => (raw || '').split(',').map((s) => s.trim()).filter(Boolean);

    const seenVisibleKeys = new Set<string>();
    const isGlobalBackofficeRole = ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(user.role);
    const resolveNotifMeta = (n: NotificationRow): { branchId: string; isBoOrHr: boolean } => {
      const rawId = (n.entity_id || '').replace(/_(STORE_CONFIRMED|APPROVED|REJECTED|PENDING_PEER|PEER_ACCEPTED|ESCALATED)$/, '');
      const checkEmp = (eid?: string, fb = '', creatorId = '') => {
        const emp = eid ? (ctx.db.employees.get(eid) ?? ctx.db.employees.find((e) => e.employee_code === eid)) : undefined;
        const creatorRole = creatorId ? ctx.db.users.get(creatorId)?.role : undefined;
        const empUserRole = emp?.user_id ? ctx.db.users.get(emp.user_id)?.role : undefined;
        const isBoOrHr = emp?.staff_group === 'BACKOFFICE' || ['ADMIN', 'HR', 'FINANCE', 'MKT', 'STORE'].includes(empUserRole || '') || ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(creatorRole || '');
        return { branchId: (eid ? resolveEmployeeBranchId(ctx, eid, fb || n.branch_id) : fb || n.branch_id) || 'ALL', isBoOrHr };
      };
      if (n.entity_type === 'ATT_ADJ_HR') { const adj = ctx.db.attendanceAdjustments.get(rawId); return checkEmp(adj?.employee_id, adj?.branch_id, adj?.created_by); }
      if (n.entity_type === 'LEAVE_ROLE') { const l = ctx.db.leaveRequests.get(rawId); return checkEmp(l?.employee_id, l?.branch_id, l?.created_by); }
      if (n.entity_type === 'SHIFT_DRAFT_ROLE') { const a = ctx.db.shiftAssignments.get(rawId); return checkEmp(a?.employee_id, a?.branch_id, a?.created_by); }
      if (n.entity_type === 'SWAP_STORE') { const s = ctx.db.shiftSwaps.get(rawId); return checkEmp(s?.requester_id, s?.branch_id, s?.created_by); }
      if (n.entity_type === 'EMG_STORE') { const e = ctx.db.emergencyLeaves.get(rawId); return checkEmp(e?.employee_id, e?.branch_id, e?.created_by); }
      return { branchId: n.branch_id || 'ALL', isBoOrHr: false };
    };
    const visible = [...ctx.db.notifications.all()].reverse().filter((n) => {
      if (isNotificationCreatedByOrSelfAction(ctx, n, user.id)) return false;
      if (n.entity_type === 'MANUAL' && n.created_by === user.id && !splitCsv(n.recipient_user_id).includes(user.id)) return false;

      let matched = false;
      if (n.entity_type === 'ANNOUNCEMENTS' && n.entity_id) {
        const anc = ancsMap.get(n.entity_id);
        if (anc) matched = user.role === 'ADMIN' || doesUserMatchAudience(ctx, user, anc.audience_scope || 'ALL', anc.audience_json);
      } else {
        const userIds = splitCsv(n.recipient_user_id), roles = splitCsv(n.recipient_role);
        if (userIds.includes('NONE')) return false;
        if (userIds.length > 0 && !userIds.includes('ALL')) {
          matched = userIds.includes(user.id);
        } else if (user.role === 'ADMIN') {
          matched = (n.entity_type === 'TICKET_ASSIGNEE' || n.entity_type === 'TICKET_REPLY_STAFF') ? roles.includes('ADMIN') : !['ATT_ADJ_HR', 'LEAVE_ROLE', 'SHIFT_DRAFT_ROLE', 'SWAP_STORE', 'EMG_STORE'].includes(n.entity_type);
        } else {
          const { branchId: notifBranch, isBoOrHr } = resolveNotifMeta(n);
          const isWorkflowRoleNotif = ['ATT_ADJ_HR', 'LEAVE_ROLE', 'SHIFT_DRAFT_ROLE', 'SWAP_STORE', 'EMG_STORE'].includes(n.entity_type);
          if (user.role === 'STORE' && ((n.entity_type === 'ATT_ADJ_HR' && n.entity_id.endsWith('_STORE_CONFIRMED')) || (n.entity_type === 'EMG_STORE' && n.entity_id.endsWith('_ESCALATED')) || (isWorkflowRoleNotif && isBoOrHr))) return false;
          const inBranch = isGlobalBackofficeRole
            || (branchScope === 'ALL' && !isWorkflowRoleNotif)
            || (!isWorkflowRoleNotif && (!notifBranch || notifBranch === 'ALL'))
            || (Array.isArray(branchScope) && Boolean(notifBranch && notifBranch !== 'ALL') && branchScope.includes(notifBranch));
          if (!inBranch) return false;
          if (roles.length > 0 && !roles.includes('ALL')) matched = roles.includes(user.role);
          else matched = userIds.includes('ALL') || roles.includes('ALL');
        }
      }
      if (!matched) return false;

      const dedupKey = n.entity_type && n.entity_id ? `ent:${n.entity_type}:${n.entity_id}` : `txt:${n.category}:${n.title}:${n.body}`;
      if (seenVisibleKeys.has(dedupKey)) return false;
      seenVisibleKeys.add(dedupKey);
      return true;
    });

    const totalVisible = visible.length;
    const enriched = visible.map((n, idx) => {
      const anc = n.entity_type === 'ANNOUNCEMENTS' ? ancsMap.get(n.entity_id) : undefined;
      const userIds = splitCsv(n.recipient_user_id).filter((x) => x !== 'ALL' && x !== 'NONE');
      const roles = splitCsv(n.recipient_role).filter((x) => x !== 'ALL');
      const isAncGroup = Boolean(anc && anc.audience_scope && anc.audience_scope !== 'ALL');
      const isPersonal = !isAncGroup && userIds.length > 0;
      const isBroadcast = !isAncGroup && !isPersonal && roles.length === 0;
      const scopeType = isPersonal ? 'PERSONAL' : isBroadcast ? 'BROADCAST' : 'ROLE';
      const userNames = userIds.map((uid) => { const u = usersMap.get(uid); return u?.display_name || u?.username || uid; });
      const roleLabels = roles.map((r) => ROLE_LABELS[r as Role] ?? r);
      const targetLabel = isAncGroup ? `Nhóm nhận (${userIds.length}): ${userNames.join(', ') || 'Theo nhóm cấu hình'}` : isPersonal ? `Cá nhân (${userNames.length}): ${userNames.join(', ')}` : isBroadcast ? 'Toàn hệ thống (Tất cả vai trò)' : `Nhóm nhân sự: ${roleLabels.join(', ')}`;
      const userReadAt = getUserReadAt(n.read_at, user.id), readStatus = userReadAt ? 'READ' : 'UNREAD';
      return {
        ...n, link: resolveNotificationLinkForRole(n, user.role), body: n.body.replace(/^Mã:\s*[A-Z0-9_]+\s*\([^)]+\)\s*·\s*/i, ''), read_at: userReadAt, code: anc?.code || `NTF-${String(totalVisible - idx).padStart(4, '0')}`,
        categoryLabel: NOTIFICATION_CATEGORY_LABELS[n.category] ?? n.category, severityLabel: NOTIFICATION_SEVERITY_LABELS[n.severity] ?? n.severity,
        scopeType, targetLabel, readStatus, readStatusLabel: userReadAt ? 'Đã đọc' : 'Chưa đọc', detailHtml: anc?.body || `<p>${n.body.replace(/^Mã:\s*[A-Z0-9_]+\s*\([^)]+\)\s*·\s*/i, '')}</p>`,
      };
    });

    const unreadCount = enriched.filter((n) => n.readStatus === 'UNREAD').length;
    const result = paginateAndSort(enriched, {
      page: query.page, perPage: query.per_page, sortBy: query.sort_by, sortOrder: query.sort_order, defaultSortBy: 'created_at',
      allowedSortFields: ['created_at', 'severity', 'title', 'category', 'readStatus'], q: query.q,
      searchExtractor: (item) => [item.code, item.title, item.body, item.categoryLabel, item.targetLabel],
      filters: { category: query.category, severity: query.severity, readStatus: query.read_status, scopeType: query.scope_type },
    });
    result.meta.filters.unread_count = String(unreadCount);
    return sendPaginated(request, 'Lấy danh sách thông báo hệ thống thành công', result);
  });

  app.post('/api/notifications', { preHandler: requirePermission('notification.send', 'comms.manage') }, async (request, reply) => {
    const body = zCreateNotificationBody.parse(request.body), actorId = request.auth!.user.id;
    const pickedUsers = body.recipient_user_ids.length ? body.recipient_user_ids : (body.recipient_user_id && body.recipient_user_id !== 'ALL' ? [body.recipient_user_id] : []);
    const pickedRoles = (body.recipient_roles.length ? body.recipient_roles : (body.recipient_role && body.recipient_role !== 'ALL' ? [body.recipient_role] : [])).filter((r) => ROLES.includes(r as Role));
    if (body.target_scope === 'USER' && !pickedUsers.length) throw Errors.badRequest('Vui lòng chọn ít nhất 1 cá nhân nhận thông báo');
    if (body.target_scope === 'ROLE' && !pickedRoles.length) throw Errors.badRequest('Vui lòng chọn ít nhất 1 nhóm nhân sự nhận thông báo');
    const recipientUserId = body.target_scope === 'USER' ? pickedUsers.join(',') : body.target_scope === 'ALL' ? 'ALL' : '';
    const recipientRole = body.target_scope === 'ROLE' ? pickedRoles.join(',') : body.target_scope === 'ALL' ? 'ALL' : '';
    const created = await ctx.db.notifications.insert({ recipient_user_id: recipientUserId, recipient_role: recipientRole, branch_id: 'ALL', category: body.category, title: body.title, body: body.body, link: body.link || '/dashboard', severity: body.severity, read_at: '', entity_type: 'MANUAL', entity_id: '' }, actorId);
    const payload = { kind: 'ANNOUNCEMENT', id: created.id, code: 'NTF', title: created.title, summary: created.body, priority: created.severity === 'CRITICAL' ? 'URGENT' : 'NORMAL' };
    if (body.target_scope === 'USER') pickedUsers.forEach((uid) => ctx.realtime()?.toUser(uid, SocketEvents.NOTIFICATION, payload));
    else if (body.target_scope === 'ROLE') pickedRoles.forEach((r) => ctx.realtime()?.toRole(r, SocketEvents.NOTIFICATION, payload));
    else ctx.realtime()?.broadcast(SocketEvents.NOTIFICATION, payload);
    const mailUsers = ctx.db.users.filter((u) => u.status === 'ACTIVE' && u.id !== actorId && (body.target_scope === 'ALL' || (body.target_scope === 'USER' && pickedUsers.includes(u.id)) || (body.target_scope === 'ROLE' && pickedRoles.includes(u.role))));
    const seenEmails = new Set<string>(), origin = webOrigin(ctx);
    mailUsers.forEach((u) => {
      const to = resolveUserPersonalRealEmail(ctx, u);
      if (!to || seenEmails.has(to)) return;
      seenEmails.add(to);
      ctx.email.enqueue({ to, template: 'INTERNAL_ANNOUNCEMENT', recipientName: u.display_name || u.username, referenceCode: `NTF-${created.id.slice(0, 6)}`, summary: created.body, metadata: [{ label: 'Tiêu đề', value: created.title }, { label: 'Phân loại', value: NOTIFICATION_CATEGORY_LABELS[created.category] ?? created.category }, { label: 'Mức độ', value: NOTIFICATION_SEVERITY_LABELS[created.severity] ?? created.severity }], actionLabel: 'Xem thông báo trên hệ thống', actionUrl: `${origin}${resolveNotificationLinkForRole(created, u.role as Role)}` });
    });
    if (seenEmails.size > 0) void ctx.email.processQueueBatch(Math.min(6, seenEmails.size));
    return reply.code(201), sendSuccess(request, 'Đã gửi thông báo thành công', created);
  });
  const handleMarkRead = async (request: FastifyRequest) => {
    const { id } = request.params as { id: string }, userId = request.auth!.user.id, notif = ctx.db.notifications.get(id);
    if (!notif) throw Errors.notFound('Thông báo', id);
    const map = parseReadMap(notif.read_at); if (!map[userId]) map[userId] = nowIso();
    const updated = await ctx.db.notifications.update(id, notif.version, { read_at: JSON.stringify(map) }, userId);
    return sendSuccess(request, 'Đã đánh dấu đã đọc thông báo', { ...updated, read_at: map[userId] });
  };
  app.patch('/api/notifications/:id/read', { preHandler: requireAuth() }, handleMarkRead);
  app.post('/api/notifications/:id/read', { preHandler: requireAuth() }, handleMarkRead);
  app.post('/api/notifications/mark-all-read', { preHandler: requireAuth() }, async (request) => {
    const body = zBulkIdsBody.parse(request.body ?? {}), user = request.auth!.user, now = nowIso();
    const targets = ctx.db.notifications.all().filter((n) => !getUserReadAt(n.read_at, user.id) && (!body.ids?.length || body.ids.includes(n.id)));
    if (targets.length > 0) {
      const patches = targets.map((n) => { const map = parseReadMap(n.read_at); map[user.id] = now; return { id: n.id, expectedVersion: n.version, patch: { read_at: JSON.stringify(map) } }; });
      await ctx.db.notifications.batchUpdate(patches, user.id);
    }
    return sendSuccess(request, `Đã đánh dấu đã đọc ${targets.length} thông báo`, { updatedCount: targets.length });
  });
  app.delete('/api/notifications/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, notif = ctx.db.notifications.get(id);
    if (!notif) throw Errors.notFound('Thông báo', id);
    await ctx.db.notifications.softDelete(id, notif.version, request.auth!.user.id);
    return sendSuccess(request, 'Đã xóa thông báo thành công', { id });
  });
}
