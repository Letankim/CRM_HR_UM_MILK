import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isOfficeEmployeeSpec, type AttendanceEvent, type Employee, type LeaveRequest, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueShiftRegisteredEmail } from '../services/action-email-dispatcher.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { assertMaxShiftsPerDay, employeeShiftsOnDate, findProbationLock, isCountedWorkShift, isDisallowedProbationShiftCode, matchEmp, probationLockCode, resolveProbationCycle } from '../services/schedule-rules.js';
import { assertNoDuplicateOrOverlappingEmployeeShift } from '../services/schedule-staffing-helper.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { getCachedPartitionStore, getPartitionStore, insertPartitionAwareRecord, preloadEmployeePartitionStores, resolveTargetMonthForRecord } from '../services/partition-write-router.js';
import { emitScheduleRealtime, findBranchShiftTemplate } from './account-employee-sync.js';
import { ensurePersonalProfile } from './my-attendance.routes.js';
import { registerProbationSelfServiceRoutes } from './probation-self-service.routes.js';
import { mapShiftAssignment } from './schedules.routes.js';

const zCreateMyShiftBody = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD'),
  shift_code: z.string().trim().min(1, 'Vui lòng chọn khung ca').default('CA_SANG'),
  note: z.string().trim().max(300).optional().default('Đăng ký làm thêm ca'),
});
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

export function buildProbationCycleSummary(ctx: AppContext, emp: Employee, todayStr: string) {
  const cycle = resolveProbationCycle(emp, todayStr), isEmp = matchEmp(emp);
  const scheduledCount = cycle.dates.reduce((sum, d) => sum + employeeShiftsOnDate(ctx, emp, d).length, 0);
  const cycleMonths = Array.from(new Set(cycle.dates.map((d) => resolveTargetMonthForRecord(ctx.db, 'LEAVE_REQUESTS', { leave_date: d }, d))));
  const seenLeaveIds = new Set<string>();
  let offCount = 0;
  for (const mk of cycleMonths) {
    const lvStore = getCachedPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', mk) ?? ctx.db.leaveRequests;
    for (const l of lvStore.all()) {
      if (!seenLeaveIds.has(l.id) && isEmp(l.employee_id) && l.status !== 'REJECTED' && l.status !== 'CANCELLED' && cycle.dates.includes(l.leave_date)) {
        seenLeaveIds.add(l.id);
        offCount++;
      }
    }
  }
  return { start: cycle.start, end: cycle.end, workRequired: cycle.workRequired, offLimit: cycle.offLimit, scheduledCount, offCount, isLocked: Boolean(findProbationLock(ctx, emp, cycle.start)) };
}

export function registerMyShiftRegisterRoute(app: FastifyInstance, ctx: AppContext): void {
  registerProbationSelfServiceRoutes(app, ctx);
  app.post('/api/my-attendance/shifts', { preHandler: requireAuth() }, async (request, reply) => {
    await preloadEmployeePartitionStores(ctx.db);
    const user = request.auth!.user, body = zCreateMyShiftBody.parse(request.body), emp = await ensurePersonalProfile(ctx, user);
    if (emp.stage === 'OFFICIAL') {
      throw Errors.forbidden('Nhân viên chính thức không đăng ký ca làm việc. Lịch làm việc được HR tự động sắp theo ca mặc định sau khi chốt lịch OFF — bạn chỉ cần đăng ký nghỉ OFF trong thời gian mở cổng, hoặc dùng Đổi ca / Nhường ca.');
    }
    if (isOfficeEmployeeSpec(emp, user.role)) {
      throw Errors.forbidden('Nhân viên khối văn phòng làm việc theo ca hành chính cố định, không áp dụng đăng ký ca làm thêm.');
    }
    const { todayStr, nowHm } = getVnNowDateAndHm(), settings = getOperationSettings(ctx.db), cycle = resolveProbationCycle(emp, todayStr);
    if (body.work_date < todayStr) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Không được đăng ký ca cho ngày đã qua (${vi(body.work_date)})`, body.work_date);
    if (!cycle.dates.includes(body.work_date)) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Chỉ được đăng ký thêm ca trong chu kỳ thử việc ${vi(cycle.start)} – ${vi(cycle.end)}`, body.work_date);
    assertDateNotLockedByPayroll(ctx.db, body.work_date, 'đăng ký ca làm việc');

    const tpl = findBranchShiftTemplate(ctx, body.shift_code, emp.branch_id);
    if (isDisallowedProbationShiftCode(body.shift_code, tpl)) {
      throw Errors.fieldValidation('shift_code', 'INVALID_VALUE', 'Nhân viên thử việc chỉ được phép đăng ký các ca cửa hàng (Ca Sáng, Ca Chiều, Ca Tối), không được đăng ký Ca Hành chính.', body.shift_code);
    }
    if (!tpl) throw Errors.fieldValidation('shift_code', 'INVALID_VALUE', 'Khung ca không tồn tại tại chi nhánh của bạn', body.shift_code);
    if (body.work_date === todayStr && nowHm >= tpl.start_time) {
      throw Errors.fieldValidation('shift_code', 'OUT_OF_RANGE', `Khung ca ${tpl.name || body.shift_code} (${tpl.start_time} – ${tpl.end_time}) hôm nay đã qua giờ bắt đầu (${tpl.start_time}), không thể đăng ký thêm ca này. Vui lòng chọn ca khác hoặc ngày tiếp theo.`, body.shift_code);
    }
    assertMaxShiftsPerDay(ctx, { emp, workDate: body.work_date, maxPerDay: settings.maxShiftsPerDay, field: 'work_date', isSelf: true });
    assertNoDuplicateOrOverlappingEmployeeShift(ctx, { emp, workDate: body.work_date, shiftCode: body.shift_code, startAt: tpl.start_time, endAt: tpl.end_time });

    const isEmp = matchEmp(emp), now = nowIso(), newKey = `${body.work_date} ${tpl.start_time}`;
    const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: body.work_date }, body.work_date);
    const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', targetMonth, user.id);

    const cycleMonths = Array.from(new Set(cycle.dates.map((d) => resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: d }, d))));
    const candidates: { shift: ShiftAssignment; shStore: Awaited<ReturnType<typeof getPartitionStore<ShiftAssignment>>>; mk: string }[] = [];
    for (const mk of cycleMonths) {
      const sStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', mk, user.id);
      const eStore = await getPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', mk, user.id);
      for (const a of sStore.filter((x) => isEmp(x.employee_id) && isCountedWorkShift(x))) {
        if (`${a.work_date} ${a.start_at}` > newKey && a.status !== 'COMPLETED' && !eStore.find((e) => e.assignment_id === a.id)) {
          candidates.push({ shift: a, shStore: sStore, mk });
        }
      }
    }
    candidates.sort((a, b) => `${b.shift.work_date} ${b.shift.start_at}`.localeCompare(`${a.shift.work_date} ${a.shift.start_at}`));
    const lastLaterEntry = candidates[0];
    const lastLater = lastLaterEntry?.shift;
    if (lastLaterEntry) await lastLaterEntry.shStore.softDelete(lastLaterEntry.shift.id, lastLaterEntry.shift.version, user.id);

    const activeLeaveOnTarget = lvStore.find((l) => isEmp(l.employee_id) && l.leave_date === body.work_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED');
    if (activeLeaveOnTarget) {
      const tailLvStore = lastLaterEntry ? await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', lastLaterEntry.mk, user.id) : lvStore;
      const canMoveToTail = Boolean(
        lastLater && lastLater.work_date !== body.work_date
        && employeeShiftsOnDate(ctx, emp, lastLater.work_date).length === 0
        && !tailLvStore.find((l) => isEmp(l.employee_id) && l.leave_date === lastLater.work_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED'),
      );
      await lvStore.softDelete(activeLeaveOnTarget.id, activeLeaveOnTarget.version, user.id);
      if (canMoveToTail && lastLater) {
        const { id: _id, version: _v, is_deleted: _d, ...restLeave } = activeLeaveOnTarget;
        await insertPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', {
          ...restLeave, leave_date: lastLater.work_date, reason: `Tự động chuyển ngày OFF sang ${vi(lastLater.work_date)} khi đăng ký ca ngày ${vi(body.work_date)}`, decided_at: now,
        }, lastLater.work_date, user.id);
      }
    }

    const pullNote = lastLater ? ` — đã tự động dời ca cuối ngày ${vi(lastLater.work_date)} (${lastLater.start_at} – ${lastLater.end_at}) sang ca này` : '';
    const created = await insertPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', {
      schedule_week_id: probationLockCode(emp.employee_code, cycle.start, targetMonth), employee_id: emp.id, branch_id: emp.branch_id, work_date: body.work_date,
      shift_template_id: tpl.id, start_at: tpl.start_time, end_at: tpl.end_time, status: 'PUBLISHED', source: 'PROBATION_EXTRA',
      employee_stage: emp.stage, day_type: 'WORK', shift_code: body.shift_code, scheduled_hours: tpl.standard_hours || 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: now, note: `${body.note}${pullNote}`.slice(0, 300), linked_assignment_id: lastLater?.id ?? '',
    }, body.work_date, user.id);
    queueShiftRegisteredEmail(ctx, created, user.id);
    const reqAudit = auditContext(request);
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_APPROVED', message: `${emp.full_name} đăng ký thêm ca ngày ${vi(created.work_date)}${pullNote}`, actorId: user.id });
    await runBackgroundSideEffect(async () => {
      await recalculateOpenPeriods(ctx, user.id);
      await ensureSyncedNotifications(ctx);
      await ctx.audit.record(reqAudit, { action: 'schedule.create', entity: 'SHIFT_ASSIGNMENTS', entityId: created.id, after: { employee_id: emp.employee_code, work_date: created.work_date, shift_code: created.shift_code, status: created.status, linked_assignment_id: created.linked_assignment_id } });
    });
    reply.code(201);
    return sendSuccess(request, `Đã đăng ký thêm ca ngày ${vi(created.work_date)} thành công${pullNote}.`, mapShiftAssignment(created, ctx));
  });
}
