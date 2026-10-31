import { DEFAULT_SHIFT_LABELS, isEmployeeRole, STAFF_GROUP_LABELS, SYSTEM_CONFIG, type Candidate, type Employee, type Interview, type PayPeriod, type Payslip, type ShiftSwap, type StaffGroup } from '@umbm/shared';
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
      const managers = resolveManagerReviewRecipients(ctx, { roles: ['HR'], branchId: swap.branch_id || reqContact?.branchId, actorId });
      for (const mgr of managers) {
        ctx.email.enqueue({
          to: mgr.email, template: 'LEAVE_SWAP_DECISION',
          subject: `${SYSTEM_CONFIG.emailSubjectPrefix} Yêu cầu nhường ca vượt 2 ca/ngày chờ HR phê duyệt (${swap.swap_code})`,
          recipientName: `${mgr.name} (${mgr.roleLabel})`, referenceCode: `${swap.swap_code}-B2`,
          summary: `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã xác nhận đồng ý nhận thay ca ngày ${swap.from_work_date} cho ${reqContact?.name || swap.requester_id} tại ${branchName}. Người nhận sẽ làm quá 2 ca trong ngày nên cần HR phê duyệt.`,
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
          ? `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã đồng ý nhận thay ca ngày ${swap.from_work_date}. Yêu cầu ${swap.swap_code} đã chuyển HR phê duyệt (người nhận vượt 2 ca/ngày).`
          : `Đồng nghiệp ${peerContact?.name || swap.peer_id} đã từ chối nhận thay ca ngày ${swap.from_work_date} (${swap.swap_code}).`,
        metadata: [{ label: 'Mã đơn đổi ca', value: swap.swap_code }, { label: 'Ngày & Khung ca', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }, { label: 'Phản hồi đồng nghiệp', value: accepted ? 'Đã đồng ý (Chờ HR duyệt)' : 'Từ chối nhận ca' }, { label: 'Ghi chú', value: swap.peer_note || swap.reason }],
        actionLabel: 'Xem chi tiết yêu cầu đổi ca', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(reqContact.role, 'swap')}`,
      }, { dedupeKey: `swap_peer_req:${swap.id}:v${swap.version}` });
      queued += 1;
    }
    return flushMail(ctx, queued);
  }

  const approved = swap.status === 'APPROVED', swapAllowanceText = swap.allowance_eligible && swap.allowance_amount_vnd > 0 ? `+${swap.allowance_amount_vnd.toLocaleString('vi-VN')} đ (cộng cho người nhận ca thay)` : 'Không cộng phụ cấp đổi ca (0 đ)';
  for (const c of [reqContact, peerContact]) {
    if (!c?.personalEmail || c.userId === (actorId || swap.decided_by)) continue;
    ctx.email.enqueue({
      to: c.personalEmail, template: 'LEAVE_SWAP_DECISION', recipientName: c.name, referenceCode: `${swap.swap_code}-${swap.status}`,
      summary: `Yêu cầu đổi ca ${swap.swap_code} ngày ${swap.from_work_date} đã ${approved ? 'được chấp thuận và cập nhật lịch làm việc chính thức' : 'bị từ chối'}.`,
      metadata: [{ label: 'Mã đơn đổi ca', value: swap.swap_code }, { label: 'Ngày ca hoán đổi', value: `${swap.from_work_date} (${shiftLabel(swap.from_shift_code)})` }, { label: 'Kết quả duyệt cuối', value: approved ? 'Đã phê duyệt & chuyển lịch chính thức' : 'Từ chối' }, ...(approved ? [{ label: 'Phụ cấp nhận đổi ca', value: swapAllowanceText }] : []), { label: 'Ghi chú Quản lý', value: swap.decision_reason || 'Đảm bảo định biên ca trực' }],
      actionLabel: 'Kiểm tra lịch làm việc mới', actionUrl: `${webOrigin(ctx)}${resolveRolePortalPath(c.role, 'schedule')}`,
    }, { dedupeKey: `swap_decide:${swap.id}:v${swap.version}:${c.personalEmail}` });
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
