import { DEFAULT_SHIFT_LABELS, isEmployeeRole, ROLE_LABELS, SYSTEM_CONFIG, type AttendanceAdjustment, type EmergencyLeave, type LeaveRequest, type Role, type ShiftAssignment, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { findLinkedEmployeeForUser, findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { resolveEmployeeRole, resolveRolePortalPath, resolveSystemHrMailbox, resolveUserPersonalRealEmail, webOrigin } from './account-email-dispatcher.js';
import { isSyntheticDemoEmail } from './email.service.js';

const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;
const flushMail = (ctx: AppContext, count: number) => { if (count > 0) void ctx.email.processQueueBatch(Math.min(6, count)); };

export interface StrictEmployeeContact {
  personalEmail: string; name: string; code: string; role: Role;
  userId: string; empId: string; branchId: string; branchName: string; isBoOrManager: boolean;
}

/** Giải mã thông tin liên hệ nhân sự nghiêm ngặt: tuyệt đối KHÔNG lấy email của Quản lý / Actor thay cho email nhân viên. */
export function resolveStrictEmployeeContact(ctx: AppContext, empIdOrCode: string): StrictEmployeeContact | null {
  const token = (empIdOrCode || '').trim();
  if (!token) return null;
  const directUser = ctx.db.users.get(token);
  const emp = ctx.db.employees.get(token)
    ?? ctx.db.employees.find((e) => e.employee_code.trim().toUpperCase() === token.toUpperCase())
    ?? (directUser ? findLinkedEmployeeForUser(directUser, ctx) : undefined);
  const user = directUser ?? (emp ? findLinkedUserForEmployee(emp, ctx) : undefined);
  if (!emp && !user) return null;
  const code = emp?.employee_code || user?.employee_id || user?.username || token;
  const name = emp?.full_name || user?.display_name || user?.username || 'Nhân sự Ụm Bò Milk';
  const rawPersonal = emp?.email && !isSyntheticDemoEmail(emp.email) ? emp.email : user?.email && !isSyntheticDemoEmail(user.email) ? user.email : '';
  const personalEmail = rawPersonal.trim().toLowerCase();
  const role = resolveEmployeeRole(ctx, emp, user);
  const branchId = emp?.branch_id || 'ALL';
  const branchName = (emp?.branch_id ? ctx.db.branches.get(emp.branch_id)?.name : undefined) || 'Ụm Bò Milk';
  const isBoOrManager = emp?.staff_group === 'BACKOFFICE' || ['ADMIN', 'HR', 'FINANCE', 'MKT', 'STORE'].includes(role);
  return { personalEmail, name, code, role, userId: user?.id || '', empId: emp?.id || '', branchId, branchName, isBoOrManager };
}

/** Giải mã danh sách người nhận email cấp Quản lý (HR toàn hệ thống + STORE đúng chi nhánh, loại trừ chính người thao tác). */
export function resolveManagerReviewRecipients(ctx: AppContext, opts: { roles: ('HR' | 'STORE')[]; branchId?: string; actorId?: string }) {
  const roleSet = new Set<string>(opts.roles), seenEmails = new Set<string>();
  const actorUser = opts.actorId ? ctx.db.users.get(opts.actorId) : undefined;
  const targetBranch = opts.branchId && opts.branchId !== 'ALL' ? opts.branchId : '';
  const results: { email: string; name: string; role: 'HR' | 'STORE'; roleLabel: string }[] = [];
  let hasHrRecipient = false;
  const orderedUsers = [...ctx.db.users.all()].sort((a, b) => (a.role === 'HR' ? -1 : 1) - (b.role === 'HR' ? -1 : 1));
  for (const u of orderedUsers) {
    if (u.status !== 'ACTIVE' || u.id === opts.actorId || !roleSet.has(u.role)) continue;
    if (u.role === 'STORE') {
      const scope = ctx.auth.resolveEffectiveBranchScope(u);
      if (!targetBranch || !Array.isArray(scope) || !scope.includes(targetBranch)) continue;
    }
    const email = resolveUserPersonalRealEmail(ctx, u);
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    if (u.role === 'HR') hasHrRecipient = true;
    results.push({ email, name: u.display_name || u.username, role: u.role as 'HR' | 'STORE', roleLabel: ROLE_LABELS[u.role] });
  }
  if (roleSet.has('HR') && !hasHrRecipient && actorUser?.role !== 'HR') {
    const hrFallback = resolveSystemHrMailbox(ctx);
    const actorEmail = actorUser ? resolveUserPersonalRealEmail(ctx, actorUser) : '';
    if (hrFallback && hrFallback !== actorEmail && !seenEmails.has(hrFallback)) {
      results.push({ email: hrFallback, name: 'Phòng Nhân sự (HR) — Ụm Bò Milk', role: 'HR', roleLabel: ROLE_LABELS.HR });
    }
  }
  return results;
}

function targetManagerRoles(ctx: AppContext, contact: StrictEmployeeContact | null, actorId?: string): ('HR' | 'STORE')[] {
  const actorRole = actorId ? ctx.db.users.get(actorId)?.role : undefined;
  const skipStore = Boolean(contact?.isBoOrManager || (actorRole && ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(actorRole)));
  return skipStore ? ['HR'] : ['HR', 'STORE'];
}

export function queueAttendanceAdjustmentCreatedEmail(ctx: AppContext, adj: AttendanceAdjustment, actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, adj.employee_id);
  const branchName = ctx.db.branches.get(adj.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  const roles = targetManagerRoles(ctx, emp, actorId);
  const recipients = resolveManagerReviewRecipients(ctx, { roles, branchId: adj.branch_id || emp?.branchId, actorId });
  for (const mgr of recipients) {
    ctx.email.enqueue({
      to: mgr.email, template: 'LEAVE_SWAP_DECISION',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Phiếu bổ sung công mới chờ ${mgr.role === 'STORE' ? 'Cửa hàng xác nhận' : 'HR phê duyệt'} (${adj.adjustment_code})`,
      recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: adj.adjustment_code,
      summary: `Nhân sự ${emp ? `${emp.name} (${emp.code})` : adj.employee_id} tại ${branchName} vừa gửi phiếu bổ sung công ${adj.adjustment_code} ngày ${adj.work_date}. Vui lòng kiểm tra và ${mgr.role === 'STORE' ? 'xác nhận thực tế ca trực tại cửa hàng' : 'xét duyệt phiếu bổ sung công'}.`,
      metadata: [{ label: 'Mã phiếu bù công', value: adj.adjustment_code }, { label: 'Nhân sự đề nghị', value: emp ? `${emp.name} (${emp.code})` : adj.employee_id }, { label: 'Chi nhánh', value: branchName }, { label: 'Ngày công & Khung ca', value: `${adj.work_date} · ${shiftLabel(adj.shift_code)} (${adj.requested_check_in_at} - ${adj.requested_check_out_at} · ${adj.requested_hours}h)` }, { label: 'Lý do giải trình', value: adj.reason }],
      actionLabel: mgr.role === 'STORE' ? 'Xác nhận phiếu bù công tại Cửa hàng' : 'Kiểm tra & Phê duyệt tại Phân hệ HR',
      actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
    }, { dedupeKey: `adj_create:${adj.id}:${mgr.role}:${mgr.email}` });
  }
  flushMail(ctx, recipients.length);
}

export function queueAttendanceAdjustmentDecidedEmails(ctx: AppContext, adj: AttendanceAdjustment, action: 'STORE_CONFIRM' | 'HR_APPROVE' | 'HR_REJECT', actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, adj.employee_id);
  const branchName = ctx.db.branches.get(adj.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  const actorUser = actorId ? ctx.db.users.get(actorId) : undefined;
  let queued = 0;
  if (action === 'STORE_CONFIRM') {
    const hrRecipients = resolveManagerReviewRecipients(ctx, { roles: ['HR'], branchId: adj.branch_id, actorId });
    for (const hr of hrRecipients) {
      ctx.email.enqueue({
        to: hr.email, template: 'LEAVE_SWAP_DECISION',
        subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cửa hàng đã xác nhận phiếu bù công — Chờ HR duyệt (${adj.adjustment_code})`,
        recipientName: `${hr.name} (${hr.roleLabel})`, referenceCode: `${adj.adjustment_code}-CH`,
        summary: `Quản lý cửa hàng (${actorUser?.display_name || branchName}) đã xác nhận phiếu bổ sung công ${adj.adjustment_code} của nhân sự ${emp ? `${emp.name} (${emp.code})` : adj.employee_id}. Phiếu đang chờ Phòng Nhân sự (HR) phê duyệt cuối để ghi nhận công.`,
        metadata: [{ label: 'Mã phiếu bù công', value: adj.adjustment_code }, { label: 'Nhân sự & Chi nhánh', value: `${emp ? `${emp.name} (${emp.code})` : adj.employee_id} · ${branchName}` }, { label: 'Ngày công & Giờ đề nghị', value: `${adj.work_date} · ${shiftLabel(adj.shift_code)} (${adj.requested_hours}h)` }, { label: 'Xác nhận của Cửa hàng', value: adj.store_note || 'Cửa hàng xác nhận nhân sự có làm việc thực tế' }],
        actionLabel: 'Phê duyệt / Từ chối tại Phân hệ HR', actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
      }, { dedupeKey: `adj_hr_esc:${adj.id}:v${adj.version}:${hr.email}` });
      queued += 1;
    }
  }
  if (emp?.personalEmail && emp.userId !== actorId) {
    const statusText = action === 'HR_APPROVE' ? 'Đã được Phòng Nhân sự (HR) phê duyệt bù công' : action === 'STORE_CONFIRM' ? 'Cửa hàng đã xác nhận (Đang chờ HR phê duyệt cuối)' : 'Bị từ chối';
    ctx.email.enqueue({
      to: emp.personalEmail, template: 'LEAVE_SWAP_DECISION',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cập nhật phiếu bổ sung công của bạn (${adj.adjustment_code})`,
      recipientName: emp.name, referenceCode: adj.adjustment_code,
      summary: `Phiếu bổ sung công ${adj.adjustment_code} ngày ${adj.work_date} của bạn đã chuyển sang trạng thái: ${statusText}.`,
      metadata: [{ label: 'Mã phiếu bổ sung công', value: adj.adjustment_code }, { label: 'Ngày công & Ca', value: `${adj.work_date} (${shiftLabel(adj.shift_code)} · ${adj.requested_hours}h)` }, { label: 'Trạng thái xử lý', value: statusText }, { label: 'Ghi chú phản hồi', value: adj.decision_reason || adj.store_note || adj.reason }],
      actionLabel: isEmployeeRole(emp.role) ? 'Xem bảng công của tôi' : 'Xem bảng công cá nhân',
      actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(emp.role, 'attendance')}`,
    }, { dedupeKey: `adj_emp:${adj.id}:v${adj.version}` });
    queued += 1;
  }
  flushMail(ctx, queued);
}

export function queueAttendanceAdjustmentDecisionEmail(ctx: AppContext, adj: AttendanceAdjustment) {
  const action = adj.status === 'STORE_CONFIRMED' ? 'STORE_CONFIRM' : adj.status === 'APPROVED' ? 'HR_APPROVE' : 'HR_REJECT';
  queueAttendanceAdjustmentDecidedEmails(ctx, adj, action, adj.status === 'STORE_CONFIRMED' ? adj.store_confirmed_by : adj.decided_by);
}

export function queueLeaveCreatedEmail(ctx: AppContext, leave: LeaveRequest, actorId?: string) {
  if (leave.status !== 'PENDING') return;
  const emp = resolveStrictEmployeeContact(ctx, leave.employee_id);
  const branchName = ctx.db.branches.get(leave.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  const recipients = resolveManagerReviewRecipients(ctx, { roles: targetManagerRoles(ctx, emp, actorId), branchId: leave.branch_id || emp?.branchId, actorId });
  for (const mgr of recipients) {
    ctx.email.enqueue({
      to: mgr.email, template: 'LEAVE_SWAP_DECISION',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Đơn xin nghỉ phép (OFF) mới chờ duyệt (${leave.request_code})`,
      recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: leave.request_code,
      summary: `Nhân sự ${emp ? `${emp.name} (${emp.code})` : leave.employee_id} tại ${branchName} vừa gửi đơn xin nghỉ phép (OFF) ngày ${leave.leave_date} chờ phê duyệt.`,
      metadata: [{ label: 'Mã đơn nghỉ OFF', value: leave.request_code }, { label: 'Nhân sự & Chi nhánh', value: `${emp ? `${emp.name} (${emp.code})` : leave.employee_id} · ${branchName}` }, { label: 'Ngày & Ca xin nghỉ', value: `${leave.leave_date} (${shiftLabel(leave.shift_code)})` }, { label: 'Lý do xin nghỉ', value: leave.reason }],
      actionLabel: 'Mở trang Duyệt Đơn Nghỉ OFF', actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
    }, { dedupeKey: `leave_create:${leave.id}:${mgr.email}` });
  }
  flushMail(ctx, recipients.length);
}

export function queueLeaveDecisionEmail(ctx: AppContext, leave: LeaveRequest, actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, leave.employee_id);
  if (!emp?.personalEmail || emp.userId === (actorId || leave.decided_by)) return;
  const approved = leave.status === 'APPROVED';
  ctx.email.enqueue({
    to: emp.personalEmail, template: 'LEAVE_SWAP_DECISION', recipientName: emp.name,
    referenceCode: leave.request_code || `OFF-${leave.id.slice(0, 6)}`,
    summary: `Đơn đăng ký nghỉ phép (OFF) ngày ${leave.leave_date} của bạn đã ${approved ? 'được phê duyệt' : 'bị từ chối'}.`,
    metadata: [{ label: 'Mã đơn nghỉ OFF', value: leave.request_code }, { label: 'Ngày xin nghỉ', value: leave.leave_date }, { label: 'Kết quả xử lý', value: approved ? 'Đã phê duyệt' : 'Từ chối' }, { label: 'Ghi chú / Lý do', value: leave.decision_reason || leave.reason || 'Theo định biên vận hành' }],
    actionLabel: 'Xem chi tiết đơn nghỉ OFF', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(emp.role, 'leave')}`,
  }, { dedupeKey: `leave_emp:${leave.id}:v${leave.version}` });
  flushMail(ctx, 1);
}

export function queueShiftRegisteredEmail(ctx: AppContext, shift: ShiftAssignment, actorId?: string) {
  if (shift.status !== 'DRAFT') return;
  const emp = resolveStrictEmployeeContact(ctx, shift.employee_id);
  const branchName = ctx.db.branches.get(shift.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  const recipients = resolveManagerReviewRecipients(ctx, { roles: targetManagerRoles(ctx, emp, actorId), branchId: shift.branch_id || emp?.branchId, actorId });
  for (const mgr of recipients) {
    ctx.email.enqueue({
      to: mgr.email, template: 'SCHEDULE_SHIFT_DECISION',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Đăng ký ca làm việc mới chờ duyệt (${emp?.code || shift.work_date})`,
      recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: `SHF-${shift.id.slice(0, 6).toUpperCase()}`,
      summary: `Nhân sự ${emp ? `${emp.name} (${emp.code})` : shift.employee_id} tại ${branchName} vừa gửi đăng ký ca làm việc ngày ${shift.work_date} chờ duyệt phân ca chính thức.`,
      metadata: [{ label: 'Nhân sự & Chi nhánh', value: `${emp ? `${emp.name} (${emp.code})` : shift.employee_id} · ${branchName}` }, { label: 'Ngày & Khung ca', value: `${shift.work_date} · ${shiftLabel(shift.shift_code)} (${shift.start_at} - ${shift.end_at})` }, { label: 'Ghi chú', value: shift.note || 'Đăng ký ca làm việc cá nhân' }],
      actionLabel: 'Duyệt phân ca trên Lịch làm việc', actionUrl: `${webOrigin(ctx)}/admin/schedules`,
    }, { dedupeKey: `shift_reg:${shift.id}:${mgr.email}` });
  }
  flushMail(ctx, recipients.length);
}

export function queueScheduleShiftEmail(ctx: AppContext, params: { empId: string; shiftLabel: string; workDate: string; startAt: string; endAt: string; branchId: string; code: string }, actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, params.empId);
  if (!emp?.personalEmail || emp.userId === actorId) return;
  const branchName = ctx.db.branches.get(params.branchId)?.name || emp.branchName;
  ctx.email.enqueue({
    to: emp.personalEmail, template: 'SCHEDULE_SHIFT_DECISION', recipientName: emp.name, referenceCode: params.code,
    summary: `Ca làm việc ngày ${params.workDate} của bạn đã được phê duyệt phân ca chính thức.`,
    metadata: [{ label: 'Nhân sự', value: `${emp.name} (${emp.code})` }, { label: 'Ngày làm việc', value: params.workDate }, { label: 'Khung ca & Giờ ca', value: `${params.shiftLabel} (${params.startAt} - ${params.endAt})` }, { label: 'Chi nhánh', value: branchName }],
    actionLabel: 'Xem lịch làm việc của bạn', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(emp.role, 'schedule')}`,
  }, { dedupeKey: `shift_pub:${params.code}:${emp.personalEmail}` });
  flushMail(ctx, 1);
}
