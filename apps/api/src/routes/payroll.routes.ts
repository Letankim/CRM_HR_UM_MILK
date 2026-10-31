import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PAYROLL_ITEM_TYPES, PAYROLL_ITEM_TYPE_LABELS, type PayPeriod, type PayrollItem } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { recalculatePeriodSnapshots } from '../services/payroll-snapshot.service.js';
import { payrollPeriodRoutes } from './payroll-periods.routes.js';
import { payrollSignatureRoutes } from './payroll-signatures.routes.js';
import { payslipRoutes } from './payslips.routes.js';
import { salaryProfileRoutes } from './salary-profiles.routes.js';

const zPayrollItemBody = z.object({
  period_id: z.string({ required_error: 'Kỳ lương là bắt buộc' }).min(1),
  employee_id: z.string({ required_error: 'Nhân sự là bắt buộc' }).min(1),
  item_type: z.enum(PAYROLL_ITEM_TYPES).default('BONUS_ATTENDANCE'),
  title: z.string().trim().min(2, 'Nội dung khoản thưởng/điều chỉnh tối thiểu 2 ký tự').max(120),
  quantity: z.coerce.number().min(0.1, 'Số lượng tối thiểu 0,1').default(1),
  unit_amount_vnd: z.coerce.number().min(0, 'Số tiền không được âm'),
  work_date: z.string().trim().optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});
const zUpdatePayrollItemBody = zPayrollItemBody.partial().extend({ version: z.coerce.number().int().min(1) });

/** Kỳ lương chỉ cho phép thay đổi khoản mục khi đang Nháp hoặc Đối soát (chưa phê duyệt snapshot) */
export function assertPeriodEditable(period: PayPeriod) {
  if (period.status !== 'DRAFT' && period.status !== 'RECONCILE') {
    throw Errors.conflict('Kỳ lương đã phê duyệt / phát hành, không được thêm, sửa hoặc xóa khoản mục. Sau khi phát hành, vui lòng tạo phiên bản điều chỉnh phiếu lương.');
  }
}

export function mapPayrollItem(item: PayrollItem, ctx: AppContext) {
  const emp = ctx.db.employees.get(item.employee_id);
  const period = ctx.db.payPeriods.get(item.period_id);
  return {
    id: item.id,
    periodId: item.period_id,
    periodName: period?.name ?? '',
    employeeId: item.employee_id,
    employeeCode: emp?.employee_code ?? '',
    employeeName: emp?.full_name ?? 'Nhân sự đã xóa',
    itemType: item.item_type,
    itemTypeLabel: PAYROLL_ITEM_TYPE_LABELS[item.item_type],
    direction: item.direction,
    title: item.title,
    quantity: item.quantity,
    unitAmountVnd: item.unit_amount_vnd,
    totalAmountVnd: item.total_amount_vnd,
    workDate: item.work_date || null,
    approvalStatus: item.approval_status,
    note: item.note,
    version: item.version,
    created_at: item.created_at,
  };
}

const resolveDirection = (t: PayrollItem['item_type']): 'ADD' | 'DEDUCT' =>
  t === 'DEDUCTION_APPROVED' || t === 'ADVANCE_DEDUCTION' ? 'DEDUCT' : 'ADD';

export async function payrollRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/payroll/items', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay') }, async (request) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const mapped = ctx.db.payrollItems.all().map((i) => mapPayrollItem(i, ctx));
    const result = paginateAndSort(mapped, {
      page: Number(q.page) || 1,
      perPage: Number(q.per_page) || 12,
      maxPerPage: 500,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
      q: q.q,
      searchExtractor: (i) => [i.employeeCode, i.employeeName, i.itemTypeLabel, i.title, i.note],
      filters: { period_id: q.period_id, direction: q.direction, branch_id: q.branch_id },
    });
    return sendPaginated(request, 'Lấy danh sách khoản thưởng, phụ cấp và điều chỉnh thành công', result);
  });

  app.post('/api/admin/payroll/items', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const body = zPayrollItemBody.parse(request.body);
    const period = ctx.db.payPeriods.get(body.period_id);
    if (!period) throw Errors.fieldValidation('period_id', 'INVALID_VALUE', 'Kỳ lương không tồn tại', body.period_id);
    assertPeriodEditable(period);
    const emp = ctx.db.employees.get(body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Nhân sự không tồn tại', body.employee_id);

    const actorId = request.auth!.user.id;
    const created = await ctx.db.payrollItems.insert(
      {
        period_id: period.id,
        employee_id: emp.id,
        branch_id: emp.branch_id,
        work_date: body.work_date || period.to_date,
        item_type: body.item_type,
        category_code: body.item_type.split('_')[0] ?? 'BONUS',
        title: body.title,
        direction: resolveDirection(body.item_type),
        quantity: body.quantity,
        unit_amount_vnd: body.unit_amount_vnd,
        total_amount_vnd: Math.round(body.quantity * body.unit_amount_vnd),
        source_ref_id: '',
        policy_version: 'v5.1',
        approval_status: 'APPROVED',
        approved_by: actorId,
        approved_at: nowIso(),
        note: body.note,
      },
      actorId,
    );
    await recalculatePeriodSnapshots(ctx, period, actorId);
    await ctx.audit.record(auditContext(request), { action: 'payroll_item.create', entity: 'PAYROLL_ITEMS', entityId: created.id, after: { employee_id: emp.employee_code, item_type: created.item_type, total_amount_vnd: created.total_amount_vnd } });
    reply.code(201);
    return sendSuccess(request, 'Đã thêm khoản thưởng / điều chỉnh và cập nhật lại bảng lương', mapPayrollItem(created, ctx));
  });

  app.put('/api/admin/payroll/items/:id', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdatePayrollItemBody.parse(request.body);
    const before = ctx.db.payrollItems.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy khoản thưởng / điều chỉnh');
    const period = ctx.db.payPeriods.get(before.period_id);
    if (period) assertPeriodEditable(period);
    const { version, period_id: _ignored, ...patch } = body;
    const nextQty = patch.quantity ?? before.quantity;
    const nextUnit = patch.unit_amount_vnd ?? before.unit_amount_vnd;
    const nextType = patch.item_type ?? before.item_type;
    const actorId = request.auth!.user.id;
    const updated = await ctx.db.payrollItems.update(
      id,
      version,
      { ...patch, direction: resolveDirection(nextType), total_amount_vnd: Math.round(nextQty * nextUnit) },
      actorId,
    );
    if (period) await recalculatePeriodSnapshots(ctx, period, actorId);
    await ctx.audit.record(auditContext(request), { action: 'payroll_item.update', entity: 'PAYROLL_ITEMS', entityId: id, before: { total_amount_vnd: before.total_amount_vnd }, after: { total_amount_vnd: updated.total_amount_vnd } });
    return sendSuccess(request, 'Đã cập nhật khoản thưởng / điều chỉnh', mapPayrollItem(updated, ctx));
  });

  app.delete('/api/admin/payroll/items/:id', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.payrollItems.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy khoản thưởng / điều chỉnh');
    const period = ctx.db.payPeriods.get(before.period_id);
    if (period) assertPeriodEditable(period);
    const actorId = request.auth!.user.id;
    await ctx.db.payrollItems.softDelete(id, body.version ?? before.version, actorId);
    if (period) await recalculatePeriodSnapshots(ctx, period, actorId);
    await ctx.audit.record(auditContext(request), { action: 'payroll_item.delete', entity: 'PAYROLL_ITEMS', entityId: id, before: { title: before.title, total_amount_vnd: before.total_amount_vnd } });
    return sendSuccess(request, 'Đã xóa khoản thưởng / điều chỉnh và tính lại bảng lương', { id });
  });

  await salaryProfileRoutes(app, ctx);
  await payrollPeriodRoutes(app, ctx);
  await payslipRoutes(app, ctx);
  await payrollSignatureRoutes(app, ctx);
}
