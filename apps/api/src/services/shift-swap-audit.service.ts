import { mondayOfWeek, SYSTEM_CONFIG, type ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { SocketEvents } from '../realtime/realtime.js';
import { emitScheduleRealtime } from '../routes/account-employee-sync.js';
import { recalculateOpenPeriods } from './payroll-snapshot.service.js';
import { findEmp } from './shift-swap-rules.js';

export async function revertSwapSchedule(ctx: AppContext, s: ShiftSwap, actorId: string): Promise<void> {
  const stageOf = (id: string) => findEmp(ctx, id)?.stage;
  if (s.kind === 'HR_SUPPORT') {
    if (s.to_assignment_id) {
      const to = ctx.db.shiftAssignments.get(s.to_assignment_id);
      if (to && !to.is_deleted) {
        await ctx.db.shiftAssignments.softDelete(to.id, to.version, actorId);
      }
    }
    if (s.from_assignment_id) {
      const from = ctx.db.shiftAssignments.get(s.from_assignment_id);
      if (from) {
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
  params: { fromAssignmentId: string; targetBranchId: string; reason: string; requesterId?: string },
  actorId: string,
) {
  const from = ctx.db.shiftAssignments.get(params.fromAssignmentId);
  if (!from) throw Errors.fieldValidation('from_assignment_id', 'INVALID_VALUE', 'Không tìm thấy ca làm việc được chọn', params.fromAssignmentId);
  const targetBranch = ctx.db.branches.get(params.targetBranchId);
  if (!targetBranch) throw Errors.fieldValidation('target_branch_id', 'INVALID_VALUE', 'Không tìm thấy chi nhánh tiếp nhận hỗ trợ', params.targetBranchId);
  if (targetBranch.id === from.branch_id) throw Errors.fieldValidation('target_branch_id', 'INVALID_VALUE', 'Chi nhánh tiếp nhận hỗ trợ phải khác chi nhánh công tác hiện tại', params.targetBranchId);

  const requester = findEmp(ctx, params.requesterId || from.employee_id);
  if (!requester) throw Errors.fieldValidation('requester_id', 'INVALID_VALUE', 'Không tìm thấy nhân sự được điều động', params.requesterId || from.employee_id);
  const sourceBranch = ctx.db.branches.get(from.branch_id);
  const swapCode = `SUP-${String(ctx.db.shiftSwaps.all(true).length + 1).padStart(4, '0')}`;
  const now = nowIso();

  const targetAssignment = await ctx.db.shiftAssignments.insert({
    branch_id: targetBranch.id, work_date: from.work_date, shift_code: from.shift_code,
    start_at: from.start_at, end_at: from.end_at, scheduled_hours: from.scheduled_hours,
    employee_id: requester.id, employee_stage: requester.stage, status: 'PUBLISHED',
    schedule_week_id: from.schedule_week_id, shift_template_id: from.shift_template_id, day_type: from.day_type,
    note: `Ca tăng cường hỗ trợ từ ${sourceBranch?.name || from.branch_id} (${swapCode})`,
    source: 'HR_SUPPORT', swapped_from_employee_id: from.employee_id,
    replacement_for_employee_id: from.employee_id || '', linked_assignment_id: '', published_at: now,
  }, actorId);

  await ctx.db.shiftAssignments.update(from.id, from.version, {
    status: 'SWAPPED', swapped_from_employee_id: requester.id,
    note: `Đã điều động hỗ trợ sang ${targetBranch.name} (${swapCode})`,
  }, actorId);

  const created = await ctx.db.shiftSwaps.insert({
    swap_code: swapCode, kind: 'HR_SUPPORT', requires_hr_approval: false, requester_id: requester.id, peer_id: '',
    from_assignment_id: from.id, to_assignment_id: targetAssignment.id, branch_id: from.branch_id, target_branch_id: targetBranch.id,
    from_work_date: from.work_date, from_shift_code: from.shift_code, to_work_date: from.work_date, to_shift_code: from.shift_code,
    reason: params.reason, status: 'APPROVED', has_conflict: false, staffing_valid: true, requested_at: now,
    peer_responded_at: now, peer_note: `Tự động tạo ca mới tại chi nhánh đích (${targetBranch.name})`, decided_by: actorId,
    decision_reason: `Điều động hỗ trợ sang chi nhánh ${targetBranch.name}`, decided_at: now,
    allowance_eligible: true, allowance_amount_vnd: SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd,
  }, actorId);

  await recalculateOpenPeriods(ctx, actorId);
  emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: from.branch_id, employeeIds: [requester.id], kind: 'SWAP_DECIDED', message: `Đã điều động sang tăng cường chi nhánh ${targetBranch.name} ngày ${from.work_date}`, actorId });
  emitScheduleRealtime(ctx, SocketEvents.SWAP_UPDATED, { branchId: targetBranch.id, employeeIds: [requester.id], kind: 'SWAP_DECIDED', message: `Tiếp nhận nhân sự tăng cường ${requester.full_name} (${swapCode})`, actorId });
  return created;
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
