import {
  ACCOUNT_STATUS_LABELS,
  DEFAULT_SHIFT_LABELS,
  EMPLOYEE_STAGE_LABELS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  PAY_RATE_TYPE_LABELS,
  PAY_RATE_UNIT_LABELS,
  ROLE_LABELS,
  SALARY_PROFILE_STATUS_LABELS,
  STAFF_GROUP_LABELS,
  type Employee,
  type User,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { currentProfile, isOfficialAt, mapSalaryProfile, probationAmount, profilesOf, profileStatus, today } from '../services/salary-profile.service.js';

export interface UniquePersonalCheckInput {
  phone?: string;
  phoneField?: 'phone' | 'phone_number';
  email?: string;
  username?: string;
  employee_code?: string;
  citizen_id?: string;
  tax_code?: string;
  bank_account_number?: string;
  excludeUserId?: string | null;
  excludeEmployeeId?: string | null;
}

/** Kiểm tra chống trùng lặp toàn bộ các trường định danh cá nhân duy nhất trên cả bảng USERS và EMPLOYEES */
export function assertUniquePersonalIdentifiers(ctx: AppContext, input: UniquePersonalCheckInput): void {
  const { excludeUserId, excludeEmployeeId, phoneField = 'phone_number' } = input;

  if (input.username) {
    const uname = input.username.trim().toLowerCase();
    const dupU = ctx.db.users.find((u) => u.id !== excludeUserId && u.username.trim().toLowerCase() === uname);
    if (dupU) throw Errors.fieldValidation('username', 'DUPLICATE_VALUE', `Tên đăng nhập @${input.username.trim()} đã được sử dụng bởi ${dupU.display_name}`, input.username);
  }

  if (input.employee_code) {
    const code = input.employee_code.trim().toUpperCase();
    const dupE = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && e.employee_code.trim().toUpperCase() === code);
    if (dupE) throw Errors.fieldValidation('employee_code', 'DUPLICATE_VALUE', `Mã nhân sự ${code} đã được cấp cho ${dupE.full_name}`, input.employee_code);
  }

  if (input.phone) {
    const p = input.phone.trim();
    const dupUser = ctx.db.users.find((u) => u.id !== excludeUserId && Boolean(u.phone && u.phone.trim() === p));
    if (dupUser) {
      throw Errors.fieldValidation(phoneField, 'DUPLICATE_VALUE', `Số điện thoại ${p} đã được sử dụng bởi tài khoản ${dupUser.display_name} (@${dupUser.username})`, p);
    }
    const dupEmp = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && Boolean(e.phone && e.phone.trim() === p));
    if (dupEmp) {
      throw Errors.fieldValidation(phoneField, 'DUPLICATE_VALUE', `Số điện thoại ${p} đã được đăng ký cho nhân sự ${dupEmp.full_name} (${dupEmp.employee_code})`, p);
    }
  }

  if (input.email) {
    const em = input.email.trim().toLowerCase();
    const dupUser = ctx.db.users.find((u) => u.id !== excludeUserId && Boolean(u.email && u.email.trim().toLowerCase() === em));
    if (dupUser) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${input.email.trim()} đã được sử dụng bởi tài khoản ${dupUser.display_name} (@${dupUser.username})`, input.email);
    }
    const dupEmp = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && Boolean(e.email && e.email.trim().toLowerCase() === em));
    if (dupEmp) {
      throw Errors.fieldValidation('email', 'DUPLICATE_VALUE', `Địa chỉ email ${input.email.trim()} đã được đăng ký cho nhân sự ${dupEmp.full_name} (${dupEmp.employee_code})`, input.email);
    }
  }

  if (input.citizen_id) {
    const cid = input.citizen_id.trim();
    const dupEmp = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && Boolean(e.citizen_id && e.citizen_id.trim() === cid));
    if (dupEmp) {
      throw Errors.fieldValidation('citizen_id', 'DUPLICATE_VALUE', `Số CCCD/CMND ${cid} đã được đăng ký cho nhân sự ${dupEmp.full_name} (${dupEmp.employee_code})`, input.citizen_id);
    }
  }

  if (input.tax_code) {
    const tax = input.tax_code.trim().toUpperCase();
    const dupEmp = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && Boolean(e.tax_code && e.tax_code.trim().toUpperCase() === tax));
    if (dupEmp) {
      throw Errors.fieldValidation('tax_code', 'DUPLICATE_VALUE', `Mã số thuế cá nhân ${input.tax_code.trim()} đã được đăng ký cho nhân sự ${dupEmp.full_name} (${dupEmp.employee_code})`, input.tax_code);
    }
  }

  if (input.bank_account_number) {
    const bankAcc = input.bank_account_number.trim();
    const dupEmp = ctx.db.employees.find((e) => e.id !== excludeEmployeeId && Boolean(e.bank_account_number && e.bank_account_number.trim() === bankAcc));
    if (dupEmp) {
      throw Errors.fieldValidation('bank_account_number', 'DUPLICATE_VALUE', `Số tài khoản ngân hàng ${bankAcc} đã được đăng ký cho nhân sự ${dupEmp.full_name} (${dupEmp.employee_code})`, input.bank_account_number);
    }
  }
}

/** Tìm tài khoản người dùng đang liên kết với hồ sơ nhân sự (ưu tiên user_id -> employee_id -> SĐT) */
export function findLinkedUserForEmployee(e: Employee, ctx: AppContext): User | undefined {
  if (e.user_id) {
    const byId = ctx.db.users.get(e.user_id);
    if (byId) return byId;
  }
  const codeUpper = e.employee_code.trim().toUpperCase();
  const byEmpCode = ctx.db.users.find(
    (u) => u.employee_id.trim().toUpperCase() === codeUpper || u.employee_id === e.id,
  );
  if (byEmpCode) return byEmpCode;
  if (e.phone) {
    const byPhone = ctx.db.users.find((u) => Boolean(u.phone && u.phone === e.phone));
    if (byPhone) return byPhone;
  }
  return undefined;
}

/** Tìm hồ sơ nhân sự đang liên kết với tài khoản người dùng */
export function findLinkedEmployeeForUser(u: User, ctx: AppContext): Employee | undefined {
  const byUserId = ctx.db.employees.find((e) => e.user_id === u.id);
  if (byUserId) return byUserId;
  if (u.employee_id) {
    const codeUpper = u.employee_id.trim().toUpperCase();
    const byCode = ctx.db.employees.find(
      (e) => e.employee_code.trim().toUpperCase() === codeUpper || e.id === u.employee_id,
    );
    if (byCode) return byCode;
  }
  if (u.phone) {
    const byPhone = ctx.db.employees.find((e) => Boolean(e.phone && e.phone === u.phone));
    if (byPhone) return byPhone;
  }
  return undefined;
}

/** Tóm tắt hồ sơ lương cá nhân hiện hành để hiển thị trên danh sách nhân sự */
export function salarySummary(e: Employee, ctx: AppContext) {
  const cur = currentProfile(profilesOf(ctx.db, e.id));
  const status = profileStatus(cur);
  if (!cur) {
    return { salaryStatus: status, salaryStatusLabel: SALARY_PROFILE_STATUS_LABELS[status], salaryRateType: null, salaryRateTypeLabel: null, salaryUnitLabel: null, salaryOfficialAmountVnd: 0, salaryProbationPercent: null, salaryEffectiveAmountVnd: 0, salaryProfile: null };
  }
  const official = isOfficialAt(e, today());
  return {
    salaryStatus: status,
    salaryStatusLabel: SALARY_PROFILE_STATUS_LABELS[status],
    salaryRateType: cur.rate_type,
    salaryRateTypeLabel: PAY_RATE_TYPE_LABELS[cur.rate_type],
    salaryUnitLabel: PAY_RATE_UNIT_LABELS[cur.rate_type],
    salaryOfficialAmountVnd: cur.amount_vnd,
    salaryProbationPercent: cur.probation_percent,
    salaryEffectiveAmountVnd: official ? cur.amount_vnd : probationAmount(cur),
    salaryProfile: mapSalaryProfile(cur, ctx.db),
  };
}

export function resolveStaffGroupLabel(ctx: AppContext, code: string, fallbackTitle?: string): string {
  const builtin = STAFF_GROUP_LABELS[code as keyof typeof STAFF_GROUP_LABELS];
  const cfg = ctx.db.systemSettings.find((s) => s.key === 'JOB_POSITIONS_CONFIG');
  if (cfg?.value) {
    try {
      const parsed = JSON.parse(cfg.value) as { code: string; label: string }[];
      const match = parsed.find((p) => p.code === code);
      if (match?.label) return match.label;
    } catch { /* ignore */ }
  }
  return builtin || fallbackTitle || code;
}

export function mapEmployeeRecord(e: Employee, ctx: AppContext) {
  const branch = ctx.db.branches.get(e.branch_id);
  const linkedUser = findLinkedUserForEmployee(e, ctx);
  const posLabel = resolveStaffGroupLabel(ctx, e.staff_group, e.position_title);
  return {
    id: e.id,
    employeeCode: e.employee_code,
    fullName: e.full_name,
    phone: e.phone,
    email: e.email || linkedUser?.email || '',
    dateOfBirth: e.date_of_birth || '',
    gender: e.gender || '',
    citizenId: e.citizen_id || '',
    citizenIssueDate: e.citizen_issue_date || '',
    permanentAddress: e.permanent_address || '',
    currentAddress: e.current_address || '',
    emergencyContactName: e.emergency_contact_name || '',
    emergencyContactPhone: e.emergency_contact_phone || '',
    taxCode: e.tax_code || '',
    resignedAt: e.resigned_at || '',
    resignReason: e.resign_reason || '',
    branchId: e.branch_id,
    branchName: branch?.name ?? 'Chưa phân chi nhánh',
    staffGroup: e.staff_group,
    staffGroupLabel: posLabel,
    stage: e.stage,
    stageLabel: EMPLOYEE_STAGE_LABELS[e.stage],
    status: e.status,
    statusLabel: EMPLOYEE_STATUS_LABELS[e.status],
    positionTitle: e.position_title || posLabel,
    employmentType: e.employment_type,
    employmentTypeLabel: EMPLOYMENT_TYPE_LABELS[e.employment_type],
    defaultShiftCode: e.default_shift_code,
    defaultShiftLabel: DEFAULT_SHIFT_LABELS[e.default_shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? e.default_shift_code,
    probationStart: e.probation_start || null,
    probationEnd: e.probation_end || null,
    officialFrom: e.official_from || null,
    probationCycleDays: e.probation_cycle_days,
    probationWorkDays: e.probation_work_days,
    probationOffDays: e.probation_off_days,
    ...salarySummary(e, ctx),
    bankName: e.bank_name,
    bankAccountNumber: e.bank_account_number,
    bankAccountHolder: e.bank_account_holder,
    userId: linkedUser?.id ?? null,
    username: linkedUser?.username ?? null,
    userDisplayName: linkedUser?.display_name ?? null,
    userRole: linkedUser?.role ?? null,
    userRoleLabel: linkedUser ? ROLE_LABELS[linkedUser.role] : null,
    accountStatus: linkedUser?.status ?? null,
    accountStatusLabel: linkedUser ? ACCOUNT_STATUS_LABELS[linkedUser.status] : 'Chưa liên kết tài khoản',
    note: e.note || '',
    version: e.version,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}
