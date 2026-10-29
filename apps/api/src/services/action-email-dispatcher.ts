import { DEFAULT_SHIFT_LABELS, isEmployeeRole, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type Candidate, type EmergencyLeave, type Employee, type Interview, type PayPeriod, type Payslip, type ShiftSwap, type StaffGroup } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { resolveRolePortalPath, resolveSystemHrMailbox, webOrigin } from './account-email-dispatcher.js';
import { isSyntheticDemoEmail } from './email.service.js';
import { resolveManagerReviewRecipients, resolveStrictEmployeeContact, type StrictEmployeeContact } from './workflow-email-dispatcher.js';

export * from './account-email-dispatcher.js';
export * from './workflow-email-dispatcher.js';

const shiftLabel = (code: string) => (DEFAULT_SHIFT_LABELS as Record<string, string>)[code] ?? code;
const flushMail = (ctx: AppContext, count: number) => { if (count > 0) void ctx.email.processQueueBatch(Math.min(8, count)); };

function managerRolesFor(ctx: AppContext, contact: StrictEmployeeContact | null, actorId?: string): ('HR' | 'STORE')[] {
  const actorRole = actorId ? ctx.db.users.get(actorId)?.role : undefined;
  return Boolean(contact?.isBoOrManager || (actorRole && ['ADMIN', 'HR', 'FINANCE', 'MKT'].includes(actorRole))) ? ['HR'] : ['HR', 'STORE'];
}

export function queueSwapEventEmail(ctx: AppContext, swap: ShiftSwap, stage: 'CREATED' | 'PEER_RESPONDED' | 'DECIDED', actorId?: string) {
  const reqContact = resolveStrictEmployeeContact(ctx, swap.requester_id);
  const peerContact = resolveStrictEmployeeContact(ctx, swap.peer_id);
  const branchName = ctx.db.branches.get(swap.branch_id)?.name || reqContact?.branchName || 'Chi nhánh';
  let queued = 0;

  if (stage === 'CREATED') {
    if (peerContact?.personalEmail && peerContact.userId !== actorId) {
      ctx.email.enqueue({
        to: peerContact.personalEmail, template: 'LEAVE_SWAP_DECISION', recipientName: peerContact.name, referenceCode: swap.swap_code,
        summary: `Đồng nghiệp ${reqContact?.name || swap.requester_id} vừa gửi đề nghị nhờ bạn nhận thay ca ngày ${swap.from_work_date}.`,
        metadata: [{ label: 'Mã yêu cầu đổi ca', value: swap.swap_code }, { label: 'Ngày & Khung ca', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }, { label: 'Người xin đổi', value: `${reqContact?.name || swap.requester_id} (${reqContact?.code || ''})` }, { label: 'Lý do đổi ca', value: swap.reason }],
        actionLabel: 'Xác nhận Đồng ý / Từ chối nhận ca', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(peerContact.role, 'swap')}`,
      }, { dedupeKey: `swap_create:${swap.id}:${peerContact.personalEmail}` });
      queued += 1;
    }
    return flushMail(ctx, queued);
  }

  if (stage === 'PEER_RESPONDED') {
    const accepted = swap.status === 'PEER_ACCEPTED';
    if (accepted) {
      const managers = resolveManagerReviewRecipients(ctx, { roles: managerRolesFor(ctx, reqContact, actorId), branchId: swap.branch_id || reqContact?.branchId, actorId });
      for (const mgr of managers) {
        ctx.email.enqueue({
          to: mgr.email, template: 'LEAVE_SWAP_DECISION',
          subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Yêu cầu đổi ca chờ Quản lý / HR phê duyệt (${swap.swap_code})`,
          recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: `${swap.swap_code}-B2`,
          summary: `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã xác nhận đồng ý nhận thay ca ngày ${swap.from_work_date} cho ${reqContact?.name || swap.requester_id} tại ${branchName}. Đơn đang chờ phê duyệt Bước 3/3.`,
          metadata: [{ label: 'Mã đơn đổi ca', value: swap.swap_code }, { label: 'Người xin đổi', value: `${reqContact?.name || swap.requester_id} (${reqContact?.code || ''})` }, { label: 'Người nhận thay', value: `${peerContact?.name || swap.peer_id} (${peerContact?.code || ''})` }, { label: 'Chi nhánh & Ca', value: `${branchName} · ${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }],
          actionLabel: 'Phê duyệt yêu cầu đổi ca', actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
        }, { dedupeKey: `swap_mgr:${swap.id}:v${swap.version}:${mgr.email}` });
        queued += 1;
      }
    }
    if (reqContact?.personalEmail && reqContact.userId !== actorId) {
      ctx.email.enqueue({
        to: reqContact.personalEmail, template: 'LEAVE_SWAP_DECISION', recipientName: reqContact.name, referenceCode: `${swap.swap_code}-PEER`,
        summary: accepted
          ? `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã đồng ý nhận thay ca ngày ${swap.from_work_date}. Yêu cầu ${swap.swap_code} đã chuyển lên Quản lý / HR phê duyệt.`
          : `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã từ chối nhận thay ca ngày ${swap.from_work_date} (${swap.swap_code}).`,
        metadata: [{ label: 'Mã đơn đổi ca', value: swap.swap_code }, { label: 'Ngày & Khung ca', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }, { label: 'Phản hồi đồng nghiệp', value: accepted ? 'Đã đồng ý (Chờ Quản lý / HR duyệt)' : 'Từ chối nhận ca' }, { label: 'Ghi chú', value: swap.peer_note || swap.reason }],
        actionLabel: 'Xem chi tiết yêu cầu đổi ca', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(reqContact.role, 'swap')}`,
      }, { dedupeKey: `swap_peer_req:${swap.id}:v${swap.version}` });
      queued += 1;
    }
    return flushMail(ctx, queued);
  }

  const approved = swap.status === 'APPROVED';
  for (const c of [reqContact, peerContact]) {
    if (!c?.personalEmail || c.userId === (actorId || swap.decided_by)) continue;
    ctx.email.enqueue({
      to: c.personalEmail, template: 'LEAVE_SWAP_DECISION', recipientName: c.name, referenceCode: `${swap.swap_code}-${swap.status}`,
      summary: `Yêu cầu đổi ca ${swap.swap_code} ngày ${swap.from_work_date} đã ${approved ? 'được Quản lý phê duyệt (Bước 3/3 — Đã cập nhật lịch chính thức)' : 'bị từ chối'}.`,
      metadata: [{ label: 'Mã đơn đổi ca', value: swap.swap_code }, { label: 'Ngày ca hoán đổi', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }, { label: 'Kết quả duyệt cuối', value: approved ? 'Đã phê duyệt & chuyển lịch chính thức' : 'Từ chối' }, { label: 'Ghi chú Quản lý', value: swap.decision_reason || 'Đảm bảo định biên ca trực' }],
      actionLabel: 'Kiểm tra lịch làm việc mới', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(c.role, 'schedule')}`,
    }, { dedupeKey: `swap_decide:${swap.id}:v${swap.version}:${c.personalEmail}` });
    queued += 1;
  }
  flushMail(ctx, queued);
}

export function queueEmergencyLeaveEmail(ctx: AppContext, emg: EmergencyLeave, actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, emg.employee_id);
  const branchName = ctx.db.branches.get(emg.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  const managers = resolveManagerReviewRecipients(ctx, { roles: managerRolesFor(ctx, emp, actorId), branchId: emg.branch_id || emp?.branchId, actorId });
  for (const mgr of managers) {
    ctx.email.enqueue({
      to: mgr.email, template: 'EMERGENCY_LEAVE_ALERT', recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: emg.emergency_code,
      summary: `Cảnh báo nghỉ đột xuất sát giờ ca (<12h): Nhân sự ${emp ? `${emp.name} (${emp.code})` : emg.employee_id} tại ${branchName} vừa báo nghỉ khẩn cấp ngày ${emg.work_date}.`,
      metadata: [{ label: 'Mã báo cáo khẩn', value: emg.emergency_code }, { label: 'Nhân sự & Chi nhánh', value: `${emp ? `${emp.name} (${emp.code})` : emg.employee_id} · ${branchName}` }, { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` }, { label: 'Lý do khẩn cấp', value: emg.reason }],
      actionLabel: 'Điều phối người thay thế ngay', actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
    }, { dedupeKey: `emg_create:${emg.id}:${mgr.email}` });
  }
  flushMail(ctx, managers.length);
}

export function queueEmergencyHandledEmail(ctx: AppContext, emg: EmergencyLeave, actorId?: string) {
  const emp = resolveStrictEmployeeContact(ctx, emg.employee_id);
  const branchName = ctx.db.branches.get(emg.branch_id)?.name || emp?.branchName || 'Chi nhánh';
  let queued = 0;
  if (emg.status === 'ESCALATED') {
    const hrList = resolveManagerReviewRecipients(ctx, { roles: ['HR'], branchId: emg.branch_id, actorId: actorId || emg.handled_by });
    for (const hr of hrList) {
      ctx.email.enqueue({
        to: hr.email, template: 'EMERGENCY_LEAVE_ALERT',
        subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cửa hàng báo thiếu nhân sự ca khẩn cấp lên HR (${emg.emergency_code})`,
        recipientName: `${hr.name} (${hr.roleLabel})`, referenceCode: `${emg.emergency_code}-HR`,
        summary: `Cửa hàng ${branchName} vừa chuyển cảnh báo thiếu nhân sự cho ca ${shiftLabel(emg.shift_code)} ngày ${emg.work_date} (nhân sự nghỉ: ${emp ? `${emp.name} (${emp.code})` : emg.employee_id}) lên Phòng Nhân sự (HR) để hỗ trợ điều phối.`,
        metadata: [{ label: 'Mã báo cáo khẩn', value: emg.emergency_code }, { label: 'Chi nhánh thiếu người', value: branchName }, { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` }, { label: 'Ghi chú từ Cửa hàng', value: emg.resolution_note || emg.reason }],
        actionLabel: 'Điều phối chi viện tại Phân hệ HR', actionUrl: `${webOrigin(ctx)}/admin/schedules?section=workflows`,
      }, { dedupeKey: `emg_esc:${emg.id}:v${emg.version}:${hr.email}` });
      queued += 1;
    }
    return flushMail(ctx, queued);
  }
  if (emp?.personalEmail && emp.userId !== (actorId || emg.handled_by)) {
    ctx.email.enqueue({
      to: emp.personalEmail, template: 'EMERGENCY_LEAVE_ALERT',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Cập nhật xử lý báo nghỉ khẩn cấp của bạn (${emg.emergency_code})`,
      recipientName: emp.name, referenceCode: emg.emergency_code,
      summary: `Báo cáo nghỉ đột xuất ${emg.emergency_code} ngày ${emg.work_date} của bạn đã được Quản lý điều phối xử lý.`,
      metadata: [{ label: 'Mã báo cáo', value: emg.emergency_code }, { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` }, { label: 'Ghi chú xử lý', value: emg.resolution_note || 'Đã điều phối phương án trực ca' }],
      actionLabel: 'Xem lịch & báo nghỉ của tôi', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(emp.role, 'leave')}`,
    }, { dedupeKey: `emg_emp:${emg.id}:v${emg.version}` });
    queued += 1;
  }
  const rep = emg.replacement_id ? resolveStrictEmployeeContact(ctx, emg.replacement_id) : null;
  if (rep?.personalEmail && rep.userId !== (actorId || emg.handled_by)) {
    ctx.email.enqueue({
      to: rep.personalEmail, template: 'SCHEDULE_SHIFT_DECISION',
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Phân công trực thay ca khẩn cấp ngày ${emg.work_date} (${emg.emergency_code})`,
      recipientName: rep.name, referenceCode: `${emg.emergency_code}-REP`,
      summary: `Bạn vừa được Quản lý phân công trực thay ${shiftLabel(emg.shift_code)} ngày ${emg.work_date} tại ${branchName} (thay cho ${emp?.name || emg.employee_id}).`,
      metadata: [{ label: 'Nhân sự trực thay', value: `${rep.name} (${rep.code})` }, { label: 'Ngày & Khung ca', value: `${emg.work_date} (${shiftLabel(emg.shift_code)})` }, { label: 'Chi nhánh', value: branchName }],
      actionLabel: 'Xem lịch làm việc của bạn', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(rep.role, 'schedule')}`,
    }, { dedupeKey: `emg_rep:${emg.id}:v${emg.version}` });
    queued += 1;
  }
  flushMail(ctx, queued);
}

export function queueInterviewEmails(ctx: AppContext, params: { candidate: Candidate; interview: Interview; isUpdate?: boolean }) {
  const { candidate, interview, isUpdate } = params;
  if (!candidate.email || isSyntheticDemoEmail(candidate.email)) return;
  const branchName = ctx.db.branches.get(interview.branch_id || candidate.branch_pref)?.name || 'Ụm Bò Milk';
  const slot = interview.start_at.slice(0, 16).replace('T', ' ');
  ctx.email.enqueue({
    to: candidate.email.trim().toLowerCase(), template: 'INTERVIEW_INVITATION', recipientName: candidate.full_name, referenceCode: `INT-${candidate.candidate_code}`,
    summary: isUpdate ? `Lịch phỏng vấn tuyển dụng của bạn tại ${SYSTEM_CONFIG.brandName} đã được cập nhật sang khung giờ mới.` : `Phòng Nhân sự ${SYSTEM_CONFIG.brandName} trân trọng mời bạn tham dự buổi phỏng vấn tuyển dụng.`,
    metadata: [{ label: 'Ứng viên', value: `${candidate.full_name} (${candidate.candidate_code})` }, { label: 'Vị trí ứng tuyển', value: candidate.position || STAFF_GROUP_LABELS[candidate.staff_group as StaffGroup] || candidate.staff_group }, { label: 'Thời gian phỏng vấn', value: `${slot} (${interview.duration_minutes || 30} phút)` }, { label: 'Chi nhánh đăng ký', value: branchName }, { label: 'Đường dẫn phòng họp', value: interview.meet_link || 'Trực tiếp / Google Meet' }],
    actionLabel: 'Truy cập phòng họp phỏng vấn', actionUrl: interview.meet_link || `${webOrigin(ctx)}/nv/login`,
  });
  flushMail(ctx, 1);
}

export function queuePromotionOfficialEmail(ctx: AppContext, emp: Employee) {
  const contact = resolveStrictEmployeeContact(ctx, emp.id);
  if (!contact?.personalEmail) return;
  ctx.email.enqueue({
    to: contact.personalEmail, template: 'PROBATION_TO_OFFICIAL', recipientName: contact.name, referenceCode: `PRO-${emp.employee_code}`,
    summary: `Chúc mừng bạn đã hoàn thành chu kỳ thử việc và chính thức được bổ nhiệm làm Nhân viên Chính thức tại ${SYSTEM_CONFIG.brandName}.`,
    metadata: [{ label: 'Họ tên & Mã nhân sự', value: `${emp.full_name} (${emp.employee_code})` }, { label: 'Giai đoạn nhân sự mới', value: 'Nhân viên chính thức' }, { label: 'Ngày chính thức', value: emp.official_from || 'Hôm nay' }, { label: 'Chi nhánh làm việc', value: contact.branchName }],
    actionLabel: isEmployeeRole(contact.role) ? 'Mở Cổng Nhân Viên' : 'Mở Hệ thống Quản trị', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(contact.role, 'home')}`,
  });
  flushMail(ctx, 1);
}

export function queueTestAssignedEmail(ctx: AppContext, params: { empId: string; testTitle: string; durationMinutes: number; passScore: number; code: string }) {
  const contact = resolveStrictEmployeeContact(ctx, params.empId);
  if (!contact?.personalEmail) return;
  ctx.email.enqueue({
    to: contact.personalEmail, template: 'TEST_ASSIGNED', recipientName: contact.name, referenceCode: params.code,
    summary: `Phòng Nhân sự vừa giao cho bạn bài kiểm tra nghiệp vụ "${params.testTitle}".`,
    metadata: [{ label: 'Nhân sự dự thi', value: `${contact.name} (${contact.code})` }, { label: 'Tên bài kiểm tra', value: params.testTitle }, { label: 'Thời lượng & Điểm đạt', value: `${params.durationMinutes} phút · Tối thiểu ${params.passScore}/100 điểm` }],
    actionLabel: 'Làm bài kiểm tra ngay', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(contact.role, 'test')}`,
  });
  flushMail(ctx, 1);
}

export function queuePayslipPublishedEmails(ctx: AppContext, period: PayPeriod, slips: Payslip[], opts?: { actorEmail?: string; isPaid?: boolean; force?: boolean }): number {
  let queued = 0;
  const isPaid = Boolean(opts?.isPaid), hrMailbox = resolveSystemHrMailbox(ctx), sentTo = new Set<string>(), origin = webOrigin(ctx);
  for (const slip of slips) {
    const contact = resolveStrictEmployeeContact(ctx, slip.employee_id || slip.employee_code);
    const empName = contact?.name || slip.full_name || 'Nhân sự Ụm Bò Milk';
    const hasPersonal = Boolean(contact?.personalEmail);
    const to = hasPersonal ? contact!.personalEmail : hrMailbox;
    if (!to) continue;
    sentTo.add(to);
    const refCode = isPaid ? `${slip.payslip_code}-PAID` : slip.payslip_code;
    const dedupeKey = `${isPaid ? 'payslip_paid' : 'payslip_pub'}:${slip.id}:r${slip.revision}${opts?.force ? `:t${Date.now()}` : ''}`;
    ctx.email.enqueue({
      to, template: 'PAYSLIP_PUBLISHED',
      recipientName: hasPersonal ? empName : `Bộ phận Kế toán & Nhân sự (Lưu trữ phiếu lương ${empName})`,
      referenceCode: refCode,
      ...(isPaid ? { subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Xác nhận đã thanh toán lương kỳ ${period.name} (${slip.payslip_code})` } : {}),
      summary: hasPersonal
        ? (isPaid ? `Phiếu lương kỳ "${period.name}" (${period.from_date} đến ${period.to_date}) của bạn đã được Kế toán xác nhận chi trả / tất toán chính thức.` : `Phiếu lương kỳ "${period.name}" (${period.from_date} đến ${period.to_date}) của bạn đã được phát hành chính thức.`)
        : `Lưu trữ phiếu lương ${slip.payslip_code} của nhân sự ${empName} kỳ "${period.name}" (Nhân sự đã nhận phiếu trên Cổng NV, chưa đăng ký email cá nhân).`,
      metadata: [{ label: 'Nhân sự', value: `${empName} (${slip.employee_code || contact?.code || ''})` }, { label: 'Mã phiếu lương', value: slip.payslip_code }, { label: 'Kỳ lương', value: `${period.name} (${period.from_date} - ${period.to_date})` }, { label: 'Tổng công & Giờ làm', value: `${slip.total_shifts_count} ca · ${slip.approved_hours} giờ (OT: ${slip.ot_hours} giờ)` }, { label: 'Thực lĩnh (NET)', value: `${Number(slip.net_vnd || 0).toLocaleString('vi-VN')} đ` }],
      actionLabel: hasPersonal ? (isPaid ? 'Xem Phiếu lương đã thanh toán' : 'Xem & Xác nhận Phiếu lương') : 'Mở Bảng lương & Phiếu lương',
      actionUrl: hasPersonal ? `${origin}${resolveRolePortalPath(contact?.role, 'payslip')}` : `${origin}/admin/payroll`,
    }, { dedupeKey });
    queued += 1;
  }
  if (slips.length > 0 && hrMailbox && !sentTo.has(hrMailbox)) {
    const sumRef = `PL-${period.period_code}-${isPaid ? 'PAID-SUM' : 'PUB-SUM'}`, totalNet = slips.reduce((s, x) => s + Number(x.net_vnd || 0), 0);
    ctx.email.enqueue({
      to: hrMailbox, template: 'PAYSLIP_PUBLISHED', recipientName: 'Bộ phận Kế toán & Nhân sự', referenceCode: sumRef,
      subject: `${SYSTEM_CONFIG.emailSubjectPrefix} ${isPaid ? 'Xác nhận chi trả lương kỳ' : 'Tổng hợp phát hành phiếu lương kỳ'} ${period.name} (${slips.length} nhân sự)`,
      summary: `Kỳ lương "${period.name}" (${period.from_date} đến ${period.to_date}) đã ${isPaid ? 'được xác nhận thanh toán' : 'phát hành phiếu lương chính thức'} cho ${slips.length} nhân sự.`,
      metadata: [{ label: 'Kỳ lương', value: `${period.name} (${period.period_code})` }, { label: 'Số phiếu lương', value: `${slips.length} nhân sự` }, { label: 'Tổng thực lĩnh (NET)', value: `${totalNet.toLocaleString('vi-VN')} đ` }],
      actionLabel: 'Mở Bảng lương & Phiếu lương', actionUrl: `${origin}/admin/payroll`,
    }, { dedupeKey: `${sumRef}${opts?.force ? `:t${Date.now()}` : ''}` });
    queued += 1;
  }
  flushMail(ctx, queued);
  return queued;
}
