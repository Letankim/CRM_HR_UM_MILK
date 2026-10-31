import type { FormInstance } from 'antd';
import {
  EMPLOYEE_STAGE_LABELS,
  ROLE_LABELS,
  STAFF_GROUP_LABELS,
  getAllowedExtraPermissionsForRole,
  isEmployeeRole,
  normalizePhone,
  type Permission,
  type Role,
} from '@umbm/shared';
import { generateUsername } from '@/lib/auto-generate';
import type { AccountRowItem } from '@/ui/components/AccountDetailDrawer';
import { syncAccountSecretForRole } from '@/ui/components/AccountSecretField';
import type { EmployeeRowItem } from '@/ui/components/employee-table-columns';

export interface LinkedFieldDiff {
  field: string;
  label: string;
  currentDisplay: string;
  incomingValue: string;
  incomingDisplay: string;
}

function cleanPhoneVal(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  return normalizePhone(s) ?? s.replace(/^\+?84/, '0');
}

/**
 * So sánh thông tin chung của Tài khoản có sẵn với các ô đang nhập trên biểu mẫu Hồ sơ Nhân sự.
 */
export function computeAccountToEmployeeDiffs(
  acc: AccountRowItem,
  rawValues: object | undefined,
  branches: { label: string; value: string }[],
  isEditing: boolean,
): LinkedFieldDiff[] {
  const formValues = (rawValues ?? {}) as Record<string, unknown>;
  const diffs: LinkedFieldDiff[] = [];
  const branchMap = new Map(branches.map((b) => [b.value, b.label]));

  const accName = (acc.displayName ?? '').trim();
  const curName = String(formValues.full_name ?? '').trim();
  if (accName && accName !== curName) {
    diffs.push({ field: 'full_name', label: 'Họ và tên', currentDisplay: curName || 'Chưa nhập', incomingValue: accName, incomingDisplay: accName });
  }

  const accPhone = cleanPhoneVal(acc.phone);
  const curPhone = cleanPhoneVal(String(formValues.phone_number ?? ''));
  if (accPhone && accPhone !== curPhone) {
    diffs.push({ field: 'phone_number', label: 'Số điện thoại', currentDisplay: String(formValues.phone_number ?? '').trim() || 'Chưa nhập', incomingValue: accPhone, incomingDisplay: accPhone });
  }

  const accEmail = (acc.email ?? '').trim();
  const curEmail = String(formValues.email ?? '').trim();
  if (accEmail && accEmail.toLowerCase() !== curEmail.toLowerCase()) {
    diffs.push({ field: 'email', label: 'Địa chỉ Email', currentDisplay: curEmail || 'Chưa nhập', incomingValue: accEmail, incomingDisplay: accEmail });
  }

  const accBranchId =
    acc.primaryBranchId ||
    (Array.isArray(acc.branchScope) && acc.branchScope.length === 1 ? acc.branchScope[0] : '') ||
    '';
  const curBranchId = String(formValues.branch_id ?? '').trim();
  if (accBranchId && accBranchId !== 'ALL' && accBranchId !== curBranchId) {
    diffs.push({
      field: 'branch_id',
      label: 'Chi nhánh làm việc',
      currentDisplay: curBranchId ? (branchMap.get(curBranchId) ?? curBranchId) : 'Chưa chọn',
      incomingValue: accBranchId,
      incomingDisplay: branchMap.get(accBranchId) ?? acc.employeeBranchName ?? accBranchId,
    });
  }

  if (!isEditing && isEmployeeRole(acc.role)) {
    const accStage = acc.role === 'CHINH_THUC' ? 'OFFICIAL' : 'PROBATION';
    const curStage = (String(formValues.stage ?? 'PROBATION') === 'OFFICIAL' ? 'OFFICIAL' : 'PROBATION') as 'PROBATION' | 'OFFICIAL';
    if (accStage !== curStage) {
      diffs.push({
        field: 'stage',
        label: 'Giai đoạn nhân sự',
        currentDisplay: EMPLOYEE_STAGE_LABELS[curStage],
        incomingValue: accStage,
        incomingDisplay: EMPLOYEE_STAGE_LABELS[accStage],
      });
    }
  }

  if (!isEditing && acc.role === 'STORE') {
    const curGroup = String(formValues.staff_group ?? 'BARISTA');
    if (curGroup !== 'STORE_MANAGER') {
      diffs.push({
        field: 'staff_group',
        label: 'Vị trí công việc',
        currentDisplay: STAFF_GROUP_LABELS[curGroup as keyof typeof STAFF_GROUP_LABELS] ?? curGroup,
        incomingValue: 'STORE_MANAGER',
        incomingDisplay: STAFF_GROUP_LABELS.STORE_MANAGER,
      });
    }
  }

  return diffs;
}

/**
 * So sánh thông tin chung của Hồ sơ Nhân sự với các ô đang nhập trên biểu mẫu Tài khoản.
 */
export function computeEmployeeToAccountDiffs(
  emp: EmployeeRowItem,
  rawValues: object | undefined,
  branchOptions: { label: string; value: string }[],
  isEditing: boolean,
): LinkedFieldDiff[] {
  const formValues = (rawValues ?? {}) as Record<string, unknown>;
  const diffs: LinkedFieldDiff[] = [];
  const branchMap = new Map(branchOptions.map((b) => [b.value, b.label]));

  const empName = (emp.fullName ?? '').trim();
  const curName = String(formValues.display_name ?? '').trim();
  if (empName && empName !== curName) {
    diffs.push({ field: 'display_name', label: 'Họ và tên', currentDisplay: curName || 'Chưa nhập', incomingValue: empName, incomingDisplay: empName });
  }

  const curUsername = String(formValues.username ?? '').trim();
  if (!isEditing && !curUsername) {
    const suggested = generateUsername(emp.fullName, emp.employeeCode);
    diffs.push({ field: 'username', label: 'Tên đăng nhập (gợi ý)', currentDisplay: 'Chưa nhập', incomingValue: suggested, incomingDisplay: `@${suggested}` });
  }

  const empPhone = cleanPhoneVal(emp.phone);
  const curPhone = cleanPhoneVal(String(formValues.phone_number ?? ''));
  if (empPhone && empPhone !== curPhone) {
    diffs.push({ field: 'phone_number', label: 'Số điện thoại', currentDisplay: String(formValues.phone_number ?? '').trim() || 'Chưa nhập', incomingValue: empPhone, incomingDisplay: empPhone });
  }

  const empEmail = (emp.email ?? '').trim();
  const curEmail = String(formValues.email ?? '').trim();
  if (empEmail && empEmail.toLowerCase() !== curEmail.toLowerCase()) {
    diffs.push({ field: 'email', label: 'Địa chỉ Email', currentDisplay: curEmail || 'Chưa nhập', incomingValue: empEmail, incomingDisplay: empEmail });
  }

  const inferredRole: Role | null =
    emp.staffGroup === 'STORE_MANAGER' ? 'STORE' : emp.staffGroup === 'BACKOFFICE' ? null : emp.stage === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC';
  const curRole = (formValues.role as Role | undefined) ?? 'THU_VIEC';
  if (inferredRole && (!isEditing || isEmployeeRole(curRole) || curRole === 'STORE') && inferredRole !== curRole) {
    diffs.push({
      field: 'role',
      label: 'Vai trò chính',
      currentDisplay: ROLE_LABELS[curRole],
      incomingValue: inferredRole,
      incomingDisplay: ROLE_LABELS[inferredRole],
    });
  }

  const curScope = String(formValues.branch_scope ?? 'ALL').trim() || 'ALL';
  if (emp.branchId && emp.branchId !== curScope) {
    diffs.push({
      field: 'branch_scope',
      label: 'Phạm vi chi nhánh',
      currentDisplay: branchMap.get(curScope) ?? curScope,
      incomingValue: emp.branchId,
      incomingDisplay: branchMap.get(emp.branchId) ?? emp.branchName ?? emp.branchId,
    });
  }

  return diffs;
}

export function applyAccountDiffsToEmployeeForm(form: FormInstance, diffs: LinkedFieldDiff[]): void {
  const entries = diffs.map((d) => ({ name: d.field, value: d.incomingValue, errors: [] as string[] }));
  const stageDiff = diffs.find((d) => d.field === 'stage');
  if (stageDiff?.incomingValue === 'OFFICIAL' && form.getFieldValue('employment_type') === 'PROBATION') {
    entries.push({ name: 'employment_type', value: 'FULL_TIME', errors: [] });
  }
  form.setFields(entries);
}

export function applyEmployeeDiffsToAccountForm(form: FormInstance, diffs: LinkedFieldDiff[], isEditing: boolean): void {
  form.setFields(diffs.map((d) => ({ name: d.field, value: d.incomingValue, errors: [] as string[] })));
  const roleDiff = diffs.find((d) => d.field === 'role');
  if (roleDiff) {
    const nextRole = roleDiff.incomingValue as Role;
    const allowed = new Set(getAllowedExtraPermissionsForRole(nextRole));
    const curPerms: Permission[] = form.getFieldValue('extra_permissions') ?? [];
    form.setFields([{ name: 'extra_permissions', value: curPerms.filter((p) => allowed.has(p)), errors: [] }]);
    syncAccountSecretForRole(form, nextRole, isEditing);
  }
}
