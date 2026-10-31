import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_SHIFT_CODES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, PIN_REGEX, STAFF_GROUPS, isEmployeeRole, normalizePhone, type Employee, type User } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { hashSecret } from '../auth/password.js';
import { DEMO_PIN } from '../data/memory-seed.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { assertBranchAccess, auditContext, requirePermission } from '../plugins/auth-context.js';
import { queueAccountCreatedEmail, queueAccountUpdatedEmail, queuePromotionOfficialEmail } from '../services/action-email-dispatcher.js';
import { recalculateOpenPeriods } from '../services/payroll-snapshot.service.js';
import { currentProfile, isProfileLocked, profilesOf, today } from '../services/salary-profile.service.js';
import { assertAmountInRange, createSalaryProfile } from '../services/salary-profile.writer.js';
import { cascadeEmployeeBranchChange, syncAccountFromEmployee } from './account-employee-sync.js';
import { buildEmployeeDossierSummary } from './employee-dossier-summary.js';
import { assertUniquePersonalIdentifiers, findLinkedUserForEmployee, mapEmployeeRecord } from './employee-mapper.js';
import { zSalaryProfileFields } from './salary-profile.schemas.js';

const zUpdateEmployeeBody = z.object({
  version: z.coerce.number().int().min(1),
  full_name: z.string().trim().min(2).max(80).optional(), phone_number: z.string().trim().optional(),
  email: z.string().trim().email('Định dạng địa chỉ email không hợp lệ').or(z.literal('')).optional(),
  date_of_birth: z.string().trim().optional(), gender: z.string().trim().max(20).optional(),
  citizen_id: z.string().trim().max(20).optional(), citizen_issue_date: z.string().trim().optional(),
  permanent_address: z.string().trim().max(200).optional(), current_address: z.string().trim().max(200).optional(),
  emergency_contact_name: z.string().trim().max(80).optional(), emergency_contact_phone: z.string().trim().max(20).optional(),
  tax_code: z.string().trim().max(30).optional(), resigned_at: z.string().trim().optional(), resign_reason: z.string().trim().max(300).optional(),
  branch_id: z.string().trim().min(1).optional(), staff_group: z.string().trim().min(1).optional(), stage: z.enum(['PROBATION', 'OFFICIAL']).optional(), position_title: z.string().trim().max(60).optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).optional(), default_shift_code: z.string().trim().min(1).max(40).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(), probation_start: z.string().trim().optional(), probation_end: z.string().trim().optional(),
  salary: zSalaryProfileFields.optional(), bank_name: z.string().trim().max(60).optional(),
  bank_account_number: z.string().trim().max(40).optional(), bank_account_holder: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(), link_user_id: z.string().trim().optional(),
  create_account: z.boolean().optional(), username: z.string().trim().max(32).optional(),
  initial_pin: z.string().trim().min(6, 'Mã PIN đăng nhập phải gồm đúng 6 chữ số').max(128).or(z.literal('')).optional(),
});

const zPromoteOfficialBody = z.object({
  version: z.coerce.number().int().min(1),
  official_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày hiệu lực chính thức phải theo định dạng YYYY-MM-DD').optional(),
  evaluation_summary: z.string().trim().max(300).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
});

const zBulkEmployeeActionBody = z.object({
  action: z.enum(['PROMOTE_OFFICIAL', 'DELETE']),
  official_from: z.string().optional(),
  items: z.array(z.object({ id: z.string().min(1), version: z.coerce.number().int().min(1) })).min(1).max(50),
});

export async function employeeActionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.put('/api/admin/employees/:id', { preHandler: requirePermission('employee.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateEmployeeBody.parse(request.body);
    const before = ctx.db.employees.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, before.branch_id);

    const { version, phone_number, link_user_id, create_account, username, initial_pin, salary, ...rest } = body;
    if (salary) assertAmountInRange(salary.rate_type, salary.amount_vnd);
    const actorId = request.auth!.user.id;
    let phone = before.phone;
    if (phone_number !== undefined) {
      const normalized = normalizePhone(phone_number);
      if (!normalized) throw Errors.fieldValidation('phone_number', 'INVALID_PHONE', 'Số điện thoại phải gồm 10 chữ số bắt đầu bằng số 0', phone_number);
      phone = normalized;
    }

    let nextUserId = before.user_id;
    const prevLinkedUser = findLinkedUserForEmployee(before, ctx);
    assertUniquePersonalIdentifiers(ctx, {
      phone: phone_number !== undefined ? phone : undefined, phoneField: 'phone_number',
      email: rest.email || undefined, citizen_id: rest.citizen_id || undefined,
      tax_code: rest.tax_code || undefined, bank_account_number: rest.bank_account_number || undefined,
      username: create_account && !prevLinkedUser ? (username || `nv.${before.employee_code.toLowerCase()}`).toLowerCase() : undefined,
      excludeEmployeeId: id, excludeUserId: link_user_id || prevLinkedUser?.id || null,
    });
    const targetAccForPin = create_account && !prevLinkedUser ? undefined : (link_user_id === '' ? undefined : link_user_id ? ctx.db.users.get(link_user_id) : prevLinkedUser);
    if (initial_pin && (!targetAccForPin || isEmployeeRole(targetAccForPin.role)) && !PIN_REGEX.test(initial_pin)) throw Errors.fieldValidation('initial_pin', 'INVALID_FORMAT', 'Mã PIN đăng nhập phải gồm đúng 6 chữ số', '******');
    const pinHash = initial_pin && initial_pin.length >= 6 ? await hashSecret(initial_pin) : null;
    const pinPatch = pinHash ? { password_hash: pinHash, failed_login_count: 0, locked_until: '', must_change_pin: true } : {};

    if (create_account && !prevLinkedUser) {
      const targetUname = (username || `nv.${before.employee_code.toLowerCase()}`).toLowerCase();
      const createdUser = await ctx.db.users.insert({
        username: targetUname, phone, display_name: rest.full_name || before.full_name, password_hash: pinHash ?? (await hashSecret(DEMO_PIN)),
        role: (rest.stage ?? before.stage) === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC', permissions_json: '[]', branch_scope: rest.branch_id || before.branch_id,
        employee_id: before.employee_code, status: 'PENDING_ACTIVATION', session_version: 1, failed_login_count: 0, locked_until: '',
        last_login_at: '', activated_by: '', activated_at: '', revoked_at: '', email: rest.email ?? before.email ?? '', revoked_by: '', revoke_reason: '', must_change_pin: true, pin_changed_at: '',
      }, actorId);
      nextUserId = createdUser.id;
      queueAccountCreatedEmail(ctx, createdUser, request.auth?.user.email, initial_pin || DEMO_PIN);
    } else {
      const targetUser = link_user_id === '' ? undefined : link_user_id ? ctx.db.users.get(link_user_id) : prevLinkedUser;
      if (link_user_id && !targetUser) throw Errors.fieldValidation('link_user_id', 'INVALID_VALUE', 'Tài khoản người dùng được chọn không tồn tại', link_user_id);
      nextUserId = await syncAccountFromEmployee(ctx, {
        empId: id, employeeCode: before.employee_code, prevUser: prevLinkedUser, targetUser,
        fullName: rest.full_name || before.full_name, phone, email: rest.email,
        branchId: rest.branch_id || before.branch_id, stage: rest.stage ?? before.stage, pinPatch, actorId,
      });
      if (initial_pin && initial_pin.length >= 6 && nextUserId) { const u = ctx.db.users.get(nextUserId); if (u) queueAccountUpdatedEmail(ctx, u, 'Cập nhật mật khẩu / mã PIN từ hồ sơ nhân sự', request.auth?.user.email, initial_pin); }
    }

    const updated = await ctx.db.employees.update(id, version, { ...rest, phone, user_id: nextUserId }, actorId);
    await cascadeEmployeeBranchChange(ctx, updated, updated.branch_id, actorId);
    if (salary) {
      const cur = currentProfile(profilesOf(ctx.db, id));
      const changed = !cur || cur.rate_type !== salary.rate_type || cur.amount_vnd !== Math.round(salary.amount_vnd) || cur.probation_percent !== salary.probation_percent || cur.attendance_bonus_vnd !== salary.attendance_bonus_vnd || cur.meal_allowance_per_shift_vnd !== salary.meal_allowance_per_shift_vnd || cur.transport_allowance_vnd !== salary.transport_allowance_vnd || cur.responsibility_allowance_vnd !== salary.responsibility_allowance_vnd || cur.other_allowance_vnd !== salary.other_allowance_vnd || cur.ot_multiplier !== salary.ot_multiplier || cur.standard_work_days !== salary.standard_work_days || cur.standard_hours_per_day !== salary.standard_hours_per_day;
      if (!cur) {
        await createSalaryProfile(ctx, updated, { ...salary, effective_from: salary.effective_from || updated.probation_start || dayjs().startOf('month').format('YYYY-MM-DD'), change_reason: 'Thiết lập lương từ hồ sơ nhân sự', note: salary.note ?? '' }, actorId);
      } else if (changed && isProfileLocked(ctx.db, cur.id)) {
        const nextFrom = salary.effective_from && salary.effective_from > cur.effective_from ? salary.effective_from : (today() > cur.effective_from ? today() : dayjs(cur.effective_from).add(1, 'day').format('YYYY-MM-DD'));
        await createSalaryProfile(ctx, updated, { ...salary, effective_from: nextFrom, change_reason: 'Điều chỉnh lương từ hồ sơ nhân sự', note: salary.note ?? '' }, actorId);
      } else if (changed) {
        await ctx.db.payRates.update(cur.id, cur.version, { ...salary, amount_vnd: Math.round(salary.amount_vnd) }, actorId);
      }
    }
    await recalculateOpenPeriods(ctx, actorId);
    await ctx.audit.record(auditContext(request), {
      action: 'employee.update', entity: 'EMPLOYEES', entityId: id,
      before: { full_name: before.full_name, branch_id: before.branch_id, status: before.status, user_id: before.user_id },
      after: { full_name: updated.full_name, branch_id: updated.branch_id, status: updated.status, user_id: updated.user_id },
    });
    return sendSuccess(request, 'Cập nhật hồ sơ nhân sự thành công', mapEmployeeRecord(updated, ctx));
  });

  app.delete('/api/admin/employees/:id', { preHandler: requirePermission('employee.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.body ?? {});
    const before = ctx.db.employees.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, before.branch_id);
    const actorId = request.auth!.user.id;
    await ctx.db.employees.softDelete(id, body.version ?? before.version, actorId);
    await recalculateOpenPeriods(ctx, actorId);
    await ctx.audit.record(auditContext(request), { action: 'employee.delete', entity: 'EMPLOYEES', entityId: id, before: { employee_code: before.employee_code, full_name: before.full_name } });
    return sendSuccess(request, `Đã xóa hồ sơ nhân sự ${before.full_name} (${before.employee_code})`, { id });
  });

  app.post('/api/admin/employees/:id/promote-official', { preHandler: requirePermission('employee.promote') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zPromoteOfficialBody.parse(request.body);
    const before = ctx.db.employees.get(id);
    if (!before) throw Errors.notFound('Không tìm thấy hồ sơ nhân sự');
    assertBranchAccess(request, before.branch_id);
    if (before.stage === 'OFFICIAL') throw Errors.badRequest('Nhân sự này đã ở giai đoạn Nhân viên chính thức');

    const effectiveDate = body.official_from || dayjs().format('YYYY-MM-DD');
    const actorId = request.auth!.user.id;
    const linkedUser = (before.user_id ? ctx.db.users.get(before.user_id) : undefined) ?? ctx.db.users.find((u) => u.employee_id === before.employee_code);

    const promoted = await ctx.reconciliation.executeSaga({
      sagaKey: `emp-promote-${id}-v${body.version}`,
      operation: 'HR_PROMOTE_OFFICIAL',
      actorId,
      initialContext: { updatedEmp: null as Employee | null, prevUser: linkedUser as User | undefined },
      steps: [
        {
          name: 'UPDATE_EMPLOYEE_STAGE_OFFICIAL',
          run: async (s) => { s.updatedEmp = await ctx.db.employees.update(id, body.version, { stage: 'OFFICIAL', official_from: effectiveDate, employment_type: before.employment_type === 'PROBATION' ? 'PART_TIME' : before.employment_type, ...(body.note ? { note: body.note } : {}) }, actorId); },
          compensate: async (s) => { if (s.updatedEmp) await ctx.db.employees.update(id, s.updatedEmp.version, { stage: before.stage, official_from: before.official_from, employment_type: before.employment_type }, actorId); },
        },
        {
          name: 'SYNC_USER_ROLE_CHINH_THUC',
          run: async (s) => { if (s.prevUser && s.prevUser.role === 'THU_VIEC') await ctx.db.users.update(s.prevUser.id, s.prevUser.version, { role: 'CHINH_THUC' }, actorId); },
        },
        {
          name: 'RECORD_STAGE_HISTORY',
          run: async () => {
            const dossier = buildEmployeeDossierSummary(before, ctx);
            const summary = body.evaluation_summary || body.note || 'Đạt điều kiện thử việc và TEST nghiệp vụ, chuyển sang Nhân viên chính thức';
            await ctx.db.employeeStageHistory.insert({ employee_id: before.id, from_stage: before.stage, to_stage: 'OFFICIAL', effective_from: effectiveDate, decided_by: request.auth!.user.username, note: summary, change_type: 'PROMOTE_OFFICIAL', from_branch_id: before.branch_id, to_branch_id: before.branch_id, from_shift_code: before.default_shift_code, to_shift_code: before.default_shift_code, probation_hours_completed: dossier.probationHoursCompleted, test_score_percent: dossier.testBestScorePercent, evaluation_summary: summary, approved_by: request.auth!.user.username }, actorId);
          },
        },
      ],
      resultSelector: (s) => s.updatedEmp!,
    });
    await recalculateOpenPeriods(ctx, actorId);
    queuePromotionOfficialEmail(ctx, promoted);
    await ctx.audit.record(auditContext(request), { action: 'employee.promote_official', entity: 'EMPLOYEES', entityId: id, before: { employee_code: before.employee_code, stage: before.stage, official_from: before.official_from }, after: { employee_code: promoted.employee_code, stage: promoted.stage, official_from: promoted.official_from, probation_start: promoted.probation_start, probation_end: promoted.probation_end } });
    return sendSuccess(request, `Đã chuyển chính thức cho nhân sự ${promoted.full_name} (${promoted.employee_code}) từ ngày ${effectiveDate}`, mapEmployeeRecord(promoted, ctx));
  });

  app.post('/api/admin/employees/bulk-action', { preHandler: requirePermission('employee.promote', 'employee.manage') }, async (request) => {
    const body = zBulkEmployeeActionBody.parse(request.body);
    const effectiveDate = body.official_from || dayjs().format('YYYY-MM-DD');
    const actorId = request.auth!.user.id;
    const processed: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    const empPatches: Parameters<typeof ctx.db.employees.batchUpdate>[0] = [];
    const userPatches: Parameters<typeof ctx.db.users.batchUpdate>[0] = [];
    for (const item of body.items) {
      const emp = ctx.db.employees.get(item.id);
      if (!emp) { skipped.push({ id: item.id, reason: 'Không tồn tại' }); continue; }
      if (body.action === 'DELETE') { empPatches.push({ id: emp.id, expectedVersion: emp.version, patch: { is_deleted: true } }); processed.push(emp.id); continue; }
      if (emp.stage === 'OFFICIAL') { skipped.push({ id: item.id, reason: 'Đã là nhân viên chính thức' }); continue; }
      empPatches.push({ id: emp.id, expectedVersion: emp.version, patch: { stage: 'OFFICIAL', official_from: effectiveDate } });
      const u = emp.user_id ? ctx.db.users.get(emp.user_id) : undefined;
      if (u && u.role === 'THU_VIEC') userPatches.push({ id: u.id, expectedVersion: u.version, patch: { role: 'CHINH_THUC' } });
      processed.push(emp.id);
    }
    const updatedEmps = empPatches.length > 0 ? await ctx.db.employees.batchUpdate(empPatches, actorId) : [];
    if (userPatches.length > 0) await ctx.db.users.batchUpdate(userPatches, actorId);
    if (body.action === 'PROMOTE_OFFICIAL') updatedEmps.forEach((emp) => queuePromotionOfficialEmail(ctx, emp));

    await recalculateOpenPeriods(ctx, actorId);
    await ctx.audit.record(auditContext(request), {
      action: body.action === 'DELETE' ? 'employee.delete' : 'employee.bulk.promote_official',
      entity: 'EMPLOYEES', entityId: `bulk-${processed.length}`,
      after: { action: body.action, processed, skipped, official_from: effectiveDate },
    });
    return sendSuccess(
      request,
      body.action === 'DELETE' ? `Đã xóa ${processed.length}/${body.items.length} hồ sơ nhân sự` : `Đã chuyển chính thức ${processed.length}/${body.items.length} nhân sự đã chọn`,
      { processedCount: processed.length, skippedCount: skipped.length, processedIds: processed, skipped },
    );
  });
}
