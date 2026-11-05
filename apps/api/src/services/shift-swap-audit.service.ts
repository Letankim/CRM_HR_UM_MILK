import { isEmployeeRole, isShiftTimePassed, mondayOfWeek, SYSTEM_CONFIG, type Employee, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { APP_TZ, dayjs, nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { emitScheduleRealtime } from '../routes/account-employee-sync.js';
import { findLinkedUserForEmployee } from '../routes/employee-mapper.js';
import { queueSwapEventEmail } from './action-email-dispatcher.js';
import { ensureSyncedNotifications } from './notification-sync.service.js';
import { recalculateOpenPeriods } from './payroll-snapshot.service.js';
import { resolveDispatchAnnouncementOnClaim } from './shift-dispatch.service.js';
import { findEmp, isOfficialSwapEligibleEmployee } from './shift-swap-rules.js';

const SHIFT_DEFAULTS: Record<string, { start: string; end: string; hours: number }> = {
  CA_SANG: { start: '07:00', end: '12:00', hours: 5 }, CA_CHIEU: { start: '12:00', end: '17:00', hours: 5 },
  CA_TOI: { start: '17:00', end: '22:30', hours: 5.5 }, HANH_CHINH: { start: '08:00', end: '17:30', hours: 8 },
};
export function resolveShiftSpec(ctx: AppContext, shiftCode: string, from?: { start_at?: string; end_at?: string; scheduled_hours?: number; shift_template_id?: string; schedule_week_id?: string }, workDate?: string) {
  const tpl = ctx.db.shiftTemplates.find((t) => t.code === shiftCode), def = SHIFT_DEFAULTS[shiftCode] ?? SHIFT_DEFAULTS.CA_SANG!;
  return {
    startAt: from?.start_at || tpl?.start_time || def.start, endAt: from?.end_at || tpl?.end_time || def.end,
    scheduledHours: Number(from?.scheduled_hours || tpl?.standard_hours || def.hours),
    shiftTemplateId: from?.shift_template_id || tpl?.id || '', scheduleWeekId: from?.schedule_week_id || `WK-${(workDate || '').slice(0, 7)}`,
  };
}

export async function revertSwapSchedule(ctx: AppContext, s: ShiftSwap, actorId: string): Promise<void> {
  const stageOf = (id: string) => findEmp(ctx, id)?.stage;
  if (s.kind === 'HR_DISPATCH') {
    if (s.from_assignment_id && s.to_assignment_id === s.from_assignment_id && s.requester_id) {
      const from = ctx.db.shiftAssignments.get(s.from_assignment_id);
      if (from && !from.is_deleted) {
        await ctx.db.shiftAssignments.update(from.id, from.version, {
          employee_id: s.requester_id, employee_stage: stageOf(s.requester_id) ?? from.employee_stage,
          swapped_from_employee_id: '', replacement_for_employee_id: '', status: 'PUBLISHED',
          note: `Hoàn trả lịch gốc sau khi hủy lệnh điều phối ${s.swap_code}`,
        }, actorId);
      }
    } else if (s.to_assignment_id) {
      const to = ctx.db.shiftAssignments.get(s.to_assignment_id);
      if (to && !to.is_deleted) await ctx.db.shiftAssignments.softDelete(to.id, to.version, actorId);
    }
    return;
  }
  if (s.kind === 'HR_SUPPORT') {
    if (s.to_assignment_id) {
      const to = ctx.db.shiftAssignments.get(s.to_assignment_id);
      if (to && !to.is_deleted) await ctx.db.shiftAssignments.softDelete(to.id, to.version, actorId);
    }
    if (s.from_assignment_id && s.from_assignment_id !== s.to_assignment_id) {
      const from = ctx.db.shiftAssignments.get(s.from_assignment_id);
      if (from && !from.is_deleted) {
        await ctx.db.shiftAssignments.update(from.id, from.version, {
          status: 'PUBLISHED', branch_id: s.branch_id, employee_id: s.requester_id,
          employee_stage: stageOf(s.requester_id) ?? from.employee_stage, swapped_from_employee_id: '',
          note: `Hoàn trả lịch gốc sau khi kiểm toán / hủy phiếu điều động ${s.swap_code}`,
        }, actorId);
      }
    }
    return;
  }
  if (s.from_assignment_id) {
    const from = ctx.db.shiftAssignments.get(s.from_assignment_id);
    if (from) {
      await ctx.db.shiftAssignments.update(from.id, from.version, {
        employee_id: s.requester_id, employee_stage: stageOf(s.requester_id) ?? from.employee_stage,
        swapped_from_employee_id: '', status: 'PUBLISHED', note: `Hoàn trả lịch gốc sau khi kiểm toán hủy phiếu ${s.swap_code}`,
      }, actorId);
    }
  }
  if (s.kind === 'SWAP' && s.to_assignment_id) {
    const to = ctx.db.shiftAssignments.get(s.to_assignment_id);
    if (to) {
      await ctx.db.shiftAssignments.update(to.id, to.version, {
        employee_id: s.peer_id, employee_stage: stageOf(s.peer_id) ?? to.employee_stage,
        swapped_from_employee_id: '', status: 'PUBLISHED', note: `Hoàn trả lịch gốc sau khi kiểm toán hủy phiếu ${s.swap_code}`,
      }, actorId);
    }
  }
}

export async function executeHrSupportDispatch(
  ctx: AppContext,
  params: { fromAssignmentId?: string; targetBranchId: string; workDate?: string; shiftCode?: string; reason: string; requesterId?: string },
  actorId: string,
) {
  const from = params.fromAssignmentId ? ctx.db.shiftAssignments.get(params.fromAssignmentId) : undefined;
  if (params.fromAssignmentId && !from) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca làm việc được chọn', params.fromAssignmentId);
  const targetBranch = ctx.db.branches.get(params.targetBranchId);
  if (!targetBranch) throw Errors.fieldValidation('target_branch_id', 'INVALID_VALUE', 'Không tìm thấy chi nhánh tiếp nhận hỗ trợ', params.targetBranchId);
  const requester = findEmp(ctx, params.requesterId || from?.employee_id || '');
  if (!requester) throw Errors.fieldValidation('requester_id', 'INVALID_VALUE', 'Vui lòng chọn nhân sự rảnh được điều động hỗ trợ', params.requesterId || '');
  const reqUser = findLinkedUserForEmployee(requester, ctx);
  if (requester.staff_group === 'BACKOFFICE' || requester.staff_group === 'STORE_MANAGER' || (reqUser && !isEmployeeRole(reqUser.role))) {
    throw Errors.fieldValidation('requester_id', 'INVALID_VALUE', 'Chỉ nhân viên vận hành cửa hàng mới được điều động tăng cường hỗ trợ chi nhánh (không áp dụng cho nhân sự khối văn phòng)', params.requesterId || '');
  }
  const sourceBranchId = from?.branch_id || requester.branch_id;
  if (targetBranch.id === sourceBranchId) throw Errors.fieldValidation('target_branch_id', 'INVALID_VALUE', 'Chi nhánh tiếp nhận hỗ trợ phải khác chi nhánh công tác hiện tại của nhân sự', params.targetBranchId);
  const workDate = params.workDate || from?.work_date || '', shiftCode = params.shiftCode || from?.shift_code || '';
  if (!workDate) throw Errors.fieldValidation('work_date', 'REQUIRED_FIELD', 'Vui lòng chọn ngày làm việc bên chi nhánh cần hỗ trợ', '');
  if (!shiftCode) throw Errors.fieldValidation('shift_code', 'REQUIRED_FIELD', 'Vui lòng chọn khung ca bên chi nhánh cần hỗ trợ', '');
  const spec = resolveShiftSpec(ctx, shiftCode, from, workDate);
  const today = dayjs().tz(APP_TZ).format('YYYY-MM-DD'), nowHm = dayjs().tz(APP_TZ).format('HH:mm');
  if (isShiftTimePassed(workDate, spec.endAt, today, nowHm)) throw Errors.fieldValidation('shift_code', 'INVALID_VALUE', `Khung ca ngày hôm nay đã kết thúc (${spec.endAt}), không thể điều phối`, shiftCode);
  const conflict = ctx.db.shiftAssignments.find((a) => {
    if (a.is_deleted || a.id === from?.id || a.status === 'ABSENT' || a.status === 'ON_LEAVE' || a.day_type === 'OFF') return false;
    const isReq = a.employee_id === requester.id || a.employee_id === requester.employee_code;
    return isReq && a.work_date === workDate && (a.shift_code === shiftCode || isShiftTimeOverlapping(a.start_at, a.end_at, spec.startAt, spec.endAt));
  });
  if (conflict) throw Errors.badRequest(`Nhân sự ${requester.full_name} đã có ca làm việc (${conflict.shift_code} ${conflict.start_at}–${conflict.end_at}) ngày ${workDate}, vui lòng chọn nhân sự đang rảnh`);

  const sourceBranch = ctx.db.branches.get(sourceBranchId), swapCode = `SUP-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`, now = nowIso();
  const targetAssignment = await ctx.db.shiftAssignments.insert({
    branch_id: targetBranch.id, work_date: workDate, shift_code: shiftCode,
    start_at: spec.startAt, end_at: spec.endAt, scheduled_hours: spec.scheduledHours,
    employee_id: requester.id, employee_stage: requester.stage, status: 'PUBLISHED',
    schedule_week_id: spec.scheduleWeekId, shift_template_id: spec.shiftTemplateId, day_type: from?.day_type || 'WORK',
    note: `Ca tăng cường hỗ trợ từ ${sourceBranch?.name || sourceBranchId} (${swapCode})`,
    source: 'HR_SUPPORT', swapped_from_employee_id: from?.employee_id || '',
    replacement_for_employee_id: from?.employee_id || '', linked_assignment_id: from?.id || '', published_at: now,
  }, actorId);
  if (from) {
    await ctx.db.shiftAssignments.update(from.id, from.version, { status: 'SWAPPED', swapped_from_employee_id: requester.id, note: `Đã điều động hỗ trợ sang ${targetBranch.name} (${swapCode})` }, actorId);
  }
  const created = await ctx.db.shiftSwaps.insert({
    swap_code: swapCode, kind: 'HR_SUPPORT', requires_hr_approval: false, requester_id: requester.id, peer_id: '',
    from_assignment_id: from?.id || targetAssignment.id, to_assignment_id: targetAssignment.id, branch_id: sourceBranchId, target_branch_id: targetBranch.id,
    from_work_date: workDate, from_shift_code: shiftCode, to_work_date: workDate, to_shift_code: shiftCode,
    reason: params.reason, status: 'APPROVED', has_conflict: false, staffing_valid: true, requested_at: now,
    peer_responded_at: now, peer_note: `Tự động tạo ca mới tại chi nhánh đích (${targetBranch.name})`, decided_by: actorId,
    decision_reason: `Điều động hỗ trợ sang chi nhánh ${targetBranch.name}`, decided_at: now,
    allowance_eligible: true, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
  }, actorId);
  await recalculateOpenPeriods(ctx, actorId);
  await ensureSyncedNotifications(ctx);
  queueSwapEventEmail(ctx, created, 'DECIDED', actorId);
  emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: sourceBranchId, employeeIds: [requester.id], kind: 'SWAP_DECIDED', message: `Đã điều động sang tăng cường chi nhánh ${targetBranch.name} ngày ${workDate}`, actorId });
  emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: targetBranch.id, employeeIds: [requester.id], kind: 'SWAP_DECIDED', message: `Tiếp nhận nhân sự tăng cường ${requester.full_name} (${swapCode})`, actorId });
  return created;
}

export function isShiftTimeOverlapping(s1: string, e1: string, s2: string, e2: string): boolean {
  return Boolean(s1 && e1 && s2 && e2 && s1 < e2 && s2 < e1);
}

export async function executeHrDispatchClaim(ctx: AppContext, swap: ShiftSwap, receiver: Employee, note: string, actorId: string): Promise<ShiftSwap> {
  const current = ctx.db.shiftSwaps.get(swap.id);
  if (!current || current.status !== 'PENDING_PEER') throw Errors.badRequest('Ca điều phối khẩn cấp này đã được nhân sự khác nhận trước đó, phiếu đã được đóng');
  const from = swap.from_assignment_id ? ctx.db.shiftAssignments.get(swap.from_assignment_id) : undefined;
  const branchId = from?.branch_id || swap.branch_id, workDate = from?.work_date || swap.from_work_date, shiftCode = from?.shift_code || swap.from_shift_code;
  if (!branchId || !workDate || !shiftCode) throw Errors.badRequest('Thông tin ca điều phối không hợp lệ');
  if (!isOfficialSwapEligibleEmployee(ctx, receiver)) throw Errors.forbidden('Chỉ Nhân viên Chính thức tại cửa hàng mới được nhận ca điều phối khẩn cấp (không áp dụng cho nhân sự khối văn phòng)');
  if (receiver.branch_id !== branchId) throw Errors.forbidden('Chỉ nhân viên thuộc chi nhánh phát lệnh mới được nhận ca điều phối này');
  const spec = resolveShiftSpec(ctx, shiftCode, from, workDate);
  const today = dayjs().tz(APP_TZ).format('YYYY-MM-DD'), nowHm = dayjs().tz(APP_TZ).format('HH:mm');
  if (isShiftTimePassed(workDate, spec.endAt, today, nowHm)) throw Errors.badRequest(`Ca làm việc này đã quá hạn nhận ca (kết thúc lúc ${spec.endAt} ngày ${dayjs(workDate).format('DD/MM/YYYY')}), không thể nhận ca nữa`);
  const conflict = ctx.db.shiftAssignments.find((a) => {
    if (a.is_deleted || a.id === from?.id || a.status === 'ABSENT' || a.status === 'ON_LEAVE' || a.day_type === 'OFF') return false;
    const isReceiver = a.employee_id === receiver.id || a.employee_id === receiver.employee_code;
    return isReceiver && a.work_date === workDate && (a.shift_code === shiftCode || isShiftTimeOverlapping(a.start_at, a.end_at, spec.startAt, spec.endAt));
  });
  if (conflict) throw Errors.badRequest(`Bạn đã có ca làm việc trùng khung giờ ngày này (${conflict.shift_code} ${conflict.start_at}–${conflict.end_at}), không thể nhận thêm ca điều phối`);
  const now = nowIso();
  let targetAssignId = '';
  if (from && !from.is_deleted) {
    const origEmpId = swap.requester_id || from.employee_id;
    await ctx.db.shiftAssignments.update(from.id, from.version, {
      employee_id: receiver.id, employee_stage: receiver.stage, status: 'PUBLISHED', source: 'HR_DISPATCH',
      swapped_from_employee_id: origEmpId, replacement_for_employee_id: origEmpId,
      note: `Nhận thay ca điều phối khẩn cấp (+30k) ${swap.swap_code}`,
    }, actorId);
    targetAssignId = from.id;
  } else {
    const newShift = await ctx.db.shiftAssignments.insert({
      schedule_week_id: spec.scheduleWeekId, employee_id: receiver.id, branch_id: branchId, work_date: workDate,
      shift_template_id: spec.shiftTemplateId, shift_code: shiftCode, start_at: spec.startAt, end_at: spec.endAt, scheduled_hours: spec.scheduledHours,
      status: 'PUBLISHED', source: 'HR_DISPATCH', employee_stage: receiver.stage, day_type: from?.day_type || 'WORK', published_at: now,
      note: `Nhận ca điều phối khẩn cấp (+30k) ${swap.swap_code}`, swapped_from_employee_id: swap.requester_id || '', replacement_for_employee_id: swap.requester_id || '', linked_assignment_id: from?.id || '',
    }, actorId);
    targetAssignId = newShift.id;
  }
  const updated = await ctx.db.shiftSwaps.update(swap.id, swap.version, {
    peer_id: receiver.id, to_assignment_id: targetAssignId, status: 'APPROVED', peer_responded_at: now, peer_note: note, decided_by: actorId, decided_at: now,
    decision_reason: from ? 'Nhân viên nhận thay thế ca điều phối khẩn cấp (+30.000đ)' : 'Nhân viên nhận ca điều phối khẩn cấp (+30.000đ)',
    allowance_eligible: true, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
  }, actorId);
  await resolveDispatchAnnouncementOnClaim(ctx, swap.swap_code, receiver, actorId);
  await recalculateOpenPeriods(ctx, actorId);
  await ensureSyncedNotifications(ctx);
  queueSwapEventEmail(ctx, updated, 'DECIDED', actorId);
  emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId, employeeIds: [receiver.id, swap.requester_id].filter(Boolean), kind: 'SWAP_DECIDED', message: `Nhân viên ${receiver.full_name} đã nhận ca điều phối ${swap.swap_code} (+30.000đ)`, actorId });
  return updated;
}

export async function auditOutOfWeekSwaps(ctx: AppContext, actorId = 'system-audit') {
  const now = nowIso(), cancelled: ShiftSwap[] = [];
  let revertedCount = 0;
  for (const s of ctx.db.shiftSwaps.all()) {
    if (s.status === 'CANCELLED' || s.status === 'REJECTED' || !s.from_work_date || !s.to_work_date) continue;
    if (mondayOfWeek(s.from_work_date) !== mondayOfWeek(s.to_work_date)) {
      const wasApproved = s.status === 'APPROVED';
      const updated = await ctx.db.shiftSwaps.update(s.id, s.version, {
        status: 'CANCELLED', decided_by: actorId, decided_at: now,
        decision_reason: 'Tự động hủy do 2 ca đổi không thuộc cùng 1 tuần làm việc (đã hoàn trả lịch về đúng người ban đầu)',
      }, actorId);
      if (wasApproved) {
        await revertSwapSchedule(ctx, s, actorId);
        revertedCount++;
      }
      cancelled.push(updated);
      emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, {
        branchId: s.branch_id, employeeIds: [s.requester_id, s.peer_id].filter(Boolean),
        kind: 'SWAP_CANCELLED', message: `Yêu cầu ${s.swap_code} đã bị tự động hủy do lệch tuần làm việc (đã hoàn trả lịch)`, actorId,
      });
    }
  }
  if (revertedCount > 0) await recalculateOpenPeriods(ctx, actorId);
  return { cancelledCount: cancelled.length, revertedCount, cancelledIds: cancelled.map((x) => x.id) };
}
