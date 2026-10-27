import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_SHIFT_LABELS, EMPLOYEE_STAGE_LABELS, isEmployeeRole, SHIFT_ASSIGNMENT_STATUSES, SHIFT_ASSIGNMENT_STATUS_LABELS, zListQueryBase, type ShiftAssignment } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { dayjs, nowIso } from '../lib/time.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { assertDateNotLockedByPayroll, findLockedPayrollPeriodForDate } from '../services/salary-profile.service.js';
import { emitScheduleRealtime, findBranchShiftTemplate, healBranchConsistency, resolveEmployeeBranchId } from './account-employee-sync.js';
import { describePunctuality, parseHm } from './attendance-helpers.js';

const zScheduleQuery = zListQueryBase.extend({
  per_page: z.coerce.number().int().min(1, 'Số dòng mỗi trang tối thiểu là 1').max(1000, 'Số dòng mỗi trang tối đa là 1000').default(15),
  branch_id: z.string().max(64).optional(),
  shift_code: z.string().max(32).optional(),
  status: z.enum([...SHIFT_ASSIGNMENT_STATUSES, 'ALL'] as const).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

const zCreateScheduleBody = z.object({ employee_id: z.string({ required_error: 'Vui lòng chọn nhân sự' }).trim().min(1), branch_id: z.string().trim().optional(), work_date: z.string({ required_error: 'Ngày làm việc là bắt buộc' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày YYYY-MM-DD'), shift_code: z.string().trim().default('CA_SANG'), status: z.enum(SHIFT_ASSIGNMENT_STATUSES).default('PUBLISHED'), day_type: z.enum(['WORK', 'OFF', 'OT']).default('WORK'), scheduled_hours: z.coerce.number().min(0).max(24).optional(), note: z.string().trim().max(300).optional().default('') });
const zUpdateScheduleBody = z.object({ version: z.coerce.number().int().min(1), employee_id: z.string().trim().optional(), work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), shift_code: z.string().trim().optional(), status: z.enum(SHIFT_ASSIGNMENT_STATUSES).optional(), day_type: z.enum(['WORK', 'OFF', 'OT']).optional(), scheduled_hours: z.coerce.number().min(0).max(24).optional(), note: z.string().trim().max(300).optional() });
const zBulkScheduleBody = z.object({ action: z.enum(['PUBLISH', 'DELETE']), items: z.array(z.object({ id: z.string().min(1), version: z.coerce.number().int().min(1) })).min(1).max(100) });

export function mapShiftAssignment(
  a: ShiftAssignment,
  ctx: AppContext,
  shiftEvents?: { inHm?: string; inLateMins?: number; hasOut?: boolean },
) {
  const emp = ctx.db.employees.get(a.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === a.employee_id);
  const findBranch = (raw?: string) => raw ? (ctx.db.branches.get(raw) ?? ctx.db.branches.find((b) => b.code === raw)) : undefined;
  const effectiveBranchId = resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id);
  const branch = findBranch(effectiveBranchId) ?? findBranch(a.branch_id);
  const empBranch = findBranch(emp?.branch_id) ?? branch;
  const tpl = findBranchShiftTemplate(ctx, a.shift_code, branch?.id ?? a.branch_id);
  const startAt = a.start_at || tpl?.start_time || '07:00';
  const endAt = a.end_at || tpl?.end_time || '12:00';

  let attendanceStatusLabel = 'Chưa điểm danh';
  let attendanceStatusColor = 'default';
  if (a.status === 'DRAFT') {
    attendanceStatusLabel = 'Chờ CH / HR duyệt phân ca';
    attendanceStatusColor = 'gold';
  } else if (a.status === 'ABSENT') {
    attendanceStatusLabel = 'Vắng mặt (Quá giờ ca — Cần bổ sung công)';
    attendanceStatusColor = 'red';
  } else if (a.status === 'COMPLETED' || (shiftEvents?.inHm && shiftEvents?.hasOut)) {
    attendanceStatusLabel = 'Đã hoàn thành ca';
    attendanceStatusColor = 'green';
  } else if (a.status === 'ON_LEAVE' || a.day_type === 'OFF') {
    attendanceStatusLabel = 'Nghỉ phép OFF';
    attendanceStatusColor = 'default';
  } else if (shiftEvents?.inHm) {
    const punc = describePunctuality('CHECK_IN', shiftEvents.inLateMins ?? 0, 0);
    attendanceStatusLabel = `Đã vào ca (${shiftEvents.inHm} · ${punc.punctualityLabel})`;
    attendanceStatusColor = punc.punctualityStatus === 'LATE' ? 'volcano' : 'processing';
  }

  const lockedPeriod = findLockedPayrollPeriodForDate(ctx.db, a.work_date);
  return {
    id: a.id, employeeId: emp?.id ?? a.employee_id, employeeCode: emp?.employee_code ?? a.employee_id,
    employeeName: emp?.full_name ?? 'Nhân sự đã xóa', employeeStage: a.employee_stage,
    employeeStageLabel: EMPLOYEE_STAGE_LABELS[a.employee_stage] ?? a.employee_stage,
    branchId: branch?.id ?? a.branch_id, branchName: branch?.name ?? 'Chi nhánh',
    branchLat: branch?.lat ?? null, branchLng: branch?.lng ?? null,
    branchRadiusM: branch?.radius_m ?? 100, branchMaxAccuracyM: branch?.max_accuracy_m ?? 150,
    employeeBranchId: empBranch?.id ?? emp?.branch_id ?? a.branch_id, employeeBranchName: empBranch?.name ?? branch?.name ?? 'Chi nhánh',
    workDate: a.work_date, shiftCode: a.shift_code,
    shiftLabel: tpl?.name ?? DEFAULT_SHIFT_LABELS[a.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? a.shift_code,
    startAt, endAt, scheduledHours: a.scheduled_hours, dayType: a.day_type, status: a.status,
    statusLabel: SHIFT_ASSIGNMENT_STATUS_LABELS[a.status], publishedAt: a.published_at || null,
    attendanceStatusLabel, attendanceStatusColor,
    isLockedByPayroll: Boolean(lockedPeriod), lockedByPeriodCode: lockedPeriod?.period_code ?? null,
    note: a.note, version: a.version, created_at: a.created_at, updated_at: a.updated_at,
  };
}

export async function scheduleRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/schedules', { preHandler: requirePermission('schedule.read', 'employee.read', 'self.schedule') }, async (request) => {
    const query = zScheduleQuery.parse(request.query);
    if (query.branch_id && query.branch_id !== 'ALL') assertBranchAccess(request, query.branch_id);
    if (query.refresh === '1' || query.refresh === 'true') {
      await Promise.all([ctx.db.shiftAssignments.refreshIfIdle(), ctx.db.employees.refreshIfIdle(), ctx.db.shiftTemplates.refreshIfIdle(), ctx.db.attendanceEvents.refreshIfIdle()]);
    }
    await healBranchConsistency(ctx);

    let scoped = filterByBranch(request, ctx.db.shiftAssignments.all(), (a) => resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id));
    if (isEmployeeRole(request.auth!.user.role)) {
      scoped = scoped.filter((a) => a.status !== 'DRAFT');
    }
    if (query.from_date) scoped = scoped.filter((a) => a.work_date >= query.from_date!);
    if (query.to_date) scoped = scoped.filter((a) => a.work_date <= query.to_date!);

    const evMap = new Map<string, { inHm?: string; inLateMins?: number; hasOut?: boolean }>();
    for (const ev of ctx.db.attendanceEvents.all()) {
      if (!ev.assignment_id) continue;
      const cur = evMap.get(ev.assignment_id) ?? {};
      if (ev.type === 'CHECK_OUT') cur.hasOut = true;
      else if (!cur.inHm) {
        const hm = dayjs(ev.server_time).format('HH:mm');
        cur.inHm = hm;
        cur.inLateMins = ev.late_minutes || Math.max(0, parseHm(hm) - parseHm(ev.scheduled_time || '07:00'));
      }
      evMap.set(ev.assignment_id, cur);
    }

    const mapped = scoped.map((a) => mapShiftAssignment(a, ctx, evMap.get(a.id)));
    const draftCount = mapped.filter((m) => m.status === 'DRAFT' && (!query.branch_id || query.branch_id === 'ALL' || m.branchId === query.branch_id)).length;
    const result = paginateAndSort(mapped, {
      page: query.page, perPage: query.per_page, maxPerPage: 1000, sortBy: query.sort_by, sortOrder: query.sort_order,
      defaultSortBy: 'workDate', defaultSortOrder: 'desc', allowedSortFields: ['workDate', 'employeeCode', 'employeeName', 'shiftCode', 'scheduledHours', 'created_at'],
      q: query.q, searchExtractor: (item) => [item.employeeCode, item.employeeName, item.branchName, item.shiftLabel, item.workDate, item.note],
      filters: { branch_id: query.branch_id, shift_code: query.shift_code, status: query.status },
      filterPredicates: { branch_id: (item, val) => item.branchId === val, shift_code: (item, val) => item.shiftCode === val },
    });
    result.meta.filters.draft_count = String(draftCount);
    return sendPaginated(request, 'Lấy danh sách lịch phân ca thành công', result);
  });

  app.post('/api/admin/schedules', { preHandler: requirePermission('schedule.propose', 'schedule.publish') }, async (request, reply) => {
    const body = zCreateScheduleBody.parse(request.body);
    assertDateNotLockedByPayroll(ctx.db, body.work_date, 'phân ca mới');
    const emp = ctx.db.employees.get(body.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === body.employee_id);
    if (!emp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy hồ sơ nhân sự được chọn', body.employee_id);
    const branchId = body.branch_id || emp.branch_id;
    assertBranchAccess(request, branchId);

    if (body.day_type !== 'OFF' && body.status !== 'ON_LEAVE') {
      const approvedLeave = ctx.db.leaveRequests.find((l) => (l.employee_id === emp.id || l.employee_id === emp.employee_code) && l.leave_date === body.work_date && l.status === 'APPROVED');
      if (approvedLeave) throw Errors.fieldValidation('work_date', 'DUPLICATE_VALUE', `Nhân sự ${emp.full_name} (${emp.employee_code}) đã có đơn xin nghỉ OFF được duyệt trong ngày ${body.work_date}, không thể phân ca làm việc trùng ngày nghỉ.`, body.work_date);
    }
    const conflict = ctx.db.shiftAssignments.find((a) => a.employee_id === emp.id && a.work_date === body.work_date && a.shift_code === body.shift_code);
    if (conflict) throw Errors.fieldValidation('shift_code', 'DUPLICATE_VALUE', `Nhân sự ${emp.full_name} đã được phân ca này trong ngày ${body.work_date}`, body.shift_code);

    const tpl = findBranchShiftTemplate(ctx, body.shift_code, branchId);
    const created = await ctx.db.shiftAssignments.insert({
      schedule_week_id: `WK-${body.work_date.slice(0, 7)}`, employee_id: emp.id, branch_id: branchId, work_date: body.work_date,
      shift_template_id: tpl?.id ?? '', start_at: tpl?.start_time ?? '07:00', end_at: tpl?.end_time ?? '12:00', status: body.status,
      source: 'MANUAL', employee_stage: emp.stage, day_type: body.day_type, shift_code: body.shift_code,
      scheduled_hours: body.scheduled_hours ?? (body.day_type === 'OFF' ? 0 : tpl?.standard_hours ?? 5),
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: body.status === 'PUBLISHED' ? nowIso() : '', note: body.note,
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'schedule.create', entity: 'SHIFT_ASSIGNMENTS', entityId: created.id, after: { employee_id: emp.employee_code, work_date: created.work_date, shift_code: created.shift_code, status: created.status } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId, employeeIds: [emp.id], kind: 'SHIFT_ASSIGNED', message: `Đã phân ca ngày ${created.work_date} cho ${emp.full_name}`, actorId: request.auth!.user.id });
    reply.code(201);
    return sendSuccess(request, 'Đã thêm phân công ca làm việc thành công', mapShiftAssignment(created, ctx));
  });

  app.put('/api/admin/schedules/:id', { preHandler: requirePermission('schedule.propose', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateScheduleBody.parse(request.body);
    const before = ctx.db.shiftAssignments.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy bản ghi phân ca');
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.work_date, 'chỉnh sửa ca làm việc');
    if (body.work_date && body.work_date !== before.work_date) assertDateNotLockedByPayroll(ctx.db, body.work_date, 'chuyển ca làm việc sang ngày');

    const { version, ...patch } = body;
    const nextEmp = patch.employee_id ? (ctx.db.employees.get(patch.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === patch.employee_id)) : undefined;
    if (patch.employee_id && !nextEmp) throw Errors.fieldValidation('employee_id', 'INVALID_VALUE', 'Không tìm thấy hồ sơ nhân sự được chọn', patch.employee_id);
    if (nextEmp) assertBranchAccess(request, nextEmp.branch_id);
    const targetEmp = nextEmp ?? ctx.db.employees.get(before.employee_id) ?? ctx.db.employees.find((e) => e.employee_code === before.employee_id);
    const targetDate = patch.work_date ?? before.work_date;
    if ((patch.day_type ?? before.day_type) !== 'OFF' && (patch.status ?? before.status) !== 'ON_LEAVE' && targetEmp) {
      const approvedLeave = ctx.db.leaveRequests.find((l) => (l.employee_id === targetEmp.id || l.employee_id === targetEmp.employee_code) && l.leave_date === targetDate && l.status === 'APPROVED');
      if (approvedLeave) throw Errors.fieldValidation('work_date', 'DUPLICATE_VALUE', `Nhân sự ${targetEmp.full_name} (${targetEmp.employee_code}) đã có đơn xin nghỉ OFF được duyệt trong ngày ${targetDate}, không thể xếp ca làm việc trùng ngày nghỉ.`, targetDate);
    }
    const tpl = patch.shift_code ? findBranchShiftTemplate(ctx, patch.shift_code, nextEmp?.branch_id ?? before.branch_id) : undefined;
    const updated = await ctx.db.shiftAssignments.update(id, version, {
      ...patch,
      ...(nextEmp ? { employee_id: nextEmp.id, branch_id: nextEmp.branch_id, employee_stage: nextEmp.stage } : {}),
      ...(tpl ? { start_at: tpl.start_time, end_at: tpl.end_time, shift_template_id: tpl.id } : {}),
      ...(patch.status === 'PUBLISHED' && !before.published_at ? { published_at: nowIso() } : {}),
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'schedule.update', entity: 'SHIFT_ASSIGNMENTS', entityId: id, before: { shift_code: before.shift_code, status: before.status }, after: { shift_code: updated.shift_code, status: updated.status } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: updated.branch_id, employeeIds: [before.employee_id, updated.employee_id], kind: before.status === 'DRAFT' && updated.status === 'PUBLISHED' ? 'SHIFT_APPROVED' : 'SHIFT_UPDATED', message: before.status === 'DRAFT' && updated.status === 'PUBLISHED' ? `Ca làm ngày ${updated.work_date} đã được duyệt phát hành chính thức` : '', actorId: request.auth!.user.id });
    return sendSuccess(request, 'Cập nhật phân công ca làm việc thành công', mapShiftAssignment(updated, ctx));
  });

  app.delete('/api/admin/schedules/:id', { preHandler: requirePermission('schedule.propose', 'schedule.publish') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.shiftAssignments.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy bản ghi phân ca');
    assertBranchAccess(request, resolveEmployeeBranchId(ctx, before.employee_id, before.branch_id));
    assertDateNotLockedByPayroll(ctx.db, before.work_date, 'xóa ca làm việc');
    await ctx.db.shiftAssignments.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'schedule.delete', entity: 'SHIFT_ASSIGNMENTS', entityId: id, before: { work_date: before.work_date, shift_code: before.shift_code } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: before.branch_id, employeeIds: [before.employee_id], kind: 'SHIFT_DELETED', actorId: request.auth!.user.id });
    return sendSuccess(request, 'Đã xóa phân công ca làm việc', { id });
  });

  app.post('/api/admin/schedules/bulk-action', { preHandler: requirePermission('schedule.publish', 'schedule.propose') }, async (request) => {
    const body = zBulkScheduleBody.parse(request.body), actorId = request.auth!.user.id, pubAt = nowIso();
    const processedIds: string[] = [], empIds = new Set<string>(), patches: { id: string; expectedVersion: number; patch: Partial<ShiftAssignment> }[] = [];
    let lastBranchId = '';
    for (const item of body.items) {
      const a = ctx.db.shiftAssignments.get(item.id);
      if (!a) continue;
      lastBranchId = resolveEmployeeBranchId(ctx, a.employee_id, a.branch_id);
      assertBranchAccess(request, lastBranchId);
      assertDateNotLockedByPayroll(ctx.db, a.work_date, body.action === 'DELETE' ? 'xóa ca làm việc' : 'duyệt ca làm việc');
      patches.push({ id: a.id, expectedVersion: a.version, patch: body.action === 'DELETE' ? { is_deleted: true } : { status: 'PUBLISHED', published_at: pubAt } });
      processedIds.push(a.id);
      empIds.add(a.employee_id);
    }
    await ctx.db.shiftAssignments.batchUpdate(patches, actorId);
    await ctx.audit.record(auditContext(request), { action: body.action === 'DELETE' ? 'schedule.delete' : 'schedule.publish', entity: 'SHIFT_ASSIGNMENTS', entityId: `bulk-${processedIds.length}`, after: { action: body.action, processedIds } });
    emitScheduleRealtime(ctx, SocketEvents.SCHEDULE_PUBLISHED, { branchId: lastBranchId, employeeIds: Array.from(empIds), kind: body.action === 'PUBLISH' ? 'SHIFT_APPROVED' : 'SHIFT_DELETED', message: body.action === 'PUBLISH' ? `Đã phát hành chính thức ${processedIds.length} ca làm việc` : '', actorId });
    return sendSuccess(request, body.action === 'DELETE' ? `Đã xóa ${processedIds.length} ca làm việc` : `Đã phát hành chính thức ${processedIds.length} ca làm việc`, { processedCount: processedIds.length, processedIds });
  });
}
