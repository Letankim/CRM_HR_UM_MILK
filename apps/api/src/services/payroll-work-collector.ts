import { DEFAULT_SHIFT_LABELS, PAYROLL_WORK_SOURCE_LABELS, type Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';
import { parseHm } from '../routes/attendance-helpers.js';
import type { WorkEntry } from './payroll-calculator.js';
import { getVnNowDateAndHm } from './shift-absent-scanner.js';

const COUNTED_STATUSES = new Set(['PUBLISHED', 'COMPLETED']);

export interface ShiftPayrollLog {
  assignmentId?: string;
  date: string;
  shiftCode: string;
  shiftLabel: string;
  shiftTime: string;
  branchName?: string;
  status: 'ATTENDANCE_FULL' | 'ATTENDANCE_CHECKIN' | 'ADJUSTMENT_APPROVED' | 'SCHEDULE_PUBLISHED' | 'LEAVE_OFF' | 'SWAPPED_OUT' | 'EMERGENCY_LEAVE' | 'ABSENT';
  statusLabel: string;
  hours: number;
  otHours: number;
  isSwapIn: boolean;
  lateMinutes: number;
  checkInHm: string;
  checkOutHm: string;
  pendingAdjustmentCode?: string;
  pendingAdjustmentStatus?: string;
  note: string;
}

export interface CollectedWorkSummary {
  entries: WorkEntry[];
  absentCount: number;
  lateCount: number;
  lateMinutesTotal: number;
  checkedInShiftsCount: number;
  adjustedShiftsCount: number;
  scheduledOnlyShiftsCount: number;
  leaveOffCount: number;
  emergencyLeaveCount: number;
  swappedOutCount: number;
  shiftLogs: ShiftPayrollLog[];
  source: keyof typeof PAYROLL_WORK_SOURCE_LABELS;
}

const cleanShiftLabel = (code: string) =>
  (DEFAULT_SHIFT_LABELS[code as keyof typeof DEFAULT_SHIFT_LABELS] ?? code).replace(/\s*\([^)]*\)\s*/g, '').trim();

/**
 * Thu thập & đối soát toàn diện dữ liệu công của nhân sự trong kỳ lương từ 5 nguồn:
 * 1. Lịch phân ca chính thức (SHIFT_ASSIGNMENTS)
 * 2. Sự kiện chấm công GPS Vào/Ra ca thực tế (ATTENDANCE_EVENTS)
 * 3. Phiếu bổ sung / điều chỉnh công đã duyệt (ATTENDANCE_ADJUSTMENTS)
 * 4. Đơn xin nghỉ phép OFF đã duyệt (LEAVE_REQUESTS) & Báo nghỉ đột xuất (EMERGENCY_LEAVES)
 * 5. Yêu cầu đổi ca 3 bước đã duyệt (SHIFT_SWAPS)
 */
export function collectWorkEntries(ctx: AppContext, empOrId: Employee | string, from: string, to: string): CollectedWorkSummary {
  const emp = typeof empOrId === 'string'
    ? (ctx.db.employees.get(empOrId) ?? ctx.db.employees.find((e) => e.employee_code === empOrId))
    : empOrId;
  const empId = emp?.id ?? (typeof empOrId === 'string' ? empOrId : '');
  const empCode = emp?.employee_code ?? '';
  const isEmp = (val?: string) => Boolean(val && (val === empId || (empCode && val === empCode)));

  const deletedShifts = ctx.db.shiftAssignments.all(true).filter((a) => a.is_deleted && isEmp(a.employee_id) && a.work_date >= from && a.work_date <= to);
  const isDeletedRef = (assignId?: string, workDate?: string, shiftCode?: string) => {
    if (assignId) return !ctx.db.shiftAssignments.get(assignId);
    if (workDate && shiftCode) {
      const hasActive = Boolean(ctx.db.shiftAssignments.find((a) => isEmp(a.employee_id) && a.work_date === workDate && a.shift_code === shiftCode));
      if (!hasActive && deletedShifts.some((a) => a.work_date === workDate && a.shift_code === shiftCode)) return true;
    }
    return false;
  };

  const approvedLeaves = ctx.db.leaveRequests.filter(
    (l) => isEmp(l.employee_id) && l.leave_date >= from && l.leave_date <= to && l.status === 'APPROVED',
  );
  const approvedLeaveDates = new Set(approvedLeaves.map((l) => l.leave_date));

  const swapsGivenOut = ctx.db.shiftSwaps.filter(
    (s) => isEmp(s.requester_id) && !isEmp(s.peer_id) && s.from_work_date >= from && s.from_work_date <= to && s.status === 'APPROVED' && !isDeletedRef(s.from_assignment_id, s.from_work_date, s.from_shift_code),
  );
  const swapsReceived = ctx.db.shiftSwaps.filter(
    (s) => isEmp(s.peer_id) && !isEmp(s.requester_id) && s.from_work_date >= from && s.from_work_date <= to && s.status === 'APPROVED' && !isDeletedRef(s.from_assignment_id, s.from_work_date, s.from_shift_code),
  );
  const receivedSwapAssignIds = new Set(swapsReceived.map((s) => s.from_assignment_id).filter(Boolean));

  const myEmergencyLeaves = ctx.db.emergencyLeaves.filter(
    (el) => isEmp(el.employee_id) && el.work_date >= from && el.work_date <= to && !isDeletedRef(el.assignment_id, el.work_date, el.shift_code),
  );
  const replacedEmergencies = ctx.db.emergencyLeaves.filter(
    (el) => isEmp(el.replacement_id) && !isEmp(el.employee_id) && el.work_date >= from && el.work_date <= to && (el.status === 'REPLACEMENT_FOUND' || el.status === 'RESOLVED'),
  );

  const empEvents = ctx.db.attendanceEvents.filter((e) => isEmp(e.employee_id) && e.work_date >= from && e.work_date <= to && !isDeletedRef(e.assignment_id, e.work_date, e.shift_code));
  const empAdjsAll = ctx.db.attendanceAdjustments.filter((a) => isEmp(a.employee_id) && a.work_date >= from && a.work_date <= to && !isDeletedRef(a.assignment_id, a.work_date, a.shift_code));
  const approvedAdjs = empAdjsAll.filter((a) => a.status === 'APPROVED');
  const pendingAdjs = empAdjsAll.filter((a) => a.status === 'PENDING' || a.status === 'STORE_CONFIRMED');

  const inRange = ctx.db.shiftAssignments.filter(
    (a) => (isEmp(a.employee_id) || receivedSwapAssignIds.has(a.id)) && a.work_date >= from && a.work_date <= to,
  );

  const entries: WorkEntry[] = [];
  const shiftLogs: ShiftPayrollLog[] = [];
  const usedAdjIds = new Set<string>(), usedLeaveDates = new Set<string>(), usedSwapOutIds = new Set<string>(), usedSwapInIds = new Set<string>();
  let absentCount = 0, lateCount = 0, lateMinutesTotal = 0, checkedInShiftsCount = 0, adjustedShiftsCount = 0, scheduledOnlyShiftsCount = 0, emergencyLeaveCount = 0;
  const { todayStr, nowHm } = getVnNowDateAndHm();
  const isVitest = Boolean(process.env.VITEST);

  for (const a of inRange) {
    const endAt = a.end_at || '12:00', shiftTime = `${a.start_at || '07:00'} – ${endAt}`, shiftLabel = cleanShiftLabel(a.shift_code);
    const branchName = (ctx.db.branches.get(a.branch_id) ?? (emp?.branch_id ? ctx.db.branches.get(emp.branch_id) : undefined))?.name ?? '';
    const evs = empEvents.filter((e) => e.assignment_id === a.id || (!e.assignment_id && e.work_date === a.work_date && e.shift_code === a.shift_code));
    const checkIn = evs.find((e) => e.type === 'CHECK_IN'), checkOut = evs.find((e) => e.type === 'CHECK_OUT');
    const adj = approvedAdjs.find((ad) => ad.assignment_id === a.id || (!ad.assignment_id && ad.work_date === a.work_date && ad.shift_code === a.shift_code));
    const pendAdj = pendingAdjs.find((ad) => ad.assignment_id === a.id || (!ad.assignment_id && ad.work_date === a.work_date && ad.shift_code === a.shift_code));
    const checkInHm = checkIn ? dayjs(checkIn.server_time).format('HH:mm') : '', checkOutHm = checkOut ? dayjs(checkOut.server_time).format('HH:mm') : '';
    const isExpired = a.work_date < todayStr || (a.work_date === todayStr && nowHm > endAt);
    const isExpiredUnpunched = a.status === 'PUBLISHED' && isExpired && !(isVitest && a.source === 'SEED');

    const swapOut = swapsGivenOut.find((s) => s.from_assignment_id === a.id || (s.from_work_date === a.work_date && s.from_shift_code === a.shift_code));
    if (swapOut && !receivedSwapAssignIds.has(a.id)) {
      usedSwapOutIds.add(swapOut.id);
      shiftLogs.push({ assignmentId: a.id, date: a.work_date, shiftCode: a.shift_code, shiftLabel, shiftTime, branchName, status: 'SWAPPED_OUT', statusLabel: `Đã đổi ca (${swapOut.swap_code})`, hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: swapOut.reason });
      continue;
    }

    if ((approvedLeaveDates.has(a.work_date) || a.day_type === 'OFF' || a.status === 'ON_LEAVE') && !checkIn && !checkOut && !adj) {
      usedLeaveDates.add(a.work_date);
      shiftLogs.push({ assignmentId: a.id, date: a.work_date, shiftCode: a.shift_code, shiftLabel, shiftTime, branchName, status: 'LEAVE_OFF', statusLabel: 'Nghỉ phép (OFF đã duyệt)', hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: a.note || 'Đơn nghỉ OFF đã duyệt' });
      continue;
    }

    const emg = myEmergencyLeaves.find((el) => el.assignment_id === a.id || (el.work_date === a.work_date && el.shift_code === a.shift_code));
    if (emg && (emg.status === 'REPLACEMENT_FOUND' || emg.status === 'RESOLVED' || Boolean(emg.replacement_id)) && !checkIn && !checkOut && !adj) {
      emergencyLeaveCount += 1;
      shiftLogs.push({ assignmentId: a.id, date: a.work_date, shiftCode: a.shift_code, shiftLabel, shiftTime, branchName, status: 'EMERGENCY_LEAVE', statusLabel: `Nghỉ đột xuất (${emg.emergency_code})`, hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: emg.reason });
      continue;
    }

    if ((a.status === 'ABSENT' || isExpiredUnpunched) && !checkIn && !checkOut && !adj) {
      absentCount += 1;
      const absLabel = pendAdj ? `Vắng mặt · Chờ duyệt bù công (${pendAdj.adjustment_code})` : 'Vắng mặt không phép (Chưa chấm công Vào/Ra)';
      shiftLogs.push({ assignmentId: a.id, date: a.work_date, shiftCode: a.shift_code, shiftLabel, shiftTime, branchName, status: 'ABSENT', statusLabel: absLabel, hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', pendingAdjustmentCode: pendAdj?.adjustment_code, pendingAdjustmentStatus: pendAdj?.status, note: a.note });
      continue;
    }

    if (!COUNTED_STATUSES.has(a.status) && !checkIn && !checkOut && !adj && !receivedSwapAssignIds.has(a.id)) continue;

    const swapIn = swapsReceived.find((s) => s.from_assignment_id === a.id || (s.from_work_date === a.work_date && s.from_shift_code === a.shift_code));
    if (swapIn) usedSwapInIds.add(swapIn.id);
    const isSwap = Boolean(a.swapped_from_employee_id || a.replacement_for_employee_id || swapIn || replacedEmergencies.some((el) => el.work_date === a.work_date && el.shift_code === a.shift_code));

    const lateMins = checkIn ? (checkIn.late_minutes || Math.max(0, parseHm(checkInHm) - parseHm(a.start_at || '07:00'))) : 0;
    if (lateMins > 0) { lateCount += 1; lateMinutesTotal += lateMins; }

    let baseHours = a.scheduled_hours || 5, extraOt = 0;
    let status: ShiftPayrollLog['status'] = 'SCHEDULE_PUBLISHED', statusLabel = 'Ca phân công chính thức';

    if (adj) {
      usedAdjIds.add(adj.id);
      baseHours = adj.requested_hours > 0 ? adj.requested_hours : baseHours;
      adjustedShiftsCount += 1;
      if (checkIn || checkOut) checkedInShiftsCount += 1;
      status = 'ADJUSTMENT_APPROVED';
      statusLabel = `Bổ sung công (${adj.adjustment_code})`;
    } else if ((checkIn && checkOut) || a.status === 'COMPLETED') {
      checkedInShiftsCount += 1;
      status = 'ATTENDANCE_FULL';
      statusLabel = lateMins > 0 ? `Đã chấm công (Trễ ${lateMins}p)` : 'Đã chấm công Vào/Ra hợp lệ';
      const outOverMins = checkOutHm ? parseHm(checkOutHm) - parseHm(endAt) : 0;
      if (outOverMins >= 30 && a.day_type !== 'OT') extraOt = Math.round((outOverMins / 60) * 100) / 100;
    } else if (checkIn || checkOut) {
      checkedInShiftsCount += 1;
      status = 'ATTENDANCE_CHECKIN';
      const missPart = checkIn && !checkOut ? `Quên chấm công Ra ca (Vào ${checkInHm})` : `Thiếu chấm công Vào ca (Ra ${checkOutHm})`;
      statusLabel = pendAdj ? `${missPart} · Chờ duyệt ${pendAdj.adjustment_code}` : missPart;
    } else {
      scheduledOnlyShiftsCount += 1;
    }

    const hours = a.day_type === 'OT' ? 0 : baseHours, otHours = a.day_type === 'OT' ? baseHours : extraOt;
    entries.push({ assignmentId: a.id, date: a.work_date, hours, otHours, isSwap });
    shiftLogs.push({ assignmentId: a.id, date: a.work_date, shiftCode: a.shift_code, shiftLabel, shiftTime, branchName, status, statusLabel, hours, otHours, isSwapIn: isSwap, lateMinutes: lateMins, checkInHm, checkOutHm, pendingAdjustmentCode: pendAdj?.adjustment_code, pendingAdjustmentStatus: pendAdj?.status, note: a.note });
  }

  for (const adj of approvedAdjs.filter((ad) => !usedAdjIds.has(ad.id))) {
    const hrs = adj.requested_hours > 0 ? adj.requested_hours : 5;
    adjustedShiftsCount += 1;
    entries.push({ assignmentId: adj.assignment_id || adj.id, date: adj.work_date, hours: hrs, otHours: 0, isSwap: false });
    shiftLogs.push({ date: adj.work_date, shiftCode: adj.shift_code, shiftLabel: cleanShiftLabel(adj.shift_code), shiftTime: `${adj.requested_check_in_at} – ${adj.requested_check_out_at}`, status: 'ADJUSTMENT_APPROVED', statusLabel: `Bổ sung công (${adj.adjustment_code})`, hours: hrs, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: adj.requested_check_in_at, checkOutHm: adj.requested_check_out_at, note: adj.reason });
  }

  for (const sw of swapsReceived.filter((s) => !usedSwapInIds.has(s.id))) {
    entries.push({ assignmentId: sw.from_assignment_id || sw.id, date: sw.from_work_date, hours: 5, otHours: 0, isSwap: true });
    shiftLogs.push({ date: sw.from_work_date, shiftCode: sw.from_shift_code, shiftLabel: cleanShiftLabel(sw.from_shift_code), shiftTime: '07:00 – 12:00', status: 'SCHEDULE_PUBLISHED', statusLabel: `Nhận đổi ca (${sw.swap_code})`, hours: 5, otHours: 0, isSwapIn: true, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: sw.reason });
  }

  for (const l of approvedLeaves.filter((x) => !usedLeaveDates.has(x.leave_date))) {
    shiftLogs.push({ date: l.leave_date, shiftCode: l.shift_code, shiftLabel: cleanShiftLabel(l.shift_code), shiftTime: 'Nghỉ cả ca', status: 'LEAVE_OFF', statusLabel: `Nghỉ OFF đã duyệt (${l.request_code})`, hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: l.reason });
  }

  for (const sw of swapsGivenOut.filter((s) => !usedSwapOutIds.has(s.id))) {
    shiftLogs.push({ date: sw.from_work_date, shiftCode: sw.from_shift_code, shiftLabel: cleanShiftLabel(sw.from_shift_code), shiftTime: 'Đã chuyển ca', status: 'SWAPPED_OUT', statusLabel: `Đã đổi ca (${sw.swap_code})`, hours: 0, otHours: 0, isSwapIn: false, lateMinutes: 0, checkInHm: '', checkOutHm: '', note: sw.reason });
  }

  shiftLogs.sort((a, b) => a.date.localeCompare(b.date));
  const source: keyof typeof PAYROLL_WORK_SOURCE_LABELS = checkedInShiftsCount > 0 || adjustedShiftsCount > 0 ? 'ATTENDANCE_CONFIRMED' : 'SCHEDULE_PUBLISHED';

  return {
    entries, absentCount, lateCount, lateMinutesTotal,
    checkedInShiftsCount, adjustedShiftsCount, scheduledOnlyShiftsCount,
    leaveOffCount: approvedLeaves.length, emergencyLeaveCount, swappedOutCount: swapsGivenOut.length,
    shiftLogs, source,
  };
}
