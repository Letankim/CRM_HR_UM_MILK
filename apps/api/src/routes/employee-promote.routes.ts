import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Employee, User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { assertBranchAccess, auditContext, requirePermission } from '../plugins/auth-context.js';
import { queuePromotionOfficialEmail } from '../services/action-email-dispatcher.js';
import { runBackgroundSideEffect } from '../services/background-write.js';
import { buildPromoteSchedulePreview, createPromoteOfficialShifts } from '../services/employee-promote-planner.service.js';
import { preloadEmployeePartitionStores } from '../services/partition-write-router.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { cleanupProbationShiftsAfterOfficial } from './employee-contracts.routes.js';
import { buildEmployeeDossierSummary } from './employee-dossier-summary.js';
import { mapEmployeeRecord } from './employee-mapper.js';

export const zPromoteOfficialBody = z.object({
  version: z.coerce.number().int().min(1),
  official_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày hiệu lực chính thức phải theo định dạng YYYY-MM-DD').optional(),
  evaluation_summary: z.string().trim().max(300).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
  create_shifts: z.array(z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shift_code: z.string().min(1),
    note: z.string().optional(),
  })).optional(),
});

export function registerEmployeePromoteRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/employees/:id/promote-preview', { preHandler: requirePermission('employee.promote') }, async (request) => {
    await preloadEmployeePartitionStores(ctx.db);
    const { id } = request.params as { id: string };
    const emp = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
    if (!emp) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, emp.branch_id);
    const query = (request.query ?? {}) as { official_from?: string };
    const officialFrom = query.official_from && /^\d{4}-\d{2}-\d{2}$/.test(query.official_from)
      ? query.official_from
      : dayjs().format('YYYY-MM-DD');
    const preview = buildPromoteSchedulePreview(ctx, emp, officialFrom);
    return sendSuccess(request, `Lấy dữ liệu xem trước lịch làm việc khi lên chính thức cho ${emp.full_name}`, preview);
  });

  app.post('/api/admin/employees/:id/promote-official', { preHandler: requirePermission('employee.promote') }, async (request) => {
    await preloadEmployeePartitionStores(ctx.db);
    const { id } = request.params as { id: string };
    const body = zPromoteOfficialBody.parse(request.body);
    const before = ctx.db.employees.get(id) ?? ctx.db.employees.find((e) => e.employee_code === id);
    if (!before) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, before.branch_id);
    if (before.stage === 'OFFICIAL') throw Errors.badRequest('Nhân sự này đã ở giai đoạn Nhân viên chính thức');

    const effectiveDate = body.official_from || dayjs().format('YYYY-MM-DD');
    const actorId = request.auth!.user.id;
    const linkedUser = (before.user_id ? ctx.db.users.get(before.user_id) : undefined) ?? ctx.db.users.find((u) => u.employee_id === before.employee_code);

    let createdShiftCount = 0;
    const promoted = await ctx.reconciliation.executeSaga({
      sagaKey: `emp-promote-${before.id}-v${body.version}`,
      operation: 'HR_PROMOTE_OFFICIAL',
      actorId,
      initialContext: { updatedEmp: null as Employee | null, prevUser: linkedUser as User | undefined },
      steps: [
        {
          name: 'UPDATE_EMPLOYEE_STAGE_OFFICIAL',
          run: async (s) => {
            s.updatedEmp = await ctx.db.employees.update(before.id, body.version, {
              stage: 'OFFICIAL',
              official_from: effectiveDate,
              employment_type: before.employment_type === 'PROBATION' ? 'PART_TIME' : before.employment_type,
              ...(body.note ? { note: body.note } : {}),
            }, actorId);
          },
          compensate: async (s) => {
            if (s.updatedEmp) await ctx.db.employees.update(before.id, s.updatedEmp.version, { stage: before.stage, official_from: before.official_from, employment_type: before.employment_type }, actorId);
          },
        },
        {
          name: 'SYNC_USER_ROLE_CHINH_THUC',
          run: async (s) => {
            if (s.prevUser && s.prevUser.role === 'THU_VIEC') await ctx.db.users.update(s.prevUser.id, s.prevUser.version, { role: 'CHINH_THUC' }, actorId);
          },
        },
        {
          name: 'RECORD_STAGE_HISTORY',
          run: async () => {
            const dossier = buildEmployeeDossierSummary(before, ctx);
            const summary = body.evaluation_summary || body.note || 'Đạt điều kiện thử việc và TEST nghiệp vụ, chuyển sang Nhân viên chính thức';
            await ctx.db.employeeStageHistory.insert({
              employee_id: before.id, from_stage: before.stage, to_stage: 'OFFICIAL', effective_from: effectiveDate,
              decided_by: request.auth!.user.username, note: summary, change_type: 'PROMOTE_OFFICIAL',
              from_branch_id: before.branch_id, to_branch_id: before.branch_id, from_shift_code: before.default_shift_code,
              to_shift_code: before.default_shift_code, probation_hours_completed: dossier.probationHoursCompleted,
              test_score_percent: dossier.testBestScorePercent, evaluation_summary: summary, approved_by: request.auth!.user.username,
            }, actorId);
            await cleanupProbationShiftsAfterOfficial(ctx, before, effectiveDate, actorId);
            if (body.create_shifts && body.create_shifts.length > 0) {
              const created = await createPromoteOfficialShifts(ctx, before, effectiveDate, body.create_shifts, actorId);
              createdShiftCount = created.length;
            }
          },
        },
      ],
      resultSelector: (s) => s.updatedEmp!,
    });

    queuePromotionOfficialEmail(ctx, promoted, actorId);
    await runBackgroundSideEffect(async () => {
      await recalculateOpenPeriods(ctx, actorId);
      await ctx.audit.record(auditContext(request), {
        action: 'employee.promote_official', entity: 'EMPLOYEES', entityId: before.id,
        before: { employee_code: before.employee_code, stage: before.stage, official_from: before.official_from },
        after: { employee_code: promoted.employee_code, stage: promoted.stage, official_from: promoted.official_from, created_shift_count: createdShiftCount },
      });
    });

    const shiftMsg = createdShiftCount > 0 ? ` và đã bổ sung ${createdShiftCount} ca làm việc chính thức trong tuần` : '';
    return sendSuccess(request, `Đã chuyển chính thức cho nhân sự ${promoted.full_name} (${promoted.employee_code}) từ ngày ${effectiveDate}${shiftMsg}`, mapEmployeeRecord(promoted, ctx));
  });
}
