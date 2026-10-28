import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_SHIFT_LABELS, ROLE_LABELS, ROLES, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { doesUserMatchAudience, getMatchingUsersForAudience } from './job-positions-and-audiences.routes.js';

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

async function ensureSyncedNotifications(ctx: AppContext, actorId: string) {
  const existing = ctx.db.notifications.all(true), users = ctx.db.users.all();
  const hasKey = (type: string, id: string) => existing.some((n) => n.entity_type === type && n.entity_id === id);
  const findUserByEmp = (empId: string) => users.find((u) => u.employee_id === empId);
  const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;
  const ins = (data: Omit<Parameters<typeof ctx.db.notifications.insert>[0], 'read_at'>) => ctx.db.notifications.insert({ ...data, read_at: '' }, actorId);
  for (const anc of ctx.db.announcements.all()) {
    if (anc.status === 'SENT' && !hasKey('ANNOUNCEMENTS', anc.id)) {
      let target = 'ALL';
      try { target = JSON.parse(anc.audience_json || '{}').target || 'ALL'; } catch { target = 'ALL'; }
      const isGlobal = !anc.audience_scope || (anc.audience_scope === 'ALL' && target === 'ALL');
      const matched = isGlobal ? [] : getMatchingUsersForAudience(ctx, anc.audience_scope || 'ALL', anc.audience_json || target);
      await ins({ recipient_user_id: isGlobal ? 'ALL' : (matched.map((u) => u.id).join(',') || 'NONE'), recipient_role: isGlobal ? 'ALL' : (anc.audience_scope === 'STAGE' ? (target === 'PROBATION' || target === 'THU_VIEC' ? 'THU_VIEC' : 'CHINH_THUC') : ''), branch_id: anc.audience_scope === 'BRANCH' ? target : 'ALL', category: 'ANNOUNCEMENT', title: anc.title, body: anc.summary || anc.title, link: '/admin/integrations?section=comms', severity: anc.priority === 'URGENT' ? 'CRITICAL' : anc.priority === 'HIGH' ? 'WARNING' : 'INFO', entity_type: 'ANNOUNCEMENTS', entity_id: anc.id });
    }
  }
  for (const u of users) {
    if (u.status === 'PENDING_ACTIVATION' && !hasKey('USERS_PENDING', u.id)) {
      await ins({ recipient_user_id: '', recipient_role: 'ADMIN', branch_id: 'ALL', category: 'SYSTEM', title: `Tài khoản mới chờ kích hoạt: ${u.display_name || u.username}`, body: `Tài khoản @${u.username} (${ROLE_LABELS[u.role as Role] ?? u.role}) đang chờ Quản trị viên phê duyệt kích hoạt.`, link: '/admin/accounts?status=PENDING_ACTIVATION', severity: 'WARNING', entity_type: 'USERS_PENDING', entity_id: u.id });
    }
  }
  for (const l of ctx.db.leaveRequests.all().slice(0, 15)) {
    const code = l.request_code || l.id, empUser = findUserByEmp(l.employee_id), empKey = `${l.id}_${l.status}`;
    if (l.status === 'PENDING' && !hasKey('LEAVE_ROLE', l.id)) {
      await ins({ recipient_user_id: '', recipient_role: 'HR,STORE', branch_id: l.branch_id || 'ALL', category: 'WORKFLOW', title: `Đơn xin nghỉ phép (OFF) chờ duyệt: ${code}`, body: `Đơn nghỉ ngày ${l.leave_date} — Lý do: ${l.reason || 'Nghỉ phép cá nhân'}.`, link: '/admin/schedules?section=workflows', severity: 'WARNING', entity_type: 'LEAVE_ROLE', entity_id: l.id });
    }
    if (empUser && !hasKey('LEAVE_USER', empKey)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: l.branch_id || 'ALL', category: 'WORKFLOW', title: l.status === 'APPROVED' ? `Đơn xin nghỉ OFF (${l.leave_date}) đã được phê duyệt` : l.status === 'REJECTED' ? `Đơn xin nghỉ OFF (${l.leave_date}) bị từ chối` : `Đã tiếp nhận đơn xin nghỉ OFF (${l.leave_date})`, body: `Mã đơn: ${code} · Ngày nghỉ: ${l.leave_date} · Lý do: ${l.reason || 'Cá nhân'}.`, link: '/nv/lich', severity: l.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'LEAVE_USER', entity_id: empKey });
    }
  }
  for (const s of ctx.db.shiftSwaps.all().slice(0, 10)) {
    if (!hasKey('SWAP_STORE', s.id)) await ins({ recipient_user_id: '', recipient_role: 'HR,STORE', branch_id: s.branch_id || 'ALL', category: 'WORKFLOW', title: `Yêu cầu đổi ca 3 bước (${s.swap_code || s.id})`, body: `Yêu cầu đổi ca ngày ${s.from_work_date} đang ở trạng thái ${s.status === 'APPROVED' ? 'Đã phê duyệt' : s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ duyệt' : 'Chờ xử lý'}.`, link: '/admin/schedules?section=workflows', severity: s.status === 'PEER_ACCEPTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_STORE', entity_id: s.id });
    const reqUser = findUserByEmp(s.requester_id), peerUser = findUserByEmp(s.peer_id), swapKey = `${s.id}_${s.status}`;
    if ((reqUser || peerUser) && !hasKey('SWAP_USER', swapKey)) await ins({ recipient_user_id: [reqUser?.id, peerUser?.id].filter(Boolean).join(','), recipient_role: '', branch_id: s.branch_id || 'ALL', category: 'WORKFLOW', title: `Cập nhật yêu cầu đổi ca (${s.swap_code || s.id})`, body: `Đổi ca ngày ${s.from_work_date} (${shiftLabel(s.from_shift_code)}): ${s.status === 'APPROVED' ? 'Đã được Quản lý phê duyệt & cập nhật lịch chính thức' : s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ Quản lý duyệt' : s.status === 'REJECTED' ? 'Đã bị từ chối' : 'Chờ đồng nghiệp xác nhận'}.`, link: '/nv/doi-ca', severity: s.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_USER', entity_id: swapKey });
  }
  for (const iv of ctx.db.interviews.all().slice(0, 10)) {
    if (iv.status !== 'CANCELLED' && !hasKey('INTERVIEW_HR', iv.id)) {
      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      await ins({ recipient_user_id: '', recipient_role: 'HR', branch_id: iv.branch_id || 'ALL', category: 'HR', title: `Lịch phỏng vấn ứng viên: ${cand?.full_name ?? iv.candidate_id}`, body: `Thời gian: ${String(iv.start_at).slice(0, 16).replace('T', ' ')} · Trạng thái: ${iv.reschedule_requested ? 'Ứng viên xin đổi lịch' : iv.decision === 'PENDING' ? 'Chờ chấm điểm phỏng vấn' : 'Đã đánh giá'}.`, link: '/admin/employees?section=recruitment&sub=interviews', severity: iv.reschedule_requested ? 'WARNING' : 'INFO', entity_type: 'INTERVIEW_HR', entity_id: iv.id });
    }
  }
  for (const e of ctx.db.employees.all().filter((x) => x.stage === 'PROBATION').slice(0, 8)) {
    if (!hasKey('PROBATION_HR', e.id)) await ins({ recipient_user_id: '', recipient_role: 'HR', branch_id: e.branch_id || 'ALL', category: 'HR', title: `Theo dõi thử việc & xét chính thức: ${e.full_name} (${e.employee_code})`, body: `Chu kỳ thử việc từ ${e.probation_start || '—'} đến ${e.probation_end || '—'} — Kiểm tra giờ công tích lũy và kết quả bài TEST.`, link: '/admin/employees?stage=PROBATION', severity: 'INFO', entity_type: 'PROBATION_HR', entity_id: e.id });
  }
  for (const att of ctx.db.testAttempts.all().filter((x) => Boolean(x.submitted_at)).slice(0, 8)) {
    if (!hasKey('TEST_HR', att.id)) {
      const emp = ctx.db.employees.get(att.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === att.employee_id);
      await ins({ recipient_user_id: '', recipient_role: 'HR', branch_id: emp?.branch_id || 'ALL', category: 'HR', title: `Kết quả bài thi TEST nghiệp vụ: ${emp?.full_name ?? att.employee_id}`, body: `Điểm đạt được: ${att.score_percent}% (${att.passed ? 'ĐẠT yêu cầu' : 'Chưa đạt — Cần ôn tập thi lại'}).`, link: '/admin/employees?section=tests', severity: att.passed ? 'INFO' : 'WARNING', entity_type: 'TEST_HR', entity_id: att.id });
    }
  }
  for (const adj of ctx.db.attendanceAdjustments.all().filter((x) => x.status === 'PENDING' || x.status === 'STORE_CONFIRMED').slice(0, 8)) {
    if (!hasKey('ATT_ADJ_HR', adj.id)) await ins({ recipient_user_id: '', recipient_role: 'HR,STORE,FINANCE', branch_id: adj.branch_id || 'ALL', category: 'ATTENDANCE', title: `Phiếu bổ sung / lỗi chấm công chờ chốt: ${adj.adjustment_code}`, body: `Ngày công ${adj.work_date} (${adj.requested_hours}h) — Lý do: ${adj.reason}.`, link: '/admin/schedules?section=workflows', severity: 'WARNING', entity_type: 'ATT_ADJ_HR', entity_id: adj.id });
  }
  for (const emg of ctx.db.emergencyLeaves.all().slice(0, 6)) {
    if (!hasKey('EMG_STORE', emg.id)) await ins({ recipient_user_id: '', recipient_role: 'HR,STORE', branch_id: emg.branch_id || 'ALL', category: 'WORKFLOW', title: `Cảnh báo nghỉ đột xuất & thiếu người: ${emg.emergency_code}`, body: `${shiftLabel(emg.shift_code)} ngày ${emg.work_date} — Lý do: ${emg.reason}. Cần tìm người thay hoặc báo HR.`, link: '/admin/schedules?section=workflows', severity: 'CRITICAL', entity_type: 'EMG_STORE', entity_id: emg.id });
  }
  for (const a of ctx.db.shiftAssignments.all().filter((x) => x.status === 'ABSENT' || x.status === 'PUBLISHED').slice(0, 6)) {
    if (!hasKey('SCHED_STORE', `${a.id}_${a.status}`)) await ins({ recipient_user_id: '', recipient_role: 'STORE', branch_id: a.branch_id || 'ALL', category: a.status === 'ABSENT' ? 'ATTENDANCE' : 'WORKFLOW', title: a.status === 'ABSENT' ? `Cảnh báo NV chưa điểm danh / Vắng mặt ca ngày ${a.work_date}` : `Lịch tuần mới đã phát hành (${a.work_date})`, body: `${shiftLabel(a.shift_code)} (${a.start_at}–${a.end_at}) tại chi nhánh phụ trách.`, link: '/admin/schedules', severity: a.status === 'ABSENT' ? 'WARNING' : 'INFO', entity_type: 'SCHED_STORE', entity_id: `${a.id}_${a.status}` });
  }
  for (const p of ctx.db.payPeriods.all().slice(0, 8)) {
    if (!hasKey('PAY_PERIOD_FIN', p.id)) await ins({ recipient_user_id: '', recipient_role: 'FINANCE', branch_id: 'ALL', category: 'PAYROLL', title: `Kỳ lương hệ thống: ${p.name} (${p.period_code || p.id})`, body: `Chu kỳ lương từ ${p.from_date} đến ${p.to_date} (${p.total_employees} NV, ${p.total_approved_hours}h công)${p.unreconciled_records_count > 0 ? ` — Cảnh báo: còn ${p.unreconciled_records_count} nhân sự lỗi tính lương / thiếu hồ sơ lương cần xử lý` : ' — Bảng lương sẵn sàng đối soát & phê duyệt'}.`, link: '/admin/payroll', severity: p.unreconciled_records_count > 0 ? 'WARNING' : 'INFO', entity_type: 'PAY_PERIOD_FIN', entity_id: p.id });
  }
  for (const ps of ctx.db.payslips.all().slice(0, 15)) {
    const empUser = findUserByEmp(ps.employee_id);
    if (empUser && !hasKey('PAYSLIP_USER', ps.id)) await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: ps.branch_id || 'ALL', category: 'PAYROLL', title: `Phiếu lương cá nhân đã phát hành: ${ps.period_name || ps.payslip_code}`, body: `Thực lĩnh (NET): ${Number(ps.net_vnd || 0).toLocaleString('vi-VN')}đ — Vui lòng kiểm tra chi tiết và xác nhận phiếu lương.`, link: '/nv/phieu-luong', severity: 'INFO', entity_type: 'PAYSLIP_USER', entity_id: ps.id });
  }
  for (const anc of ctx.db.announcements.all().filter((x) => x.status === 'DRAFT' || x.status === 'SCHEDULED' || x.status === 'FAILED').slice(0, 8)) {
    const mktKey = `${anc.id}_${anc.status}`;
    if (!hasKey('MKT_ANC', mktKey)) {
      const title = anc.status === 'FAILED' ? `Cảnh báo lỗi phát tin: ${anc.title}` : anc.status === 'SCHEDULED' ? `Lịch phát thông báo sắp tới: ${anc.title}` : `Nội dung bản nháp chờ duyệt phát: ${anc.title}`;
      const body = anc.status === 'FAILED' ? `Bản tin ${anc.code} gặp lỗi trong quá trình gửi — Vui lòng kiểm tra và thử gửi lại.` : anc.status === 'SCHEDULED' ? `Bản tin ${anc.code} đã đặt lịch phát vào ${anc.scheduled_at || 'khung giờ dự kiến'}.` : `Bản tin ${anc.code} đang lưu nháp (DRAFT) chờ kiểm duyệt và phát hành.`;
      await ins({ recipient_user_id: '', recipient_role: 'MKT', branch_id: 'ALL', category: 'ANNOUNCEMENT', title, body, link: '/admin/integrations?section=comms', severity: anc.status === 'FAILED' ? 'CRITICAL' : anc.status === 'DRAFT' ? 'WARNING' : 'INFO', entity_type: 'MKT_ANC', entity_id: mktKey });
    }
  }
  for (const dlv of ctx.db.deliveryLogs.all().filter((x) => x.status === 'FAILED').slice(0, 6)) {
    if (!hasKey('MKT_DLV_ERR', dlv.id)) await ins({ recipient_user_id: '', recipient_role: 'MKT', branch_id: 'ALL', category: 'ANNOUNCEMENT', title: `Lỗi gửi thông báo tới người nhận (${dlv.channel})`, body: `Lượt gửi #${dlv.id} thất bại (Đã thử ${dlv.attempts} lần) — Lỗi: ${dlv.last_error || 'Mất kết nối kênh nhận'}.`, link: '/admin/integrations?section=comms', severity: 'WARNING', entity_type: 'MKT_DLV_ERR', entity_id: dlv.id });
  }
}

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
    await ensureSyncedNotifications(ctx, user.id);

    const usersMap = new Map(ctx.db.users.all().map((u) => [u.id, u]));
    const ancsMap = new Map(ctx.db.announcements.all().map((a) => [a.id, a]));
    const splitCsv = (raw: string) => (raw || '').split(',').map((s) => s.trim()).filter(Boolean);

    const visible = ctx.db.notifications.all().filter((n) => {
      if (user.role === 'ADMIN' || n.created_by === user.id) return true;
      if (n.entity_type === 'ANNOUNCEMENTS' && n.entity_id) {
        const anc = ancsMap.get(n.entity_id);
        if (anc) return doesUserMatchAudience(ctx, user, anc.audience_scope || 'ALL', anc.audience_json);
      }
      const userIds = splitCsv(n.recipient_user_id), roles = splitCsv(n.recipient_role);
      if (userIds.includes('NONE')) return false;
      const isPersonal = userIds.includes(user.id);
      if (userIds.length > 0 && !userIds.includes('ALL')) return isPersonal;
      const inBranch = branchScope === 'ALL' || !n.branch_id || n.branch_id === 'ALL' || branchScope.includes(n.branch_id);
      if (!inBranch) return false;
      if (roles.length > 0 && !roles.includes('ALL')) return roles.includes(user.role);
      return userIds.includes('ALL') || roles.includes('ALL');
    });

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
        ...n, body: n.body.replace(/^Mã:\s*[A-Z0-9_]+\s*\([^)]+\)\s*·\s*/i, ''), read_at: userReadAt, code: anc?.code || `NTF-${String(idx + 1).padStart(4, '0')}`,
        categoryLabel: NOTIFICATION_CATEGORY_LABELS[n.category] ?? n.category, severityLabel: NOTIFICATION_SEVERITY_LABELS[n.severity] ?? n.severity,
        scopeType, targetLabel, readStatus, readStatusLabel: userReadAt ? 'Đã đọc' : 'Chưa đọc', detailHtml: anc?.body || `<p>${n.body.replace(/^Mã:\s*[A-Z0-9_]+\s*\([^)]+\)\s*·\s*/i, '')}</p>`,
      };
    });

    const result = paginateAndSort(enriched, {
      page: query.page, perPage: query.per_page, sortBy: query.sort_by, sortOrder: query.sort_order, defaultSortBy: 'created_at',
      allowedSortFields: ['created_at', 'severity', 'title', 'category', 'readStatus'], q: query.q,
      searchExtractor: (item) => [item.code, item.title, item.body, item.categoryLabel, item.targetLabel],
      filters: { category: query.category, severity: query.severity, readStatus: query.read_status, scopeType: query.scope_type },
    });
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
    const mailUsers = ctx.db.users.filter((u) => u.status === 'ACTIVE' && (body.target_scope === 'ALL' || (body.target_scope === 'USER' && pickedUsers.includes(u.id)) || (body.target_scope === 'ROLE' && pickedRoles.includes(u.role))));
    mailUsers.forEach((u) => ctx.email.enqueue({ to: u.email || `${u.username}@umbomilk.vn`, template: 'INTERNAL_ANNOUNCEMENT', recipientName: u.display_name || u.username, referenceCode: `NTF-${created.id.slice(0, 6)}`, summary: created.body, metadata: [{ label: 'Tiêu đề', value: created.title }, { label: 'Phân loại', value: NOTIFICATION_CATEGORY_LABELS[created.category] ?? created.category }, { label: 'Mức độ', value: NOTIFICATION_SEVERITY_LABELS[created.severity] ?? created.severity }] }));
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
    for (const n of targets) { const map = parseReadMap(n.read_at); map[user.id] = now; await ctx.db.notifications.update(n.id, n.version, { read_at: JSON.stringify(map) }, user.id); }
    return sendSuccess(request, `Đã đánh dấu đã đọc ${targets.length} thông báo`, { updatedCount: targets.length });
  });
  app.delete('/api/notifications/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, notif = ctx.db.notifications.get(id);
    if (!notif) throw Errors.notFound('Thông báo', id);
    await ctx.db.notifications.softDelete(id, notif.version, request.auth!.user.id);
    return sendSuccess(request, 'Đã xóa thông báo thành công', { id });
  });
}
