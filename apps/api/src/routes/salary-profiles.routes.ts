import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EMPLOYEE_STAGES,
  EMPLOYEE_STAGE_LABELS,
  PAY_RATE_TYPES,
  SALARY_PROFILE_STATUS_LABELS,
  STAFF_GROUP_LABELS,
  zListQueryBase,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';
import { currentProfile, dayBefore, isProfileLocked, mapSalaryProfile, profilesOf, profileStatus } from '../services/salary-profile.service.js';
import { assertAmountInRange, createSalaryProfile, deleteLatestSalaryProfile } from '../services/salary-profile.writer.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';
import { zCreateSalaryProfileBody, zUpdateSalaryProfileBody } from './salary-profile.schemas.js';

const zListQuery = zListQueryBase.extend({
  branch_id: z.string().max(64).optional(),
  stage: z.enum([...EMPLOYEE_STAGES, 'ALL'] as const).optional(),
  rate_type: z.enum([...PAY_RATE_TYPES, 'ALL'] as const).optional(),
  profile_status: z.enum(['ACTIVE', 'SCHEDULED', 'EXPIRED', 'MISSING', 'ALL']).optional(),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

export async function salaryProfileRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/payroll/salary-profiles', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const query = zListQuery.parse(request.query);
    if (query.branch_id && query.branch_id !== 'ALL') assertBranchAccess(request, query.branch_id);
    if (query.refresh === '1' || query.refresh === 'true') {
      await Promise.all([ctx.db.payRates.refreshIfIdle(), ctx.db.employees.refreshIfIdle()]);
    }
    const scoped = filterByBranch(request, ctx.db.employees.all(), (e) => e.branch_id);
    const rows = scoped.map((e) => {
      const history = profilesOf(ctx.db, e.id);
      const cur = currentProfile(history);
      const status = profileStatus(cur);
      return {
        id: e.id,
        employeeId: e.id,
        employeeCode: e.employee_code,
        fullName: e.full_name,
        branchId: e.branch_id,
        branchName: ctx.db.branches.get(e.branch_id)?.name ?? 'Chưa phân chi nhánh',
        stage: e.stage,
        stageLabel: EMPLOYEE_STAGE_LABELS[e.stage],
        staffGroupLabel: resolveStaffGroupLabel(ctx, e.staff_group, e.position_title),
        officialFrom: e.official_from || null,
        profileStatus: status,
        profileStatusLabel: SALARY_PROFILE_STATUS_LABELS[status],
        rateType: cur?.rate_type ?? null,
        amountVnd: cur?.amount_vnd ?? 0,
        historyCount: history.length,
        profile: cur ? mapSalaryProfile(cur, ctx.db) : null,
      };
    });
    const result = paginateAndSort(rows, {
      page: query.page,
      perPage: query.per_page,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
      defaultSortBy: 'employeeCode',
      defaultSortOrder: 'asc',
      allowedSortFields: ['employeeCode', 'fullName', 'amountVnd', 'stage'],
      q: query.q,
      searchExtractor: (r) => [r.employeeCode, r.fullName, r.branchName, r.staffGroupLabel],
      filters: { branch_id: query.branch_id, stage: query.stage, rate_type: query.rate_type, profile_status: query.profile_status },
      filterPredicates: {
        branch_id: (r, v) => r.branchId === v,
        rate_type: (r, v) => r.rateType === v,
        profile_status: (r, v) => r.profileStatus === v,
      },
    });
    return sendPaginated(request, 'Lấy danh sách hồ sơ lương nhân sự thành công', result);
  });

  app.get('/api/admin/employees/:id/salary-profiles', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const emp = ctx.db.employees.get(id);
    if (!emp) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, emp.branch_id);
    const history = profilesOf(ctx.db, id).map((p) => ({ ...mapSalaryProfile(p, ctx.db), locked: isProfileLocked(ctx.db, p.id) }));
    return sendSuccess(request, 'Lấy lịch sử lương của nhân sự thành công', history);
  });

  app.post('/api/admin/payroll/salary-profiles', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const body = zCreateSalaryProfileBody.parse(request.body);
    const emp = ctx.db.employees.get(body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Nhân sự được chọn không tồn tại', body.employee_id);
    assertBranchAccess(request, emp.branch_id);
    const actorId = request.auth!.user.id;
    const created = await createSalaryProfile(ctx, emp, body, actorId);
    await ctx.audit.record(auditContext(request), {
      action: 'salary_profile.create',
      entity: 'PAY_RATES',
      entityId: created.id,
      after: { employee_code: emp.employee_code, rate_type: created.rate_type, amount_vnd: created.amount_vnd, probation_percent: created.probation_percent, effective_from: created.effective_from },
    });
    reply.code(201);
    return sendSuccess(request, `Đã thiết lập mức lương mới cho ${emp.full_name} từ ngày ${created.effective_from}`, mapSalaryProfile(created, ctx.db));
  });

  app.put('/api/admin/payroll/salary-profiles/:id', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateSalaryProfileBody.parse(request.body);
    const before = ctx.db.payRates.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy mức lương');
    const emp = ctx.db.employees.get(before.employee_id);
    if (emp) assertBranchAccess(request, emp.branch_id);
    if (isProfileLocked(ctx.db, id)) {
      throw Errors.conflict('Mức lương đã được dùng để chốt kỳ lương, không được sửa đè. Vui lòng tạo mức lương mới có ngày hiệu lực.');
    }
    const { version, effective_from, ...patch } = body;
    const nextType = patch.rate_type ?? before.rate_type;
    const nextAmount = patch.amount_vnd ?? before.amount_vnd;
    assertAmountInRange(nextType, nextAmount);
    let olderToShift: ReturnType<typeof profilesOf>[number] | undefined;
    if (effective_from && effective_from !== before.effective_from) {
      const history = profilesOf(ctx.db, before.employee_id);
      const idx = history.findIndex((p) => p.id === id);
      const newer = history[idx - 1];
      const older = history[idx + 1];
      if (newer || (older && effective_from <= older.effective_from)) {
        throw Errors.fieldValidation('effective_from', 'INVALID_VALUE', 'Chỉ được đổi ngày hiệu lực của mức lương mới nhất và phải sau mức lương liền trước', effective_from);
      }
      olderToShift = older;
    }
    const actorId = request.auth!.user.id;
    const updated = await ctx.db.payRates.update(
      id,
      version,
      { ...patch, ...(effective_from ? { effective_from } : {}), amount_vnd: Math.round(nextAmount) },
      actorId,
    );
    if (olderToShift && effective_from) {
      await ctx.db.payRates.update(olderToShift.id, olderToShift.version, { effective_to: dayBefore(effective_from), status: 'EXPIRED' }, actorId);
    }
    await ctx.audit.record(auditContext(request), {
      action: 'salary_profile.update',
      entity: 'PAY_RATES',
      entityId: id,
      before: { rate_type: before.rate_type, amount_vnd: before.amount_vnd, probation_percent: before.probation_percent },
      after: { rate_type: updated.rate_type, amount_vnd: updated.amount_vnd, probation_percent: updated.probation_percent },
    });
    return sendSuccess(request, 'Đã cập nhật mức lương', mapSalaryProfile(updated, ctx.db));
  });

  app.delete('/api/admin/payroll/salary-profiles/:id', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.payRates.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy mức lương');
    const emp = ctx.db.employees.get(before.employee_id);
    if (emp) assertBranchAccess(request, emp.branch_id);
    await deleteLatestSalaryProfile(ctx, before, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), {
      action: 'salary_profile.delete',
      entity: 'PAY_RATES',
      entityId: id,
      before: { employee_id: before.employee_id, amount_vnd: before.amount_vnd, effective_from: before.effective_from },
    });
    return sendSuccess(request, 'Đã xóa mức lương và khôi phục mức lương liền trước', { id });
  });
}
