import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PAYROLL_ITEM_TYPES, PAYROLL_ITEM_TYPE_LABELS, type PayPeriod, type PayrollItem } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { AppError, Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { mapSnapshot, recalculatePeriodSnapshots } from '../services/payroll-snapshot.service.js';
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
const zManualColumnsBody = z.object({
  version: z.coerce.number().int().min(1).optional(),
  manual_base_add_vnd: z.coerce.number().min(0, 'Cộng lương cơ bản không được âm').optional(),
  manual_ot_add_vnd: z.coerce.number().min(0, 'Cộng lương tăng ca không được âm').optional(),
  manual_bonus_vnd: z.coerce.number().min(0, 'Cộng thưởng nóng không được âm').optional(),
  manual_advance_deduct_vnd: z.coerce.number().min(0, 'Trừ ứng lương không được âm').optional(),
  manual_kpi_deduct_vnd: z.coerce.number().min(0, 'Trừ phạt KPI không được âm').optional(),
  manual_uniform_deduct_vnd: z.coerce.number().min(0, 'Trừ phí đồng phục không được âm').optional(),
});

/** Kỳ lương chỉ cho phép thay đổi khoản mục / 6 cột nhập tay khi đang Nháp hoặc Đối soát (chưa phê duyệt snapshot) */
export function assertPeriodEditable(period: PayPeriod) {
  if (period.status !== 'DRAFT' && period.status !== 'RECONCILE') {
    throw Errors.conflict('Kỳ lương đã phê duyệt / phát hành, không được thêm, sửa, xóa khoản mục hoặc sửa 6 cột nhập tay Kế toán.');
  }
}

/** Khóa chống gian lận: Cấm sửa khoản mục hoặc 6 cột nhập tay nếu nhân sự đã ký xác nhận hoặc đã thanh toán phiếu lương */
export function assertEmployeePayslipNotSigned(ctx: AppContext, periodId: string, employeeId: string, snapshotId?: string) {
  const emp = ctx.db.employees.get(employeeId);
  const empCode = emp?.employee_code?.trim().toUpperCase() ?? '';
  const slip = ctx.db.payslips.find(
    (p) =>
      p.status !== 'REVISED' &&
      Boolean(
        (snapshotId && p.snapshot_id === snapshotId) ||
          (p.period_id === periodId && (p.employee_id === employeeId || (empCode && p.employee_code.trim().toUpperCase() === empCode))),
      ),
  );
  if (slip?.status === 'PAID') {
    throw Errors.conflict('Phiếu lương của nhân sự này đã thanh toán, không được phép chỉnh sửa số liệu.');
  }
  if (slip?.employee_confirmed_at || slip?.employee_signature_file_id) {
    throw Errors.conflict('Nhân sự đã ký tay xác nhận phiếu lương. Dữ liệu đã niêm phong chống gian lận, Kế toán không được phép chỉnh sửa.');
  }
}

export function mapPayrollItem(item: PayrollItem, ctx: AppContext) {
  const emp = ctx.db.employees.get(item.employee_id), period = ctx.db.payPeriods.get(item.period_id);
  return {
    id: item.id, periodId: item.period_id, periodName: period?.name ?? '', employeeId: item.employee_id,
    employeeCode: emp?.employee_code ?? '', employeeName: emp?.full_name ?? 'Nhân sự đã xóa',
    itemType: item.item_type, itemTypeLabel: PAYROLL_ITEM_TYPE_LABELS[item.item_type], direction: item.direction,
    title: item.title, quantity: item.quantity, unitAmountVnd: item.unit_amount_vnd, totalAmountVnd: item.total_amount_vnd,
    workDate: item.work_date || null, approvalStatus: item.approval_status, note: item.note, version: item.version, created_at: item.created_at,
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
    assertEmployeePayslipNotSigned(ctx, period.id, emp.id);

    const actorId = request.auth!.user.id;
    const created = await ctx.db.payrollItems.insert(
      {
        period_id: period.id, employee_id: emp.id, branch_id: emp.branch_id, work_date: body.work_date || period.to_date,
        item_type: body.item_type, category_code: body.item_type.split('_')[0] ?? 'BONUS', title: body.title,
        direction: resolveDirection(body.item_type), quantity: body.quantity, unit_amount_vnd: body.unit_amount_vnd,
        total_amount_vnd: Math.round(body.quantity * body.unit_amount_vnd), source_ref_id: '', policy_version: 'v5.1',
        approval_status: 'APPROVED', approved_by: actorId, approved_at: nowIso(), note: body.note,
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
    assertEmployeePayslipNotSigned(ctx, before.period_id, before.employee_id);
    const { version, period_id: _ignored, ...patch } = body;
    const nextQty = patch.quantity ?? before.quantity, nextUnit = patch.unit_amount_vnd ?? before.unit_amount_vnd, nextType = patch.item_type ?? before.item_type;
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
    assertEmployeePayslipNotSigned(ctx, before.period_id, before.employee_id);
    const actorId = request.auth!.user.id;
    await ctx.db.payrollItems.softDelete(id, body.version ?? before.version, actorId);
    if (period) await recalculatePeriodSnapshots(ctx, period, actorId);
    await ctx.audit.record(auditContext(request), { action: 'payroll_item.delete', entity: 'PAYROLL_ITEMS', entityId: id, before: { title: before.title, total_amount_vnd: before.total_amount_vnd } });
    return sendSuccess(request, 'Đã xóa khoản thưởng / điều chỉnh và tính lại bảng lương', { id });
  });

  app.put('/api/admin/payroll/snapshots/:id/manual-columns', { preHandler: requirePermission('payroll.manage', 'payroll.publish', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string }, body = zManualColumnsBody.parse(request.body), snap = ctx.db.payrollSnapshots.get(id);
    if (!snap) throw Errors.notFound('Snapshot lương nhân sự', id);
    const period = ctx.db.payPeriods.get(snap.period_id);
    if (period) assertPeriodEditable(period);
    assertEmployeePayslipNotSigned(ctx, snap.period_id, snap.employee_id, snap.id);
    const nextBaseAdd = Math.round(body.manual_base_add_vnd ?? snap.manual_base_add_vnd ?? 0);
    const nextOtAdd = Math.round(body.manual_ot_add_vnd ?? snap.manual_ot_add_vnd ?? 0);
    const nextBonus = Math.round(body.manual_bonus_vnd ?? snap.manual_bonus_vnd ?? 0);
    const nextAdvanceDeduct = Math.round(body.manual_advance_deduct_vnd ?? snap.manual_advance_deduct_vnd ?? 0);
    const nextKpiDeduct = Math.round(body.manual_kpi_deduct_vnd ?? snap.manual_kpi_deduct_vnd ?? 0);
    const nextUniformDeduct = Math.round(body.manual_uniform_deduct_vnd ?? snap.manual_uniform_deduct_vnd ?? 0);
    const autoGross = snap.base_salary_vnd + snap.ot_pay_vnd + (snap.ot_daily_allowance_vnd ?? 0) + snap.shift_swap_allowance_vnd + snap.meal_allowance_vnd + snap.transport_allowance_vnd + snap.attendance_bonus_vnd + snap.kpi_bonus_vnd + snap.other_allowances_vnd + snap.positive_adjustments_vnd;
    const nextGross = autoGross + nextBaseAdd + nextOtAdd + nextBonus;
    const totalDeduct = snap.approved_deductions_vnd + snap.advance_deduction_vnd + (snap.late_fine_vnd ?? 0) + nextAdvanceDeduct + nextKpiDeduct + nextUniformDeduct;
    const nextNet = Math.max(0, nextGross - totalDeduct);
    const actorId = request.auth!.user.id;
    const updated = await ctx.db.payrollSnapshots.update(id, body.version ?? snap.version, {
      manual_base_add_vnd: nextBaseAdd, manual_ot_add_vnd: nextOtAdd, manual_bonus_vnd: nextBonus,
      manual_advance_deduct_vnd: nextAdvanceDeduct, manual_kpi_deduct_vnd: nextKpiDeduct, manual_uniform_deduct_vnd: nextUniformDeduct,
      gross_vnd: nextGross, net_vnd: nextNet,
    }, actorId);
    if (period) {
      const allSnaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === period.id);
      const pGross = allSnaps.reduce((s, r) => s + r.gross_vnd, 0);
      const pDeduct = allSnaps.reduce((s, r) => s + r.approved_deductions_vnd + r.advance_deduction_vnd + (r.late_fine_vnd ?? 0) + (r.manual_advance_deduct_vnd ?? 0) + (r.manual_kpi_deduct_vnd ?? 0) + (r.manual_uniform_deduct_vnd ?? 0), 0);
      const pNet = allSnaps.reduce((s, r) => s + r.net_vnd, 0);
      await ctx.db.payPeriods.update(period.id, period.version, { total_gross_vnd: pGross, total_deductions_vnd: pDeduct, total_net_vnd: pNet }, actorId);
    }
    await ctx.audit.record(auditContext(request), { action: 'payroll_snapshot.manual_columns', entity: 'PAYROLL_SNAPSHOTS', entityId: id, after: { manual_base_add_vnd: nextBaseAdd, manual_ot_add_vnd: nextOtAdd, manual_bonus_vnd: nextBonus, manual_advance_deduct_vnd: nextAdvanceDeduct, manual_kpi_deduct_vnd: nextKpiDeduct, manual_uniform_deduct_vnd: nextUniformDeduct, gross_vnd: nextGross, net_vnd: nextNet } });
    return sendSuccess(request, 'Đã cập nhật 6 cột điều chỉnh kế toán và tính lại thực lĩnh thành công', { ...mapSnapshot(updated, ctx, request.auth?.user.role), manual_base_add_vnd: nextBaseAdd, manual_ot_add_vnd: nextOtAdd, manual_bonus_vnd: nextBonus, manual_advance_deduct_vnd: nextAdvanceDeduct, manual_kpi_deduct_vnd: nextKpiDeduct, manual_uniform_deduct_vnd: nextUniformDeduct });
  });

  app.post('/api/admin/payroll/periods/:id/approve', { preHandler: requirePermission('payroll.manage', 'payroll.publish', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string }, actor = request.auth!.user, before = ctx.db.payPeriods.get(id);
    if (!before) throw Errors.notFound('Kỳ lương', id);
    if (actor.role !== 'ADMIN' || (before.reconciled_by && before.reconciled_by === actor.id)) {
      throw new AppError(403, 'SEPARATION_OF_DUTIES_VIOLATION', 'Vi phạm nguyên tắc tách biệt nhiệm vụ (Separation of Duties): Kế toán lập bảng lương không được tự phê duyệt kỳ lương; chỉ Tổng quản trị (ADMIN) độc lập được phép phê duyệt');
    }
    if (before.status !== 'RECONCILE') throw Errors.conflict('Kỳ lương phải ở trạng thái Đối soát (RECONCILE) trước khi phê duyệt');
    const updated = await ctx.db.payPeriods.update(id, before.version, { status: 'APPROVED', approved_by: actor.id, approved_at: nowIso() }, actor.id);
    await ctx.audit.record(auditContext(request), { action: 'pay_period.approve', entity: 'PAY_PERIODS', entityId: id, before: { status: before.status }, after: { status: updated.status } });
    return sendSuccess(request, 'Ban Quản trị đã phê duyệt kỳ lương thành công', updated);
  });

  await salaryProfileRoutes(app, ctx);
  await payrollPeriodRoutes(app, ctx);
  await payslipRoutes(app, ctx);
  await payrollSignatureRoutes(app, ctx);
}
