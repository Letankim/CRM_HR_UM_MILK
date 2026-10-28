import { ACCOUNT_STATUS_LABELS, DEFAULT_SHIFT_LABELS, ROLE_LABELS, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type AttendanceAdjustment, type EmergencyLeave, type Employee, type StaffGroup, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { isSyntheticDemoEmail } from './email.service.js';

const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;

export function resolveFallbackRealEmail(ctx: AppContext, preferred?: string): string {
  if (preferred && !isSyntheticDemoEmail(preferred)) return preferred.trim().toLowerCase();
  for (const u of ctx.db.users.all(true)) if (u.email && !isSyntheticDemoEmail(u.email)) return u.email.trim().toLowerCase();
  for (const e of ctx.db.employees.all(true)) if (e.email && !isSyntheticDemoEmail(e.email)) return e.email.trim().toLowerCase();
  return (ctx.env.EMAIL_FROM_ADDRESS || '3do.service.veo@gmail.com').trim().toLowerCase();
}

export function resolveRealAccountEmail(ctx: AppContext, user: User, actorEmail?: string): string {
  if (user.email && !isSyntheticDemoEmail(user.email)) return user.email.trim().toLowerCase();
  const emp = user.employee_id
    ? ctx.db.employees.find((e) => e.employee_code === user.employee_id || e.id === user.employee_id || e.user_id === user.id)
    : ctx.db.employees.find((e) => e.user_id === user.id);
  if (emp?.email && !isSyntheticDemoEmail(emp.email)) return emp.email.trim().toLowerCase();
  return resolveFallbackRealEmail(ctx, actorEmail);
}

export function queueAccountCreatedEmail(ctx: AppContext, user: User, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail);
  const ref = `ACC-${user.id.slice(0, 8).toUpperCase()}`, isActive = user.status === 'ACTIVE';
  ctx.email.enqueue({
    to, template: 'ACCOUNT_ACTIVATED',
    subject: isActive ? `${SYSTEM_CONFIG.emailSubjectPrefix} Khởi tạo và kích hoạt tài khoản (${ref})` : `${SYSTEM_CONFIG.emailSubjectPrefix} Khởi tạo tài khoản chờ kích hoạt (${ref})`,
    recipientName: user.display_name || user.username, referenceCode: ref,
    summary: isActive
      ? `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của ${user.display_name} (${user.username}) đã được khởi tạo và kích hoạt chính thức.`
      : `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của ${user.display_name} (${user.username}) đã được khởi tạo ở trạng thái Chờ Quản trị viên kích hoạt.`,
    metadata: [{ label: 'Tên đăng nhập', value: user.username }, { label: 'Họ tên hiển thị', value: user.display_name }, { label: 'Vai trò hệ thống', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }],
    actionLabel: 'Đăng nhập hệ thống', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/login`,
  }, { dedupeKey: `acc_create:${user.id}:v${user.version}` });
}

export function queueAccountActivatedEmail(ctx: AppContext, user: User, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail), ref = `ACC-${user.id.slice(0, 8).toUpperCase()}`;
  ctx.email.enqueue({
    to, template: 'ACCOUNT_ACTIVATED', recipientName: user.display_name || user.username, referenceCode: ref,
    summary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của ${user.display_name} (${user.username}) đã được kích hoạt chính thức.`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.ACTIVE }],
    actionLabel: 'Đăng nhập hệ thống ngay', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/login`,
  }, { dedupeKey: `acc_activate:${user.id}:v${user.version}` });
}

export function queueAccountLockedEmail(ctx: AppContext, user: User, reason?: string, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail), ref = `LCK-${user.id.slice(0, 8).toUpperCase()}`;
  ctx.email.enqueue({
    to, template: 'ACCOUNT_REVOKED', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Thông báo khóa tạm thời tài khoản (${ref})`,
    recipientName: user.display_name || user.username, referenceCode: ref,
    summary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của ${user.display_name} (${user.username}) đã bị khóa tạm thời bởi Quản trị viên.`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.LOCKED }, { label: 'Lý do khóa tạm thời', value: reason || 'Khóa tạm thời bởi Quản trị viên' }],
  }, { dedupeKey: `acc_lock:${user.id}:v${user.version}` });
}

export function queueAccountUnlockedEmail(ctx: AppContext, user: User, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail), ref = `ULK-${user.id.slice(0, 8).toUpperCase()}`;
  ctx.email.enqueue({
    to, template: 'ACCOUNT_ACTIVATED', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Thông báo mở khóa tài khoản đăng nhập (${ref})`,
    recipientName: user.display_name || user.username, referenceCode: ref,
    summary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của ${user.display_name} (${user.username}) đã được mở khóa đăng nhập và hoạt động trở lại.`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }],
    actionLabel: 'Đăng nhập hệ thống', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/login`,
  }, { dedupeKey: `acc_unlock:${user.id}:v${user.version}` });
}

export function queueAccountRevokedEmail(ctx: AppContext, user: User, reason?: string, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail), ref = `REV-${user.id.slice(0, 8).toUpperCase()}`;
  ctx.email.enqueue({
    to, template: 'ACCOUNT_REVOKED', recipientName: user.display_name || user.username, referenceCode: ref,
    summary: `Quyền truy cập hệ thống ${SYSTEM_CONFIG.brandName} của tài khoản ${user.display_name} (${user.username}) đã bị thu hồi.`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Lý do thu hồi', value: reason || 'Theo quyết định quản trị' }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.REVOKED }],
  }, { dedupeKey: `acc_revoke:${user.id}:v${user.version}` });
}

export function queueAccountUpdatedEmail(ctx: AppContext, user: User, changeNote: string, actorEmail?: string) {
  const to = resolveRealAccountEmail(ctx, user, actorEmail), ref = `UPD-${user.id.slice(0, 8).toUpperCase()}`;
  ctx.email.enqueue({
    to, template: 'ACCOUNT_ACTIVATED', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cập nhật thông tin và phân quyền tài khoản (${ref})`,
    recipientName: user.display_name || user.username, referenceCode: ref,
    summary: `Thông tin hoặc phân quyền tài khoản ${user.display_name} (${user.username}) vừa được Quản trị viên cập nhật.`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Vai trò hiện tại', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }, { label: 'Nội dung cập nhật', value: changeNote }],
    actionLabel: 'Kiểm tra tài khoản', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/login`,
  }, { dedupeKey: `acc_update:${user.id}:v${user.version}` });
}

export function queueEmployeeOnboardedEmail(ctx: AppContext, emp: Employee, actorEmail?: string) {
  const to = emp.email && !isSyntheticDemoEmail(emp.email) ? emp.email.trim().toLowerCase() : resolveFallbackRealEmail(ctx, actorEmail);
  const branchName = ctx.db.branches.get(emp.branch_id)?.name || 'Ụm Bò Milk';
  ctx.email.enqueue({
    to, template: 'ACCOUNT_ACTIVATED', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Tiếp nhận hồ sơ nhân sự mới (${emp.employee_code})`,
    recipientName: emp.full_name, referenceCode: emp.employee_code,
    summary: `Hồ sơ nhân sự ${emp.full_name} (${emp.employee_code}) đã được khởi tạo trên hệ thống ${SYSTEM_CONFIG.brandName}.`,
    metadata: [{ label: 'Mã & Họ tên nhân sự', value: `${emp.full_name} (${emp.employee_code})` }, { label: 'Chi nhánh làm việc', value: branchName }, { label: 'Vị trí công việc', value: emp.position_title || STAFF_GROUP_LABELS[emp.staff_group as StaffGroup] || emp.staff_group }],
  }, { dedupeKey: `emp_onboard:${emp.id}` });
}

export function queueAttendanceAdjustmentDecisionEmail(ctx: AppContext, adj: AttendanceAdjustment, actorEmail?: string) {
  const emp = ctx.db.employees.get(adj.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === adj.employee_id);
  const to = emp?.email && !isSyntheticDemoEmail(emp.email) ? emp.email.trim().toLowerCase() : resolveFallbackRealEmail(ctx, actorEmail);
  const statusText = adj.status === 'APPROVED' ? 'Đã phê duyệt bù công' : adj.status === 'STORE_CONFIRMED' ? 'Cửa hàng đã xác nhận (Chờ HR duyệt)' : 'Từ chối';
  ctx.email.enqueue({
    to, template: 'LEAVE_SWAP_DECISION', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Kết quả xử lý phiếu bổ sung công (${adj.adjustment_code})`,
    recipientName: emp?.full_name || 'Nhân sự Ụm Bò Milk', referenceCode: adj.adjustment_code,
    summary: `Phiếu bổ sung công ${adj.adjustment_code} ngày ${adj.work_date} đã được cập nhật trạng thái: ${statusText}.`,
    metadata: [{ label: 'Mã phiếu bổ sung công', value: adj.adjustment_code }, { label: 'Ngày công & Ca', value: `${adj.work_date} (${shiftLabel(adj.shift_code)})` }, { label: 'Trạng thái xử lý', value: statusText }, { label: 'Ghi chú phản hồi', value: adj.decision_reason || adj.store_note || adj.reason }],
    actionLabel: 'Xem bảng công của tôi', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/cong`,
  }, { dedupeKey: `adj_decide:${adj.id}:v${adj.version}` });
}

export function queueEmergencyHandledEmail(ctx: AppContext, emg: EmergencyLeave, actorEmail?: string) {
  const emp = ctx.db.employees.get(emg.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === emg.employee_id);
  const to = emp?.email && !isSyntheticDemoEmail(emp.email) ? emp.email.trim().toLowerCase() : resolveFallbackRealEmail(ctx, actorEmail);
  ctx.email.enqueue({
    to, template: 'EMERGENCY_LEAVE_ALERT', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cập nhật xử lý báo nghỉ khẩn cấp (${emg.emergency_code})`,
    recipientName: emp?.full_name || 'Nhân sự Ụm Bò Milk', referenceCode: emg.emergency_code,
    summary: `Báo cáo nghỉ đột xuất ${emg.emergency_code} ngày ${emg.work_date} đã được Quản lý xử lý.`,
    metadata: [{ label: 'Mã báo cáo', value: emg.emergency_code }, { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` }, { label: 'Ghi chú xử lý', value: emg.resolution_note || 'Đã điều phối lịch trực' }],
  }, { dedupeKey: `emg_handle:${emg.id}:v${emg.version}` });
}
