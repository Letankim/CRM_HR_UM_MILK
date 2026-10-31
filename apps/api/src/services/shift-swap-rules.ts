import type { Employee, ShiftAssignment, ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { getOperationSettings } from './operations-settings.service.js';
import { employeeShiftsOnDate } from './schedule-rules.js';
import { findEmployeeShiftConflictOnDate } from './schedule-staffing-helper.js';
import { clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from './shift-absent-scanner.js';

export { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';

/**
 * Quy tắc Đổi ca 2 chiều (SWAP) và Nhường ca (GIVE):
 * - Cả người gửi và người nhận đều bắt buộc là Nhân viên Chính thức tại cửa hàng cùng chi nhánh (nhân viên thử việc chưa được đổi hoặc nhường ca).
 * - Ca đã phát hành chính thức, chưa bắt đầu và chưa phát sinh chấm công.
 * - SWAP: 2 nhân viên chính thức đổi 2 ca cho nhau — đồng nghiệp đồng ý là cập nhật lịch ngay, không cần HR.
 * - GIVE: đồng nghiệp chính thức nhận thêm ca; nếu vượt số ca tối đa / ngày (mặc định 2) thì bắt buộc HR phê duyệt.
 */
export const findEmp = (ctx: AppContext, id: string) => ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);

export function assertShiftTransferable(ctx: AppContext, a: ShiftAssignment, field: string, label: string, skipTimeCheck = false): void {
  if (a.status !== 'PUBLISHED') throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} phải là ca đã được phát hành chính thức và chưa hoàn thành`, a.id);
  if (ctx.db.attendanceEvents.find((e) => e.assignment_id === a.id)) throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} đã phát sinh chấm công, không thể đổi / nhường`, a.id);
  if (skipTimeCheck) return;
  const { todayStr, nowHm } = getVnNowDateAndHm();
  if (a.work_date < todayStr || (a.work_date === todayStr && nowHm >= (a.start_at || '07:00'))) {
    throw Errors.fieldValidation(field, 'OUT_OF_RANGE', `${label} (${dayjs(a.work_date).format('DD/MM/YYYY')} ${a.start_at}) đã bắt đầu hoặc đã qua, không thể đổi / nhường`, a.id);
  }
}

/** Kiểm tra người nhận có thể đảm nhận ca `incoming` (sau khi bỏ ca `outgoing` nếu có). Trả về số ca trong ngày sau khi nhận. */
export function checkReceiverCanTake(ctx: AppContext, receiver: Employee, incoming: ShiftAssignment, outgoingId?: string): { countAfter: number; conflict: string | null } {
  const sameDay = employeeShiftsOnDate(ctx, receiver, incoming.work_date, outgoingId ? [outgoingId] : []);
  const conflict = findEmployeeShiftConflictOnDate(ctx, { emp: receiver, workDate: incoming.work_date, shiftCode: incoming.shift_code, startAt: incoming.start_at, endAt: incoming.end_at, excludeId: outgoingId });
  const onLeave = ctx.db.leaveRequests.find((l) => (l.employee_id === receiver.id || l.employee_id === receiver.employee_code) && l.leave_date === incoming.work_date && l.status === 'APPROVED');
  return { countAfter: sameDay.length + 1, conflict: onLeave ? `${receiver.full_name} đã được duyệt nghỉ OFF ngày ${dayjs(incoming.work_date).format('DD/MM/YYYY')}` : conflict?.message ?? null };
}

/** hrOverride = HR phê duyệt: bỏ qua kiểm tra thời điểm ca đã bắt đầu (HR có thể duyệt bổ sung sau). */
export function evaluateSwapRequest(ctx: AppContext, params: { kind: 'SWAP' | 'GIVE'; requester: Employee; peer: Employee; from: ShiftAssignment; to?: ShiftAssignment; hrOverride?: boolean }) {
  const { maxShiftsPerDay } = getOperationSettings(ctx.db);
  const { kind, requester, peer, from, to } = params;
  if (requester.branch_id !== peer.branch_id) throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Chỉ được đổi / nhường ca với đồng nghiệp cùng chi nhánh', peer.id);
  if (requester.id === peer.id) throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Người nhận phải khác người gửi yêu cầu', peer.id);
  if (peer.status !== 'ACTIVE') throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Đồng nghiệp đã nghỉ việc hoặc ngừng hoạt động', peer.id);
  if (!isOfficialSwapEligibleEmployee(ctx, requester)) {
    throw Errors.fieldValidation('requester_id', 'INVALID_VALUE', 'Chức năng đổi ca và nhường ca chỉ áp dụng cho Nhân viên Chính thức tại cửa hàng (nhân viên thử việc chưa được đổi hoặc nhường ca)', requester.id);
  }
  if (!isOfficialSwapEligibleEmployee(ctx, peer)) {
    throw Errors.fieldValidation('peer_id', 'INVALID_VALUE', 'Chỉ được đổi hoặc nhường ca cho đồng nghiệp là Nhân viên Chính thức cùng chi nhánh (nhân viên thử việc và khối quản trị / quản lý không nhận chuyển ca)', peer.id);
  }
  assertShiftTransferable(ctx, from, 'from_assignment_id', 'Ca của bạn', params.hrOverride);
  if (kind === 'SWAP') {
    if (!to) throw Errors.fieldValidation('to_assignment_id', 'REQUIRED_FIELD', 'Vui lòng chọn ca của đồng nghiệp để đổi', '');
    if (to.employee_id !== peer.id && to.employee_id !== peer.employee_code) throw Errors.fieldValidation('to_assignment_id', 'INVALID_VALUE', 'Ca được chọn không thuộc lịch của đồng nghiệp', to.id);
    assertShiftTransferable(ctx, to, 'to_assignment_id', 'Ca của đồng nghiệp', params.hrOverride);
    const forPeer = checkReceiverCanTake(ctx, peer, from, to.id), forReq = checkReceiverCanTake(ctx, requester, to, from.id);
    if (forPeer.conflict) throw Errors.fieldValidation('to_assignment_id', 'DUPLICATE_VALUE', forPeer.conflict, to.id);
    if (forReq.conflict) throw Errors.fieldValidation('to_assignment_id', 'DUPLICATE_VALUE', forReq.conflict.replace(requester.full_name, 'Bạn'), to.id);
    if (forPeer.countAfter > maxShiftsPerDay || forReq.countAfter > maxShiftsPerDay) {
      throw Errors.fieldValidation('to_assignment_id', 'OUT_OF_RANGE', `Sau khi đổi, một trong hai người sẽ làm quá ${maxShiftsPerDay} ca trong 1 ngày — trái quy định công ty`, to.id);
    }
    return { requiresHr: false, receiverCountAfter: forPeer.countAfter };
  }
  const check = checkReceiverCanTake(ctx, peer, from);
  if (check.conflict) throw Errors.fieldValidation('peer_id', 'DUPLICATE_VALUE', check.conflict, peer.id);
  if (check.countAfter > maxShiftsPerDay + 1) {
    throw Errors.fieldValidation('peer_id', 'OUT_OF_RANGE', `${peer.full_name} đã có ${check.countAfter - 1} ca trong ngày, không thể nhận thêm ca`, peer.id);
  }
  return { requiresHr: check.countAfter > maxShiftsPerDay, receiverCountAfter: check.countAfter };
}

/** Áp dụng yêu cầu đã được chấp thuận vào lịch chính thức (đổi chủ ca, không tạo ca mới). */
export async function applySwapToSchedule(ctx: AppContext, swap: ShiftSwap, actorId: string): Promise<void> {
  const from = ctx.db.shiftAssignments.get(swap.from_assignment_id);
  if (!from) throw Errors.badRequest('Ca gốc không còn trên lịch làm việc, không thể cập nhật');
  await clearShiftAttendanceOnWorkflowOverride(ctx.db, from, actorId, `Chuyển ca theo yêu cầu ${swap.swap_code}`);
  const stageOf = (id: string) => findEmp(ctx, id)?.stage ?? from.employee_stage;
  if (swap.kind === 'SWAP') {
    const to = swap.to_assignment_id ? ctx.db.shiftAssignments.get(swap.to_assignment_id) : undefined;
    if (!to) throw Errors.badRequest('Ca của đồng nghiệp không còn trên lịch làm việc, không thể đổi ca');
    await ctx.db.shiftAssignments.update(from.id, from.version, { employee_id: swap.peer_id, employee_stage: stageOf(swap.peer_id), swapped_from_employee_id: swap.requester_id, note: `Đổi ca 2 chiều ${swap.swap_code}` }, actorId);
    await ctx.db.shiftAssignments.update(to.id, to.version, { employee_id: swap.requester_id, employee_stage: stageOf(swap.requester_id), swapped_from_employee_id: swap.peer_id, note: `Đổi ca 2 chiều ${swap.swap_code}` }, actorId);
    return;
  }
  await ctx.db.shiftAssignments.update(from.id, from.version, { employee_id: swap.peer_id, employee_stage: stageOf(swap.peer_id), swapped_from_employee_id: swap.requester_id, note: `Nhận ca được nhường ${swap.swap_code}` }, actorId);
}
