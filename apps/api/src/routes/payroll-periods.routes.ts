import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PAY_PERIOD_STATUSES, PAY_PERIOD_STATUS_LABELS, type PayPeriod, type PayPeriodStatus } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { mapSnapshot, recalculatePeriodSnapshots } from '../services/payroll-snapshot.service.js';
import { generatePayslips } from '../services/payslip.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const zPeriodBody = z
  .object({
    period_code: z.string().trim().max(30).optional().default(''),
    name: z.string({ required_error: 'Tên kỳ lương là bắt buộc' }).trim().min(3, 'Tên kỳ lương tối thiểu 3 ký tự').max(100),
    from_date: z.string().regex(DATE_RE, 'Từ ngày phải theo định dạng YYYY-MM-DD'),
    to_date: z.string().regex(DATE_RE, 'Đến ngày phải theo định dạng YYYY-MM-DD'),
    note: z.string().trim().max(300).optional().default(''),
  })
  .refine((v) => v.from_date <= v.to_date, { path: ['to_date'], message: 'Đến ngày phải sau hoặc bằng Từ ngày' });

const zTransitionBody = z.object({
  version: z.coerce.number().int().min(1),
  target_status: z.enum(PAY_PERIOD_STATUSES),
  note: z.string().trim().max(300).optional().default(''),
});

/** Máy trạng thái kỳ lương: chỉ đi đúng thứ tự, cho phép trả về bước trước khi chưa phát hành */
const ALLOWED: Record<PayPeriodStatus, PayPeriodStatus[]> = {
  DRAFT: ['RECONCILE'],
  RECONCILE: ['APPROVED', 'DRAFT'],
  APPROVED: ['PUBLISHED', 'RECONCILE'],
  PUBLISHED: ['PAID'],
  PAID: [],
};

const withLabel = (p: PayPeriod) => ({ ...p, statusLabel: PAY_PERIOD_STATUS_LABELS[p.status] });

export async function payrollPeriodRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/payroll/runs', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const runs = ctx.db.payPeriods.all().sort((a, b) => b.from_date.localeCompare(a.from_date)).map(withLabel);
    return sendSuccess(request, 'Lấy tổng quan kỳ lương thành công', { runs, items: ctx.db.payrollItems.all() });
  });

  app.get('/api/admin/payroll/periods', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const items = ctx.db.payPeriods.all().sort((a, b) => b.from_date.localeCompare(a.from_date)).map(withLabel);
    return sendSuccess(request, 'Lấy danh sách kỳ lương thành công', items);
  });

  app.get('/api/admin/payroll/periods/:id/snapshots', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const period = ctx.db.payPeriods.get(id);
    if (!period) throw Errors.notFound('Không tìm thấy kỳ lương');
    const snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === id).map((s) => mapSnapshot(s, ctx));
    return sendSuccess(request, 'Lấy chi tiết bảng lương thành công', { period: withLabel(period), snapshots: snaps });
  });

  app.post('/api/admin/payroll/periods', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const body = zPeriodBody.parse(request.body);
    const overlap = ctx.db.payPeriods.find((p) => p.from_date <= body.to_date && p.to_date >= body.from_date);
    if (overlap) {
      throw Errors.fieldValidation('from_date', 'DUPLICATE_VALUE', `Khoảng thời gian bị trùng với kỳ lương "${overlap.name}" (${overlap.from_date} đến ${overlap.to_date})`, body.from_date);
    }
    const actorId = request.auth!.user.id;
    const code = (body.period_code || `KL-${body.from_date.slice(0, 7).replace('-', '')}-${ctx.db.payPeriods.all(true).length + 1}`).toUpperCase();
    if (ctx.db.payPeriods.find((p) => p.period_code === code)) {
      throw Errors.fieldValidation('period_code', 'DUPLICATE_VALUE', 'Mã kỳ lương đã tồn tại', code);
    }
    const created = await ctx.db.payPeriods.insert(
      {
        name: body.name, from_date: body.from_date, to_date: body.to_date, status: 'DRAFT', snapshot_hash: '', approved_by: '',
        published_at: '', paid_at: '', period_code: code, month_key: body.from_date.slice(0, 7), branch_scope: 'ALL',
        total_employees: 0, total_approved_hours: 0, total_ot_hours: 0, total_gross_vnd: 0, total_deductions_vnd: 0, total_net_vnd: 0,
        unreconciled_records_count: 0, reconciled_by: '', reconciled_at: '', approved_at: '', published_by: '', paid_by: '', note: body.note,
      },
      actorId,
    );
    const populated = await recalculatePeriodSnapshots(ctx, created, actorId);
    await ctx.audit.record(auditContext(request), { action: 'payroll_period.create', entity: 'PAY_PERIODS', entityId: populated.id, after: { period_code: populated.period_code, total_net_vnd: populated.total_net_vnd } });
    reply.code(201);
    return sendSuccess(request, 'Đã khởi tạo kỳ lương và tự động tổng hợp bảng lương theo hồ sơ lương từng nhân sự', withLabel(populated));
  });

  app.post('/api/admin/payroll/periods/:id/recalculate', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const period = ctx.db.payPeriods.get(id);
    if (!period) throw Errors.notFound('Không tìm thấy kỳ lương');
    if (period.status !== 'DRAFT' && period.status !== 'RECONCILE') {
      throw Errors.conflict('Kỳ lương đã phê duyệt, snapshot đã đóng băng và không được tính lại');
    }
    const updated = await recalculatePeriodSnapshots(ctx, period, request.auth!.user.id);
    return sendSuccess(request, 'Đã tính lại bảng lương theo dữ liệu công và hồ sơ lương mới nhất', withLabel(updated));
  });

  app.delete('/api/admin/payroll/periods/:id', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.payPeriods.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
    if (before.status !== 'DRAFT' && before.status !== 'RECONCILE') {
      throw Errors.conflict('Chỉ được xóa kỳ lương ở trạng thái Nháp hoặc Đối soát');
    }
    await ctx.db.payPeriods.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'payroll_period.delete', entity: 'PAY_PERIODS', entityId: id, before: { period_code: before.period_code } });
    return sendSuccess(request, `Đã xóa kỳ lương ${before.name}`, { id });
  });

  app.post('/api/admin/payroll/periods/:id/transition', { preHandler: requirePermission('payroll.manage', 'payroll.publish', 'payroll.pay', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zTransitionBody.parse(request.body);
    const before = ctx.db.payPeriods.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy kỳ lương');
    if (!ALLOWED[before.status].includes(body.target_status)) {
      throw Errors.fieldValidation('target_status', 'INVALID_VALUE', `Không thể chuyển kỳ lương từ "${PAY_PERIOD_STATUS_LABELS[before.status]}" sang "${PAY_PERIOD_STATUS_LABELS[body.target_status]}"`, body.target_status);
    }
    const actorId = request.auth!.user.id;
    let current = before;
    if (body.target_status === 'RECONCILE' || body.target_status === 'APPROVED') {
      if (before.status === 'DRAFT' || before.status === 'RECONCILE') current = await recalculatePeriodSnapshots(ctx, before, actorId);
      if (body.target_status === 'APPROVED' && current.unreconciled_records_count > 0) {
        throw Errors.badRequest(`Còn ${current.unreconciled_records_count} nhân sự có công nhưng chưa thiết lập hồ sơ lương hợp lệ. Vui lòng thiết lập lương trước khi phê duyệt.`);
      }
    }
    const now = nowIso();
    const updated = await ctx.reconciliation.executeSaga({
      sagaKey: `payroll-transition-${id}-${body.target_status}-v${current.version}`,
      operation: 'PAYROLL_STATE_TRANSITION',
      actorId,
      initialContext: { period: current },
      steps: [
        {
          name: 'UPDATE_PERIOD_STATE',
          run: async (s) => {
            s.period = await ctx.db.payPeriods.update(
              id,
              current.version,
              {
                status: body.target_status,
                ...(body.target_status === 'RECONCILE' ? { reconciled_by: actorId, reconciled_at: now } : {}),
                ...(body.target_status === 'APPROVED' ? { approved_by: actorId, approved_at: now } : {}),
                ...(body.target_status === 'PUBLISHED' ? { published_by: actorId, published_at: now } : {}),
                ...(body.target_status === 'PAID' ? { paid_by: actorId, paid_at: now } : {}),
                ...(body.note ? { note: body.note } : {}),
              },
              actorId,
            );
          },
        },
        {
          name: 'GENERATE_PAYSLIPS',
          run: async (s) => {
            if (body.target_status === 'PUBLISHED') await generatePayslips(ctx, s.period, actorId);
          },
        },
      ],
      resultSelector: (s) => s.period,
    });

    await ctx.audit.record(auditContext(request), { action: 'payroll_period.transition', entity: 'PAY_PERIODS', entityId: id, before: { status: before.status }, after: { status: updated.status } });
    return sendSuccess(request, `Đã chuyển trạng thái kỳ lương sang "${PAY_PERIOD_STATUS_LABELS[updated.status]}"`, withLabel(updated));
  });
}
