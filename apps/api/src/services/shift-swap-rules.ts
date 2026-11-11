import type { AttendanceEvent, Employee, LeaveRequest, ShiftAssignment, ShiftSwap } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';
import { invalidateHistoricalShiftsCache } from './historical-shifts-loader.js';
import { getOperationSettings } from './operations-settings.service.js';
import { extractMonthKeyFromDate, findPartitionAwareRecord, getCachedPartitionStore } from './partition-write-router.js';
import { employeeShiftsOnDate } from './schedule-rules.js';
import { findEmployeeShiftConflictOnDate } from './schedule-staffing-helper.js';
import { clearShiftAttendanceOnWorkflowOverride, getVnNowDateAndHm } from './shift-absent-scanner.js';

export { isOfficialSwapEligibleEmployee } from '../routes/employee-mapper.js';

export const findEmp = (ctx: AppContext, id: string) => ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);

export function assertShiftTransferable(ctx: AppContext, a: ShiftAssignment, field: string, label: string, skipTimeCheck = false): void {
  if (a.status !== 'PUBLISHED') throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} phải là ca đã được phát hành chính thức và chưa hoàn thành`, a.id);
  const mk = extractMonthKeyFromDate(a.work_date);
  const evStore = (mk ? getCachedPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', mk) : undefined) ?? ctx.db.attendanceEvents;
  if (evStore.find((e) => e.assignment_id === a.id)) throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} đã phát sinh chấm công, không thể đổi / nhường`, a.id);
  if (skipTimeCheck) return;
  const { todayStr, nowHm } = getVnNowDateAndHm();
  if (a.work_date < todayStr || (a.work_date === todayStr && nowHm >= (a.start_at || '07:00'))) {
    throw Errors.fieldValidation(field, 'OUT_OF_RANGE', `${label} (${dayjs(a.work_date).format('DD/MM/YYYY')} ${a.start_at}) đã bắt đầu hoặc đã qua, không thể đổi / nhường`, a.id);
  }
}

export function checkReceiverCanTake(ctx: AppContext, receiver: Employee, incoming: ShiftAssignment, outgoingId?: string): { countAfter: number; conflict: string | null } {
  const sameDay = employeeShiftsOnDate(ctx, receiver, incoming.work_date, outgoingId ? [outgoingId] : []);
  const conflict = findEmployeeShiftConflictOnDate(ctx, { emp: receiver, workDate: incoming.work_date, shiftCode: incoming.shift_code, startAt: incoming.start_at, endAt: incoming.end_at, excludeId: outgoingId });
  const mk = extractMonthKeyFromDate(incoming.work_date);
  const lvStore = (mk ? getCachedPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk) : undefined) ?? ctx.db.leaveRequests;
  const onLeave = lvStore.find((l) => (l.employee_id === receiver.id || l.employee_id === receiver.employee_code) && l.leave_date === incoming.work_date && l.status === 'APPROVED');
  return { countAfter: sameDay.length + 1, conflict: onLeave ? `${receiver.full_name} đã được duyệt nghỉ OFF ngày ${dayjs(incoming.work_date).format('DD/MM/YYYY')}` : conflict?.message ?? null };
}

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

/** Áp dụng yêu cầu đã được chấp thuận vào lịch chính thức (đổi chủ ca trên đúng phân vùng tháng của ca). */
export async function applySwapToSchedule(ctx: AppContext, swap: ShiftSwap, actorId: string): Promise<void> {
  const fromFound = await findPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', swap.from_assignment_id, swap.from_work_date);
  const from = fromFound?.record;
  if (!fromFound || !from) throw Errors.badRequest('Ca gốc không còn trên lịch làm việc, không thể cập nhật');
  await clearShiftAttendanceOnWorkflowOverride(ctx.db, from, actorId, `Chuyển ca theo yêu cầu ${swap.swap_code}`);
  const stageOf = (id: string) => findEmp(ctx, id)?.stage ?? from.employee_stage;
  if (swap.kind === 'SWAP') {
    const toFound = swap.to_assignment_id ? await findPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', swap.to_assignment_id, swap.to_work_date) : undefined;
    const to = toFound?.record;
    if (!toFound || !to) throw Errors.badRequest('Ca của đồng nghiệp không còn trên lịch làm việc, không thể đổi ca');
    await clearShiftAttendanceOnWorkflowOverride(ctx.db, to, actorId, `Chuyển ca theo yêu cầu ${swap.swap_code}`);
    await fromFound.store.update(from.id, from.version, { employee_id: swap.peer_id, employee_stage: stageOf(swap.peer_id), swapped_from_employee_id: swap.requester_id, note: `Đổi ca 2 chiều ${swap.swap_code}` }, actorId);
    await toFound.store.update(to.id, to.version, { employee_id: swap.requester_id, employee_stage: stageOf(swap.requester_id), swapped_from_employee_id: swap.peer_id, note: `Đổi ca 2 chiều ${swap.swap_code}` }, actorId);
    invalidateHistoricalShiftsCache(ctx.db);
    return;
  }
  await fromFound.store.update(from.id, from.version, { employee_id: swap.peer_id, employee_stage: stageOf(swap.peer_id), swapped_from_employee_id: swap.requester_id, note: `Nhận ca được nhường ${swap.swap_code}` }, actorId);
  invalidateHistoricalShiftsCache(ctx.db);
}
