import { ACCOUNT_STATUS_LABELS, isEmployeeRole, ROLE_LABELS, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type Employee, type Role, type StaffGroup, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { findLinkedEmployeeForUser, findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { isSyntheticDemoEmail } from './email.service.js';
import { getPublicFrontendOrigin } from './smtp-sender.js';

export type PortalLinkTarget = 'login' | 'home' | 'attendance' | 'schedule' | 'leave' | 'swap' | 'payslip' | 'test' | 'comms' | 'workflows' | 'tickets';

export const webOrigin = (ctx: AppContext): string => getPublicFrontendOrigin(ctx.env.API_PUBLIC_ORIGIN);

export function resolveEmployeeRole(ctx: AppContext, emp?: Employee, user?: User): Role {
  if (user) return user.role;
  if (!emp) return 'THU_VIEC';
  const linked = findLinkedUserForEmployee(emp, ctx);
  if (linked) return linked.role;
  return emp.stage === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC';
}

export function resolveRolePortalPath(role: Role | undefined, target: PortalLinkTarget): string {
  const isEmp = !role || isEmployeeRole(role);
  if (target === 'login') return isEmp ? '/nv/login' : '/login';
  if (target === 'home') {
    if (isEmp) return '/nv';
    if (role === 'MKT') return '/admin/integrations?section=comms';
    if (role === 'HR') return '/admin/employees';
    if (role === 'FINANCE') return '/admin/payroll';
    if (role === 'STORE') return '/admin/schedules';
    return '/dashboard';
  }
  if (target === 'workflows') return isEmp ? '/nv/lich' : '/admin/schedules?section=workflows';
  if (target === 'attendance') return isEmp ? '/nv/cong' : role === 'MKT' ? '/dashboard' : '/admin/my-attendance';
  if (target === 'schedule') return isEmp ? '/nv/lich' : role === 'MKT' ? '/dashboard' : '/admin/my-attendance';
  if (target === 'leave') return isEmp ? '/nv/nghi-phep' : role === 'MKT' ? '/dashboard' : '/admin/my-attendance';
  if (target === 'swap') return isEmp ? '/nv/doi-ca' : role === 'MKT' ? '/dashboard' : '/admin/my-attendance';
  if (target === 'payslip') return '/nv/phieu-luong';
  if (target === 'tickets') return isEmp ? '/nv/ho-tro' : '/admin/tickets';
  if (target === 'test') return role === 'MKT' ? '/dashboard' : '/nv/bai-kiem-tra';
  if (target === 'comms') return isEmp ? '/nv/ban-tin' : (role === 'ADMIN' || role === 'HR' || role === 'MKT') ? '/admin/integrations?section=comms' : '/admin/notifications';
  return isEmp ? '/nv' : '/dashboard';
}

/** Hộp thư hệ thống chính thức của HR / Quản trị (tuyệt đối không lấy email của Quản lý cửa hàng / actorEmail). */
export function resolveSystemHrMailbox(ctx: AppContext): string {
  for (const u of ctx.db.users.all()) {
    if (u.status === 'ACTIVE' && u.role === 'HR' && u.email && !isSyntheticDemoEmail(u.email)) return u.email.trim().toLowerCase();
  }
  if (ctx.env.EMAIL_FROM_ADDRESS && !isSyntheticDemoEmail(ctx.env.EMAIL_FROM_ADDRESS)) {
    return ctx.env.EMAIL_FROM_ADDRESS.trim().toLowerCase();
  }
  for (const u of ctx.db.users.all()) {
    if (u.status === 'ACTIVE' && u.role === 'ADMIN' && u.email && !isSyntheticDemoEmail(u.email)) return u.email.trim().toLowerCase();
  }
  return '3do.service.veo@gmail.com';
}

export function resolveFallbackRealEmail(ctx: AppContext): string {
  return resolveSystemHrMailbox(ctx);
}

/** Chỉ trả về email thật cá nhân của chính tài khoản đó (hoặc rỗng '' nếu chưa cấu hình — tuyệt đối không mượn email người khác). */
export function resolveUserPersonalRealEmail(ctx: AppContext, user: User): string {
  if (user.email && !isSyntheticDemoEmail(user.email)) return user.email.trim().toLowerCase();
  const emp = findLinkedEmployeeForUser(user, ctx);
  if (emp?.email && !isSyntheticDemoEmail(emp.email)) return emp.email.trim().toLowerCase();
  return '';
}

export function resolveRealAccountEmail(ctx: AppContext, user: User): string {
  return resolveUserPersonalRealEmail(ctx, user) || resolveSystemHrMailbox(ctx);
}

function enqueueAccountOrAuditEmail(
  ctx: AppContext,
  user: User,
  params: {
    template: 'ACCOUNT_ACTIVATED' | 'ACCOUNT_REVOKED';
    ref: string;
    subject?: string;
    personalSummary: string;
    auditSummary: string;
    metadata: { label: string; value: string }[];
    personalActionLabel?: string;
    personalTarget?: PortalLinkTarget;
    dedupeKey: string;
  },
) {
  const personalEmail = resolveUserPersonalRealEmail(ctx, user);
  const origin = webOrigin(ctx);
  if (personalEmail) {
    ctx.email.enqueue({
      to: personalEmail, template: params.template, ...(params.subject ? { subject: params.subject } : {}),
      recipientName: user.display_name || user.username, referenceCode: params.ref, summary: params.personalSummary,
      metadata: params.metadata,
      ...(params.personalActionLabel && params.personalTarget
        ? { actionLabel: params.personalActionLabel, actionUrl: `${origin}${resolveRolePortalPath(user.role, params.personalTarget)}` }
        : {}),
    }, { dedupeKey: params.dedupeKey });
  } else {
    ctx.email.enqueue({
      to: resolveSystemHrMailbox(ctx), template: params.template,
      subject: params.subject ? `${params.subject} — Lưu vết Quản trị` : undefined,
      recipientName: 'Quản trị hệ thống & Phòng Nhân sự', referenceCode: params.ref, summary: params.auditSummary,
      metadata: [...params.metadata, { label: 'Ghi chú hộp thư', value: 'Tài khoản chưa đăng ký email cá nhân — lưu biên bản tại hộp thư Quản trị' }],
      actionLabel: 'Mở Quản lý Tài khoản', actionUrl: `${origin}/admin/accounts`,
    }, { dedupeKey: `${params.dedupeKey}:audit` });
  }
  void ctx.email.processQueueBatch(3);
}

export function queueAccountCreatedEmail(ctx: AppContext, user: User, _actorEmail?: string) {
  const isEmp = isEmployeeRole(user.role), ref = `ACC-${user.id.slice(0, 8).toUpperCase()}`, isActive = user.status === 'ACTIVE';
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_ACTIVATED', ref,
    subject: isActive ? `${SYSTEM_CONFIG.emailSubjectPrefix} Khởi tạo và kích hoạt tài khoản (${ref})` : `${SYSTEM_CONFIG.emailSubjectPrefix} Khởi tạo tài khoản chờ kích hoạt (${ref})`,
    personalSummary: isActive ? `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của bạn (@${user.username}) đã được khởi tạo và kích hoạt chính thức.` : `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của bạn (@${user.username}) đã được khởi tạo ở trạng thái Chờ Quản trị viên kích hoạt.`,
    auditSummary: `Biên bản khởi tạo tài khoản @${user.username} (${user.display_name} — ${ROLE_LABELS[user.role]}).`,
    metadata: [{ label: 'Tên đăng nhập', value: user.username }, { label: 'Họ tên hiển thị', value: user.display_name }, { label: 'Vai trò hệ thống', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }],
    personalActionLabel: isEmp ? 'Đăng nhập Cổng Nhân viên' : 'Đăng nhập Quản trị hệ thống', personalTarget: 'login',
    dedupeKey: `acc_create:${user.id}:v${user.version}`,
  });
}

export function queueAccountActivatedEmail(ctx: AppContext, user: User, _actorEmail?: string) {
  const ref = `ACC-${user.id.slice(0, 8).toUpperCase()}`, isEmp = isEmployeeRole(user.role);
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_ACTIVATED', ref,
    personalSummary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của bạn (@${user.username}) đã được kích hoạt chính thức.`,
    auditSummary: `Biên bản kích hoạt chính thức tài khoản @${user.username} (${user.display_name} — ${ROLE_LABELS[user.role]}).`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.ACTIVE }],
    personalActionLabel: isEmp ? 'Đăng nhập Cổng Nhân viên ngay' : 'Đăng nhập Quản trị ngay', personalTarget: 'login',
    dedupeKey: `acc_activate:${user.id}:v${user.version}`,
  });
}

export function queueAccountLockedEmail(ctx: AppContext, user: User, reason?: string, _actorEmail?: string) {
  const ref = `LCK-${user.id.slice(0, 8).toUpperCase()}`;
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_REVOKED', ref, subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Thông báo khóa tạm thời tài khoản (${ref})`,
    personalSummary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của bạn (@${user.username}) đã bị khóa tạm thời bởi Quản trị viên.`,
    auditSummary: `Biên bản khóa tạm thời tài khoản @${user.username} (${user.display_name}).`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.LOCKED }, { label: 'Lý do khóa tạm thời', value: reason || 'Khóa tạm thời bởi Quản trị viên' }],
    dedupeKey: `acc_lock:${user.id}:v${user.version}`,
  });
}

export function queueAccountUnlockedEmail(ctx: AppContext, user: User, _actorEmail?: string) {
  const ref = `ULK-${user.id.slice(0, 8).toUpperCase()}`, isEmp = isEmployeeRole(user.role);
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_ACTIVATED', ref, subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Thông báo mở khóa tài khoản đăng nhập (${ref})`,
    personalSummary: `Tài khoản hệ thống ${SYSTEM_CONFIG.brandName} của bạn (@${user.username}) đã được mở khóa đăng nhập và hoạt động trở lại.`,
    auditSummary: `Biên bản mở khóa tài khoản @${user.username} (${user.display_name}).`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Vai trò', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }],
    personalActionLabel: isEmp ? 'Đăng nhập Cổng Nhân viên' : 'Đăng nhập Quản trị hệ thống', personalTarget: 'login',
    dedupeKey: `acc_unlock:${user.id}:v${user.version}`,
  });
}

export function queueAccountRevokedEmail(ctx: AppContext, user: User, reason?: string, _actorEmail?: string) {
  const ref = `REV-${user.id.slice(0, 8).toUpperCase()}`;
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_REVOKED', ref,
    personalSummary: `Quyền truy cập hệ thống ${SYSTEM_CONFIG.brandName} của tài khoản @${user.username} đã bị thu hồi.`,
    auditSummary: `Biên bản thu hồi quyền truy cập tài khoản @${user.username} (${user.display_name}).`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Họ tên nhân sự', value: user.display_name }, { label: 'Lý do thu hồi', value: reason || 'Theo quyết định quản trị' }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS.REVOKED }],
    dedupeKey: `acc_revoke:${user.id}:v${user.version}`,
  });
}

export function queueAccountUpdatedEmail(ctx: AppContext, user: User, changeNote: string, _actorEmail?: string) {
  const ref = `UPD-${user.id.slice(0, 8).toUpperCase()}`, isEmp = isEmployeeRole(user.role);
  enqueueAccountOrAuditEmail(ctx, user, {
    template: 'ACCOUNT_ACTIVATED', ref, subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cập nhật thông tin và phân quyền tài khoản (${ref})`,
    personalSummary: `Thông tin hoặc phân quyền tài khoản @${user.username} của bạn vừa được Quản trị viên cập nhật.`,
    auditSummary: `Biên bản cập nhật phân quyền tài khoản @${user.username} (${user.display_name}).`,
    metadata: [{ label: 'Tên tài khoản', value: user.username }, { label: 'Vai trò hiện tại', value: ROLE_LABELS[user.role] }, { label: 'Trạng thái', value: ACCOUNT_STATUS_LABELS[user.status] }, { label: 'Nội dung cập nhật', value: changeNote }],
    personalActionLabel: isEmp ? 'Mở Cổng Nhân viên' : 'Kiểm tra trên Hệ thống Quản trị', personalTarget: 'home',
    dedupeKey: `acc_update:${user.id}:v${user.version}`,
  });
}

export function queueEmployeeOnboardedEmail(ctx: AppContext, emp: Employee, _actorEmail?: string) {
  const linkedUser = findLinkedUserForEmployee(emp, ctx);
  const personalEmail = (emp.email && !isSyntheticDemoEmail(emp.email) ? emp.email : linkedUser?.email && !isSyntheticDemoEmail(linkedUser.email) ? linkedUser.email : '').trim().toLowerCase();
  if (!personalEmail) return;
  const branchName = ctx.db.branches.get(emp.branch_id)?.name || 'Ụm Bò Milk', role = resolveEmployeeRole(ctx, emp, linkedUser);
  ctx.email.enqueue({
    to: personalEmail, template: 'ACCOUNT_ACTIVATED', subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Tiếp nhận hồ sơ nhân sự mới (${emp.employee_code})`,
    recipientName: emp.full_name, referenceCode: emp.employee_code,
    summary: `Chào mừng ${emp.full_name} (${emp.employee_code}) gia nhập hệ thống ${SYSTEM_CONFIG.brandName}. Hồ sơ nhân sự của bạn đã được khởi tạo chính thức.`,
    metadata: [{ label: 'Mã & Họ tên nhân sự', value: `${emp.full_name} (${emp.employee_code})` }, { label: 'Chi nhánh làm việc', value: branchName }, { label: 'Vị trí công việc', value: emp.position_title || STAFF_GROUP_LABELS[emp.staff_group as StaffGroup] || emp.staff_group }],
    actionLabel: isEmployeeRole(role) ? 'Mở Cổng Nhân viên' : 'Xem hồ sơ nhân sự', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(role, 'home')}`,
  }, { dedupeKey: `emp_onboard:${emp.id}` });
  void ctx.email.processQueueBatch(3);
}
