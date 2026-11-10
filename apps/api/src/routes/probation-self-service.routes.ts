import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AttendanceEvent, LeaveRequest, ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import {
  assertMaxShiftsPerDay, assertShiftNotInPast, employeeShiftsOnDate, isCountedWorkShift,
  isDisallowedProbationShiftCode, matchEmp, probationLockCode, resolveProbationCycle,
} from '../services/schedule-rules.js';
import { assertNoDuplicateOrOverlappingEmployeeShift } from '../services/schedule-staffing-helper.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { getPartitionStore, insertPartitionAwareRecord, nextPartitionCode, preloadEmployeePartitionStores, resolveTargetMonthForRecord } from '../services/partition-write-router.js';
import { emitScheduleRealtime, findBranchShiftTemplate } from './account-employee-sync.js';
import { ensurePersonalProfile } from './my-attendance.routes.js';
import { mapShiftAssignment } from './schedules.routes.js';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

const zProbationOffBatchBody = z.object({
  off_dates: z.array(z.string().regex(YMD_RE, 'Định dạng ngày nghỉ phải là YYYY-MM-DD')).optional(),
  leave_dates: z.array(z.string().regex(YMD_RE, 'Định dạng ngày nghỉ phải là YYYY-MM-DD')).optional(),
  reason: z.string().trim().max(300).optional().default('Đăng ký 5 ngày OFF chu kỳ thử việc 12 ngày'),
});
const zProbationSelfSwapBody = z.object({
  work_date: z.string().regex(YMD_RE, 'Ngày có ca làm việc phải theo định dạng YYYY-MM-DD'),
  off_date: z.string().regex(YMD_RE, 'Ngày đang nghỉ OFF phải theo định dạng YYYY-MM-DD'),
  reason: z.string().trim().max(300).optional().default('Nhân viên thử việc tự đổi ngày làm sang ngày OFF trong chu kỳ 12 ngày'),
});
const zProbationExtraBody = z.object({
  work_date: z.string().regex(YMD_RE, 'Ngày đăng ký thêm ca phải theo định dạng YYYY-MM-DD'),
  shift_code: z.string().trim().min(1, 'Vui lòng chọn khung ca').default('CA_SANG'),
  note: z.string().trim().max(300).optional().default('Đăng ký thêm ca đẩy nhanh chu kỳ thử việc'),
});

export function registerProbationSelfServiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/me/probation-off-batch', { preHandler: requireAuth() }, async (request, reply) => {
    await preloadEmployeePartitionStores(ctx.db);
    const user = request.auth!.user, body = zProbationOffBatchBody.parse(request.body ?? {}), emp = await ensurePersonalProfile(ctx, user);
    if (emp.stage !== 'PROBATION') throw Errors.forbidden('Chức năng đăng ký 5 ngày OFF chu kỳ 12 ngày chỉ dành cho Nhân viên thử việc');
    const rawDates = body.off_dates ?? body.leave_dates ?? [], uniqueOffDates = Array.from(new Set(rawDates)).sort();
    const { todayStr } = getVnNowDateAndHm(), cycle = resolveProbationCycle(emp, todayStr);
    if (uniqueOffDates.length !== cycle.offLimit) {
      throw Errors.fieldValidation('off_dates', 'INVALID_VALUE', `Bắt buộc chọn đúng ${cycle.offLimit} ngày nghỉ OFF khác nhau trong chu kỳ 12 ngày thử việc`, rawDates);
    }
    for (const d of uniqueOffDates) {
      if (!cycle.dates.includes(d)) throw Errors.fieldValidation('off_dates', 'OUT_OF_RANGE', `Ngày nghỉ ${vi(d)} nằm ngoài chu kỳ thử việc 12 ngày (${vi(cycle.start)} – ${vi(cycle.end)})`, d);
    }
    for (const d of cycle.dates) assertDateNotLockedByPayroll(ctx.db, d, 'đăng ký chu kỳ thử việc 12 ngày');

    const isEmp = matchEmp(emp), now = nowIso();
    const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: cycle.start }, cycle.start);
    const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', targetMonth, user.id);
    const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', targetMonth, user.id);
    const evStore = await getPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', targetMonth, user.id);

    const lockCode = probationLockCode(emp.employee_code, cycle.start, targetMonth);
    for (const l of lvStore.filter((x) => isEmp(x.employee_id) && cycle.dates.includes(x.leave_date))) await lvStore.softDelete(l.id, l.version, user.id);
    for (const s of shStore.filter((a) => isEmp(a.employee_id) && cycle.dates.includes(a.work_date) && a.status !== 'COMPLETED' && !evStore.find((e) => e.assignment_id === a.id))) {
      await shStore.softDelete(s.id, s.version, user.id);
    }

    const shiftCode = (emp.default_shift_code || 'CA_SANG').toUpperCase(), tpl = findBranchShiftTemplate(ctx, shiftCode, emp.branch_id);
    const startAt = tpl?.start_time || '07:00', endAt = tpl?.end_time || '12:00', hours = tpl?.standard_hours || 5;
    const createdLeaves: LeaveRequest[] = [];
    for (let i = 0; i < uniqueOffDates.length; i++) {
      const offDate = uniqueOffDates[i]!;
      createdLeaves.push(await insertPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', {
        request_code: nextPartitionCode(lvStore, 'POFF-', 'request_code'),
        employee_id: emp.id, branch_id: emp.branch_id, leave_date: offDate, kind: 'PROBATION_OFF',
        shift_code: shiftCode, reason: body.reason, status: 'APPROVED', employee_stage: 'PROBATION',
        schedule_week_id: lockCode, assignment_id: '', quota_cycle_used: i + 1, quota_cycle_limit: cycle.offLimit,
        staffing_after_leave: 1, min_staff_required: 1, submitted_at: now, store_reviewed_by: '', store_reviewed_at: '',
        decided_by: user.id, decision_reason: 'Tự động duyệt 5 ngày OFF chu kỳ thử việc 12 ngày', decided_at: now,
      }, offDate, user.id));
    }

    const workDates = cycle.dates.filter((d) => !uniqueOffDates.includes(d)).slice(0, cycle.workRequired);
    const createdShifts: ShiftAssignment[] = [];
    for (const workDate of workDates) {
      createdShifts.push(await insertPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', {
        schedule_week_id: lockCode, employee_id: emp.id, branch_id: emp.branch_id, work_date: workDate,
        shift_template_id: tpl?.id ?? '', start_at: startAt, end_at: endAt, status: 'PUBLISHED',
        source: 'PROBATION_AUTO', employee_stage: 'PROBATION', day_type: 'WORK', shift_code: shiftCode,
        scheduled_hours: hours, swapped_from_employee_id: '', replacement_for_employee_id: '',
        published_at: now, note: 'Tự động phát hành 7 ca thử việc từ đăng ký 5 ngày OFF', linked_assignment_id: '',
      }, workDate, user.id));
    }

    const existingLock = ctx.db.scheduleWeeks.find((w) => w.code === lockCode);
    const lockRec = {
      branch_id: emp.branch_id, week_start: cycle.start, week_end: cycle.end, status: 'PUBLISHED' as const,
      published_by: user.id, published_at: now, code: lockCode, schedule_kind: 'PROBATION_12_DAYS' as const,
      store_confirmed_by: '', store_confirmed_at: '', locked_at: now,
      note: `Tự động phát hành ${createdShifts.length} ca làm + ${createdLeaves.length} ngày OFF chu kỳ thử việc`,
    };
    if (existingLock) await ctx.db.scheduleWeeks.update(existingLock.id, existingLock.version, lockRec, user.id);
    else await ctx.db.scheduleWeeks.insert(lockRec, user.id);

    const reqAudit = auditContext(request);
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_APPROVED', message: `${emp.full_name} đã hoàn tất đăng ký 5 ngày OFF và nhận 7 ca chính thức`, actorId: user.id });
    await runBackgroundSideEffect(async () => {
      await ensureSyncedNotifications(ctx);
      await ctx.audit.record(reqAudit, { action: 'probation.off_batch', entity: 'SHIFT_ASSIGNMENTS', entityId: lockCode, after: { offDates: uniqueOffDates, workDates, createdShiftCount: createdShifts.length } });
    });
    reply.code(201);
    return sendSuccess(request, `Đã lưu ${createdLeaves.length} ngày nghỉ OFF và tự động phát hành ${createdShifts.length} ca làm việc chính thức`, {
      cycleStart: cycle.start, cycleEnd: cycle.end, offDates: uniqueOffDates, workDates,
      createdOffCount: createdLeaves.length, createdShiftCount: createdShifts.length,
      leaves: createdLeaves, shifts: createdShifts.map((s) => mapShiftAssignment(s, ctx)),
    });
  });

  app.post('/api/me/probation-self-swap', { preHandler: requireAuth() }, async (request) => {
    await preloadEmployeePartitionStores(ctx.db);
    const user = request.auth!.user, body = zProbationSelfSwapBody.parse(request.body ?? {}), emp = await ensurePersonalProfile(ctx, user);
    if (emp.stage !== 'PROBATION') throw Errors.forbidden('Chức năng tự đổi ngày làm trong chu kỳ 12 ngày chỉ dành cho Nhân viên thử việc');
    if (body.work_date === body.off_date) throw Errors.fieldValidation('off_date', 'INVALID_VALUE', 'Ngày chuyển đến phải khác ngày có ca làm việc hiện tại', body.off_date);
    const { todayStr } = getVnNowDateAndHm(), cycle = resolveProbationCycle(emp, todayStr);
    if (!cycle.dates.includes(body.work_date)) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Ngày có ca (${vi(body.work_date)}) nằm ngoài chu kỳ thử việc 12 ngày`, body.work_date);
    if (!cycle.dates.includes(body.off_date)) throw Errors.fieldValidation('off_date', 'OUT_OF_RANGE', `Ngày nghỉ OFF (${vi(body.off_date)}) nằm ngoài chu kỳ thử việc 12 ngày`, body.off_date);
    assertDateNotLockedByPayroll(ctx.db, body.work_date, 'đổi ngày làm thử việc');
    assertDateNotLockedByPayroll(ctx.db, body.off_date, 'đổi ngày làm thử việc');

    const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: body.work_date }, body.work_date);
    const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', targetMonth, user.id);
    const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', targetMonth, user.id);
    const evStore = await getPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', targetMonth, user.id);

    const shiftsOnWorkDate = employeeShiftsOnDate(ctx, emp, body.work_date);
    const targetShift = shiftsOnWorkDate.find((s) => s.status !== 'COMPLETED' && !evStore.find((e) => e.assignment_id === s.id));
    if (!targetShift) throw Errors.fieldValidation('work_date', 'INVALID_VALUE', `Không tìm thấy ca làm việc chưa điểm danh vào ngày ${vi(body.work_date)} để hoán đổi`, body.work_date);
    assertShiftNotInPast(body.off_date, targetShift.start_at, 'off_date');
    if (employeeShiftsOnDate(ctx, emp, body.off_date).some((s) => s.shift_code === targetShift.shift_code)) {
      throw Errors.fieldValidation('off_date', 'DUPLICATE_VALUE', `Ngày ${vi(body.off_date)} đã có ca làm việc trùng khung ca`, body.off_date);
    }

    const now = nowIso(), isEmp = matchEmp(emp);
    const offLeave = lvStore.find((l) => isEmp(l.employee_id) && l.leave_date === body.off_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED');
    const updatedShift = await shStore.update(targetShift.id, targetShift.version, { work_date: body.off_date, status: 'PUBLISHED', published_at: now, note: body.reason }, user.id);
    const updatedLeave = offLeave
      ? await lvStore.update(offLeave.id, offLeave.version, { leave_date: body.work_date, status: 'APPROVED', reason: body.reason, decided_at: now }, user.id)
      : await insertPartitionAwareRecord<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', {
          request_code: nextPartitionCode(lvStore, 'POFF-', 'request_code'),
          employee_id: emp.id, branch_id: emp.branch_id, leave_date: body.work_date, kind: 'PROBATION_OFF',
          shift_code: targetShift.shift_code, reason: body.reason, status: 'APPROVED', employee_stage: 'PROBATION',
          schedule_week_id: targetShift.schedule_week_id, assignment_id: '', quota_cycle_used: 1, quota_cycle_limit: cycle.offLimit,
          staffing_after_leave: 1, min_staff_required: 1, submitted_at: now, store_reviewed_by: '', store_reviewed_at: '',
          decided_by: user.id, decision_reason: 'Tự đổi ngày làm sang ngày OFF trong chu kỳ thử việc', decided_at: now,
        }, body.work_date, user.id);

    await runBackgroundSideEffect(() => recalculateOpenPeriods(ctx, user.id));
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_UPDATED', message: `${emp.full_name} tự đổi ngày làm ${vi(body.work_date)} sang ${vi(body.off_date)}`, actorId: user.id });
    return sendSuccess(request, `Đã hoán đổi ca làm việc từ ngày ${vi(body.work_date)} sang ngày ${vi(body.off_date)} thành công`, {
      shift: mapShiftAssignment(updatedShift, ctx), leave: updatedLeave, fromWorkDate: body.work_date, toWorkDate: body.off_date,
    });
  });

  app.post('/api/me/probation-extra-shift', { preHandler: requireAuth() }, async (request, reply) => {
    await preloadEmployeePartitionStores(ctx.db);
    const user = request.auth!.user, body = zProbationExtraBody.parse(request.body ?? {}), emp = await ensurePersonalProfile(ctx, user);
    if (emp.stage !== 'PROBATION') throw Errors.forbidden('Chức năng đăng ký thêm ca đẩy nhanh chỉ dành cho Nhân viên thử việc');
    const { todayStr, nowHm } = getVnNowDateAndHm(), settings = getOperationSettings(ctx.db), cycle = resolveProbationCycle(emp, todayStr);
    if (body.work_date < todayStr) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Không được đăng ký ca cho ngày đã qua (${vi(body.work_date)})`, body.work_date);
    if (!cycle.dates.includes(body.work_date)) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Chỉ được đăng ký thêm ca trong chu kỳ thử việc ${vi(cycle.start)} – ${vi(cycle.end)}`, body.work_date);
    assertDateNotLockedByPayroll(ctx.db, body.work_date, 'đăng ký thêm ca thử việc');
    const tpl = findBranchShiftTemplate(ctx, body.shift_code, emp.branch_id);
    if (isDisallowedProbationShiftCode(body.shift_code, tpl)) {
      throw Errors.fieldValidation('shift_code', 'INVALID_VALUE', 'Nhân viên thử việc chỉ được phép đăng ký các ca cửa hàng (Ca Sáng, Ca Chiều, Ca Tối), không được đăng ký Ca Hành chính.', body.shift_code);
    }
    const startAt = tpl?.start_time || '07:00', endAt = tpl?.end_time || '12:00';
    if (body.work_date === todayStr && nowHm >= startAt) {
      throw Errors.fieldValidation('shift_code', 'OUT_OF_RANGE', `Khung ca ${tpl?.name || body.shift_code} (${startAt} – ${endAt}) hôm nay đã qua giờ bắt đầu (${startAt}), không thể đăng ký thêm ca này. Vui lòng chọn ca khác hoặc ngày tiếp theo.`, body.shift_code);
    }
    assertMaxShiftsPerDay(ctx, { emp, workDate: body.work_date, maxPerDay: settings.maxShiftsPerDay, field: 'work_date', isSelf: true });
    assertNoDuplicateOrOverlappingEmployeeShift(ctx, { emp, workDate: body.work_date, shiftCode: body.shift_code, startAt, endAt });

    const isEmp = matchEmp(emp), now = nowIso();
    const targetMonth = resolveTargetMonthForRecord(ctx.db, 'SHIFT_ASSIGNMENTS', { work_date: body.work_date }, body.work_date);
    const shStore = await getPartitionStore<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', targetMonth, user.id);
    const lvStore = await getPartitionStore<LeaveRequest>(ctx.db, 'LEAVE_REQUESTS', targetMonth, user.id);
    const evStore = await getPartitionStore<AttendanceEvent>(ctx.db, 'ATTENDANCE_EVENTS', targetMonth, user.id);

    const allEmpShifts = shStore.filter((a) => isEmp(a.employee_id) && isCountedWorkShift(a));
    const lastLater = allEmpShifts
      .filter((a) => `${a.work_date} ${a.start_at}` > `${body.work_date} ${startAt}` && a.status !== 'COMPLETED' && !evStore.find((e) => e.assignment_id === a.id))
      .sort((a, b) => `${b.work_date} ${b.start_at}`.localeCompare(`${a.work_date} ${a.start_at}`))[0];
    if (lastLater) await shStore.softDelete(lastLater.id, lastLater.version, user.id);
    const activeLeaveOnTarget = lvStore.find((l) => isEmp(l.employee_id) && l.leave_date === body.work_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED');
    if (activeLeaveOnTarget) {
      if (lastLater && lastLater.work_date !== body.work_date && employeeShiftsOnDate(ctx, emp, lastLater.work_date).length === 0 && !lvStore.find((l) => isEmp(l.employee_id) && l.leave_date === lastLater.work_date && l.status !== 'REJECTED' && l.status !== 'CANCELLED')) {
        await lvStore.update(activeLeaveOnTarget.id, activeLeaveOnTarget.version, { leave_date: lastLater.work_date, reason: `Tự động chuyển ngày OFF sang ${vi(lastLater.work_date)} khi đăng ký thêm ca ngày ${vi(body.work_date)}`, decided_at: now }, user.id);
      } else {
        await lvStore.softDelete(activeLeaveOnTarget.id, activeLeaveOnTarget.version, user.id);
      }
    }
    const created = await insertPartitionAwareRecord<ShiftAssignment>(ctx.db, 'SHIFT_ASSIGNMENTS', {
      schedule_week_id: probationLockCode(emp.employee_code, cycle.start, targetMonth),
      employee_id: emp.id, branch_id: emp.branch_id, work_date: body.work_date, shift_template_id: tpl?.id ?? '',
      start_at: startAt, end_at: endAt, status: 'PUBLISHED', source: 'PROBATION_EXTRA', employee_stage: 'PROBATION',
      day_type: 'WORK', shift_code: body.shift_code, scheduled_hours: tpl?.standard_hours || 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: now,
      note: lastLater ? `${body.note} (Đã tự động rút ngắn ca cuối ngày ${vi(lastLater.work_date)})` : body.note, linked_assignment_id: lastLater?.id ?? '',
    }, body.work_date, user.id);
    reply.code(201);
    return sendSuccess(request, `Đã đăng ký thêm ca ngày ${vi(body.work_date)}${lastLater ? ` và tự động dời ca cuối ngày ${vi(lastLater.work_date)}` : ''}`, {
      shift: mapShiftAssignment(created, ctx), removedTailShiftId: lastLater?.id ?? null, removedTailWorkDate: lastLater?.work_date ?? null,
    });
  });
}
