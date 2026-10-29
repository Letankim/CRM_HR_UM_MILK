import { TICKET_DEPARTMENTS, type Employee, type Payslip } from '@umbm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { applyPayslipAdjustment, ensurePublishedPeriodPayslips, generatePayslips, mapPayslip } from '../services/payslip.service.js';
import { emitAndEmailTicketEvent, mapSupportTicket, upsertPayslipDisputeTicket } from '../services/ticket-notification.service.js';
import { findAllLinkedEmployeesForUser } from './employee-mapper.js';
import { validateAssigneeForDepartment } from './tickets.routes.js';

function mapPayslipWithTicket(ctx: AppContext, slip: Payslip) {
  const base = mapPayslip(slip);
  const tck = ctx.db.supportTickets.filter((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === slip.id).slice(-1)[0];
  if (!tck) return { ...base, linkedTicket: null };
  const mt = mapSupportTicket(ctx, tck);
  return { ...base, linkedTicket: { id: mt.id, ticketCode: mt.ticket_code, status: mt.status, statusLabel: mt.statusLabel, department: mt.target_department, departmentLabel: mt.departmentLabel, assigneeName: mt.assigneeName, messageCount: mt.messageCount } };
}

const zRevisionBody = z.object({
  version: z.coerce.number().int().min(1).optional(),
  delta_vnd: z.coerce.number({ invalid_type_error: 'Số tiền điều chỉnh phải là số' }).refine((v) => v !== 0, 'Số tiền điều chỉnh phải khác 0'),
  reason: z.string({ required_error: 'Lý do điều chỉnh là bắt buộc' }).trim().min(5, 'Lý do điều chỉnh tối thiểu 5 ký tự').max(300),
  field_changed: z.string().trim().max(60).optional().default('ADJUSTMENT'),
});

function isOwnPayslip(p: { employee_id: string; employee_code: string }, emps: Employee[], user: { id: string; username: string; employee_id: string }): boolean {
  const slipCode = (p.employee_code || '').trim().toUpperCase(), slipEmpId = (p.employee_id || '').trim().toUpperCase();
  for (const emp of emps) {
    const empCode = emp.employee_code.trim().toUpperCase();
    if (p.employee_id === emp.id || (empCode && (slipEmpId === empCode || slipCode === empCode))) return true;
  }
  const uCode = (user.employee_id || '').trim().toUpperCase(), uname = (user.username || '').trim().toUpperCase();
  return Boolean((uCode && (p.employee_id === user.employee_id || slipEmpId === uCode || slipCode === uCode)) || (uname && slipCode === uname));
}

export async function payslipRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/payroll/periods/:id/payslips', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay') }, async (request) => {
    const { id } = request.params as { id: string };
    await ensurePublishedPeriodPayslips(ctx, request.auth?.user.id ?? 'system');
    const items = ctx.db.payslips.filter((p) => p.period_id === id).sort((a, b) => a.employee_code.localeCompare(b.employee_code) || a.revision - b.revision);
    return sendSuccess(request, 'Lấy danh sách phiếu lương của kỳ thành công', items.map((p) => mapPayslipWithTicket(ctx, p)));
  });

  app.post('/api/admin/payroll/periods/:id/notify-payslips', { preHandler: requirePermission('payroll.publish', 'payroll.manage', 'payroll.pay', 'system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const period = ctx.db.payPeriods.get(id);
    if (!period) throw Errors.notFound('Không tìm thấy kỳ lương');
    if (period.status !== 'PUBLISHED' && period.status !== 'PAID') {
      throw Errors.badRequest('Chỉ gửi thông báo & Email phiếu lương cho kỳ đã Phát hành hoặc Đã thanh toán');
    }
    const slips = await generatePayslips(ctx, period, request.auth!.user.id, {
      actorEmail: request.auth?.user.email,
      isPaid: period.status === 'PAID',
      forceEmail: true,
    });
    return sendSuccess(request, `Đã đồng bộ phiếu lương và gửi thông báo kèm Email cho ${slips.length} nhân sự trong kỳ ${period.name}`, { count: slips.length });
  });

  app.get('/api/admin/payroll/payslips/:id/revisions', { preHandler: requirePermission('payroll.read', 'payroll.manage', 'payroll.publish', 'payroll.pay') }, async (request) => {
    const { id } = request.params as { id: string };
    const slip = ctx.db.payslips.get(id) ?? ctx.db.payslips.find((p) => p.snapshot_id === id && p.status !== 'REVISED') ?? ctx.db.payslips.find((p) => p.snapshot_id === id);
    const snap = ctx.db.payrollSnapshots.get(id) ?? (slip ? ctx.db.payrollSnapshots.get(slip.snapshot_id) : undefined);
    const periodId = slip?.period_id ?? snap?.period_id;
    const employeeId = slip?.employee_id ?? snap?.employee_id;
    if (!periodId || !employeeId) return sendSuccess(request, 'Chưa có lịch sử điều chỉnh phiếu lương', []);
    const revs = ctx.db.payslipRevisions
      .filter((r) => r.period_id === periodId && (r.employee_id === employeeId || Boolean(snap && r.employee_id === snap.employee_code)))
      .sort((a, b) => a.revision - b.revision);
    return sendSuccess(request, 'Lấy lịch sử điều chỉnh phiếu lương thành công', revs);
  });

  app.post('/api/admin/payroll/payslips/:id/revisions', { preHandler: requirePermission('payroll.manage', 'system.config') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = zRevisionBody.parse(request.body);
    const out = await applyPayslipAdjustment(ctx, id, body, request.auth!.user.id, request.auth?.user.email);
    await ctx.audit.record(auditContext(request), { action: 'payslip.revision', entity: out.entity, entityId: out.entityId, before: out.before, after: out.after });
    reply.code(201);
    return sendSuccess(request, out.message, out.data);
  });

  app.get('/api/me/payslips', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    if (q.refresh === '1' || q.refresh === 'true') {
      await Promise.all([ctx.db.payPeriods.load(), ctx.db.payrollSnapshots.load(), ctx.db.payslips.load(), ctx.db.employees.load(), ctx.db.users.load()]);
    }
    const user = request.auth!.user;
    await ensurePublishedPeriodPayslips(ctx, user.id);
    const emps = findAllLinkedEmployeesForUser(user, ctx);
    if (emps.length === 0 && !user.employee_id) return sendSuccess(request, 'Chưa có hồ sơ nhân sự gắn với tài khoản', []);
    const visiblePeriods = new Set(ctx.db.payPeriods.filter((p) => p.status === 'PUBLISHED' || p.status === 'PAID').map((p) => p.id));
    const seenPeriods = new Set<string>();
    const items = ctx.db.payslips
      .filter((p) => p.status !== 'REVISED' && visiblePeriods.has(p.period_id) && isOwnPayslip(p, emps, user))
      .sort((a, b) => b.from_date.localeCompare(a.from_date) || b.net_vnd - a.net_vnd || b.revision - a.revision)
      .filter((p) => (seenPeriods.has(p.period_id) ? false : (seenPeriods.add(p.period_id), true)));
    return sendSuccess(request, 'Lấy danh sách phiếu lương cá nhân thành công', items.map((p) => mapPayslipWithTicket(ctx, p)));
  });

  app.get('/api/me/payslips/:id', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.auth!.user, emps = findAllLinkedEmployeesForUser(user, ctx);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!isOwnPayslip(slip, emps, user)) throw Errors.forbidden('Bạn chỉ được xem phiếu lương của chính mình');
    const period = ctx.db.payPeriods.get(slip.period_id);
    if (!period || (period.status !== 'PUBLISHED' && period.status !== 'PAID')) throw Errors.forbidden('Phiếu lương chưa được phát hành');
    return sendSuccess(request, 'Lấy chi tiết phiếu lương thành công', mapPayslipWithTicket(ctx, slip));
  });

  app.post('/api/me/payslips/:id/confirm', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.auth!.user, emps = findAllLinkedEmployeesForUser(user, ctx);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!isOwnPayslip(slip, emps, user)) throw Errors.forbidden('Bạn chỉ được xác nhận phiếu lương của chính mình');
    const now = nowIso();
    const updated = await ctx.db.payslips.update(slip.id, slip.version, { viewed_by_employee_at: slip.viewed_by_employee_at || now, employee_confirmed_at: now, dispute_status: 'NONE' }, user.id);
    const openTck = ctx.db.supportTickets.find((t) => t.related_entity_type === 'PAYSLIP' && t.related_entity_id === slip.id && t.status !== 'CLOSED');
    if (openTck) {
      await ctx.db.supportTickets.update(openTck.id, openTck.version, { status: 'CLOSED', closed_at: now, resolved_by: openTck.resolved_by || user.id, resolved_at: openTck.resolved_at || now }, user.id);
      await ensureSyncedNotifications(ctx);
    }
    return sendSuccess(request, 'Đã xác nhận đồng ý phiếu lương thành công', mapPayslipWithTicket(ctx, updated));
  });

  app.post('/api/me/payslips/:id/dispute', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      reason: z.string({ required_error: 'Lý do thắc mắc phiếu lương là bắt buộc' }).trim().min(5, 'Lý do thắc mắc phiếu lương tối thiểu 5 ký tự'),
      target_department: z.enum(TICKET_DEPARTMENTS).optional().default('FINANCE'),
      assignee_user_id: z.string().optional().default(''),
    }).parse(request.body);
    validateAssigneeForDepartment(ctx, body.target_department, body.assignee_user_id);
    const user = request.auth!.user, emps = findAllLinkedEmployeesForUser(user, ctx);
    const slip = ctx.db.payslips.get(id);
    if (!slip) throw Errors.notFound('Không tìm thấy phiếu lương');
    if (!isOwnPayslip(slip, emps, user)) throw Errors.forbidden('Bạn chỉ được gửi phản hồi cho phiếu lương của chính mình');
    const updated = await ctx.db.payslips.update(slip.id, slip.version, { viewed_by_employee_at: slip.viewed_by_employee_at || nowIso(), dispute_status: 'OPEN', dispute_reason: body.reason }, user.id);
    const ticket = await upsertPayslipDisputeTicket(ctx, updated, user, { reason: body.reason, targetDepartment: body.target_department, assigneeUserId: body.assignee_user_id });
    await ensureSyncedNotifications(ctx);
    emitAndEmailTicketEvent(ctx, ticket, 'CREATED', user.id, body.reason);
    await ctx.audit.record(auditContext(request), { action: 'ticket.create', entity: 'SUPPORT_TICKETS', entityId: ticket.id, after: { payslipId: slip.id, code: ticket.ticket_code, dept: ticket.target_department, assignee: ticket.assignee_user_id } });
    return sendSuccess(request, 'Đã tạo phiếu hỗ trợ và gửi thắc mắc phiếu lương tới đúng bộ phận phụ trách', mapPayslipWithTicket(ctx, updated));
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
