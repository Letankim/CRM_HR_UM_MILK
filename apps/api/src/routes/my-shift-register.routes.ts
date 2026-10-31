import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Employee } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { auditContext, requireAuth } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { queueShiftRegisteredEmail } from '../services/action-email-dispatcher.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { getOperationSettings } from '../services/operations-settings.service.js';
import { assertDateNotLockedByPayroll } from '../services/salary-profile.service.js';
import { assertMaxShiftsPerDay, employeeShiftsOnDate, findProbationLock, matchEmp, resolveProbationCycle } from '../services/schedule-rules.js';
import { assertNoDuplicateOrOverlappingEmployeeShift, evaluateBranchShiftCapacity } from '../services/schedule-staffing-helper.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { emitScheduleRealtime, findBranchShiftTemplate } from './account-employee-sync.js';
import { ensurePersonalProfile } from './my-attendance.routes.js';
import { mapShiftAssignment } from './schedules.routes.js';

const zCreateMyShiftBody = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD'),
  shift_code: z.string().trim().min(1, 'Vui lòng chọn khung ca').default('CA_SANG'),
  note: z.string().trim().max(300).optional().default('Đăng ký làm thêm ca'),
});
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

/** Tóm tắt chu kỳ thử việc 12 ngày cho Cổng Nhân viên: số ca đã xếp / bắt buộc, số ngày OFF đã đăng ký. */
export function buildProbationCycleSummary(ctx: AppContext, emp: Employee, todayStr: string) {
  const cycle = resolveProbationCycle(emp, todayStr), isEmp = matchEmp(emp);
  const scheduledCount = cycle.dates.reduce((sum, d) => sum + employeeShiftsOnDate(ctx, emp, d).length, 0);
  const offCount = ctx.db.leaveRequests.filter((l) => isEmp(l.employee_id) && l.status !== 'REJECTED' && l.status !== 'CANCELLED' && cycle.dates.includes(l.leave_date)).length;
  return { start: cycle.start, end: cycle.end, workRequired: cycle.workRequired, offLimit: cycle.offLimit, scheduledCount, offCount, isLocked: Boolean(findProbationLock(ctx, emp, cycle.start)) };
}

/**
 * Đăng ký làm thêm ca (chỉ Nhân viên thử việc). Nhân viên chính thức không đăng ký ca — lịch được HR tự động sắp theo ca mặc định.
 * Tối đa 2 ca / ngày; nếu chu kỳ đã đủ 7 ca, ca cuối chu kỳ sẽ được dời lên ca đăng ký thêm khi HR duyệt.
 */
export function registerMyShiftRegisterRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/my-attendance/shifts', { preHandler: requireAuth() }, async (request, reply) => {
    const user = request.auth!.user, body = zCreateMyShiftBody.parse(request.body), emp = await ensurePersonalProfile(ctx, user);
    if (emp.stage === 'OFFICIAL') {
      throw Errors.forbidden('Nhân viên chính thức không đăng ký ca làm việc. Lịch làm việc được HR tự động sắp theo ca mặc định sau khi chốt lịch OFF — bạn chỉ cần đăng ký nghỉ OFF trong thời gian mở cổng, hoặc dùng Đổi ca / Nhường ca.');
    }
    const { todayStr, nowHm } = getVnNowDateAndHm(), settings = getOperationSettings(ctx.db), cycle = resolveProbationCycle(emp, todayStr);
    if (body.work_date < todayStr) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Không được đăng ký ca cho ngày đã qua (${vi(body.work_date)})`, body.work_date);
    if (!cycle.dates.includes(body.work_date)) throw Errors.fieldValidation('work_date', 'OUT_OF_RANGE', `Chỉ được đăng ký thêm ca trong chu kỳ thử việc ${vi(cycle.start)} – ${vi(cycle.end)}`, body.work_date);
    assertDateNotLockedByPayroll(ctx.db, body.work_date, 'đăng ký ca làm việc');
    const isEmp = matchEmp(emp);
    if (ctx.db.leaveRequests.find((l) => isEmp(l.employee_id) && l.leave_date === body.work_date && (l.status === 'APPROVED' || l.status === 'PENDING'))) {
      throw Errors.fieldValidation('work_date', 'DUPLICATE_VALUE', `Bạn đã đăng ký nghỉ OFF ngày ${vi(body.work_date)}, không thể đăng ký ca trùng ngày nghỉ.`, body.work_date);
    }
    const tpl = findBranchShiftTemplate(ctx, body.shift_code, emp.branch_id);
    if (!tpl) throw Errors.fieldValidation('shift_code', 'INVALID_VALUE', 'Khung ca không tồn tại tại chi nhánh của bạn', body.shift_code);
    if (body.work_date === todayStr && nowHm >= tpl.start_time) throw Errors.fieldValidation('shift_code', 'OUT_OF_RANGE', `Khung ca ${tpl.start_time} – ${tpl.end_time} hôm nay đã bắt đầu, vui lòng chọn ca khác hoặc ngày khác.`, body.shift_code);
    assertMaxShiftsPerDay(ctx, { emp, workDate: body.work_date, maxPerDay: settings.maxShiftsPerDay, field: 'work_date', isSelf: true });
    assertNoDuplicateOrOverlappingEmployeeShift(ctx, { emp, workDate: body.work_date, shiftCode: body.shift_code, startAt: tpl.start_time, endAt: tpl.end_time });
    const cap = evaluateBranchShiftCapacity(ctx, { branchId: emp.branch_id, workDate: body.work_date, shiftCode: body.shift_code, startAt: tpl.start_time, endAt: tpl.end_time });
    if (cap.isFullOrExceeded) throw Errors.fieldValidation('shift_code', 'OUT_OF_RANGE', cap.message, body.shift_code);

    const cycleShifts = cycle.dates.flatMap((d) => employeeShiftsOnDate(ctx, emp, d));
    const newKey = `${body.work_date} ${tpl.start_time}`;
    const lastLater = cycleShifts.length >= cycle.workRequired
      ? cycleShifts.filter((a) => `${a.work_date} ${a.start_at}` > newKey && !ctx.db.attendanceEvents.find((e) => e.assignment_id === a.id)).sort((a, b) => `${b.work_date} ${b.start_at}`.localeCompare(`${a.work_date} ${a.start_at}`))[0]
      : undefined;
    const pullNote = lastLater ? ` — sẽ dời ca cuối ngày ${vi(lastLater.work_date)} (${lastLater.start_at} – ${lastLater.end_at}) lên ca này khi HR duyệt để giữ đủ ${cycle.workRequired} ca` : '';
    const created = await ctx.db.shiftAssignments.insert({
      schedule_week_id: `PB-${emp.employee_code}-${cycle.start}`, employee_id: emp.id, branch_id: emp.branch_id, work_date: body.work_date,
      shift_template_id: tpl.id, start_at: tpl.start_time, end_at: tpl.end_time, status: 'DRAFT', source: 'PROBATION_EXTRA',
      employee_stage: emp.stage, day_type: 'WORK', shift_code: body.shift_code, scheduled_hours: tpl.standard_hours || 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: `${body.note}${pullNote}`.slice(0, 300), linked_assignment_id: lastLater?.id ?? '',
    }, user.id);
    queueShiftRegisteredEmail(ctx, created, user.id);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'schedule.create', entity: 'SHIFT_ASSIGNMENTS', entityId: created.id, after: { employee_id: emp.employee_code, work_date: created.work_date, shift_code: created.shift_code, status: created.status, linked_assignment_id: created.linked_assignment_id } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: emp.branch_id, employeeIds: [emp.id], kind: 'SHIFT_REGISTERED', message: `${emp.full_name} đăng ký làm thêm ca ngày ${vi(created.work_date)} chờ HR duyệt`, actorId: user.id });
    reply.code(201);
    return sendSuccess(request, `Đã gửi đăng ký làm thêm ca ngày ${vi(created.work_date)} — chờ HR duyệt${pullNote}.`, mapShiftAssignment(created, ctx));
  });
}
