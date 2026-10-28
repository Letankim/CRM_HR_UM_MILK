import { DEFAULT_SHIFT_LABELS, ROLE_LABELS, type NotificationRow, type Role } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { getMatchingUsersForAudience } from '../routes/job-positions-and-audiences.routes.js';
import { singleFlight, tolerantWrite } from './background-write.js';

const syncInFlight = new WeakMap<object, Promise<void>>();
const lastSyncSig = new WeakMap<object, string>();
const SYNC_ACTOR = 'system-sync';

function computeSyncSig(ctx: AppContext): string {
  const sumV = (rows: { version: number }[]) => rows.reduce((acc, r) => acc + r.version, rows.length * 97);
  return [ctx.db.announcements, ctx.db.users, ctx.db.shiftAssignments, ctx.db.leaveRequests, ctx.db.shiftSwaps, ctx.db.attendanceAdjustments, ctx.db.emergencyLeaves, ctx.db.payslips].map((s) => sumV(s.all())).join(':');
}

export function ensureSyncedNotifications(ctx: AppContext): Promise<void> {
  if (lastSyncSig.get(ctx.db) === computeSyncSig(ctx)) return Promise.resolve();
  return singleFlight(syncInFlight, ctx.db, () => runSyncNotifications(ctx));
}

async function deduplicateAdjustmentsAndNotifications(ctx: AppContext): Promise<void> {
  const empByCode = new Map(ctx.db.employees.all().map((e) => [e.employee_code, e.id]));
  const seenAdjKeys = new Set<string>();
  const adjDeletes: { id: string; expectedVersion: number; patch: { is_deleted: boolean } }[] = [];
  for (const adj of [...ctx.db.attendanceAdjustments.all()].reverse()) {
    if (adj.status === 'REJECTED') continue;
    const eid = empByCode.get(adj.employee_id) ?? adj.employee_id;
    const key = adj.assignment_id ? `asg:${adj.assignment_id}` : `emp:${eid}:${adj.work_date}:${adj.shift_code}`;
    if (seenAdjKeys.has(key)) adjDeletes.push({ id: adj.id, expectedVersion: adj.version, patch: { is_deleted: true } });
    else seenAdjKeys.add(key);
  }
  if (adjDeletes.length > 0) await tolerantWrite(() => ctx.db.attendanceAdjustments.batchUpdate(adjDeletes, SYNC_ACTOR));

  const adjBatchCounts = new Map<string, number>();
  for (const adj of ctx.db.attendanceAdjustments.all()) {
    if ((adj.status === 'APPROVED' || adj.status === 'REJECTED') && adj.decided_at) {
      const bk = `${adj.decided_at.slice(0, 16)}_${adj.status}`;
      adjBatchCounts.set(bk, (adjBatchCounts.get(bk) ?? 0) + 1);
    }
  }

  const seenNotifKeys = new Set<string>();
  const notifDeletes: { id: string; expectedVersion: number; patch: { is_deleted: boolean } }[] = [];
  for (const n of [...ctx.db.notifications.all()].reverse()) {
    const rawAdjId = (n.entity_id || '').replace(/_(STORE_CONFIRMED|APPROVED|REJECTED)$/, '');
    const adj = n.entity_type.startsWith('ATT_ADJ_') && !n.entity_id.startsWith('BULK_') ? ctx.db.attendanceAdjustments.get(rawAdjId) : undefined;
    const isResolvedPending =
      (n.entity_type === 'ATT_ADJ_HR' && (!adj || (adj.status !== 'PENDING' && adj.status !== 'STORE_CONFIRMED') || (adj.status === 'STORE_CONFIRMED' && !n.entity_id.endsWith('_STORE_CONFIRMED')))) ||
      (n.entity_type === 'LEAVE_ROLE' && ctx.db.leaveRequests.get(n.entity_id)?.status !== 'PENDING') ||
      (n.entity_type === 'SHIFT_DRAFT_ROLE' && ctx.db.shiftAssignments.get(n.entity_id)?.status !== 'DRAFT') ||
      (n.entity_type === 'SWAP_STORE' && !['PENDING_PEER', 'PEER_ACCEPTED'].includes(ctx.db.shiftSwaps.get((n.entity_id || '').replace(/_(PENDING_PEER|PEER_ACCEPTED)$/, ''))?.status ?? '')) ||
      (n.entity_type === 'EMG_STORE' && ['RESOLVED', 'REPLACEMENT_FOUND'].includes(ctx.db.emergencyLeaves.get(n.entity_id)?.status ?? '')) ||
      (n.entity_type === 'USERS_PENDING' && ctx.db.users.get(n.entity_id)?.status !== 'PENDING_ACTIVATION');
    const isMergedIntoBulk = n.entity_type === 'ATT_ADJ_USER' && !n.entity_id.startsWith('BULK_') && adj?.decided_at && (adjBatchCounts.get(`${adj.decided_at.slice(0, 16)}_${adj.status}`) ?? 0) > 1;
    const isSelfPendingLeave = n.entity_type === 'LEAVE_USER' && n.title.includes('Đã tiếp nhận');
    const entKey = n.entity_type && n.entity_id ? `ent:${n.entity_type}:${n.entity_id}` : '';
    const txtKey = `txt:${n.category}:${n.recipient_role}:${n.recipient_user_id}:${n.title}`;
    if (isResolvedPending || isMergedIntoBulk || isSelfPendingLeave || (entKey && seenNotifKeys.has(entKey)) || seenNotifKeys.has(txtKey)) {
      notifDeletes.push({ id: n.id, expectedVersion: n.version, patch: { is_deleted: true } });
      continue;
    }
    if (entKey) seenNotifKeys.add(entKey);
    seenNotifKeys.add(txtKey);
  }
  if (notifDeletes.length > 0) await tolerantWrite(() => ctx.db.notifications.batchUpdate(notifDeletes, SYNC_ACTOR));
}

async function runSyncNotifications(ctx: AppContext): Promise<void> {
  const sigBefore = computeSyncSig(ctx);
  if (lastSyncSig.get(ctx.db) === sigBefore) return;
  await deduplicateAdjustmentsAndNotifications(ctx);
  const users = ctx.db.users.all(), seenKeys = new Set<string>();
  for (const n of ctx.db.notifications.all(true)) {
    if (!n.is_deleted) {
      if (n.entity_type && n.entity_id) seenKeys.add(`${n.entity_type}:${n.entity_id}`);
      seenKeys.add(`title:${n.recipient_role}:${n.recipient_user_id}:${n.title}`);
    }
  }
  const hasKey = (type: string, id: string, role = '', uid = '', title = '') => seenKeys.has(`${type}:${id}`) || (Boolean(title) && seenKeys.has(`title:${role}:${uid}:${title}`));
  const findEmp = (empId: string) => ctx.db.employees.get(empId) ?? ctx.db.employees.find((e) => e.employee_code === empId);
  const findUserByEmp = (empId: string) => { const emp = findEmp(empId); return (emp?.user_id ? ctx.db.users.get(emp.user_id) : undefined) ?? users.find((u) => u.employee_id === empId || (emp && u.employee_id === emp.employee_code)); };
  const isBoOrHr = (emp?: { staff_group?: string }, empUser?: { role?: string }, creatorId?: string) => emp?.staff_group === 'BACKOFFICE' || ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(empUser?.role ?? '') || ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(ctx.db.users.get(creatorId || '')?.role ?? '');
  const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;
  const pendingInserts: Promise<unknown>[] = [];
  const ins = (data: Omit<Parameters<typeof ctx.db.notifications.insert>[0], 'read_at'>, actorId = SYNC_ACTOR) => {
    if (hasKey(data.entity_type, data.entity_id, data.recipient_role, data.recipient_user_id, data.title)) return Promise.resolve();
    seenKeys.add(`${data.entity_type}:${data.entity_id}`);
    seenKeys.add(`title:${data.recipient_role}:${data.recipient_user_id}:${data.title}`);
    pendingInserts.push(tolerantWrite(() => ctx.db.notifications.insert({ ...data, read_at: '' }, actorId || SYNC_ACTOR)));
    return Promise.resolve();
  };

  for (const anc of ctx.db.announcements.all().slice(-30)) {
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
  for (const a of ctx.db.shiftAssignments.all().slice(-40)) {
    const emp = findEmp(a.employee_id), empUser = findUserByEmp(a.employee_id), empLabel = emp ? `${emp.full_name} (${emp.employee_code})` : a.employee_id, brId = emp?.branch_id || a.branch_id || 'ALL';
    if (a.status === 'DRAFT' && !hasKey('SHIFT_DRAFT_ROLE', a.id)) {
      await ins({ recipient_user_id: '', recipient_role: isBoOrHr(emp, empUser, a.created_by) ? 'HR' : 'HR,STORE', branch_id: brId, category: 'WORKFLOW', title: `Đăng ký ca làm việc chờ duyệt: ${empLabel}`, body: `${shiftLabel(a.shift_code)} (${a.start_at}–${a.end_at}) ngày ${a.work_date} đang chờ Quản lý cửa hàng / HR duyệt phân ca.`, link: '/admin/schedules', severity: 'WARNING', entity_type: 'SHIFT_DRAFT_ROLE', entity_id: a.id }, empUser?.id || a.created_by);
    }
    if (empUser && a.status === 'PUBLISHED' && a.source === 'EMPLOYEE_REGISTER' && !hasKey('SHIFT_PUB_USER', `${a.id}_PUBLISHED`)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: brId, category: 'WORKFLOW', title: `Ca đăng ký ngày ${a.work_date} đã được duyệt phân ca chính thức`, body: `${shiftLabel(a.shift_code)} (${a.start_at}–${a.end_at}) ngày ${a.work_date} đã được phê duyệt. Bạn đã có thể chấm công Vào/Ra ca.`, link: '/nv/lich', severity: 'INFO', entity_type: 'SHIFT_PUB_USER', entity_id: `${a.id}_PUBLISHED` }, a.updated_by);
    }
  }
  for (const l of ctx.db.leaveRequests.all().slice(-40)) {
    const code = l.request_code || l.id, emp = findEmp(l.employee_id), empUser = findUserByEmp(l.employee_id), empKey = `${l.id}_${l.status}`, brId = emp?.branch_id || l.branch_id || 'ALL';
    const empLabel = emp ? `${emp.full_name} (${emp.employee_code})` : l.employee_id;
    if (l.status === 'PENDING' && !hasKey('LEAVE_ROLE', l.id)) {
      await ins({ recipient_user_id: '', recipient_role: isBoOrHr(emp, empUser, l.created_by) ? 'HR' : 'HR,STORE', branch_id: brId, category: 'WORKFLOW', title: `Đơn xin nghỉ phép (OFF) chờ duyệt: ${code} — ${empLabel}`, body: `Nhân sự ${empLabel} xin nghỉ ngày ${l.leave_date} — Lý do: ${l.reason || 'Nghỉ phép cá nhân'}.`, link: '/admin/schedules?section=workflows', severity: 'WARNING', entity_type: 'LEAVE_ROLE', entity_id: l.id }, empUser?.id || l.created_by);
    }
    if (empUser && (l.status === 'APPROVED' || l.status === 'REJECTED') && empUser.id !== l.decided_by && !hasKey('LEAVE_USER', empKey)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: brId, category: 'WORKFLOW', title: l.status === 'APPROVED' ? `Đơn xin nghỉ OFF (${l.leave_date}) đã được phê duyệt` : `Đơn xin nghỉ OFF (${l.leave_date}) bị từ chối`, body: `Mã đơn: ${code} · Ngày nghỉ: ${l.leave_date} · Lý do: ${l.decision_reason || l.reason || 'Cá nhân'}.`, link: '/nv/nghi-phep', severity: l.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'LEAVE_USER', entity_id: empKey }, l.decided_by);
    }
  }
  for (const s of ctx.db.shiftSwaps.all().slice(-40)) {
    const reqEmp = findEmp(s.requester_id), reqUser = findUserByEmp(s.requester_id), peerUser = findUserByEmp(s.peer_id), swapKey = `${s.id}_${s.status}`, brId = reqEmp?.branch_id || s.branch_id || 'ALL';
    const reqLabel = reqEmp ? `${reqEmp.full_name} (${reqEmp.employee_code})` : s.requester_id;
    if ((s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && !hasKey('SWAP_STORE', `${s.id}_${s.status}`)) {
      await ins({ recipient_user_id: '', recipient_role: isBoOrHr(reqEmp, reqUser, s.created_by) ? 'HR' : 'HR,STORE', branch_id: brId, category: 'WORKFLOW', title: `Yêu cầu đổi ca (${s.swap_code || s.id}): ${reqLabel}`, body: `Đổi ca ngày ${s.from_work_date} (${shiftLabel(s.from_shift_code)}) đang ở trạng thái ${s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ Quản lý / HR duyệt' : 'Chờ đồng nghiệp xác nhận'}.`, link: '/admin/schedules?section=workflows', severity: s.status === 'PEER_ACCEPTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_STORE', entity_id: `${s.id}_${s.status}` }, s.status === 'PEER_ACCEPTED' ? (peerUser?.id || s.updated_by) : (reqUser?.id || s.created_by));
    }
    const targetIds = s.status === 'PENDING_PEER' ? [peerUser?.id] : (s.status === 'PEER_ACCEPTED' || s.status === 'PEER_DECLINED') ? [reqUser?.id] : [reqUser?.id, peerUser?.id].filter((id) => id !== s.decided_by);
    const cleanTargetIds = targetIds.filter(Boolean).join(',');
    if (cleanTargetIds && !hasKey('SWAP_USER', swapKey)) {
      await ins({ recipient_user_id: cleanTargetIds, recipient_role: '', branch_id: brId, category: 'WORKFLOW', title: `Cập nhật yêu cầu đổi ca (${s.swap_code || s.id})`, body: `Đổi ca ngày ${s.from_work_date} (${shiftLabel(s.from_shift_code)}): ${s.status === 'APPROVED' ? 'Đã được Quản lý phê duyệt & cập nhật lịch chính thức' : s.status === 'PEER_ACCEPTED' ? 'Đồng nghiệp đã xác nhận — Chờ Quản lý duyệt' : s.status === 'REJECTED' || s.status === 'PEER_DECLINED' ? 'Đã bị từ chối' : `${reqLabel} nhờ bạn nhận ca thay`}.`, link: '/nv/doi-ca', severity: s.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'SWAP_USER', entity_id: swapKey }, s.status === 'PENDING_PEER' ? (reqUser?.id || s.created_by) : (s.decided_by || peerUser?.id || s.updated_by));
    }
  }
  const adjDecisionBatches = new Map<string, typeof adjList>();
  const adjList = ctx.db.attendanceAdjustments.all().slice(-50);
  for (const adj of adjList) {
    const emp = findEmp(adj.employee_id), empUser = findUserByEmp(adj.employee_id), empLabel = emp ? `${emp.full_name} (${emp.employee_code})` : adj.employee_id, brId = emp?.branch_id || adj.branch_id || 'ALL';
    const hrEntityId = adj.status === 'STORE_CONFIRMED' ? `${adj.id}_STORE_CONFIRMED` : adj.id;
    const adjTargetRole = adj.status === 'STORE_CONFIRMED' || isBoOrHr(emp, empUser, adj.created_by) ? 'HR' : 'HR,STORE';
    if ((adj.status === 'PENDING' || adj.status === 'STORE_CONFIRMED') && !hasKey('ATT_ADJ_HR', hrEntityId)) {
      await ins({ recipient_user_id: '', recipient_role: adjTargetRole, branch_id: brId, category: 'ATTENDANCE', title: adj.status === 'STORE_CONFIRMED' ? `CH đã xác nhận phiếu bù công chờ HR duyệt: ${adj.adjustment_code} (${empLabel})` : `Phiếu bổ sung / lỗi chấm công chờ chốt: ${adj.adjustment_code} (${empLabel})`, body: `Nhân sự ${empLabel} · Ngày công ${adj.work_date} (${adj.requested_hours}h) — Lý do: ${adj.reason}.`, link: '/admin/schedules?section=workflows', severity: 'WARNING', entity_type: 'ATT_ADJ_HR', entity_id: hrEntityId }, adj.status === 'STORE_CONFIRMED' ? (adj.store_confirmed_by || adj.updated_by) : (empUser?.id || adj.created_by));
    }
    if (adj.status === 'STORE_CONFIRMED' && empUser && empUser.id !== adj.store_confirmed_by && !hasKey('ATT_ADJ_USER', `${adj.id}_STORE_CONFIRMED`)) {
      await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: brId, category: 'ATTENDANCE', title: `Phiếu bổ sung công (${adj.adjustment_code}) đã được Cửa hàng xác nhận`, body: `Ngày công ${adj.work_date} (${adj.requested_hours}h) — ${adj.store_note || adj.reason}.`, link: '/nv/cong', severity: 'INFO', entity_type: 'ATT_ADJ_USER', entity_id: `${adj.id}_STORE_CONFIRMED` }, adj.store_confirmed_by);
    } else if (adj.status === 'APPROVED' || adj.status === 'REJECTED') {
      const bk = `${(adj.decided_at || adj.updated_at).slice(0, 16)}_${adj.status}`;
      adjDecisionBatches.set(bk, [...(adjDecisionBatches.get(bk) ?? []), adj]);
    }
  }
  for (const [bk, group] of adjDecisionBatches.entries()) {
    if (group.length === 1) {
      const adj = group[0]!, emp = findEmp(adj.employee_id), empUser = findUserByEmp(adj.employee_id), adjUserKey = `${adj.id}_${adj.status}`;
      if (empUser && empUser.id !== adj.decided_by && !hasKey('ATT_ADJ_USER', adjUserKey)) {
        await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: emp?.branch_id || adj.branch_id || 'ALL', category: 'ATTENDANCE', title: adj.status === 'APPROVED' ? `Phiếu bổ sung công (${adj.adjustment_code}) đã được HR phê duyệt` : `Phiếu bổ sung công (${adj.adjustment_code}) bị từ chối`, body: `Ngày công ${adj.work_date} (${adj.requested_hours}h) — ${adj.decision_reason || adj.reason}.`, link: '/nv/cong', severity: adj.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'ATT_ADJ_USER', entity_id: adjUserKey }, adj.decided_by);
      }
    } else {
      const bulkKey = `BULK_${bk}`, codes = group.map((x) => x.adjustment_code), sample = group[0]!;
      const targetUids = Array.from(new Set(group.map((x) => findUserByEmp(x.employee_id)?.id).filter((id): id is string => Boolean(id && id !== sample.decided_by))));
      if (targetUids.length > 0 && !hasKey('ATT_ADJ_USER', bulkKey)) {
        await ins({ recipient_user_id: targetUids.join(','), recipient_role: '', branch_id: 'ALL', category: 'ATTENDANCE', title: `Kết quả xử lý hàng loạt ${group.length} phiếu bổ sung công (${codes[0]} .. ${codes[codes.length - 1]})`, body: `Phòng Nhân sự (HR) đã ${sample.status === 'APPROVED' ? 'phê duyệt' : 'từ chối'} ${group.length} phiếu bổ sung công: ${codes.slice(0, 6).join(', ')}${codes.length > 6 ? ` (+${codes.length - 6} phiếu)` : ''}.`, link: '/nv/cong', severity: sample.status === 'REJECTED' ? 'WARNING' : 'INFO', entity_type: 'ATT_ADJ_USER', entity_id: bulkKey }, sample.decided_by);
      }
    }
  }
  for (const emg of ctx.db.emergencyLeaves.all().slice(-30)) {
    const emp = findEmp(emg.employee_id), empUser = findUserByEmp(emg.employee_id), empLabel = emp ? `${emp.full_name} (${emp.employee_code})` : emg.employee_id;
    if (!hasKey('EMG_STORE', emg.id)) await ins({ recipient_user_id: '', recipient_role: isBoOrHr(emp, empUser, emg.created_by) ? 'HR' : 'HR,STORE', branch_id: emp?.branch_id || emg.branch_id || 'ALL', category: 'WORKFLOW', title: `Cảnh báo nghỉ đột xuất & thiếu người: ${emg.emergency_code} (${empLabel})`, body: `${empLabel} báo nghỉ ${shiftLabel(emg.shift_code)} ngày ${emg.work_date} — Lý do: ${emg.reason}. Cần tìm người thay hoặc báo HR.`, link: '/admin/schedules?section=workflows', severity: 'CRITICAL', entity_type: 'EMG_STORE', entity_id: emg.id }, empUser?.id || emg.created_by);
  }
  for (const ps of ctx.db.payslips.all().slice(-30)) {
    const empUser = findUserByEmp(ps.employee_id);
    if (empUser && !hasKey('PAYSLIP_USER', ps.id)) await ins({ recipient_user_id: empUser.id, recipient_role: '', branch_id: ps.branch_id || 'ALL', category: 'PAYROLL', title: `Phiếu lương cá nhân đã phát hành: ${ps.period_name || ps.payslip_code}`, body: `Thực lĩnh (NET): ${Number(ps.net_vnd || 0).toLocaleString('vi-VN')}đ — Vui lòng kiểm tra chi tiết và xác nhận phiếu lương.`, link: '/nv/phieu-luong', severity: 'INFO', entity_type: 'PAYSLIP_USER', entity_id: ps.id });
  }
  if (pendingInserts.length > 0) await Promise.all(pendingInserts);
  const sigAfter = computeSyncSig(ctx);
  if (sigAfter !== sigBefore) return runSyncNotifications(ctx);
  lastSyncSig.set(ctx.db, sigAfter);
}

export function isNotificationCreatedByOrSelfAction(ctx: AppContext, n: NotificationRow, userId: string): boolean {
  const meUser = ctx.db.users.get(userId);
  const myEmp = ctx.db.employees.find((e) => e.user_id === userId || Boolean(meUser?.employee_id && (e.id === meUser.employee_id || e.employee_code === meUser.employee_id)));
  const isMyEmp = (eid?: string) => Boolean(eid && myEmp && (eid === myEmp.id || eid === myEmp.employee_code));
  const rawId = (n.entity_id || '').replace(/_(PUBLISHED|APPROVED|REJECTED|PENDING|STORE_CONFIRMED|PENDING_PEER|PEER_ACCEPTED|PEER_DECLINED)$/, '');
  const recipientUserIds = (n.recipient_user_id || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (n.entity_type === 'MANUAL' && n.created_by === userId && !recipientUserIds.includes(userId)) return true;
  if (n.entity_id.startsWith('BULK_')) return n.created_by === userId || !recipientUserIds.includes(userId);
  if (n.entity_type === 'USERS_PENDING') return n.entity_id === userId;
  if (n.entity_type === 'ATT_ADJ_HR') {
    const adj = ctx.db.attendanceAdjustments.get(rawId);
    return !adj || (n.entity_id.endsWith('_STORE_CONFIRMED') ? (adj.store_confirmed_by === userId || isMyEmp(adj.employee_id)) : (adj.created_by === userId || isMyEmp(adj.employee_id)));
  }
  if (n.entity_type === 'ATT_ADJ_USER') {
    const adj = ctx.db.attendanceAdjustments.get(rawId);
    return !adj || adj.decided_by === userId || (n.entity_id.endsWith('_STORE_CONFIRMED') && adj.store_confirmed_by === userId);
  }
  if (n.entity_type === 'SHIFT_DRAFT_ROLE' || n.entity_type === 'SCHED_STORE') { const a = ctx.db.shiftAssignments.get(rawId); return !a || a.created_by === userId || isMyEmp(a.employee_id); }
  if (n.entity_type === 'SHIFT_PUB_USER') { const a = ctx.db.shiftAssignments.get(rawId); return !a || a.updated_by === userId; }
  if (n.entity_type === 'LEAVE_ROLE') { const l = ctx.db.leaveRequests.get(rawId); return !l || l.created_by === userId || isMyEmp(l.employee_id); }
  if (n.entity_type === 'LEAVE_USER') { const l = ctx.db.leaveRequests.get(rawId); return n.title.includes('Đã tiếp nhận') || !l || l.decided_by === userId; }
  if (n.entity_type === 'SWAP_STORE') {
    const s = ctx.db.shiftSwaps.get(rawId);
    return !s || (n.entity_id.endsWith('_PEER_ACCEPTED') ? isMyEmp(s.peer_id) : (s.created_by === userId || isMyEmp(s.requester_id)));
  }
  if (n.entity_type === 'SWAP_USER') {
    const s = ctx.db.shiftSwaps.get(rawId);
    return !s || (n.entity_id.endsWith('_PENDING_PEER') && (s.created_by === userId || isMyEmp(s.requester_id))) || ((n.entity_id.endsWith('_PEER_ACCEPTED') || n.entity_id.endsWith('_PEER_DECLINED')) && isMyEmp(s.peer_id)) || ((n.entity_id.endsWith('_APPROVED') || n.entity_id.endsWith('_REJECTED')) && s.decided_by === userId);
  }
  if (n.entity_type === 'EMG_STORE') { const emg = ctx.db.emergencyLeaves.get(rawId); return !emg || emg.created_by === userId || isMyEmp(emg.employee_id); }
  return false;
}
