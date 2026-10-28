import { DEFAULT_SHIFT_LABELS, ROLE_LABELS, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type Candidate, type EmergencyLeave, type Employee, type Interview, type LeaveRequest, type PayPeriod, type Payslip, type Role, type ShiftSwap, type StaffGroup } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveFallbackRealEmail } from './account-email-dispatcher.js';
import { isSyntheticDemoEmail } from './email.service.js';

export * from './account-email-dispatcher.js';
const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;

export function resolveEmployeeContact(ctx: AppContext, empIdOrCode: string, useFallback = true) {
  if (!empIdOrCode) return null;
  const emp = ctx.db.employees.get(empIdOrCode) ?? ctx.db.employees.find((e) => e.employee_code === empIdOrCode);
  const user = emp
    ? (emp.user_id ? ctx.db.users.get(emp.user_id) : undefined) ?? ctx.db.users.find((u) => u.employee_id === emp.employee_code)
    : ctx.db.users.get(empIdOrCode);
  if (!emp && !user) return null;
  const code = emp?.employee_code || user?.employee_id || user?.username || empIdOrCode;
  const name = emp?.full_name || user?.display_name || user?.username || 'Nhân sự Ụm Bò Milk';
  const rawEmail = (emp?.email && !isSyntheticDemoEmail(emp.email) ? emp.email : user?.email && !isSyntheticDemoEmail(user.email) ? user.email : '') || (useFallback ? resolveFallbackRealEmail(ctx) : `${code.toLowerCase()}@${SYSTEM_CONFIG.companyDomain}`);
  const email = rawEmail.trim().toLowerCase();
  const branchName = (emp?.branch_id ? ctx.db.branches.get(emp.branch_id)?.name : undefined) || 'Ụm Bò Milk';
  return { email, name, code, branchId: emp?.branch_id || 'ALL', branchName };
}

export function resolveRoleContacts(ctx: AppContext, roles: string[], branchId?: string) {
  const roleSet = new Set(roles);
  const results: { email: string; name: string; roleLabel: string }[] = [];
  for (const u of ctx.db.users.all()) {
    if (u.status !== 'ACTIVE' || !roleSet.has(u.role)) continue;
    if (branchId && branchId !== 'ALL' && u.branch_scope !== 'ALL' && !u.branch_scope.split(',').map((s) => s.trim()).includes(branchId)) continue;
    const emp = u.employee_id ? ctx.db.employees.find((e) => e.employee_code === u.employee_id || e.id === u.employee_id) : undefined;
    const rawEmail = (u.email && !isSyntheticDemoEmail(u.email) ? u.email : emp?.email && !isSyntheticDemoEmail(emp.email) ? emp.email : '') || resolveFallbackRealEmail(ctx);
    results.push({ email: rawEmail.trim().toLowerCase(), name: u.display_name || emp?.full_name || u.username, roleLabel: ROLE_LABELS[u.role as Role] ?? u.role });
  }
  return results;
}

export function queueInterviewEmails(ctx: AppContext, params: { candidate: Candidate; interview: Interview; isUpdate?: boolean }) {
  const { candidate, interview, isUpdate } = params;
  const branchName = ctx.db.branches.get(interview.branch_id || candidate.branch_pref)?.name || 'Ụm Bò Milk';
  const slot = interview.start_at.slice(0, 16).replace('T', ' ');
  const candEmail = (!isSyntheticDemoEmail(candidate.email) ? candidate.email : resolveFallbackRealEmail(ctx)).trim().toLowerCase();
  ctx.email.enqueue({
    to: candEmail,
    template: 'INTERVIEW_INVITATION',
    recipientName: candidate.full_name,
    referenceCode: `INT-${candidate.candidate_code}`,
    summary: isUpdate
      ? `Lịch phỏng vấn tuyển dụng của bạn tại ${SYSTEM_CONFIG.brandName} đã được cập nhật sang khung giờ mới.`
      : `Phòng Nhân sự ${SYSTEM_CONFIG.brandName} trân trọng mời bạn tham dự buổi phỏng vấn tuyển dụng.`,
    metadata: [
      { label: 'Ứng viên', value: `${candidate.full_name} (${candidate.candidate_code})` },
      { label: 'Vị trí ứng tuyển', value: candidate.position || STAFF_GROUP_LABELS[candidate.staff_group as StaffGroup] || candidate.staff_group },
      { label: 'Thời gian phỏng vấn', value: `${slot} (${interview.duration_minutes || 30} phút)` },
      { label: 'Chi nhánh đăng ký', value: branchName },
      { label: 'Đường dẫn phòng họp', value: interview.meet_link || 'Trực tiếp / Google Meet' },
    ],
    actionLabel: 'Truy cập phòng họp phỏng vấn',
    actionUrl: interview.meet_link || `${ctx.env.API_PUBLIC_ORIGIN}/login`,
  });
}

export function queuePromotionOfficialEmail(ctx: AppContext, emp: Employee) {
  const contact = resolveEmployeeContact(ctx, emp.id);
  if (!contact) return;
  ctx.email.enqueue({
    to: contact.email,
    template: 'PROBATION_TO_OFFICIAL',
    recipientName: contact.name,
    referenceCode: `PRO-${emp.employee_code}`,
    summary: `Chúc mừng bạn đã hoàn thành chu kỳ thử việc và chính thức được bổ nhiệm làm Nhân viên Chính thức tại ${SYSTEM_CONFIG.brandName}.`,
    metadata: [
      { label: 'Họ tên & Mã nhân sự', value: `${emp.full_name} (${emp.employee_code})` },
      { label: 'Giai đoạn nhân sự mới', value: 'Nhân viên chính thức' },
      { label: 'Ngày chính thức', value: emp.official_from || 'Hôm nay' },
      { label: 'Chi nhánh làm việc', value: contact.branchName },
    ],
    actionLabel: 'Mở Cổng Nhân Viên',
    actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv`,
  });
}

export function queueScheduleShiftEmail(ctx: AppContext, params: { empId: string; shiftLabel: string; workDate: string; startAt: string; endAt: string; branchId: string; code: string }) {
  const contact = resolveEmployeeContact(ctx, params.empId);
  if (!contact) return;
  const branchName = ctx.db.branches.get(params.branchId)?.name || contact.branchName;
  ctx.email.enqueue({
    to: contact.email,
    template: 'SCHEDULE_SHIFT_DECISION',
    recipientName: contact.name,
    referenceCode: params.code,
    summary: `Ca làm việc ngày ${params.workDate} của bạn đã được phê duyệt phân ca chính thức.`,
    metadata: [
      { label: 'Nhân sự', value: `${contact.name} (${contact.code})` },
      { label: 'Ngày làm việc', value: params.workDate },
      { label: 'Khung ca & Giờ ca', value: `${params.shiftLabel} (${params.startAt} - ${params.endAt})` },
      { label: 'Chi nhánh', value: branchName },
    ],
    actionLabel: 'Xem lịch làm việc của bạn',
    actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/lich`,
  });
}

export function queueLeaveDecisionEmail(ctx: AppContext, leave: LeaveRequest) {
  const contact = resolveEmployeeContact(ctx, leave.employee_id);
  if (!contact) return;
  const approved = leave.status === 'APPROVED';
  ctx.email.enqueue({
    to: contact.email,
    template: 'LEAVE_SWAP_DECISION',
    recipientName: contact.name,
    referenceCode: leave.request_code || `OFF-${leave.id.slice(0, 6)}`,
    summary: `Đơn đăng ký nghỉ phép (OFF) ngày ${leave.leave_date} của bạn đã ${approved ? 'được phê duyệt' : 'bị từ chối'}.`,
    metadata: [
      { label: 'Mã đơn nghỉ OFF', value: leave.request_code },
      { label: 'Ngày xin nghỉ', value: leave.leave_date },
      { label: 'Kết quả xử lý', value: approved ? 'Đã phê duyệt' : 'Từ chối' },
      { label: 'Ghi chú / Lý do', value: leave.decision_reason || leave.reason || 'Theo định biên vận hành' },
    ],
    actionLabel: 'Xem chi tiết đơn nghỉ OFF',
    actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/nghi-phep`,
  });
}

export function queueSwapEventEmail(ctx: AppContext, swap: ShiftSwap, stage: 'CREATED' | 'DECIDED') {
  const reqContact = resolveEmployeeContact(ctx, swap.requester_id);
  const peerContact = resolveEmployeeContact(ctx, swap.peer_id);
  if (stage === 'CREATED' && peerContact) {
    ctx.email.enqueue({
      to: peerContact.email,
      template: 'LEAVE_SWAP_DECISION',
      recipientName: peerContact.name,
      referenceCode: swap.swap_code,
      summary: `Đồng nghiệp ${reqContact?.name || swap.requester_id} vừa gửi đề nghị nhờ bạn nhận thay ca ngày ${swap.from_work_date}.`,
      metadata: [
        { label: 'Mã yêu cầu đổi ca', value: swap.swap_code },
        { label: 'Ngày & Khung ca', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` },
        { label: 'Người xin đổi', value: `${reqContact?.name || swap.requester_id} (${reqContact?.code || ''})` },
        { label: 'Lý do đổi ca', value: swap.reason },
      ],
      actionLabel: 'Xác nhận Đồng ý / Từ chối nhận ca',
      actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/doi-ca`,
    });
    return;
  }
  const approved = swap.status === 'APPROVED';
  for (const c of [reqContact, peerContact]) {
    if (!c) continue;
    ctx.email.enqueue({
      to: c.email,
      template: 'LEAVE_SWAP_DECISION',
      recipientName: c.name,
      referenceCode: `${swap.swap_code}-${swap.status}`,
      summary: `Yêu cầu đổi ca ${swap.swap_code} ngày ${swap.from_work_date} đã ${approved ? 'được Quản lý phê duyệt (Bước 3/3 — Đã cập nhật lịch chính thức)' : 'bị từ chối'}.`,
      metadata: [
        { label: 'Mã đơn đổi ca', value: swap.swap_code },
        { label: 'Ngày ca hoán đổi', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` },
        { label: 'Kết quả duyệt cuối', value: approved ? 'Đã phê duyệt & chuyển lịch chính thức' : 'Từ chối' },
        { label: 'Ghi chú Quản lý', value: swap.decision_reason || 'Đảm bảo định biên ca trực' },
      ],
      actionLabel: 'Kiểm tra lịch làm việc mới',
      actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/lich`,
    });
  }
}

export function queueEmergencyLeaveEmail(ctx: AppContext, emg: EmergencyLeave) {
  const empContact = resolveEmployeeContact(ctx, emg.employee_id);
  const managers = resolveRoleContacts(ctx, ['STORE', 'HR'], emg.branch_id);
  for (const mgr of managers.slice(0, 3)) {
    ctx.email.enqueue({
      to: mgr.email,
      template: 'EMERGENCY_LEAVE_ALERT',
      recipientName: mgr.name,
      referenceCode: emg.emergency_code,
      summary: `Cảnh báo nghỉ đột xuất sát giờ ca (<12h): Nhân sự ${empContact?.name || emg.employee_id} vừa báo nghỉ khẩn cấp ngày ${emg.work_date}.`,
      metadata: [
        { label: 'Mã báo cáo khẩn', value: emg.emergency_code },
        { label: 'Nhân sự báo nghỉ', value: `${empContact?.name || emg.employee_id} (${empContact?.code || ''})` },
        { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` },
        { label: 'Lý do khẩn cấp', value: emg.reason },
      ],
      actionLabel: 'Điều phối người thay thế ngay',
      actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/admin/schedules?section=workflows`,
    });
  }
}

export function queueTestAssignedEmail(ctx: AppContext, params: { empId: string; testTitle: string; durationMinutes: number; passScore: number; code: string }) {
  const contact = resolveEmployeeContact(ctx, params.empId);
  if (!contact) return;
  ctx.email.enqueue({
    to: contact.email,
    template: 'TEST_ASSIGNED',
    recipientName: contact.name,
    referenceCode: params.code,
    summary: `Phòng Nhân sự vừa giao cho bạn bài kiểm tra nghiệp vụ "${params.testTitle}".`,
    metadata: [
      { label: 'Nhân sự dự thi', value: `${contact.name} (${contact.code})` },
      { label: 'Tên bài kiểm tra', value: params.testTitle },
      { label: 'Thời lượng & Điểm đạt', value: `${params.durationMinutes} phút · Tối thiểu ${params.passScore}/100 điểm` },
    ],
    actionLabel: 'Làm bài kiểm tra ngay',
    actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/bai-kiem-tra`,
  });
}

export function queuePayslipPublishedEmails(ctx: AppContext, period: PayPeriod, slips: Payslip[]) {
  for (const slip of slips) {
    const contact = resolveEmployeeContact(ctx, slip.employee_id, slips.length === 1);
    if (!contact) continue;
    ctx.email.enqueue({
      to: contact.email, template: 'PAYSLIP_PUBLISHED', recipientName: contact.name, referenceCode: slip.payslip_code,
      summary: `Phiếu lương kỳ "${period.name}" (${period.from_date} đến ${period.to_date}) của bạn đã được phát hành chính thức.`,
      metadata: [{ label: 'Mã phiếu lương', value: slip.payslip_code }, { label: 'Kỳ lương', value: `${period.name} (${period.from_date} - ${period.to_date})` }, { label: 'Tổng giờ công', value: `${slip.approved_hours} giờ (OT: ${slip.ot_hours} giờ)` }, { label: 'Thực lĩnh (NET)', value: `${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ` }],
      actionLabel: 'Xem & Xác nhận Phiếu lương', actionUrl: `${ctx.env.API_PUBLIC_ORIGIN}/nv/phieu-luong`,
    });
  }
}
