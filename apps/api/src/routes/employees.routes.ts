import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_SHIFT_CODES,
  EMPLOYEE_STAGES,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  STAFF_GROUPS,
  STAFF_GROUP_LABELS,
  SYSTEM_CONFIG,
  normalizePhone,
  zListQueryBase,
  type Employee,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { hashSecret } from '../auth/password.js';
import { DEMO_PIN } from '../data/memory-seed.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { assertBranchAccess, auditContext, filterByBranch, requirePermission } from '../plugins/auth-context.js';
import { today } from '../services/salary-profile.service.js';
import { assertAmountInRange, newProfileRow } from '../services/salary-profile.writer.js';
import { healBranchConsistency, syncAccountFromEmployee } from './account-employee-sync.js';
import { assertUniquePersonalIdentifiers, mapEmployeeRecord, resolveStaffGroupLabel } from './employee-mapper.js';
import { employeeActionRoutes } from './employees-actions.routes.js';
import { zSalaryProfileFields } from './salary-profile.schemas.js';

export { mapEmployeeRecord } from './employee-mapper.js';

const zEmployeeListQuery = zListQueryBase.extend({
  stage: z.enum([...EMPLOYEE_STAGES, 'ALL'] as const).optional(),
  staff_group: z.string().trim().max(64).optional(),
  status: z.enum([...EMPLOYEE_STATUSES, 'ALL'] as const).optional(),
  branch_id: z.string().max(64).optional(),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

const zCreateEmployeeBody = z.object({
  employee_code: z.string().trim().max(20).optional().default(''),
  full_name: z.string({ required_error: 'Họ và tên nhân viên là bắt buộc' }).trim().min(2, 'Họ và tên tối thiểu 2 ký tự').max(80),
  phone_number: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('Định dạng địa chỉ email không hợp lệ').or(z.literal('')).optional().default(''),
  date_of_birth: z.string().trim().optional().default(''),
  gender: z.string().trim().max(20).optional().default(''),
  citizen_id: z.string().trim().max(20).optional().default(''),
  citizen_issue_date: z.string().trim().optional().default(''),
  permanent_address: z.string().trim().max(200).optional().default(''),
  current_address: z.string().trim().max(200).optional().default(''),
  emergency_contact_name: z.string().trim().max(80).optional().default(''),
  emergency_contact_phone: z.string().trim().max(20).optional().default(''),
  tax_code: z.string().trim().max(30).optional().default(''),
  branch_id: z.string({ required_error: 'Chi nhánh làm việc là bắt buộc' }).trim().min(1),
  staff_group: z.string().trim().min(1).default('BARISTA'),
  stage: z.enum(['PROBATION', 'OFFICIAL']).default('PROBATION'),
  position_title: z.string().trim().max(60).optional().default(''),
  employment_type: z.enum(EMPLOYMENT_TYPES).default('PROBATION'),
  default_shift_code: z.enum(DEFAULT_SHIFT_CODES).default('CA_SANG'),
  probation_start: z.string().trim().optional().default(''),
  probation_end: z.string().trim().optional().default(''),
  /** Hồ sơ lương cá nhân ban đầu (tùy chọn) — Theo giờ / Theo tháng / Theo ca + % lương thử việc */
  salary: zSalaryProfileFields.optional(),
  bank_name: z.string().trim().max(60).optional().default(''),
  bank_account_number: z.string().trim().max(40).optional().default(''),
  bank_account_holder: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
  create_account: z.boolean().optional().default(true),
  link_user_id: z.string().trim().max(64).optional().default(''),
  username: z.string().trim().max(32).optional().default(''),
  initial_pin: z.string().trim().min(6, 'Mật khẩu tối thiểu 6 ký tự').or(z.literal('')).optional().default(DEMO_PIN),
});

export async function employeeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/admin/employees', { preHandler: requirePermission('employee.read') }, async (request) => {
    const query = zEmployeeListQuery.parse(request.query);
    if (query.branch_id && query.branch_id !== 'ALL') assertBranchAccess(request, query.branch_id);
    if (query.refresh === '1' || query.refresh === 'true') {
      await Promise.all([ctx.db.employees.refreshIfIdle(), ctx.db.users.refreshIfIdle(), ctx.db.branches.refreshIfIdle(), ctx.db.payRates.refreshIfIdle()]);
    }
    await healBranchConsistency(ctx);
    const canSeeSalary = request.auth!.permissions.has('payroll.read') || request.auth!.permissions.has('employee.manage') || request.auth!.permissions.has('system.config');
    const canSeePersonal = request.auth!.permissions.has('employee.manage') || request.auth!.permissions.has('system.config');
    const scoped = filterByBranch(request, ctx.db.employees.all(), (e) => e.branch_id);
    const mapped = scoped.map((e) => {
      const row = mapEmployeeRecord(e, ctx);
      return { ...row, ...(canSeeSalary ? {} : { salaryOfficialAmountVnd: 0, salaryEffectiveAmountVnd: 0, salaryProbationPercent: null, salaryProfile: null, bankName: '', bankAccountNumber: '', bankAccountHolder: '', taxCode: '' }), ...(canSeePersonal ? {} : { citizenId: '' }) };
    });
    const result = paginateAndSort(mapped, {
      page: query.page,
      perPage: query.per_page,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
      defaultSortBy: 'created_at',
      defaultSortOrder: 'desc',
      allowedSortFields: ['created_at', 'updated_at', 'employeeCode', 'fullName', 'stage', 'status', 'salaryOfficialAmountVnd'],
      q: query.q,
      searchExtractor: (item) => [item.employeeCode, item.fullName, item.phone, item.email, item.citizenId, item.branchName, item.staffGroupLabel, item.stageLabel],
      filters: { stage: query.stage, staff_group: query.staff_group, status: query.status, branch_id: query.branch_id },
      filterPredicates: { staff_group: (item, val) => item.staffGroup === val, branch_id: (item, val) => item.branchId === val },
    });
    return sendPaginated(request, 'Lấy danh sách hồ sơ nhân sự thành công', result);
  });

  app.post('/api/admin/employees', { preHandler: requirePermission('employee.manage') }, async (request, reply) => {
    const body = zCreateEmployeeBody.parse(request.body);
    assertBranchAccess(request, body.branch_id);
    if (!ctx.db.branches.get(body.branch_id)) {
      throw Errors.fieldValidation('branch_id', 'INVALID_VALUE', 'Chi nhánh được chọn không tồn tại', body.branch_id);
    }
    const rawPhone = body.phone_number ?? body.phone ?? '';
    const phone = normalizePhone(rawPhone);
    if (!phone) throw Errors.fieldValidation('phone_number', 'INVALID_PHONE', 'Số điện thoại phải gồm 10 chữ số bắt đầu bằng số 0', rawPhone);
    const empCode = (body.employee_code || `NV${String(ctx.db.employees.all(true).length + 1).padStart(4, '0')}`).toUpperCase();
    const targetUsername = (body.username || `nv.${empCode.toLowerCase()}`).toLowerCase();
    assertUniquePersonalIdentifiers(ctx, {
      employee_code: empCode,
      phone,
      phoneField: 'phone_number',
      email: body.email || undefined,
      citizen_id: body.citizen_id || undefined,
      tax_code: body.tax_code || undefined,
      bank_account_number: body.bank_account_number || undefined,
      username: !body.link_user_id && body.create_account ? targetUsername : undefined,
      excludeUserId: body.link_user_id || null,
    });
    if (body.salary) {
      try {
        assertAmountInRange(body.salary.rate_type, body.salary.amount_vnd);
      } catch {
        throw Errors.fieldValidation('salary.amount_vnd', 'OUT_OF_RANGE', 'Mức lương không phù hợp với hình thức tính lương đã chọn (giờ / tháng / ca)', body.salary.amount_vnd);
      }
    }

    const actorId = request.auth!.user.id;
    const pinHash = await hashSecret(body.initial_pin || DEMO_PIN);
    const startDate = body.probation_start || today();

    const created = await ctx.reconciliation.executeSaga({
      sagaKey: `emp-onboard-${empCode}-${Date.now()}`,
      operation: 'HR_ONBOARD_EMPLOYEE',
      actorId,
      initialContext: { emp: null as Employee | null, userId: '' },
      steps: [
        {
          name: 'CREATE_OR_LINK_ACCOUNT',
          run: async (s) => {
            if (body.link_user_id) {
              const existingUser = ctx.db.users.get(body.link_user_id);
              if (existingUser) {
                const pinPatch = body.initial_pin && body.initial_pin.length >= 6 ? { password_hash: pinHash, failed_login_count: 0, locked_until: '' } : undefined;
                s.userId = await syncAccountFromEmployee(ctx, {
                  empId: '', employeeCode: empCode, targetUser: existingUser,
                  fullName: body.full_name, phone, email: body.email || undefined,
                  branchId: body.branch_id, stage: body.stage, pinPatch, actorId,
                });
                return;
              }
            }
            if (!body.create_account) return;
            const u = await ctx.db.users.insert(
              {
                username: targetUsername, phone, display_name: body.full_name, password_hash: pinHash,
                role: body.stage === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC', permissions_json: '[]', branch_scope: body.branch_id,
                employee_id: empCode, status: 'PENDING_ACTIVATION', session_version: 1, failed_login_count: 0, locked_until: '',
                last_login_at: '', activated_by: '', activated_at: '', revoked_at: '', email: body.email, revoked_by: '', revoke_reason: '',
              },
              actorId,
            );
            s.userId = u.id;
          },
        },
        {
          name: 'INSERT_EMPLOYEE_RECORD',
          run: async (s) => {
            s.emp = await ctx.db.employees.insert(
              {
                employee_code: empCode, full_name: body.full_name, phone, branch_id: body.branch_id, staff_group: body.staff_group,
                stage: body.stage, probation_start: body.probation_start, probation_end: body.probation_end,
                official_from: body.stage === 'OFFICIAL' ? startDate : '', status: 'ACTIVE', user_id: s.userId, candidate_id: '',
                email: body.email, date_of_birth: body.date_of_birth, gender: body.gender, citizen_id: body.citizen_id,
                citizen_issue_date: body.citizen_issue_date, permanent_address: body.permanent_address, current_address: body.current_address,
                emergency_contact_name: body.emergency_contact_name, emergency_contact_phone: body.emergency_contact_phone,
                position_title: body.position_title || resolveStaffGroupLabel(ctx, body.staff_group),
                employment_type: body.employment_type, default_shift_code: body.default_shift_code,
                probation_cycle_days: SYSTEM_CONFIG.defaults.probationCycleDays, probation_work_days: SYSTEM_CONFIG.defaults.probationWorkDays,
                probation_off_days: SYSTEM_CONFIG.defaults.probationOffDays, resigned_at: '', resign_reason: '', bank_name: body.bank_name,
                bank_account_number: body.bank_account_number, bank_account_holder: body.bank_account_holder || body.full_name.toUpperCase(),
                tax_code: body.tax_code, base_hourly_rate_vnd: body.salary?.amount_vnd ?? 0, note: body.note,
              },
              actorId,
            );
          },
        },
        {
          name: 'INSERT_INITIAL_SALARY_PROFILE',
          run: async (s) => {
            if (!body.salary || !s.emp) return;
            await ctx.db.payRates.insert(newProfileRow(s.emp, body.salary, actorId, body.salary.effective_from || startDate, '', 'Thiết lập lương ban đầu khi tiếp nhận nhân sự'), actorId);
          },
        },
      ],
      resultSelector: (s) => s.emp!,
    });

    await ctx.audit.record(auditContext(request), {
      action: 'employee.create',
      entity: 'EMPLOYEES',
      entityId: created.id,
      after: { employee_code: created.employee_code, stage: created.stage, user_id: created.user_id, salary_rate_type: body.salary?.rate_type ?? null },
    });
    reply.code(201);
    return sendSuccess(request, 'Đã tạo hồ sơ nhân sự mới và đề xuất tài khoản ở trạng thái Chờ Quản trị viên kích hoạt', mapEmployeeRecord(created, ctx));
  });

  await employeeActionRoutes(app, ctx);
}
