import type { AttendanceAdjustment, AttendanceEvent, Employee, LeaveRequest, ShiftAssignment, ShiftSwap } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { Errors } from '../lib/errors.js';
import { dayjs } from '../lib/time.js';
import { singleFlight, tolerantWrite } from './background-write.js';
import { readPartitionRegistry } from './data-partition.service.js';
import { extractMonthKeyFromDate, findPartitionAwareRecord, getCachedPartitionStore, insertPartitionAwareRecord, updatePartitionAwareRecord } from './partition-write-router.js';
import { findLockedPayrollPeriodForDate } from './salary-profile.service.js';

type SweepResult = { markedAbsent: number; restoredCompleted: number };
const sweepsInFlight = new WeakMap<Database, Promise<SweepResult>>();

export function getVnNowDateAndHm(): { todayStr: string; nowHm: string } {
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return { todayStr: dayjs(vnNow).format('YYYY-MM-DD'), nowHm: dayjs(vnNow).format('HH:mm') };
}

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
  const todayStr = options?.nowDate ?? vn.todayStr, nowHm = options?.nowHm ?? vn.nowHm;
  const isVitest = Boolean(process.env.VITEST) && !options?.includeSeedInTests;

  const allEvents = db.attendanceEvents.all(), allAdjustments = db.attendanceAdjustments.all();
  const empByCode = new Map(db.employees.all().map((e) => [e.employee_code, e]));
  const resolveCanonicalEmpId = (rawId: string) => db.employees.get(rawId)?.id ?? empByCode.get(rawId)?.id ?? rawId;

  const hasInKeys = new Set<string>(), hasOutKeys = new Set<string>();
  for (const ev of allEvents) {
    const targetSet = ev.type === 'CHECK_OUT' ? hasOutKeys : hasInKeys;
    if (ev.assignment_id) targetSet.add(`asg:${ev.assignment_id}`);
    targetSet.add(`emp:${resolveCanonicalEmpId(ev.employee_id)}:${ev.work_date}:${ev.shift_code}`);
  }

  const approvedAdjMap = new Map<string, (typeof allAdjustments)[number]>();
  for (const adj of allAdjustments) {
    if (adj.status !== 'APPROVED' || adj.punch_type === 'CHECK_IN') continue;
    if (adj.assignment_id) approvedAdjMap.set(`asg:${adj.assignment_id}`, adj);
    approvedAdjMap.set(`emp:${resolveCanonicalEmpId(adj.employee_id)}:${adj.work_date}:${adj.shift_code}`, adj);
  }

  let markedAbsent = 0, restoredCompleted = 0;
  const patches: { id: string; expectedVersion: number; patch: Partial<ShiftAssignment> }[] = [];

  for (const a of db.shiftAssignments.all()) {
    if (a.day_type === 'OFF' || a.status === 'ON_LEAVE' || findLockedPayrollPeriodForDate(db, a.work_date)) continue;
    const eid = resolveCanonicalEmpId(a.employee_id), asgKey = `asg:${a.id}`, empKey = `emp:${eid}:${a.work_date}:${a.shift_code}`;
    const hasIn = hasInKeys.has(asgKey) || hasInKeys.has(empKey), hasOut = hasOutKeys.has(asgKey) || hasOutKeys.has(empKey);
    const approvedAdj = approvedAdjMap.get(asgKey) ?? approvedAdjMap.get(empKey);

    if ((a.status === 'ABSENT' || a.status === 'PUBLISHED') && (approvedAdj || (hasIn && hasOut))) {
      patches.push({
        id: a.id, expectedVersion: a.version,
        patch: {
          status: 'COMPLETED',
          scheduled_hours: approvedAdj?.requested_hours ?? a.scheduled_hours,
          note: approvedAdj ? `Đã bù công theo phiếu ${approvedAdj.adjustment_code}` : (a.note || 'Đã hoàn thành điểm danh Vào/Ra ca'),
        },
      });
      restoredCompleted++;
      continue;
    }

    if (a.status !== 'PUBLISHED' || hasIn || approvedAdj || (isVitest && a.source === 'SEED')) continue;
    const rawEnd = a.end_at || '12:00', endAt = rawEnd.includes('T') ? rawEnd.slice(11, 16) : rawEnd;
    if (a.work_date < todayStr || (a.work_date === todayStr && nowHm > endAt)) {
      patches.push({
        id: a.id, expectedVersion: a.version,
        patch: {
          status: 'ABSENT',
          note: a.note ? (a.note.includes('Vắng mặt') ? a.note : `${a.note} (Quá giờ — Tự động chuyển Vắng mặt)`) : 'Quá giờ kết thúc ca chưa điểm danh — Tự động chuyển Vắng mặt',
        },
      });
      markedAbsent++;
    }
  }

  if (patches.length > 0) await tolerantWrite(() => db.shiftAssignments.batchUpdate(patches, actorId));
  return { markedAbsent, restoredCompleted };
}

export async function applyApprovedAdjustmentToShift(db: Database, adjustmentId: string, actorId: string): Promise<string> {
  const adjFound = await findPartitionAwareRecord<AttendanceAdjustment>(db, 'ATTENDANCE_ADJUSTMENTS', adjustmentId);
  const adj = adjFound?.record ?? db.attendanceAdjustments.get(adjustmentId);
  if (!adj) return '';
  const emp = db.employees.get(adj.employee_id) ?? db.employees.find((e) => e.employee_code === adj.employee_id);
  const matchEmp = (eid: string) => eid === adj.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
  let targetShift = adj.assignment_id ? (await findPartitionAwareRecord<ShiftAssignment>(db, 'SHIFT_ASSIGNMENTS', adj.assignment_id, adj.work_date))?.record : undefined;
  if (!targetShift) {
    const shiftMonth = extractMonthKeyFromDate(adj.work_date);
    const shiftPartStore = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<ShiftAssignment>(db, 'SHIFT_ASSIGNMENTS', shiftMonth) : undefined;
    targetShift = shiftPartStore?.find((a) => matchEmp(a.employee_id) && a.work_date === adj.work_date && a.shift_code === adj.shift_code)
      ?? db.shiftAssignments.find((a) => matchEmp(a.employee_id) && a.work_date === adj.work_date && a.shift_code === adj.shift_code);
  }
  if (!targetShift) return '';
  if (adj.punch_type === 'CHECK_IN' || adj.punch_type === 'CHECK_OUT') {
    const type = adj.punch_type, hm = type === 'CHECK_IN' ? (adj.requested_check_in_at || targetShift.start_at) : (adj.requested_check_out_at || targetShift.end_at);
    const branch = db.branches.get(targetShift.branch_id) ?? (emp ? db.branches.get(emp.branch_id) : undefined);
    await insertPartitionAwareRecord(db, 'ATTENDANCE_EVENTS', {
      idempotency_key: `adj_${adj.id}_${type}`, employee_id: targetShift.employee_id, assignment_id: targetShift.id, branch_id: targetShift.branch_id, type,
      server_time: `${targetShift.work_date}T${hm || '07:00'}:00+07:00`, lat: branch?.lat ?? 0, lng: branch?.lng ?? 0, accuracy_m: 0, distance_m: 0, within_radius: false,
      photo_id: adj.evidence_file_id ? `evidence_${adj.id}` : '', photo_sha256: '', device_info: 'Phiếu bổ sung công (HR phê duyệt minh chứng)', result: 'VALID',
      work_date: targetShift.work_date, shift_code: targetShift.shift_code, scheduled_time: type === 'CHECK_IN' ? targetShift.start_at : targetShift.end_at,
      late_minutes: 0, early_leave_minutes: 0, allowed_radius_m: branch?.radius_m ?? 100, gps_status: 'OUT_OF_RADIUS', photo_drive_file_id: adj.evidence_file_id,
      ip_address: '', anomaly_flags_json: JSON.stringify(['HR_APPROVED_EVIDENCE']), note: `${type === 'CHECK_IN' ? 'Vào ca' : 'Ra ca'} được bù bởi HR theo phiếu ${adj.adjustment_code} (HR duyệt minh chứng)`,
    }, targetShift.work_date, actorId);
    const fresh = (await findPartitionAwareRecord<ShiftAssignment>(db, 'SHIFT_ASSIGNMENTS', targetShift.id, targetShift.work_date))?.record ?? targetShift;
    const patch = type === 'CHECK_OUT' ? { status: 'COMPLETED' as const, note: `Hoàn thành ca theo phiếu ${adj.adjustment_code}` } : (fresh.status === 'ABSENT' ? { status: 'PUBLISHED' as const, note: `Đã xác nhận Vào ca theo phiếu ${adj.adjustment_code}` } : {});
    if (Object.keys(patch).length > 0) await updatePartitionAwareRecord(db, 'SHIFT_ASSIGNMENTS', fresh.id, fresh.version, patch, fresh.work_date, actorId);
    return targetShift.id;
  }
  await updatePartitionAwareRecord(db, 'SHIFT_ASSIGNMENTS', targetShift.id, targetShift.version, { status: 'COMPLETED', scheduled_hours: adj.requested_hours || targetShift.scheduled_hours, note: `Đã bù công theo phiếu bổ sung ${adj.adjustment_code}` }, targetShift.work_date, actorId);
  return targetShift.id;
}

export function formatPendingAdjustmentLabel(code: string, punchType?: string | null): string {
  if (punchType === 'CHECK_IN') return `Đã gửi yêu cầu Vào ca (${code} · Chờ duyệt)`;
  if (punchType === 'CHECK_OUT') return `Đã gửi yêu cầu Ra ca (${code} · Chờ duyệt)`;
  return `Đã gửi bù công (${code} · Chờ duyệt)`;
}

export function resolveShiftActiveRequests(db: Database, shift: ShiftAssignment, emp?: Employee) {
  const matchEmp = (eid: string) => eid === shift.employee_id || Boolean(emp && (eid === emp.id || eid === emp.employee_code));
  const shiftMonth = extractMonthKeyFromDate(shift.work_date);
  const isRegisteredMonth = Boolean(shiftMonth && readPartitionRegistry(db).some((r) => r.monthKey === shiftMonth));
  const adjPart = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<AttendanceAdjustment>(db, 'ATTENDANCE_ADJUSTMENTS', shiftMonth) : undefined;
  const swapPart = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<ShiftSwap>(db, 'SHIFT_SWAPS', shiftMonth) : undefined;
  const leavePart = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<LeaveRequest>(db, 'LEAVE_REQUESTS', shiftMonth) : undefined;
  const adjSources = adjPart ? (isRegisteredMonth ? [adjPart] : [adjPart, db.attendanceAdjustments]) : [db.attendanceAdjustments];
  const swapSources = swapPart ? (isRegisteredMonth ? [swapPart] : [swapPart, db.shiftSwaps]) : [db.shiftSwaps];
  const leaveSources = leavePart ? (isRegisteredMonth ? [leavePart] : [leavePart, db.leaveRequests]) : [db.leaveRequests];

  const shiftAdjs = adjSources.flatMap((s) => s.filter((a) => (shift.id && a.assignment_id === shift.id) || (matchEmp(a.employee_id) && a.work_date === shift.work_date && a.shift_code === shift.shift_code))).reverse();
  const approvedAdj = shiftAdjs.find((a) => a.status === 'APPROVED' && a.punch_type !== 'CHECK_IN');
  const pendingAdj = shiftAdjs.find((a) => a.status === 'PENDING' || a.status === 'STORE_CONFIRMED');
  const rejectedAdj = !pendingAdj && !approvedAdj ? shiftAdjs.find((a) => a.status === 'REJECTED') : undefined;
  const pendingSwap = swapSources.flatMap((s) => s.filter((x) => (x.status === 'PENDING_PEER' || x.status === 'PEER_ACCEPTED') && (x.from_assignment_id === shift.id || x.to_assignment_id === shift.id || (matchEmp(x.requester_id) && x.from_work_date === shift.work_date && x.from_shift_code === shift.shift_code))))[0];
  const pendingLeave = leaveSources.flatMap((s) => s.filter((l) => (l.status === 'PENDING' || l.status === 'DRAFT') && ((shift.id && l.assignment_id === shift.id) || (matchEmp(l.employee_id) && l.leave_date === shift.work_date))))[0];
  return {
    hasApprovedAdjustment: Boolean(approvedAdj),
    pendingAdjustmentCode: pendingAdj?.adjustment_code ?? null, pendingAdjustmentStatus: pendingAdj?.status ?? null, pendingAdjustmentPunchType: pendingAdj?.punch_type ?? null,
    rejectedAdjustmentCode: rejectedAdj?.adjustment_code ?? null, rejectedAdjustmentPunchType: rejectedAdj?.punch_type ?? null, rejectedAdjustmentReason: rejectedAdj?.decision_reason ?? null,
    pendingSwapCode: pendingSwap?.swap_code ?? null, pendingLeaveCode: pendingLeave?.request_code ?? null,
  };
}

export function assertNoDuplicateAdjustment(db: Database, emp: Employee, assignmentId: string, workDate: string, shiftCode: string, punchType: 'CHECK_IN' | 'CHECK_OUT' | 'FULL_SHIFT' = 'FULL_SHIFT', extraStore?: { find: typeof db.attendanceAdjustments.find }): void {
  const samePunch = (p: string) => p === punchType || p === 'FULL_SHIFT' || punchType === 'FULL_SHIFT';
  const pred = (a: AttendanceAdjustment) => a.status !== 'REJECTED' && samePunch(a.punch_type) && (Boolean(assignmentId && a.assignment_id === assignmentId) || ((a.employee_id === emp.id || a.employee_id === emp.employee_code) && a.work_date === workDate && a.shift_code === shiftCode));
  const shiftMonth = extractMonthKeyFromDate(workDate);
  const cachedStore = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<AttendanceAdjustment>(db, 'ATTENDANCE_ADJUSTMENTS', shiftMonth) : undefined;
  const dup = extraStore?.find(pred) ?? cachedStore?.find(pred) ?? (shiftMonth === db.partitionMonth ? db.attendanceAdjustments.find(pred) : undefined);
  if (dup) throw Errors.fieldValidation('assignment_id', 'DUPLICATE_VALUE', `Ca làm việc ngày ${workDate} đã gửi Phiếu bổ sung công (${dup.adjustment_code}) và đang chờ duyệt hoặc đã được phê duyệt. Không được phép gửi trùng yêu cầu.`, assignmentId || workDate);
}

export function assertNoDuplicateShiftWorkflow(db: Database, emp: Employee, field: string, assignmentId: string, workDate: string, shiftCode: string): void {
  const isEmp = (eid: string) => eid === emp.id || eid === emp.employee_code;
  const shiftMonth = extractMonthKeyFromDate(workDate);
  const leavePart = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<LeaveRequest>(db, 'LEAVE_REQUESTS', shiftMonth) : undefined;
  const swapPart = shiftMonth !== db.partitionMonth ? getCachedPartitionStore<ShiftSwap>(db, 'SHIFT_SWAPS', shiftMonth) : undefined;
  const leavePred = (l: LeaveRequest) => isEmp(l.employee_id) && l.leave_date === workDate && l.status !== 'REJECTED' && l.status !== 'CANCELLED';
  const dupLeave = (leavePart ?? db.leaveRequests).find(leavePred);
  if (dupLeave) throw Errors.fieldValidation(field, 'DUPLICATE_VALUE', `Ngày ${workDate} đã có Đơn xin nghỉ OFF (${dupLeave.request_code}) đang chờ duyệt hoặc đã được duyệt, không được phép gửi thêm yêu cầu.`, workDate);
  const swapPred = (s: ShiftSwap) => (s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED') && (Boolean(assignmentId && s.from_assignment_id === assignmentId) || (isEmp(s.requester_id) && s.from_work_date === workDate && s.from_shift_code === shiftCode));
  const dupSwap = (swapPart ?? db.shiftSwaps).find(swapPred);
  if (dupSwap) throw Errors.fieldValidation(field, 'DUPLICATE_VALUE', `Ca làm việc ngày ${workDate} đang có Yêu cầu đổi ca (${dupSwap.swap_code}) chờ duyệt, không được phép gửi trùng yêu cầu.`, assignmentId || workDate);
}

export function resolveWorkflowShiftStatus(db: Database, shiftCode: string, assignmentId = '', employeeId = '', workDate = '') {
  const emp = employeeId ? (db.employees.get(employeeId) ?? db.employees.find((e) => e.employee_code === employeeId)) : undefined;
  const matchEmp = (eid: string) => Boolean(employeeId && (eid === employeeId || (emp && (eid === emp.id || eid === emp.employee_code))));
  const mk = extractMonthKeyFromDate(workDate);
  const shStore = (mk && mk !== db.partitionMonth ? getCachedPartitionStore<ShiftAssignment>(db, 'SHIFT_ASSIGNMENTS', mk) : undefined) ?? db.shiftAssignments;
  const assign = (assignmentId ? (shStore.get(assignmentId) ?? db.shiftAssignments.get(assignmentId)) : undefined)
    ?? (employeeId && workDate
      ? (shStore.find((a) => matchEmp(a.employee_id) && a.work_date === workDate && a.shift_code === shiftCode && a.day_type !== 'OFF')
        ?? shStore.find((a) => matchEmp(a.employee_id) && a.work_date === workDate && a.day_type !== 'OFF'))
      : undefined);
  if (!assign) return { shiftAssignmentId: '', shiftStatus: 'MISSING', shiftStatusLabel: 'Không còn ca trên lịch', isShiftOfficialPublished: false };
  const aMk = extractMonthKeyFromDate(assign.work_date);
  const evStore = (aMk && aMk !== db.partitionMonth ? getCachedPartitionStore<AttendanceEvent>(db, 'ATTENDANCE_EVENTS', aMk) : undefined) ?? db.attendanceEvents;
  const adjStore = (aMk && aMk !== db.partitionMonth ? getCachedPartitionStore<AttendanceAdjustment>(db, 'ATTENDANCE_ADJUSTMENTS', aMk) : undefined) ?? db.attendanceAdjustments;
  const aEmp = db.employees.get(assign.employee_id) ?? db.employees.find((e) => e.employee_code === assign.employee_id);
  const matchAEmp = (eid: string) => eid === assign.employee_id || Boolean(aEmp && (eid === aEmp.id || eid === aEmp.employee_code));
  const evs = evStore.filter((ev) => ev.assignment_id === assign.id || (matchAEmp(ev.employee_id) && ev.work_date === assign.work_date && ev.shift_code === assign.shift_code));
  const hasIn = evs.some((ev) => ev.type === 'CHECK_IN'), hasOut = evs.some((ev) => ev.type === 'CHECK_OUT');
  const hasApprovedAdj = Boolean(adjStore.find((a) => a.status === 'APPROVED' && a.punch_type !== 'CHECK_IN' && (a.assignment_id === assign.id || (matchAEmp(a.employee_id) && a.work_date === assign.work_date && a.shift_code === assign.shift_code))));
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
  const mk = extractMonthKeyFromDate(shift.work_date);
  const evStore = (mk && mk !== db.partitionMonth ? getCachedPartitionStore<AttendanceEvent>(db, 'ATTENDANCE_EVENTS', mk) : undefined) ?? db.attendanceEvents;
  const adjStore = (mk && mk !== db.partitionMonth ? getCachedPartitionStore<AttendanceAdjustment>(db, 'ATTENDANCE_ADJUSTMENTS', mk) : undefined) ?? db.attendanceAdjustments;
  for (const ev of evStore.filter((e) => e.assignment_id === shift.id || (matchEmp(e.employee_id) && e.work_date === shift.work_date && e.shift_code === shift.shift_code))) {
    await evStore.softDelete(ev.id, ev.version, actorId);
  }
  for (const adj of adjStore.filter((a) => a.status !== 'REJECTED' && (a.assignment_id === shift.id || (matchEmp(a.employee_id) && a.work_date === shift.work_date && a.shift_code === shift.shift_code)))) {
    await adjStore.update(adj.id, adj.version, { status: 'REJECTED', decided_by: actorId, decision_reason: reason, decided_at: new Date().toISOString() }, actorId);
  }
}
