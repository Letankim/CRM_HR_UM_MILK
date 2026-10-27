import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone, zListQueryBase } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { resolveShiftLabel, resolveStaffGroupLabel } from './employee-mapper.js';
import { interviewRoutes } from './interviews.routes.js';
import { testBankRoutes } from './test-bank.routes.js';

const zCandidateListQuery = zListQueryBase.extend({
  branch_id: z.string().trim().optional(),
  status: z.string().trim().optional(),
  staff_group: z.string().trim().optional(),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

const zCreateCandidateBody = z.object({
  full_name: z.string().trim().min(2, 'Họ tên ứng viên tối thiểu 2 ký tự'),
  phone: z.string().trim().min(9),
  email: z.string().trim().email('Email ứng viên không hợp lệ').or(z.literal('')).optional().default(''),
  applied_branch_id: z.string().trim().optional(),
  branch_pref: z.string().trim().optional(),
  applied_position: z.string().optional(),
  staff_group: z.string().default('BARISTA'),
  shift_pref: z.string().default('CA_SANG'),
  birth_year: z.string().default('2003'),
  gender: z.string().default(''),
  experience_note: z.string().max(400).optional().default(''),
  source_channel: z.string().default('WEB'),
  hr_note: z.string().max(400).optional().default(''),
});

const zUpdateCandidateBody = z.object({
  version: z.coerce.number().int().min(1),
  full_name: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  branch_pref: z.string().trim().optional(),
  staff_group: z.string().optional(),
  shift_pref: z.string().optional(),
  birth_year: z.string().optional(),
  gender: z.string().optional(),
  experience_note: z.string().max(400).optional(),
  source_channel: z.string().optional(),
  status: z.enum(['NEW', 'CONTACTED', 'INTERVIEW_SCHEDULED', 'HIRED', 'REJECTED']).optional(),
  hr_note: z.string().max(400).optional(),
});

const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional() });

export async function recruitmentTestRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/candidates', { preHandler: requirePermission('candidate.manage', 'interview.manage') }, async (request) => {
    const query = zCandidateListQuery.parse(request.query);
    if (query.refresh === '1' || query.refresh === 'true') {
      await ctx.db.candidates.refreshIfIdle();
    }
    const items = ctx.db.candidates.all().map((c) => ({
      ...c,
      stage: c.status,
      branchName: ctx.db.branches.get(c.branch_pref)?.name ?? (c.branch_pref || 'Chưa chọn chi nhánh'),
      positionLabel: resolveStaffGroupLabel(ctx, c.staff_group, c.position),
      shiftPrefLabel: resolveShiftLabel(ctx, c.shift_pref, c.branch_pref),
    }));
    return sendPaginated(
      request,
      'Lấy danh sách ứng viên tuyển dụng thành công',
      paginateAndSort(items, {
        page: query.page,
        perPage: query.per_page,
        sortBy: query.sort_by,
        sortOrder: query.sort_order,
        defaultSortBy: 'created_at',
        defaultSortOrder: 'desc',
        allowedSortFields: ['created_at', 'full_name', 'status', 'candidate_code'],
        q: query.q,
        searchExtractor: (i) => [i.candidate_code, i.full_name, i.phone, i.email, i.branchName, i.positionLabel, i.hr_note],
        filters: {
          branch_id: query.branch_id,
          status: query.status,
          staff_group: query.staff_group,
        },
        filterPredicates: {
          branch_id: (item, val) => item.branch_pref === val,
          status: (item, val) => item.status === val,
          staff_group: (item, val) => item.staff_group === val,
        },
      }),
    );
  });

  app.post('/api/admin/candidates', { preHandler: requirePermission('candidate.manage') }, async (request, reply) => {
    const body = zCreateCandidateBody.parse(request.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Số điện thoại ứng viên không hợp lệ (10 số bắt đầu bằng 0)', body.phone);
    if (ctx.db.candidates.find((c) => c.phone === phone) || ctx.db.employees.find((e) => e.phone === phone)) {
      throw Errors.fieldValidation('phone', 'DUPLICATE_VALUE', `Số điện thoại ${phone} đã tồn tại trong danh sách ứng viên hoặc nhân sự`, body.phone);
    }
    if (body.email && (ctx.db.candidates.find((c) => c.email.trim().toLowerCase() === body.email.trim().toLowerCase()) || ctx.db.employees.find((e) => e.email.trim().toLowerCase() === body.email.trim().toLowerCase()))) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${body.email} đã tồn tại trong danh sách ứng viên hoặc nhân sự`, body.email);
    }
    const branchId = body.branch_pref || body.applied_branch_id || '';
    const staffGroup = body.applied_position || body.staff_group || 'BARISTA';
    const created = await ctx.db.candidates.insert({
      candidate_code: `UV${String(ctx.db.candidates.all(true).length + 1).padStart(4, '0')}`,
      source_row: `WEB-${Date.now()}`,
      full_name: body.full_name, phone, email: body.email,
      position: resolveStaffGroupLabel(ctx, staffGroup, staffGroup),
      staff_group: staffGroup, branch_pref: branchId, shift_pref: body.shift_pref,
      status: 'NEW', source_channel: body.source_channel, birth_year: body.birth_year, gender: body.gender,
      experience_note: body.experience_note, hr_note: body.hr_note, cv_file_id: '', assigned_hr_id: request.auth!.user.username, contacted_at: nowIso(),
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.create', entity: 'CANDIDATES', entityId: created.id, after: { candidate_code: created.candidate_code, full_name: created.full_name } });
    reply.code(201);
    return sendSuccess(request, 'Đã tiếp nhận hồ sơ ứng viên mới thành công', created);
  });

  app.put('/api/admin/candidates/:id', { preHandler: requirePermission('candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateCandidateBody.parse(request.body);
    const before = ctx.db.candidates.get(id);
    if (!before) throw Errors.notFound('Hồ sơ ứng viên', id);
    const phone = body.phone ? normalizePhone(body.phone) : before.phone;
    if (body.phone && !phone) throw Errors.fieldValidation('phone', 'INVALID_PHONE', 'Số điện thoại không hợp lệ', body.phone);
    if (body.phone && (ctx.db.candidates.find((c) => c.id !== id && c.phone === phone) || ctx.db.employees.find((e) => e.phone === phone))) {
      throw Errors.fieldValidation('phone', 'DUPLICATE_VALUE', `Số điện thoại ${phone} đã tồn tại ở hồ sơ khác`, body.phone);
    }
    if (body.email && (ctx.db.candidates.find((c) => c.id !== id && c.email.trim().toLowerCase() === body.email!.trim().toLowerCase()) || ctx.db.employees.find((e) => e.email.trim().toLowerCase() === body.email!.trim().toLowerCase()))) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${body.email} đã tồn tại ở hồ sơ khác`, body.email);
    }
    const staffGroup = body.staff_group ?? before.staff_group;
    const nextStatus = body.status ?? before.status;
    const updated = await ctx.db.candidates.update(id, body.version, {
      full_name: body.full_name ?? before.full_name, phone: phone || before.phone, email: body.email ?? before.email,
      branch_pref: body.branch_pref ?? before.branch_pref, staff_group: staffGroup,
      position: resolveStaffGroupLabel(ctx, staffGroup, before.position),
      shift_pref: body.shift_pref ?? before.shift_pref,
      birth_year: body.birth_year ?? before.birth_year,
      gender: body.gender ?? before.gender,
      experience_note: body.experience_note ?? before.experience_note,
      source_channel: body.source_channel ?? before.source_channel,
      status: nextStatus,
      contacted_at: nextStatus === 'CONTACTED' && !before.contacted_at ? nowIso() : before.contacted_at,
      hr_note: body.hr_note ?? before.hr_note,
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.update', entity: 'CANDIDATES', entityId: id, before: { status: before.status }, after: { status: updated.status } });
    return sendSuccess(request, 'Đã cập nhật hồ sơ ứng viên thành công', updated);
  });

  app.delete('/api/admin/candidates/:id', { preHandler: requirePermission('candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteBody.parse(request.body ?? {});
    const before = ctx.db.candidates.get(id);
    if (!before) throw Errors.notFound('Hồ sơ ứng viên', id);
    await ctx.db.candidates.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'candidate.delete', entity: 'CANDIDATES', entityId: id, before: { candidate_code: before.candidate_code, full_name: before.full_name } });
    return sendSuccess(request, 'Đã xóa hồ sơ ứng viên', { id });
  });

  await interviewRoutes(app, ctx);
  await testBankRoutes(app, ctx);
}
