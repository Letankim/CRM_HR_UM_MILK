import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Employee, LeaveRequest } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { AppError, Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { assertBranchAccess, auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import {
  evaluateEmployeeWeeklyOffGate,
  grantEmployeeVipOffWindow,
  submitWeeklyOffBatch,
} from '../services/weekly-off-gate.service.js';
import { emitScheduleRealtime } from './account-employee-sync.js';
import { findLinkedEmployeeForUser } from './employee-mapper.js';
import { ensurePersonalProfile } from './my-attendance.routes.js';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const vi = (d: string) => dayjs(d).format('DD/MM/YYYY');

const zWeeklyOffBatchBody = z.object({
  leave_dates: z.array(z.string().regex(YMD_RE, 'Ngày nghỉ phải theo định dạng YYYY-MM-DD')).optional(),
  off_dates: z.array(z.string().regex(YMD_RE, 'Ngày nghỉ phải theo định dạng YYYY-MM-DD')).optional(),
  employee_id: z.string().trim().optional(),
  reason: z.string().trim().max(300).optional().default('Đăng ký 2 ngày OFF định kỳ hàng tuần'),
});

const zGrantVipWindowBody = z.object({
  employee_id: z.string({ required_error: 'Vui lòng chọn nhân sự' }).trim().min(1, 'Vui lòng chọn nhân sự'),
  duration_minutes: z.coerce
    .number({ invalid_type_error: 'Thời lượng mở cổng bù VIP phải là số phút hợp lệ' })
    .int()
    .min(30, 'Thời lượng mở cổng bù VIP tối thiểu là 30 phút')
    .max(120, 'Thời lượng mở cổng bù VIP tối đa là 120 phút')
    .default(60),
  reason: z.string().trim().max(300).optional().default('Mở cổng bù VIP đăng ký 2 ngày OFF tuần'),
});

/**
 * Kiểm tra quyền xin nghỉ đột xuất (`DOT_XUAT`) trước khi tạo đơn:
 * - Nhân viên thử việc bắt buộc có `emergency_leave_grant_count >= 1`.
 */
export function assertEmergencyLeaveAllowed(emp: Employee): void {
  if (emp.stage === 'PROBATION' && Number(emp.emergency_leave_grant_count ?? 0) < 1) {
    throw new AppError(
      400,
      'BUSINESS_RULE_VIOLATION',
      'Nhân viên thử việc cần được Quản trị/HR cấp quyền (1 lượt) trước khi gửi đơn nghỉ đột xuất',
      [{
        field: 'kind',
        code: 'OUT_OF_RANGE',
        message: 'Nhân viên thử việc cần được Quản trị/HR cấp quyền (1 lượt) trước khi gửi đơn nghỉ đột xuất',
        rejected_value: 'DOT_XUAT',
      }],
    );
  }
}

/**
 * Xử lý hậu kỳ sau khi tạo đơn nghỉ đột xuất (`DOT_XUAT`):
 * - Nếu là nhân viên thử việc: trừ `emergency_leave_grant_count = 0`.
 * - Phát thông báo `URGENT` đến `STORE` và `HR`.
 */
export async function completeEmergencyLeaveSideEffects(
  ctx: AppContext,
  emp: Employee,
  created: LeaveRequest,
  actorId: string,
): Promise<void> {
  if (emp.stage === 'PROBATION') {
    const freshEmp = ctx.db.employees.get(emp.id) ?? emp;
    await ctx.db.employees.update(freshEmp.id, freshEmp.version, { emergency_leave_grant_count: 0 }, actorId);
  }
  await ctx.db.notifications.insert({
    recipient_user_id: '',
    recipient_role: 'STORE,HR',
    branch_id: emp.branch_id || 'ALL',
    category: 'URGENT',
    title: `[KHẨN CẤP] Đơn xin nghỉ đột xuất: ${emp.full_name} (${emp.employee_code}) ngày ${vi(created.leave_date)}`,
    body: `Nhân sự ${emp.full_name} (${emp.employee_code}) gửi đơn xin nghỉ đột xuất ngày ${vi(created.leave_date)} (${created.shift_code}) — Lý do: ${created.reason}.`,
    link: '/admin/schedules?section=workflows',
    severity: 'CRITICAL',
    read_at: '',
    entity_type: 'EMERGENCY_LEAVE_URGENT',
    entity_id: created.id,
  }, actorId);
}

export function registerLeaveRequestGateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/me/weekly-off-gate', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user;
    const emp = findLinkedEmployeeForUser(user, ctx) ?? (await ensurePersonalProfile(ctx, user));
    const status = evaluateEmployeeWeeklyOffGate(ctx, emp);
    return sendSuccess(request, 'Kiểm tra trạng thái cổng đăng ký 2 ngày OFF hàng tuần thành công', status);
  });

  app.post('/api/me/weekly-off-batch', { preHandler: requireAuth() }, async (request) => {
    const user = request.auth!.user, body = zWeeklyOffBatchBody.parse(request.body ?? {});
    const emp = body.employee_id
      ? (ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id))
      : (findLinkedEmployeeForUser(user, ctx) ?? (await ensurePersonalProfile(ctx, user)));
    if (!emp) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    const rawDates = body.leave_dates ?? body.off_dates ?? [];
    const result = await submitWeeklyOffBatch(ctx, {
      emp,
      leaveDates: rawDates,
      reason: body.reason,
      actorId: user.id,
    });
    const reqAudit = auditContext(request);
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, {
      branchId: emp.branch_id,
      employeeIds: [emp.id],
      kind: 'LEAVE_CREATED',
      message: `${emp.full_name} cập nhật 2 ngày nghỉ OFF tuần (${result.leaveDates.map(vi).join(', ')})`,
      actorId: user.id,
    });
    await runBackgroundSideEffect(async () => {
      await ensureSyncedNotifications(ctx);
      await ctx.audit.record(reqAudit, {
        action: 'leave.weekly_off_batch',
        entity: 'LEAVE_REQUESTS',
        entityId: emp.id,
        after: { weekStart: result.weekStart, leaveDates: result.leaveDates, replacedCount: result.replacedCount },
      });
    });
    return sendSuccess(
      request,
      `Đã cập nhật nguyên tử 2 ngày nghỉ OFF (${result.leaveDates.map(vi).join(' và ')}) cho tuần ${vi(result.weekStart)} – ${vi(result.weekEnd)}`,
      result,
    );
  });

  app.post('/api/admin/leave-requests/grant-vip-window', { preHandler: requirePermission('leave.approve', 'schedule.publish', 'employee.manage') }, async (request) => {
    const body = zGrantVipWindowBody.parse(request.body ?? {});
    const targetEmp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!targetEmp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy hồ sơ nhân sự', body.employee_id);
    assertBranchAccess(request, targetEmp.branch_id);
    const actorId = request.auth!.user.id;
    const res = await grantEmployeeVipOffWindow(ctx, {
      employeeId: targetEmp.id,
      durationMinutes: body.duration_minutes,
      actorId,
    });
    await ctx.audit.record(auditContext(request), {
      action: 'leave.grant_vip_window',
      entity: 'EMPLOYEES',
      entityId: targetEmp.id,
      after: { duration_minutes: res.durationMinutes, vip_off_window_until: res.vip_off_window_until, reason: body.reason },
    });
    return sendSuccess(
      request,
      `Đã mở cổng bù VIP (${res.durationMinutes} phút) cho nhân sự ${res.fullName} (${res.employeeCode})`,
      res,
    );
  });
}
