import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Payslip } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { buildPayslipPayload, mapPayslip } from '../services/payslip.service.js';

const zRevisionBody = z.object({
  version: z.coerce.number().int().min(1).optional(),
  delta_vnd: z.coerce.number({ invalid_type_error: 'Số tiền điều chỉnh phải là số' }).refine((v) => v !== 0, 'Số tiền điều chỉnh phải khác 0'),
  reason: z.string({ required_error: 'Lý do điều chỉnh là bắt buộc' }).trim().min(5, 'Lý do điều chỉnh tối thiểu 5 ký tự').max(300),
  field_changed: z.string().trim().max(60).optional().default('ADJUSTMENT'),
});

/** Nhân sự gắn với tài khoản đang đăng nhập (self-only) */
function selfEmployee(ctx: AppContext, user: { id: string; employee_id: string }) {
  return ctx.db.employees.find((e) => e.user_id === user.id) ?? ctx.db.employees.find((e) => !!user.employee_id && e.employee_code === user.employee_id);
}

export async function payslipRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/payroll/periods/:id/payslips', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay') }, async (request) => {
    const { id } = request.params as { id: string };
    const items = ctx.db.payslips.filter((p) => p.period_id === id).sort((a, b) => a.employee_code.localeCompare(b.employee_code) || a.revision - b.revision);
    return sendSuccess(request, 'Lấy danh sách phiếu lương của kỳ thành công', items.map(mapPayslip));
  });

  app.get('/api/admin/payroll/payslips/:id/revisions', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay') }, async (request) => {
    const { id } = request.params as { id: string };
    const slip = ctx.db.payslips.get(id) ?? ctx.db.payslips.find((p) => p.snapshot_id === id);
    if (!slip) return sendSuccess(request, 'Chưa có lịch sử điều chỉnh phiếu lương', []);
    const revs = ctx.db.payslipRevisions.filter((r) => r.period_id === slip.period_id && r.employee_id === slip.employee_id).sort((a, b) => a.revision - b.revision);
    return sendSuccess(request, 'Lấy lịch sử điều chỉnh phiếu lương thành công', revs);
  });

  app.post('/api/admin/payroll/payslips/:id/revisions', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = zRevisionBody.parse(request.body);
    const slip = ctx.db.payslips.get(id) ?? ctx.db.payslips.find((p) => p.snapshot_id === id && p.status !== 'REVISED');
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương đã phát hành của nhân sự này');
    if (slip.status === 'REVISED') throw Errors.conflict('Phiếu lương này đã được thay thế bởi bản điều chỉnh mới hơn');
    const period = ctx.db.payPeriods.get(slip.period_id);
    const snap = ctx.db.payrollSnapshots.get(slip.snapshot_id);
    if (!period || !snap) throw Errors.notFound('Không tìm thấy kỳ lương hoặc dữ liệu gốc của phiếu lương');
    const after = slip.net_vnd + body.delta_vnd;
    if (after < 0) throw Errors.fieldValidation('delta_vnd', 'OUT_OF_RANGE', 'Số tiền điều chỉnh làm thực lĩnh âm, vui lòng kiểm tra lại', body.delta_vnd);

    const actorId = request.auth!.user.id;
    const nextRevision = slip.revision + 1;
    const result = await ctx.reconciliation.executeSaga({
      sagaKey: `payslip-revision-${id}-r${nextRevision}`,
      operation: 'PAYROLL_PAYSLIP_REVISION',
      actorId,
      initialContext: { newSlip: null as Payslip | null },
      steps: [
        {
          name: 'INSERT_REVISION_LOG',
          run: async () => {
            await ctx.db.payslipRevisions.insert(
              {
                payslip_id: slip.id, revision: nextRevision, reason: body.reason, delta_vnd: body.delta_vnd, created_reason_by: actorId,
                period_id: slip.period_id, employee_id: slip.employee_id, field_changed: body.field_changed,
                before_amount_vnd: slip.net_vnd, after_amount_vnd: after, details_json: JSON.stringify({ previous_payslip_code: slip.payslip_code }),
                status: 'APPROVED', approved_by: actorId, approved_at: nowIso(),
              },
              actorId,
            );
          },
        },
        {
          name: 'INSERT_NEW_PAYSLIP_REVISION',
          run: async (s) => {
            s.newSlip = await ctx.db.payslips.insert(buildPayslipPayload(ctx, period, snap, nextRevision, after, slip.gross_vnd + Math.max(0, body.delta_vnd)), actorId);
          },
        },
        { name: 'MARK_PREVIOUS_REVISED', run: async () => { await ctx.db.payslips.update(slip.id, body.version ?? slip.version, { status: 'REVISED' }, actorId); } },
      ],
      resultSelector: (s) => s.newSlip!,
    });
    await ctx.audit.record(auditContext(request), { action: 'payslip.revision', entity: 'PAYSLIPS', entityId: result.id, before: { payslip_code: slip.payslip_code, net_vnd: slip.net_vnd }, after: { payslip_code: result.payslip_code, net_vnd: result.net_vnd, reason: body.reason } });
    reply.code(201);
    return sendSuccess(request, `Đã tạo phiếu lương điều chỉnh lần ${nextRevision} (phiếu gốc được giữ nguyên để truy vết)`, mapPayslip(result));
  });

  app.get('/api/me/payslips', { preHandler: requirePermission('self.payslip') }, async (request) => {
    const emp = selfEmployee(ctx, request.auth!.user);
    if (!emp) return sendSuccess(request, 'Chưa có hồ sơ nhân sự gắn với tài khoản', []);
    const visiblePeriods = new Set(ctx.db.payPeriods.filter((p) => p.status === 'PUBLISHED' || p.status === 'PAID').map((p) => p.id));
    const items = ctx.db.payslips
      .filter((p) => p.employee_id === emp.id && p.status !== 'REVISED' && visiblePeriods.has(p.period_id))
      .sort((a, b) => b.from_date.localeCompare(a.from_date));
    return sendSuccess(request, 'Lấy danh sách phiếu lương cá nhân thành công', items.map(mapPayslip));
  });

  app.get('/api/me/payslips/:id', { preHandler: requirePermission('self.payslip') }, async (request) => {
    const { id } = request.params as { id: string };
    const emp = selfEmployee(ctx, request.auth!.user);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!emp || slip.employee_id !== emp.id) throw Errors.forbidden('Bạn chỉ được xem phiếu lương của chính mình');
    const period = ctx.db.payPeriods.get(slip.period_id);
    if (!period || (period.status !== 'PUBLISHED' && period.status !== 'PAID')) throw Errors.forbidden('Phiếu lương chưa được phát hành');
    return sendSuccess(request, 'Lấy chi tiết phiếu lương thành công', mapPayslip(slip));
  });

  app.post('/api/me/payslips/:id/confirm', { preHandler: requirePermission('self.payslip') }, async (request) => {
    const { id } = request.params as { id: string };
    const emp = selfEmployee(ctx, request.auth!.user);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!emp || slip.employee_id !== emp.id) throw Errors.forbidden('Bạn chỉ được xác nhận phiếu lương của chính mình');
    const now = nowIso();
    const updated = await ctx.db.payslips.update(slip.id, slip.version, { viewed_by_employee_at: slip.viewed_by_employee_at || now, employee_confirmed_at: now, dispute_status: 'NONE' }, request.auth!.user.id);
    return sendSuccess(request, 'Đã xác nhận đồng ý phiếu lương thành công', mapPayslip(updated));
  });

  app.post('/api/me/payslips/:id/dispute', { preHandler: requirePermission('self.payslip') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ reason: z.string().trim().min(5, 'Lý do thắc mắc phiếu lương tối thiểu 5 ký tự') }).parse(request.body);
    const emp = selfEmployee(ctx, request.auth!.user);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!emp || slip.employee_id !== emp.id) throw Errors.forbidden('Bạn chỉ được gửi phản hồi cho phiếu lương của chính mình');
    const updated = await ctx.db.payslips.update(slip.id, slip.version, { viewed_by_employee_at: slip.viewed_by_employee_at || nowIso(), dispute_status: 'OPEN', dispute_reason: body.reason }, request.auth!.user.id);
    ['FINANCE', 'HR', 'ADMIN'].forEach((r) => ctx.realtime()?.toRole(r, SocketEvents.NOTIFICATION, { kind: 'PAYROLL_DISPUTE', code: slip.payslip_code, title: `Báo sai lệch phiếu lương (${slip.employee_code}): ${body.reason}` }));
    return sendSuccess(request, 'Đã gửi phản hồi thắc mắc phiếu lương tới bộ phận Kế toán / Nhân sự', mapPayslip(updated));
  });

  app.get('/api/admin/payroll/revenue-inputs', { preHandler: requirePermission('payroll.read') }, async (request) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    const items = ctx.db.revenueInputs.all().map((r) => ({
      ...r,
      branchName: ctx.db.branches.get(r.branch_id)?.name ?? (r.branch_id === 'ALL' ? 'Toàn chuỗi Ụm Bò Milk' : r.branch_id),
      periodName: ctx.db.payPeriods.get(r.period_id)?.name ?? (r.period_id || 'Kỳ lương hiện hành'),
    }));
    const result = paginateAndSort(items, {
      page: Number(q.page) || 1,
      perPage: Number(q.per_page) || 12,
      maxPerPage: 200,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
      q: q.q,
      searchExtractor: (r) => [r.periodName, r.branchName, r.note],
      filters: { period_id: q.period_id, branch_id: q.branch_id },
    });
    return sendPaginated(request, 'Lấy báo cáo doanh thu đối chiếu & tỷ lệ chi phí lương thành công', result);
  });

  app.post('/api/admin/payroll/revenue-inputs', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const body = z.object({
      period_id: z.string().optional().default(''),
      branch_id: z.string().default('ALL'),
      revenue_vnd: z.coerce.number().min(1, 'Doanh thu phải lớn hơn 0'),
      payroll_cost_vnd: z.coerce.number().min(0).optional(),
      note: z.string().default(''),
    }).parse(request.body);
    const period = (body.period_id ? ctx.db.payPeriods.get(body.period_id) : undefined) ?? ctx.db.payPeriods.all()[0];
    const targetPeriodId = period?.id || body.period_id || 'CURRENT';
    const snaps = ctx.db.payrollSnapshots.filter((s) => s.period_id === targetPeriodId && (body.branch_id === 'ALL' || s.branch_id === body.branch_id));
    const payrollCost = body.payroll_cost_vnd ?? (snaps.reduce((sum, s) => sum + s.gross_vnd, 0) || period?.total_gross_vnd || 0);
    const laborPct = Number(((payrollCost / body.revenue_vnd) * 100).toFixed(2));
    const created = await ctx.db.revenueInputs.insert({
      period_id: targetPeriodId, branch_id: body.branch_id, revenue_vnd: body.revenue_vnd, source: 'FINANCE_MANUAL',
      from_date: period?.from_date || '', to_date: period?.to_date || '', payroll_cost_vnd: payrollCost,
      labor_cost_percent: laborPct, verified_by: request.auth!.user.display_name || request.auth!.user.username, verified_at: nowIso(), note: body.note,
    }, request.auth!.user.id);
    reply.code(201);
    return sendSuccess(request, `Đã lưu doanh thu đối chiếu — Tỷ lệ chi phí lương/doanh thu: ${laborPct}%`, created);
  });
}
