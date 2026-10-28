import { DEFAULT_SHIFT_LABELS, ROLE_LABELS, type NotificationRow, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { getMatchingUsersForAudience } from '../routes/job-positions-and-audiences.routes.js';
import { singleFlight, tolerantWrite } from './background-write.js';

const syncInFlight = new WeakMap<object, Promise<void>>();
const SYNC_ACTOR = 'system-sync';

export function ensureSyncedNotifications(ctx: AppContext): Promise<void> {
  return singleFlight(syncInFlight, ctx.db, () => runSyncNotifications(ctx));
}

async function deduplicateAdjustmentsAndNotifications(ctx: AppContext): Promise<void> {
  const empByCode = new Map(ctx.db.employees.all().map((e) => [e.employee_code, e.id]));
  const seenAdjKeys = new Set<string>();
  for (const adj of ctx.db.attendanceAdjustments.all()) {
    if (adj.status === 'REJECTED') continue;
    const eid = empByCode.get(adj.employee_id) ?? adj.employee_id;
    const key = adj.assignment_id ? `asg:${adj.assignment_id}` : `emp:${eid}:${adj.work_date}:${adj.shift_code}`;
    if (seenAdjKeys.has(key)) {
      await tolerantWrite(() => ctx.db.attendanceAdjustments.softDelete(adj.id, adj.version, SYNC_ACTOR));
    } else {
      seenAdjKeys.add(key);
    }
  }

  const seenNotifKeys = new Set<string>();
  for (const n of ctx.db.notifications.all()) {
    const isOrphanAdj = n.entity_type === 'ATT_ADJ_HR' && n.entity_id && !ctx.db.attendanceAdjustments.get(n.entity_id);
    const isSelfPendingLeave = n.entity_type === 'LEAVE_USER' && n.title.includes('Đã tiếp nhận');
    const entKey = n.entity_type && n.entity_id ? `ent:${n.entity_type}:${n.entity_id}` : '';
    const txtKey = `txt:${n.category}:${n.recipient_role}:${n.recipient_user_id}:${n.title}`;
    if (isOrphanAdj || isSelfPendingLeave || (entKey && seenNotifKeys.has(entKey)) || seenNotifKeys.has(txtKey)) {
      await tolerantWrite(() => ctx.db.notifications.softDelete(n.id, n.version, SYNC_ACTOR));
      continue;
    }
    if (entKey) seenNotifKeys.add(entKey);
    seenNotifKeys.add(txtKey);
  }
}

async function runSyncNotifications(ctx: AppContext): Promise<void> {
  await deduplicateAdjustmentsAndNotifications(ctx);
  const users = ctx.db.users.all();
  const seenKeys = new Set<string>();
  for (const n of ctx.db.notifications.all(true)) {
    if (!n.is_deleted) {
      if (n.entity_type && n.entity_id) seenKeys.add(`${n.entity_type}:${n.entity_id}`);
      seenKeys.add(`title:${n.recipient_role}:${n.recipient_user_id}:${n.title}`);
    }
  }
  const hasKey = (type: string, id: string, role = '', uid = '', title = '') =>
    seenKeys.has(`${type}:${id}`) || (Boolean(title) && seenKeys.has(`title:${role}:${uid}:${title}`));
  const findUserByEmp = (empId: string) => {
    const emp = ctx.db.employees.get(empId) ?? ctx.db.employees.find((e) => e.employee_code === empId);
    return (emp?.user_id ? ctx.db.users.get(emp.user_id) : undefined) ?? users.find((u) => u.employee_id === empId || (emp && u.employee_id === emp.employee_code));
  };
  const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;
  const ins = async (data: Omit<Parameters<typeof ctx.db.notifications.insert>[0], 'read_at'>) => {
    if (hasKey(data.entity_type, data.entity_id, data.recipient_role, data.recipient_user_id, data.title)) return;
    seenKeys.add(`${data.entity_type}:${data.entity_id}`);
    seenKeys.add(`title:${data.recipient_role}:${data.recipient_user_id}:${data.title}`);
    await tolerantWrite(() => ctx.db.notifications.insert({ ...data, read_at: '' }, SYNC_ACTOR));
  };

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
    if (empUser && (l.status === 'APPROVED' || l.status === 'REJECTED') && empUser.id !== l.decided_by && !hasKey('LEAVE_USER', empKey)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: l.branch_id || 'ALL', category: 'WORKFLOW', title: l.status === 'APPROVED' ? `Đơn xin nghỉ OFF (${l.leave_date}) đã được phê duyệt` : `Đơn xin nghỉ OFF (${l.leave_date}) bị từ chối`, body: `Mã đơn: ${code} · Ngày nghỉ: ${l.leave_date} · Lý do: ${l.decision_reason || l.reason || 'Cá nhân'}.`, link: '/nv/nghi-phep', severity: l.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'LEAVE_USER', entity_id: empKey });
    }
  }
  for (const s of ctx.db.shiftSwaps.all().slice(0, 10)) {
    if ((s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && !hasKey('SWAP_STORE', s.id)) {
      await ins({ recipient_user_id: '', recipient_role: 'HR,STORE', branch_id: s.branch_id || 'ALL', category: 'WORKFLOW', title: `Yêu cầu đổi ca 3 bước (${s.swap_code || s.id})`, body: `Yêu cầu đổi ca ngày ${s.from_work_date} đang ở trạng thái ${s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ duyệt' : 'Chờ xử lý'}.`, link: '/admin/schedules?section=workflows', severity: s.status === 'PEER_ACCEPTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_STORE', entity_id: s.id });
    }
    const reqUser = findUserByEmp(s.requester_id), peerUser = findUserByEmp(s.peer_id), swapKey = `${s.id}_${s.status}`;
    const targetIds = s.status === 'PENDING_PEER' ? [peerUser?.id] : (s.status === 'PEER_ACCEPTED' || s.status === 'PEER_DECLINED') ? [reqUser?.id] : [reqUser?.id, peerUser?.id].filter((id) => id !== s.decided_by);
    const cleanTargetIds = targetIds.filter(Boolean).join(',');
    if (cleanTargetIds && !hasKey('SWAP_USER', swapKey)) {
      await ins({ recipient_user_id: cleanTargetIds, recipient_role: '', branch_id: s.branch_id || 'ALL', category: 'WORKFLOW', title: `Cập nhật yêu cầu đổi ca (${s.swap_code || s.id})`, body: `Đổi ca ngày ${s.from_work_date} (${shiftLabel(s.from_shift_code)}): ${s.status === 'APPROVED' ? 'Đã được Quản lý phê duyệt & cập nhật lịch chính thức' : s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ Quản lý duyệt' : s.status === 'REJECTED' || s.status === 'PEER_DECLINED' ? 'Đã bị từ chối' : 'Đồng nghiệp nhờ bạn nhận ca thay'}.`, link: '/nv/doi-ca', severity: s.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_USER', entity_id: swapKey });
    }
  }
  for (const iv of ctx.db.interviews.all().slice(0, 10)) {
    if (iv.status !== 'CANCELLED' && !hasKey('INTERVIEW_HR', iv.id)) {
      const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
      await ins({ recipient_user_id: '', recipient_role: 'HR', branch_id: iv.branch_id || 'ALL', category: 'HR', title: `Lịch phỏng vấn ứng viên: ${cand?.full_name ?? iv.candidate_id}`, body: `Thời gian: ${String(iv.start_at).slice(0, 16).replace('T', ' ')} · Trạng thái: ${iv.reschedule_requested ? 'Ứng viên xin đổi lịch' : iv.decision === 'PENDING' ? 'Chờ chấm điểm phỏng vấn' : 'Đã đánh giá'}.`, link: '/admin/employees?section=recruitment&sub=interviews', severity: iv.reschedule_requested ? 'WARNING' : 'INFO', entity_type: 'INTERVIEW_HR', entity_id: iv.id });
    }
  }
  for (const adj of ctx.db.attendanceAdjustments.all().slice(0, 12)) {
    if ((adj.status === 'PENDING' || adj.status === 'STORE_CONFIRMED') && !hasKey('ATT_ADJ_HR', adj.id)) {
      await ins({ recipient_user_id: '', recipient_role: 'HR,STORE,FINANCE', branch_id: adj.branch_id || 'ALL', category: 'ATTENDANCE', title: `Phiếu bổ sung / lỗi chấm công chờ chốt: ${adj.adjustment_code}`, body: `Ngày công ${adj.work_date} (${adj.requested_hours}h) — Lý do: ${adj.reason}.`, link: '/admin/schedules?section=workflows', severity: 'WARNING', entity_type: 'ATT_ADJ_HR', entity_id: adj.id });
    }
    const empUser = findUserByEmp(adj.employee_id), adjUserKey = `${adj.id}_${adj.status}`;
    if (empUser && (adj.status === 'APPROVED' || adj.status === 'REJECTED') && empUser.id !== adj.decided_by && !hasKey('ATT_ADJ_USER', adjUserKey)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: adj.branch_id || 'ALL', category: 'ATTENDANCE', title: adj.status === 'APPROVED' ? `Phiếu bổ sung công (${adj.adjustment_code}) đã được phê duyệt` : `Phiếu bổ sung công (${adj.adjustment_code}) bị từ chối`, body: `Ngày công ${adj.work_date} (${adj.requested_hours}h) — ${adj.decision_reason || adj.reason}.`, link: '/nv/cong', severity: adj.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'ATT_ADJ_USER', entity_id: adjUserKey });
    }
  }
  for (const emg of ctx.db.emergencyLeaves.all().slice(0, 6)) {
    if (!hasKey('EMG_STORE', emg.id)) await ins({ recipient_user_id: '', recipient_role: 'HR,STORE', branch_id: emg.branch_id || 'ALL', category: 'WORKFLOW', title: `Cảnh báo nghỉ đột xuất & thiếu người: ${emg.emergency_code}`, body: `${shiftLabel(emg.shift_code)} ngày ${emg.work_date} — Lý do: ${emg.reason}. Cần tìm người thay hoặc báo HR.`, link: '/admin/schedules?section=workflows', severity: 'CRITICAL', entity_type: 'EMG_STORE', entity_id: emg.id });
  }
  for (const ps of ctx.db.payslips.all().slice(0, 15)) {
    const empUser = findUserByEmp(ps.employee_id);
    if (empUser && !hasKey('PAYSLIP_USER', ps.id)) await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: ps.branch_id || 'ALL', category: 'PAYROLL', title: `Phiếu lương cá nhân đã phát hành: ${ps.period_name || ps.payslip_code}`, body: `Thực lĩnh (NET): ${Number(ps.net_vnd || 0).toLocaleString('vi-VN')}đ — Vui lòng kiểm tra chi tiết và xác nhận phiếu lương.`, link: '/nv/phieu-luong', severity: 'INFO', entity_type: 'PAYSLIP_USER', entity_id: ps.id });
  }
}

/**
 * Kiểm tra xem thông báo này có phải được sinh ra từ chính hành động / yêu cầu của người dùng `userId` hay không.
 * Người tạo yêu cầu tuyệt đối không nhận thông báo "chờ duyệt / chờ chốt" cho chính yêu cầu mình vừa gửi.
 */
export function isNotificationCreatedByOrSelfAction(ctx: AppContext, n: NotificationRow, userId: string): boolean {
  const myEmp = ctx.db.employees.find((e) => e.user_id === userId);
  const isMyEmp = (eid?: string) => Boolean(eid && myEmp && (eid === myEmp.id || eid === myEmp.employee_code));

  if (n.entity_type === 'ATT_ADJ_HR') {
    const adj = ctx.db.attendanceAdjustments.get(n.entity_id);
    return !adj || adj.created_by === userId || isMyEmp(adj.employee_id);
  }
  if (n.entity_type === 'ATT_ADJ_USER') {
    const adj = ctx.db.attendanceAdjustments.get(n.entity_id.split('_')[0] || '');
    return !adj || adj.decided_by === userId;
  }
  if (n.entity_type === 'LEAVE_ROLE') {
    const l = ctx.db.leaveRequests.get(n.entity_id);
    return !l || l.created_by === userId || isMyEmp(l.employee_id);
  }
  if (n.entity_type === 'LEAVE_USER') {
    if (n.title.includes('Đã tiếp nhận')) return true;
    const l = ctx.db.leaveRequests.get(n.entity_id.split('_')[0] || '');
    return !l || l.decided_by === userId;
  }
  if (n.entity_type === 'SWAP_STORE') {
    const s = ctx.db.shiftSwaps.get(n.entity_id);
    return !s || s.created_by === userId || isMyEmp(s.requester_id);
  }
  if (n.entity_type === 'SWAP_USER') {
    const s = ctx.db.shiftSwaps.get(n.entity_id.split('_')[0] || '');
    if (!s) return true;
    if (n.entity_id.endsWith('_PENDING_PEER') && (s.created_by === userId || isMyEmp(s.requester_id))) return true;
    if ((n.entity_id.endsWith('_PEER_ACCEPTED') || n.entity_id.endsWith('_PEER_DECLINED')) && isMyEmp(s.peer_id)) return true;
    if ((n.entity_id.endsWith('_APPROVED') || n.entity_id.endsWith('_REJECTED')) && s.decided_by === userId) return true;
    return false;
  }
  if (n.entity_type === 'EMG_STORE') {
    const emg = ctx.db.emergencyLeaves.get(n.entity_id);
    return !emg || emg.created_by === userId || isMyEmp(emg.employee_id);
  }
  if (n.entity_type === 'SCHED_STORE') {
    const a = ctx.db.shiftAssignments.get(n.entity_id.split('_')[0] || '');
    return !a || a.created_by === userId || isMyEmp(a.employee_id);
  }
  if (n.entity_type === 'USERS_PENDING') return n.entity_id === userId;
  return false;
}
