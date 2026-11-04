import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mondayOfWeek, type OfficeWorkdayMode } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { executePublishOfficeShifts, planOfficeShiftsForWeek } from '../services/office-schedule-planner.service.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';

const zOfficeQuery = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD').optional(),
  branch_id: z.string().trim().optional().default('ALL'),
  mode: z.enum(['MON_TO_FRI', 'MON_TO_SAT', 'MON_TO_SAT_MORNING']).optional(),
});

const zOfficePublishBody = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đầu tuần phải theo định dạng YYYY-MM-DD'),
  branch_id: z.string().trim().optional().default('ALL'),
  mode: z.enum(['MON_TO_FRI', 'MON_TO_SAT', 'MON_TO_SAT_MORNING']).optional(),
  note: z.string().trim().max(300).optional().default(''),
});

export async function officeScheduleRoutes(app: FastifyInstance, ctx: AppContext) {
  const perm = requirePermission('schedule.read', 'schedule.publish');

  app.get('/api/admin/schedule-planner/office-shifts', { preHandler: perm }, async (request) => {
    const q = zOfficeQuery.parse(request.query ?? {});
    const weekStart = q.week_start ? mondayOfWeek(q.week_start) : mondayOfWeek(new Date().toISOString().slice(0, 10));
    const preview = await planOfficeShiftsForWeek(ctx, { weekStart, branchId: q.branch_id, mode: q.mode as OfficeWorkdayMode | undefined });
    return sendSuccess(request, `Xem trước lịch ca làm việc khối Văn phòng tuần ${preview.weekStart} thành công`, preview);
  });

  app.post('/api/admin/schedule-planner/office-shifts/publish', { preHandler: requirePermission('schedule.publish') }, async (request) => {
    const body = zOfficePublishBody.parse(request.body ?? {});
    const actorId = request.auth!.user.id;
    const result = await executePublishOfficeShifts(ctx, {
      weekStart: body.week_start, branchId: body.branch_id,
      mode: body.mode as OfficeWorkdayMode | undefined, note: body.note, actorId,
    });
    await recalculateOpenPeriods(ctx, actorId).catch(() => undefined);
    await ctx.audit.record(auditContext(request), {
      action: 'schedule.office.publish',
      entity: 'SHIFT_ASSIGNMENTS',
      entityId: `OFFICE_${result.weekStart}`,
      after: { ...result },
    });
    return sendSuccess(request, `Đã phát hành ${result.createdCount} ca hành chính cho khối văn phòng (${result.modeLabel})`, result);
  });
}
