import type { Employee, ShiftAssignment } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { singleFlight, tolerantWrite } from './background-write.js';
import { findLockedPayrollPeriodForDate } from './salary-profile.service.js';

type SweepResult = { markedAbsent: number; restoredCompleted: number };
const sweepsInFlight = new WeakMap<Database, Promise<SweepResult>>();

export function getVnNowDateAndHm(): { todayStr: string; nowHm: string } {
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return { todayStr: dayjs(vnNow).format('YYYY-MM-DD'), nowHm: dayjs(vnNow).format('HH:mm') };
}

/**
 * Quét ngầm tự động các ca làm việc đã phát hành (PUBLISHED) nhưng đã qua giờ kết thúc ca
 * (ví dụ ca 07:00 - 12:00 mà hiện tại là 12:30 vẫn chưa có CHECK_IN và chưa có Phiếu bổ sung công được duyệt)
 * để khóa điểm danh và chuyển trạng thái sang Vắng mặt (ABSENT).
 * Đồng thời tự động khôi phục sang Đã hoàn thành (COMPLETED) nếu đã có Phiếu bổ sung công được HR phê duyệt.
 * Chỉ một lượt quét chạy tại một thời điểm; dòng bị xung đột phiên bản được bỏ qua và xử lý ở lượt sau.
 */
export function sweepExpiredShiftsAndMarkAbsent(
  db: Database,
  actorId = 'auto-absent-scanner',
  options?: { nowDate?: string; nowHm?: string; includeSeedInTests?: boolean },
): Promise<SweepResult> {
  if (options) return runSweep(db, actorId, options);
  return singleFlight(sweepsInFlight, db, () => runSweep(db, actorId));
}

async function runSweep(
  db: Database,
  actorId: string,
  options?: { nowDate?: string; nowHm?: string; includeSeedInTests?: boolean },
): Promise<SweepResult> {
  const vn = getVnNowDateAndHm();
  const todayStr = options?.nowDate ?? vn.todayStr;
  const nowHm = options?.nowHm ?? vn.nowHm;
  const isVitest = Boolean(process.env.VITEST) && !options?.includeSeedInTests;

  const allEvents = db.attendanceEvents.all();
  const allAdjustments = db.attendanceAdjustments.all();
  const empByCode = new Map(db.employees.all().map((e) => [e.employee_code, e]));
  const resolveCanonicalEmpId = (rawId: string) =>
    db.employees.get(rawId)?.id ?? empByCode.get(rawId)?.id ?? rawId;

  const hasInKeys = new Set<string>();
  const hasOutKeys = new Set<string>();
  for (const ev of allEvents) {
    const targetSet = ev.type === 'CHECK_OUT' ? hasOutKeys : hasInKeys;
    if (ev.assignment_id) targetSet.add(`asg:${ev.assignment_id}`);
    const eid = resolveCanonicalEmpId(ev.employee_id);
    targetSet.add(`emp:${eid}:${ev.work_date}:${ev.shift_code}`);
  }

  const approvedAdjMap = new Map<string, (typeof allAdjustments)[number]>();
  for (const adj of allAdjustments) {
    if (adj.status !== 'APPROVED') continue;
    if (adj.assignment_id) approvedAdjMap.set(`asg:${adj.assignment_id}`, adj);
    const eid = resolveCanonicalEmpId(adj.employee_id);
    approvedAdjMap.set(`emp:${eid}:${adj.work_date}:${adj.shift_code}`, adj);
  }

  let markedAbsent = 0;
  let restoredCompleted = 0;
  const patches: { id: string; expectedVersion: number; patch: Partial<ShiftAssignment> }[] = [];

  for (const a of db.shiftAssignments.all()) {
    if (a.day_type === 'OFF' || a.status === 'ON_LEAVE') continue;
    if (findLockedPayrollPeriodForDate(db, a.work_date)) continue;

    const eid = resolveCanonicalEmpId(a.employee_id);
    const asgKey = `asg:${a.id}`;
    const empKey = `emp:${eid}:${a.work_date}:${a.shift_code}`;
    const hasIn = hasInKeys.has(asgKey) || hasInKeys.has(empKey);
    const hasOut = hasOutKeys.has(asgKey) || hasOutKeys.has(empKey);
    const approvedAdj = approvedAdjMap.get(asgKey) ?? approvedAdjMap.get(empKey);

    if ((a.status === 'ABSENT' || a.status === 'PUBLISHED') && (approvedAdj || (hasIn && hasOut))) {
      const nextPatch: Partial<ShiftAssignment> = {
        status: 'COMPLETED',
        scheduled_hours: approvedAdj?.requested_hours ?? a.scheduled_hours,
        note: approvedAdj ? `Đã bù công theo phiếu ${approvedAdj.adjustment_code}` : (a.note || 'Đã hoàn thành điểm danh Vào/Ra ca'),
      };
      patches.push({ id: a.id, expectedVersion: a.version, patch: nextPatch });
      restoredCompleted++;
      continue;
    }

    if (a.status !== 'PUBLISHED' || hasIn || approvedAdj) continue;
    if (isVitest && a.source === 'SEED') continue;

    const endAt = a.end_at || '12:00';
    const isExpired = a.work_date < todayStr || (a.work_date === todayStr && nowHm > endAt);
    if (!isExpired) continue;

    patches.push({
      id: a.id,
      expectedVersion: a.version,
      patch: {
        status: 'ABSENT',
        note: a.note && a.note.includes('Vắng mặt') ? a.note : 'Quá giờ kết thúc ca chưa điểm danh — Tự động chuyển Vắng mặt',
      },
    });
    markedAbsent++;
  }

  if (patches.length > 0) {
    await tolerantWrite(() => db.shiftAssignments.batchUpdate(patches, actorId));
  }

  return { markedAbsent, restoredCompleted };
}

export async function applyApprovedAdjustmentToShift(db: Database, adjustmentId: string, actorId: string): Promise<string> {
  const adj = db.attendanceAdjustments.get(adjustmentId);
  if (!adj) return '';
  const emp = db.employees.get(adj.employee_id) ?? db.employees.find((e) => e.employee_code === adj.employee_id);
  const matchEmp = (eid: string) => eid === adj.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
  const targetShift = (adj.assignment_id ? db.shiftAssignments.get(adj.assignment_id) : undefined) ?? db.shiftAssignments.find((a) => matchEmp(a.employee_id) && a.work_date === adj.work_date && a.shift_code === adj.shift_code);
  if (!targetShift) return '';
  await db.shiftAssignments.update(targetShift.id, targetShift.version, { status: 'COMPLETED', scheduled_hours: adj.requested_hours || targetShift.scheduled_hours, note: `Đã bù công theo phiếu bổ sung ${adj.adjustment_code}` }, actorId);
  return targetShift.id;
}

export function resolveShiftActiveRequests(db: Database, shift: ShiftAssignment, emp?: Employee) {
  const matchEmp = (eid: string) => eid === shift.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
  const approvedAdj = db.attendanceAdjustments.find((a) => a.status === 'APPROVED' && ((shift.id && a.assignment_id === shift.id) || (matchEmp(a.employee_id) && a.work_date === shift.work_date && a.shift_code === shift.shift_code)));
  const pendingAdj = db.attendanceAdjustments.find((a) => (a.status === 'PENDING' || a.status === 'STORE_CONFIRMED') && ((shift.id && a.assignment_id === shift.id) || (matchEmp(a.employee_id) && a.work_date === shift.work_date && a.shift_code === shift.shift_code)));
  const pendingSwap = db.shiftSwaps.find((s) => (s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && (s.from_assignment_id === shift.id || (matchEmp(s.requester_id) && s.from_work_date === shift.work_date && s.from_shift_code === shift.shift_code)));
  const pendingLeave = db.leaveRequests.find((l) => (l.status === 'PENDING' || l.status === 'DRAFT') && ((shift.id && l.assignment_id === shift.id) || (matchEmp(l.employee_id) && l.leave_date === shift.work_date)));
  const pendingEmg = db.emergencyLeaves.find((e) => (e.status === 'REPORTED' || e.status === 'ESCALATED') && ((shift.id && e.assignment_id === shift.id) || (matchEmp(e.employee_id) && e.work_date === shift.work_date && e.shift_code === shift.shift_code)));
  return {
    hasApprovedAdjustment: Boolean(approvedAdj),
    pendingAdjustmentCode: pendingAdj?.adjustment_code ?? null, pendingAdjustmentStatus: pendingAdj?.status ?? null,
    pendingSwapCode: pendingSwap?.swap_code ?? null, pendingLeaveCode: pendingLeave?.request_code ?? null, pendingEmergencyCode: pendingEmg?.emergency_code ?? null,
  };
}

export function assertNoDuplicateAdjustment(db: Database, emp: Employee, assignmentId: string, workDate: string, shiftCode: string): void {
  const dup = db.attendanceAdjustments.find((a) => a.status !== 'REJECTED' && (Boolean(assignmentId && a.assignment_id === assignmentId) || ((a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === workDate && a.shift_code === shiftCode)));
  if (dup) throw Errors.fieldValidation('assignment_id', 'DUPLICATE_VALUE', `Ca làm việc ngày ${workDate} đã gửi Phiếu bổ sung công (${dup.adjustment_code}) và đang chờ duyệt hoặc đã được phê duyệt. Không được phép gửi trùng yêu cầu.`, assignmentId || workDate);
}

export function assertNoDuplicateShiftWorkflow(db: Database, emp: Employee, field: string, assignmentId: string, workDate: string, shiftCode: string): void {
  const isEmp = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const dupEmg = db.emergencyLeaves.find((e) => !(Boolean(process.env.VITEST) && e.created_by === 'seed') && (Boolean(assignmentId && e.assignment_id === assignmentId) || (isEmp(e.employee_id) && e.work_date === workDate && e.shift_code === shiftCode)));
  if (dupEmg) throw Errors.fieldValidation(field, 'DUPLICATE_VALUE', `Ca làm việc ngày ${workDate} đã gửi Báo nghỉ khẩn cấp (${dupEmg.emergency_code}) đang chờ xử lý, không được phép gửi trùng yêu cầu.`, assignmentId || workDate);
  const dupLeave = db.leaveRequests.find((l) => isEmp(l.employee_id) && l.leave_date === workDate && l.status !== 'REJECTED' && l.status !== 'CANCELLED');
  if (dupLeave) throw Errors.fieldValidation(field, 'DUPLICATE_VALUE', `Ngày ${workDate} đã có Đơn xin nghỉ OFF (${dupLeave.request_code}) đang chờ duyệt hoặc đã được duyệt, không được phép gửi thêm yêu cầu.`, workDate);
  const dupSwap = db.shiftSwaps.find((s) => (s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && (Boolean(assignmentId && s.from_assignment_id === assignmentId) || (isEmp(s.requester_id) && s.from_work_date === workDate && s.from_shift_code === shiftCode)));
  if (dupSwap) throw Errors.fieldValidation(field, 'DUPLICATE_VALUE', `Ca làm việc ngày ${workDate} đang có Yêu cầu đổi ca (${dupSwap.swap_code}) chờ duyệt, không được phép gửi trùng yêu cầu.`, assignmentId || workDate);
}

export function resolveWorkflowShiftStatus(db: Database, shiftCode: string, assignmentId = '', employeeId = '', workDate = '') {
  const emp = employeeId ? (db.employees.get(employeeId) ?? db.employees.find((e) => e.employee_code === employeeId)) : undefined;
  const matchEmp = (eid: string) => Boolean(employeeId && (eid === employeeId || (emp && (eid === emp.id || eid === emp.employee_code))));
  const assign = (assignmentId ? db.shiftAssignments.get(assignmentId) : undefined)
    ?? (employeeId && workDate
      ? (db.shiftAssignments.find((a) => matchEmp(a.employee_id) && a.work_date === workDate && a.shift_code === shiftCode && a.day_type !== 'OFF')
        ?? db.shiftAssignments.find((a) => matchEmp(a.employee_id) && a.work_date === workDate && a.day_type !== 'OFF'))
      : undefined);
  if (!assign) return { shiftAssignmentId: '', shiftStatus: 'MISSING', shiftStatusLabel: 'Không còn ca trên lịch', isShiftOfficialPublished: false };
  const aEmp = db.employees.get(assign.employee_id) ?? db.employees.find((e) => e.employee_code === assign.employee_id);
  const matchAEmp = (eid: string) => eid === assign.employee_id || Boolean(aEmp && (eid === aEmp.id || eid === aEmp.employee_code));
  const evs = db.attendanceEvents.filter((ev) => ev.assignment_id === assign.id || (matchAEmp(ev.employee_id) && ev.work_date === assign.work_date && ev.shift_code === assign.shift_code));
  const hasIn = evs.some((ev) => ev.type === 'CHECK_IN'), hasOut = evs.some((ev) => ev.type === 'CHECK_OUT');
  const hasApprovedAdj = Boolean(db.attendanceAdjustments.find((a) => a.status === 'APPROVED' && (a.assignment_id === assign.id || (matchAEmp(a.employee_id) && a.work_date === assign.work_date && a.shift_code === assign.shift_code))));
  if (assign.status === 'COMPLETED' || (hasIn && hasOut) || hasApprovedAdj) return { shiftAssignmentId: assign.id, shiftStatus: 'COMPLETED', shiftStatusLabel: 'Đã hoàn thành ca', isShiftOfficialPublished: false };
  if (assign.status === 'ABSENT') return { shiftAssignmentId: assign.id, shiftStatus: 'ABSENT', shiftStatusLabel: 'Vắng mặt', isShiftOfficialPublished: false };
  if (assign.status === 'DRAFT') return { shiftAssignmentId: assign.id, shiftStatus: 'DRAFT', shiftStatusLabel: 'Chờ duyệt phân ca', isShiftOfficialPublished: false };
  if (assign.status === 'ON_LEAVE' || assign.day_type === 'OFF') return { shiftAssignmentId: assign.id, shiftStatus: 'ON_LEAVE', shiftStatusLabel: 'Nghỉ phép OFF', isShiftOfficialPublished: false };
  if (hasIn) return { shiftAssignmentId: assign.id, shiftStatus: 'CHECKED_IN', shiftStatusLabel: 'Đã điểm danh vào ca', isShiftOfficialPublished: false };
  return { shiftAssignmentId: assign.id, shiftStatus: 'PUBLISHED', shiftStatusLabel: 'Đã phân ca chính thức', isShiftOfficialPublished: true };
}

export async function clearShiftAttendanceOnWorkflowOverride(db: Database, shift: ShiftAssignment, actorId: string, reason: string): Promise<void> {
  const emp = db.employees.get(shift.employee_id) ?? db.employees.find((e) => e.employee_code === shift.employee_id);
  const matchEmp = (eid: string) => eid === shift.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
  for (const ev of db.attendanceEvents.filter((e) => e.assignment_id === shift.id || (matchEmp(e.employee_id) && e.work_date === shift.work_date && e.shift_code === shift.shift_code))) {
    await db.attendanceEvents.softDelete(ev.id, ev.version, actorId);
  }
  for (const adj of db.attendanceAdjustments.filter((a) => a.status !== 'REJECTED' && (a.assignment_id === shift.id || (matchEmp(a.employee_id) && a.work_date === shift.work_date && a.shift_code === shift.shift_code)))) {
    await db.attendanceAdjustments.update(adj.id, adj.version, { status: 'REJECTED', decided_by: actorId, decision_reason: reason, decided_at: new Date().toISOString() }, actorId);
  }
}
