import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BRANCH_STATUSES, BRANCH_STATUS_LABELS, zListQueryBase, type Branch, type ShiftTemplate, type StaffingRule } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';

const zBranchListQuery = zListQueryBase.extend({ status: z.enum([...BRANCH_STATUSES, 'ALL'] as const).optional(), refresh: z.enum(['0', '1', 'true', 'false']).optional() });
const zBranchBody = z.object({ code: z.string({ required_error: 'Mã chi nhánh là bắt buộc' }).trim().min(2).max(10), name: z.string({ required_error: 'Tên chi nhánh là bắt buộc' }).trim().min(2).max(100), address: z.string().trim().max(200).optional().default(''), lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radius_m: z.coerce.number().int().min(10).max(2000).default(100), max_accuracy_m: z.coerce.number().int().min(5).max(500).default(50), open_time: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'), close_time: z.string().regex(/^\d{2}:\d{2}$/).default('22:30'), phone_contact: z.string().trim().max(20).optional().default(''), effective_from: z.string().trim().optional().default(''), status: z.enum(BRANCH_STATUSES).default('ACTIVE'), note: z.string().trim().max(300).optional().default('') });
const zUpdateBranchBody = zBranchBody.partial().extend({ version: z.coerce.number().int().min(1) });
const zShiftTemplateBody = z.object({ code: z.string({ required_error: 'Mã ca là bắt buộc' }).trim().min(2).max(20), name: z.string({ required_error: 'Tên ca làm việc là bắt buộc' }).trim().min(2).max(60), branch_id: z.string().trim().optional().default('ALL'), start_time: z.string().regex(/^\d{2}:\d{2}$/), end_time: z.string().regex(/^\d{2}:\d{2}$/), standard_hours: z.coerce.number().min(0.5).max(24).default(5), break_minutes: z.coerce.number().int().min(0).default(0), effective_from: z.string().trim().optional().default(''), status: z.enum(BRANCH_STATUSES).default('ACTIVE'), note: z.string().trim().max(200).optional().default('') });
const zUpdateShiftBody = zShiftTemplateBody.partial().extend({ version: z.coerce.number().int().min(1) });
const zStaffingRuleBody = z.object({ branch_id: z.string().trim().default('ALL'), shift_template_id: z.string().trim().default('ALL'), min_staff: z.coerce.number().int().min(1).default(2), max_staff: z.coerce.number().int().min(1).default(6), enforcement: z.enum(['HARD_BLOCK', 'SOFT_WARN']).default('HARD_BLOCK'), effective_from: z.string().optional().default(''), day_of_week: z.string().default('ALL'), required_groups_json: z.string().default('["BARISTA"]'), note: z.string().default('') });

function mapBranch(b: Branch, ctx: AppContext) {
  const employeeCount = ctx.db.employees.filter((e) => e.branch_id === b.id && e.status === 'ACTIVE').length;
  return {
    id: b.id, code: b.code, name: b.name, address: b.address, lat: b.lat, lng: b.lng,
    radiusM: b.radius_m, maxAccuracyM: b.max_accuracy_m, timezone: b.timezone,
    openTime: b.open_time, closeTime: b.close_time, phoneContact: b.phone_contact,
    effectiveFrom: b.effective_from || '2026-01-01', status: b.status, statusLabel: BRANCH_STATUS_LABELS[b.status],
    employeeCount, note: b.note, version: b.version, created_at: b.created_at, updated_at: b.updated_at,
  };
}

function mapShift(s: ShiftTemplate, ctx: AppContext) {
  const isGlobal = !s.shift_group || s.shift_group === 'STORE' || s.shift_group === 'ALL';
  const branch = !isGlobal ? (ctx.db.branches.get(s.shift_group) ?? ctx.db.branches.find((b) => b.code === s.shift_group)) : undefined;
  return {
    id: s.id, code: s.code, name: s.name, startTime: s.start_time, endTime: s.end_time,
    standardHours: s.standard_hours, breakMinutes: s.break_minutes, effectiveFrom: s.effective_from || '2026-01-01',
    branchId: branch?.id ?? 'ALL', branchCode: branch?.code ?? 'ALL', branchName: branch ? `${branch.code} — ${branch.name}` : 'Tất cả chi nhánh',
    status: s.status, statusLabel: BRANCH_STATUS_LABELS[s.status], note: s.note,
    version: s.version, created_at: s.created_at, updated_at: s.updated_at,
  };
}

function mapStaffingRule(r: StaffingRule, ctx: AppContext) {
  const branch = r.branch_id && r.branch_id !== 'ALL' ? (ctx.db.branches.get(r.branch_id) ?? ctx.db.branches.find((b) => b.code === r.branch_id)) : undefined;
  const shift = r.shift_template_id && r.shift_template_id !== 'ALL' ? (ctx.db.shiftTemplates.get(r.shift_template_id) ?? ctx.db.shiftTemplates.find((s) => s.code === r.shift_template_id)) : undefined;
  return {
    ...r, branchId: branch?.id ?? 'ALL', branchCode: branch?.code ?? 'ALL',
    branchName: branch ? `${branch.code} — ${branch.name}` : 'Tất cả chi nhánh (Mặc định)',
    shiftName: shift ? `${shift.name} (${shift.start_time} – ${shift.end_time})` : (r.shift_template_id === 'ALL' ? 'Mọi khung ca làm việc' : r.shift_template_id),
    shiftTimeRange: shift ? `${shift.start_time} – ${shift.end_time}` : '',
  };
}

export async function branchRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/branches', { preHandler: requirePermission('employee.read', 'schedule.read', 'system.config', 'account.read') }, async (request) => {
    const query = zBranchListQuery.parse(request.query);
    if (query.refresh === '1' || query.refresh === 'true') {
      await Promise.all([ctx.db.branches.refreshIfIdle(), ctx.db.shiftTemplates.refreshIfIdle()]);
    }
    const scoped = filterByBranch(request, ctx.db.branches.all(), (b) => b.id);
    const mapped = scoped.map((b) => mapBranch(b, ctx));
    const result = paginateAndSort(mapped, {
      page: query.page,
      perPage: query.per_page,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
      defaultSortBy: 'code',
      defaultSortOrder: 'asc',
      allowedSortFields: ['code', 'name', 'radiusM', 'employeeCount', 'created_at', 'updated_at'],
      q: query.q,
      searchExtractor: (item) => [item.code, item.name, item.address, item.phoneContact],
      filters: { status: query.status },
    });
    return sendPaginated(request, 'Lấy danh sách chi nhánh thành công', result);
  });

  app.post('/api/admin/branches', { preHandler: requirePermission('system.config') }, async (request, reply) => {
    const body = zBranchBody.parse(request.body);
    const code = body.code.toUpperCase();
    if (ctx.db.branches.find((b) => b.code.toUpperCase() === code)) {
      throw Errors.fieldValidation('code', 'DUPLICATE_VALUE', 'Mã chi nhánh đã tồn tại', body.code);
    }
    const created = await ctx.db.branches.insert(
      { ...body, code, timezone: 'Asia/Ho_Chi_Minh', manager_employee_id: '', effective_from: body.effective_from || dayjs().format('YYYY-MM-DD') },
      request.auth!.user.id,
    );
    await ctx.audit.record(auditContext(request), { action: 'branch.create', entity: 'BRANCHES', entityId: created.id, after: { code: created.code, name: created.name } });
    reply.code(201);
    return sendSuccess(request, 'Thêm mới chi nhánh thành công', mapBranch(created, ctx));
  });

  app.put('/api/admin/branches/:id', { preHandler: requirePermission('system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateBranchBody.parse(request.body);
    const before = ctx.db.branches.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy chi nhánh');
    const { version, ...patch } = body;
    const updated = await ctx.db.branches.update(id, version, patch, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'branch.update', entity: 'BRANCHES', entityId: id, before: { lat: before.lat, lng: before.lng }, after: { lat: updated.lat, lng: updated.lng } });
    return sendSuccess(request, 'Cập nhật cấu hình chi nhánh và GPS thành công', mapBranch(updated, ctx));
  });

  app.delete('/api/admin/branches/:id', { preHandler: requirePermission('system.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.branches.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy chi nhánh');
    await ctx.db.branches.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'branch.delete', entity: 'BRANCHES', entityId: id, before: { code: before.code, name: before.name } });
    return sendSuccess(request, `Đã xóa chi nhánh ${before.name}`, { id });
  });

  app.get('/api/admin/shift-templates', { preHandler: requirePermission('schedule.read', 'system.config', 'employee.read') }, async (request) => {
    const scope = request.auth!.branchScope;
    const list = ctx.db.shiftTemplates.all().filter((s) => scope === 'ALL' || !s.shift_group || s.shift_group === 'ALL' || s.shift_group === 'STORE' || scope.includes(s.shift_group));
    return sendSuccess(request, 'Lấy danh sách mẫu ca làm việc thành công', list.map((s) => mapShift(s, ctx)));
  });

  app.post('/api/admin/shift-templates', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request, reply) => {
    const body = zShiftTemplateBody.parse(request.body);
    const code = body.code.toUpperCase();
    const shiftGroup = !body.branch_id || body.branch_id === 'ALL' || body.branch_id === 'STORE' ? 'STORE' : body.branch_id;
    if (shiftGroup !== 'STORE') assertBranchAccess(request, shiftGroup);
    if (ctx.db.shiftTemplates.find((s) => s.code.toUpperCase() === code && (s.shift_group || 'STORE') === shiftGroup)) {
      throw Errors.fieldValidation('code', 'DUPLICATE_VALUE', 'Mã ca làm việc đã tồn tại trong phạm vi chi nhánh này', body.code);
    }
    const { branch_id: _, ...rest } = body;
    const created = await ctx.db.shiftTemplates.insert(
      { ...rest, code, effective_from: body.effective_from || dayjs().format('YYYY-MM-DD'), effective_to: '', shift_group: shiftGroup, is_overnight: false },
      request.auth!.user.id,
    );
    await ctx.audit.record(auditContext(request), { action: 'shift_template.create', entity: 'SHIFT_TEMPLATES', entityId: created.id, after: { code: created.code, shift_group: shiftGroup } });
    reply.code(201);
    return sendSuccess(request, 'Thêm mẫu ca làm việc thành công', mapShift(created, ctx));
  });

  app.put('/api/admin/shift-templates/:id', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateShiftBody.parse(request.body);
    const before = ctx.db.shiftTemplates.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy mẫu ca làm việc');
    const { version, branch_id, ...patch } = body;
    const shiftGroup = branch_id !== undefined ? (!branch_id || branch_id === 'ALL' || branch_id === 'STORE' ? 'STORE' : branch_id) : undefined;
    if (shiftGroup && shiftGroup !== 'STORE') assertBranchAccess(request, shiftGroup);
    const updated = await ctx.db.shiftTemplates.update(id, version, { ...patch, ...(shiftGroup ? { shift_group: shiftGroup } : {}) }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'shift_template.update', entity: 'SHIFT_TEMPLATES', entityId: id, before: { name: before.name, start_time: before.start_time, end_time: before.end_time }, after: { name: updated.name, start_time: updated.start_time, end_time: updated.end_time } });
    return sendSuccess(request, 'Cập nhật mẫu ca làm việc thành công', mapShift(updated, ctx));
  });

  app.delete('/api/admin/shift-templates/:id', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.shiftTemplates.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy mẫu ca làm việc');
    await ctx.db.shiftTemplates.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'shift_template.delete', entity: 'SHIFT_TEMPLATES', entityId: id, before: { code: before.code } });
    return sendSuccess(request, `Đã xóa mẫu ca ${before.name}`, { id });
  });

  app.get('/api/admin/staffing-rules', { preHandler: requirePermission('schedule.read', 'system.config', 'employee.read') }, async (request) => {
    const scope = request.auth!.branchScope;
    const rawRules = ctx.db.staffingRules.all().filter((r) => scope === 'ALL' || r.branch_id === 'ALL' || scope.includes(r.branch_id));
    return sendSuccess(request, 'Lấy danh sách định biên nhân sự theo ca thành công', rawRules.map((r) => mapStaffingRule(r, ctx)));
  });

  app.post('/api/admin/staffing-rules', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request, reply) => {
    const body = zStaffingRuleBody.parse(request.body);
    if (body.branch_id !== 'ALL') assertBranchAccess(request, body.branch_id);
    if (body.max_staff < body.min_staff) {
      throw Errors.fieldValidation('max_staff', 'OUT_OF_RANGE', 'Số nhân sự tối đa phải lớn hơn hoặc bằng số nhân sự tối thiểu', body.max_staff);
    }
    if (ctx.db.staffingRules.find((r) => r.branch_id === body.branch_id && r.shift_template_id === body.shift_template_id)) {
      throw Errors.fieldValidation('shift_template_id', 'DUPLICATE_VALUE', 'Chi nhánh này đã có cấu hình định biên cho khung ca đã chọn. Vui lòng chỉnh sửa định biên hiện có.', body.shift_template_id);
    }
    const created = await ctx.db.staffingRules.insert(
      { ...body, effective_from: body.effective_from || dayjs().format('YYYY-MM-DD'), approved_by: request.auth!.user.display_name || request.auth!.user.username },
      request.auth!.user.id,
    );
    await ctx.audit.record(auditContext(request), { action: 'staffing_rule.create', entity: 'STAFFING_RULES', entityId: created.id, after: { branch_id: created.branch_id, min_staff: created.min_staff, max_staff: created.max_staff } });
    reply.code(201);
    return sendSuccess(request, 'Đã lưu cấu hình định biên nhân sự theo ca thành công', mapStaffingRule(created, ctx));
  });

  app.put('/api/admin/staffing-rules/:id', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zStaffingRuleBody.partial().extend({ version: z.coerce.number().int().min(1).optional() }).parse(request.body);
    const before = ctx.db.staffingRules.get(id);
    if (!before) throw Errors.notFound('Định biên ca làm', id);
    const nextBranch = body.branch_id ?? before.branch_id;
    const nextShift = body.shift_template_id ?? before.shift_template_id;
    const nextMin = body.min_staff ?? before.min_staff;
    const nextMax = body.max_staff ?? before.max_staff;
    if (nextBranch !== 'ALL') assertBranchAccess(request, nextBranch);
    if (nextMax < nextMin) {
      throw Errors.fieldValidation('max_staff', 'OUT_OF_RANGE', 'Số nhân sự tối đa phải lớn hơn hoặc bằng số nhân sự tối thiểu', nextMax);
    }
    if (ctx.db.staffingRules.find((r) => r.id !== id && r.branch_id === nextBranch && r.shift_template_id === nextShift)) {
      throw Errors.fieldValidation('shift_template_id', 'DUPLICATE_VALUE', 'Chi nhánh này đã có cấu hình định biên cho khung ca đã chọn', nextShift);
    }
    const { version, ...patch } = body;
    const updated = await ctx.db.staffingRules.update(id, version ?? before.version, patch, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'staffing_rule.update', entity: 'STAFFING_RULES', entityId: id, before: { branch_id: before.branch_id, min_staff: before.min_staff, max_staff: before.max_staff }, after: { branch_id: updated.branch_id, min_staff: updated.min_staff, max_staff: updated.max_staff } });
    return sendSuccess(request, 'Đã cập nhật cấu hình định biên nhân sự theo ca thành công', mapStaffingRule(updated, ctx));
  });

  app.delete('/api/admin/staffing-rules/:id', { preHandler: requirePermission('system.config', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const before = ctx.db.staffingRules.get(id);
    if (!before) throw Errors.notFound('Định biên ca làm', id);
    if (before.branch_id !== 'ALL') assertBranchAccess(request, before.branch_id);
    await ctx.db.staffingRules.softDelete(id, before.version, request.auth!.user.id);
    return sendSuccess(request, 'Đã xóa cấu hình định biên ca làm việc', { id });
  });
}
