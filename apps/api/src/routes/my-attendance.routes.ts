import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateOffWindow, REQUEST_STATUS_LABELS, ROLE_LABELS, type Employee, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { requireAuth } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { evaluateBranchShiftCapacity, getShiftCheckoutWindow } from '../services/schedule-staffing-helper.js';
import { formatPendingAdjustmentLabel } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, healBranchConsistency, resolveShiftTimeDetails } from './account-employee-sync.js';
import { mapAttendanceEvent, migrateLegacyBase64Photos } from './attendance-helpers.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';
import { mapAdjustmentRecord } from './attendance-adjustments.routes.js';
import { buildProbationCycleSummary, registerMyShiftRegisterRoute } from './my-shift-register.routes.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { mapShiftAssignment } from './schedules.routes.js';
import { mapShiftSwapRecord } from './shift-swap-helpers.js';

const SHIFT_DEFAULT_HOURS: Record<string, { start: string; end: string; hours: number }> = {
  CA_SANG: { start: '07:00', end: '12:00', hours: 5 }, CA_CHIEU: { start: '12:00', end: '17:00', hours: 5 },
  CA_TOI: { start: '17:00', end: '22:00', hours: 5 }, CA_HANH_CHINH: { start: '08:00', end: '17:30', hours: 8 },
};
function getVnDateAndHm(): { todayStr: string; nowHm: string } {
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return { todayStr: dayjs(vnNow).format('YYYY-MM-DD'), nowHm: dayjs(vnNow).format('HH:mm') };
}

export async function ensurePersonalProfile(ctx: AppContext, user: User): Promise<Employee> {
  const existing = findLinkedEmployeeForUser(user, ctx);
  if (existing) {
    if (!existing.user_id) await ctx.db.employees.update(existing.id, existing.version, { user_id: user.id }, user.id).catch(() => undefined);
    if (!user.employee_id) await ctx.db.users.update(user.id, user.version, { employee_id: existing.employee_code }, user.id).catch(() => undefined);
    for (const s of ctx.db.shiftAssignments.filter((a) => (a.employee_id === existing.id || a.employee_id === existing.employee_code) && a.note === 'Ca làm việc cá nhân hôm nay')) {
      if (!ctx.db.attendanceEvents.find((e) => e.assignment_id === s.id)) await ctx.db.shiftAssignments.softDelete(s.id, s.version, user.id);
    }
    return existing;
  }
  const firstBranch = ctx.db.branches.all()[0];
  const scopedBranchId = user.branch_scope && user.branch_scope !== 'ALL' ? user.branch_scope.split(',')[0]?.trim() || firstBranch?.id || '' : firstBranch?.id || '';
  const nextCode = `NV${String(ctx.db.employees.all(true).length + 1).padStart(4, '0')}`;
  const isProb = user.role === 'THU_VIEC';
  const createdEmp = await ctx.db.employees.insert({
    employee_code: nextCode, candidate_id: '', user_id: user.id, full_name: user.display_name, phone: user.phone || '', email: user.email || '',
    date_of_birth: '1998-01-01', gender: 'Khác', citizen_id: '', citizen_issue_date: '', permanent_address: 'TP. Hồ Chí Minh', current_address: 'TP. Hồ Chí Minh',
    emergency_contact_name: '', emergency_contact_phone: '', branch_id: scopedBranchId, staff_group: 'BACKOFFICE', position_title: ROLE_LABELS[user.role] || 'Nhân sự',
    stage: isProb ? 'PROBATION' : 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_SANG', probation_start: '2026-01-01', probation_end: '2026-01-12',
    probation_cycle_days: 12, probation_work_days: 7, probation_off_days: 5, official_from: '2026-01-13', resigned_at: '', resign_reason: '', status: 'ACTIVE',
    base_hourly_rate_vnd: 35000, bank_name: 'Techcombank', bank_account_number: '', bank_account_holder: user.display_name.toUpperCase(), tax_code: '',
    note: 'Hồ sơ nhân sự liên kết tài khoản hệ thống',
  }, user.id);
  await ctx.db.users.update(user.id, user.version, { employee_id: createdEmp.employee_code }, user.id);
  return createdEmp;
}

export async function myAttendanceRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/my-attendance', { preHandler: requireAuth() }, async (request) => {
    void migrateLegacyBase64Photos(ctx);
    await runBackgroundSideEffect(() => healBranchConsistency(ctx));
    const user = request.auth!.user, settings = getOperationSettings(ctx.db);
    const emp = await ensurePersonalProfile(ctx, user);
    const branch = ctx.db.branches.get(emp.branch_id) ?? ctx.db.branches.all()[0];
    const { todayStr, nowHm } = getVnDateAndHm();

    const myRawEvents = ctx.db.attendanceEvents.filter((e) => e.employee_id === emp.id || e.employee_id === emp.employee_code).reverse();
    const events = myRawEvents.map((e) => mapAttendanceEvent(e, ctx));

    const myRawShifts = ctx.db.shiftAssignments.filter((a) => a.employee_id === emp.id || a.employee_id === emp.employee_code).reverse();
    const shifts = myRawShifts.map((a) => {
      const base = mapShiftAssignment(a, ctx);
      const sEvs = events.filter((e) => e.assignment_id === a.id || (!e.assignment_id && e.work_date === a.work_date && e.shift_code === a.shift_code));
      const inEv = sEvs.find((e) => e.type === 'CHECK_IN') ?? null;
      let outEv = sEvs.find((e) => e.type === 'CHECK_OUT') ?? null;
      if (a.status === 'COMPLETED' && inEv && !outEv) {
        const rawIn = myRawEvents.find((e) => e.id === inEv.id);
        if (rawIn) { outEv = mapAttendanceEvent({ ...rawIn, id: `${inEv.id}_auto_out`, type: 'CHECK_OUT', scheduled_time: a.end_at || '12:00', server_time: `${a.work_date}T${a.end_at || '12:00'}:00+07:00`, late_minutes: 0, early_leave_minutes: 0, note: 'Đã hoàn thành ca (Xác nhận bổ sung giờ ra ca)' }, ctx); events.push(outEv); }
      }
      const win = getShiftCheckoutWindow(a.work_date, a.start_at || '07:00', a.end_at || '12:00', todayStr, nowHm);
      const isToday = a.work_date === todayStr, isExpiredToday = isToday && !inEv && win.isPastEnd;
      const isAbsentShift = a.status === 'ABSENT' || (!inEv && a.status === 'PUBLISHED' && win.isPastEnd);
      const isPendingApproval = a.status === 'DRAFT', isDone = a.status === 'COMPLETED' || Boolean(inEv && outEv) || base.hasApprovedAdjustment;
      const isForgotCheckout = Boolean(inEv && !outEv && !isDone && win.isCheckoutLocked);
      const isWithinCheckoutGrace = Boolean(inEv && !outEv && !isDone && win.isWithinCheckoutGrace);
      const canCheckOutNow = Boolean(inEv && !outEv && !isDone && !win.isCheckoutLocked && (isToday || win.isWithinCheckoutGrace));
      const effectiveStatus = isDone && (base.status === 'PUBLISHED' || base.status === 'ABSENT') ? 'COMPLETED' : base.status;
      const effectiveStatusLabel = effectiveStatus === 'COMPLETED' ? 'Đã hoàn thành' : base.statusLabel;
      const inTimeHm = inEv ? String(inEv.checkTimeFormatted || '').slice(0, 5) : '';
      const pendingLabel = base.pendingAdjustmentCode ? formatPendingAdjustmentLabel(base.pendingAdjustmentCode, base.pendingAdjustmentPunchType) : '';
      const hasRelevantRejection = !isDone && !pendingLabel && Boolean(base.rejectedAdjustmentCode) && !(inEv && base.rejectedAdjustmentPunchType === 'CHECK_IN');
      const attendanceStatusLabel = isDone ? 'Đã hoàn thành ca'
        : isPendingApproval ? 'Chờ CH / HR duyệt phân ca'
        : pendingLabel ? pendingLabel
        : isAbsentShift ? 'Vắng mặt (Quá giờ ca — Cần bổ sung công)'
        : inEv ? (isForgotCheckout ? `Quên Ra ca (Vào ${inTimeHm} — Cần bổ sung công)` : isWithinCheckoutGrace ? `Đã vào ca (${inTimeHm} · Còn hạn Ra ca đến ${win.graceDeadlineHm})` : `Đã vào ca (${inTimeHm})`)
        : base.pendingSwapCode ? `Chờ duyệt đổi ca (${base.pendingSwapCode})`
        : base.pendingLeaveCode ? `Chờ duyệt nghỉ (${base.pendingLeaveCode})` : 'Chưa điểm danh';
      const attendanceStatusColor = isDone ? 'green' : isPendingApproval ? 'gold' : pendingLabel ? 'orange' : isAbsentShift ? 'red' : inEv ? (isForgotCheckout || inEv.punctualityStatus === 'LATE' ? 'volcano' : 'processing') : base.pendingSwapCode ? 'purple' : base.pendingLeaveCode ? 'gold' : 'default';
      return {
        ...base, status: effectiveStatus, statusLabel: effectiveStatusLabel, isToday, isExpiredToday, isAbsentShift: !isDone && isAbsentShift,
        isForgotCheckout, isWithinCheckoutGrace, canCheckOutNow, checkoutGraceDeadlineHm: win.graceDeadlineHm, checkInEvent: inEv, checkOutEvent: outEv,
        rejectedAdjustmentCode: hasRelevantRejection ? base.rejectedAdjustmentCode : null,
        rejectedAdjustmentPunchType: hasRelevantRejection ? base.rejectedAdjustmentPunchType : null,
        rejectedAdjustmentReason: hasRelevantRejection ? base.rejectedAdjustmentReason : null,
        attendanceStatusLabel, attendanceStatusColor,
      };
    }).sort((a, b) => {
      const rank = (s: { workDate: string; isToday: boolean; status: string; isAbsentShift: boolean; isExpiredToday: boolean; canCheckOutNow: boolean; checkInEvent: unknown; checkOutEvent: unknown }) =>
        s.canCheckOutNow ? 0 : s.isToday ? (s.status === 'PUBLISHED' && !s.isAbsentShift && !s.isExpiredToday && !s.checkInEvent ? 1 : s.status === 'PUBLISHED' ? 2 : 3) : s.workDate > todayStr ? 4 : 5;
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.workDate >= todayStr ? a.workDate.localeCompare(b.workDate) || a.startAt.localeCompare(b.startAt) : b.workDate.localeCompare(a.workDate);
    });

    const leaves = ctx.db.leaveRequests
      .filter((l) => l.employee_id === emp.id || l.employee_id === emp.employee_code)
      .reverse()
      .map((l) => ({ ...l, ...resolveShiftTimeDetails(ctx, l.shift_code, l.assignment_id, l.branch_id, l.employee_id, l.leave_date), branchName: ctx.db.branches.get(l.branch_id)?.name ?? branch?.name ?? 'Chi nhánh', statusLabel: REQUEST_STATUS_LABELS[l.status] }));

    const swaps = ctx.db.shiftSwaps
      .filter((s) => s.requester_id === emp.id || s.requester_id === emp.employee_code || s.peer_id === emp.id || s.peer_id === emp.employee_code)
      .reverse()
      .map((s) => mapShiftSwapRecord(ctx, s, branch));

    const peerBusyByEmp = new Map<string, Record<string, string>>();
    const putBusy = (key: string, date: string, label: string) => {
      let map = peerBusyByEmp.get(key);
      if (!map) { map = {}; peerBusyByEmp.set(key, map); }
      map[date] = label;
    };
    for (const a of ctx.db.shiftAssignments.all()) {
      if (a.day_type === 'OFF' || a.status === 'ON_LEAVE' || a.status === 'ABSENT') continue;
      const meta = resolveShiftTimeDetails(ctx, a.shift_code, a.id);
      putBusy(a.employee_id, a.work_date, `${meta.shiftLabel} (${meta.shiftTimeRange})`);
    }
    for (const l of ctx.db.leaveRequests.all()) {
      if (l.status === 'APPROVED' || l.status === 'PENDING') putBusy(l.employee_id, l.leave_date, 'Đang nghỉ OFF');
    }
    const branchPeers = ctx.db.employees
      .filter((e) => e.id !== emp.id && e.status === 'ACTIVE' && e.branch_id === emp.branch_id)
      .map((e) => ({
        id: e.id, employeeCode: e.employee_code, fullName: e.full_name, positionTitle: e.position_title || 'Nhân sự cửa hàng',
        branchName: ctx.db.branches.get(e.branch_id)?.name ?? '',
        busyShiftsByDate: { ...(peerBusyByEmp.get(e.employee_code) ?? {}), ...(peerBusyByEmp.get(e.id) ?? {}) },
      }));

    const adjustments = ctx.db.attendanceAdjustments
      .filter((a) => a.employee_id === emp.id || a.employee_id === emp.employee_code)
      .reverse()
      ;

    const cycleDays = emp.probation_cycle_days || 12;
    const rawDiff = emp.probation_start ? dayjs(todayStr).diff(dayjs(emp.probation_start), 'day') + 1 : (emp.probation_work_days || 7);
    const probationDaysPassed = Math.min(cycleDays, Math.max(1, rawDiff > cycleDays ? (emp.probation_work_days || 7) : rawDiff));

    return sendSuccess(request, 'Lấy dữ liệu điểm danh và ca làm việc cá nhân thành công', {
      todayDate: todayStr, nowTimeHm: nowHm,
      profile: {
        employeeId: emp.id, employeeCode: emp.employee_code, fullName: emp.full_name, role: user.role, roleLabel: ROLE_LABELS[user.role],
        stage: emp.stage, branchId: branch?.id ?? emp.branch_id, branchName: branch?.name ?? 'Ụm Bò Milk Chi nhánh 1',
        branchLat: branch?.lat ?? 10.7769, branchLng: branch?.lng ?? 106.7009, radiusM: branch?.radius_m ?? 100,
        probationStart: emp.probation_start, probationEnd: emp.probation_end, officialFrom: emp.official_from,
        probationCycleDays: cycleDays, probationDaysPassed, probationDaysRemaining: Math.max(0, cycleDays - probationDaysPassed),
      },
      shifts, events, leaves, swaps, branchPeers, adjustments: adjustments.map((a) => mapAdjustmentRecord(ctx, a)),
      offWindow: evaluateOffWindow(settings, todayStr, nowHm), canRegisterShift: emp.stage === 'PROBATION',
      probationCycle: emp.stage === 'PROBATION' ? buildProbationCycleSummary(ctx, emp, todayStr) : null,
    });
  });

  app.get('/api/my-attendance/shift-availability', { preHandler: requireAuth() }, async (request) => {
    const q = z.object({ work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD'), shift_code: z.string().trim().min(1) }).parse(request.query ?? {});
    const emp = await ensurePersonalProfile(ctx, request.auth!.user);
    const tpl = ctx.db.shiftTemplates.find((s) => s.code === q.shift_code), fallback = SHIFT_DEFAULT_HOURS[q.shift_code] ?? SHIFT_DEFAULT_HOURS.CA_SANG!;
    const cap = evaluateBranchShiftCapacity(ctx, { branchId: emp.branch_id, workDate: q.work_date, shiftCode: q.shift_code, startAt: tpl?.start_time ?? fallback.start, endAt: tpl?.end_time ?? fallback.end, emp });
    return sendSuccess(request, cap.message, cap);
  });

  registerMyShiftRegisterRoute(app, ctx);

  app.delete('/api/my-attendance/shifts/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }, user = request.auth!.user, emp = await ensurePersonalProfile(ctx, user), shift = ctx.db.shiftAssignments.get(id);
    if (!shift || (shift.employee_id !== emp.id && shift.employee_id !== emp.employee_code)) throw Errors.forbidden('Bạn chỉ được phép hủy ca làm việc của chính mình');
    assertDateNotLockedByPayroll(ctx.db, shift.work_date, 'hủy ca làm việc');
    if (ctx.db.attendanceEvents.find((e) => e.assignment_id === shift.id)) throw Errors.badRequest('Ca làm việc này đã có dữ liệu điểm danh thực tế, không thể hủy ca');
    if (shift.status !== 'DRAFT') throw Errors.badRequest('Ca làm việc này đã được Quản lý cửa hàng / HR duyệt phân ca chính thức. Nếu cần thay đổi, vui lòng dùng chức năng Đổi ca / Nhường ca.');
    await ctx.db.shiftAssignments.softDelete(shift.id, shift.version, user.id);
    await ensureSyncedNotifications(ctx);
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: shift.branch_id || emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_CANCELLED', actorId: user.id });
    return sendSuccess(request, 'Đã hủy đăng ký ca làm việc đang chờ duyệt', { id });
  });
}
