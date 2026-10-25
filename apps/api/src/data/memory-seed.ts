import { SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import { hashSecret } from '../auth/password.js';
import { serializeCell } from '../sheets/a1.js';
import { InMemorySheetsGateway } from '../sheets/gateway.js';
import { newId, nowIso } from '../lib/time.js';
import type { SpreadsheetIds } from './database.js';
import { seedExtraTables } from './memory-seed-extra.js';

export const MEMORY_IDS: SpreadsheetIds = {
  CORE: 'mem-core',
  HR: 'mem-hr',
  SCHEDULE: 'mem-schedule',
  ATTENDANCE: 'mem-attendance',
  PAYROLL: 'mem-payroll',
  COMMS: 'mem-comms',
  SYSTEM: 'mem-system',
};

export const DEMO_PASSWORD = 'Umbm@2026';
export const DEMO_PIN = '246810';

function row(headers: readonly string[], data: Record<string, unknown>): string[] {
  return headers.map((h) => serializeCell(data[h]));
}

export async function createMemoryGateway(): Promise<InMemorySheetsGateway> {
  const gw = new InMemorySheetsGateway();
  for (const key of Object.keys(SPREADSHEETS) as SpreadsheetKey[]) {
    for (const [tab, headers] of Object.entries(SPREADSHEETS[key].tabs)) {
      gw.seed(MEMORY_IDS[key], tab, [[...(headers as readonly string[])]]);
    }
  }

  const now = nowIso();
  const sys = (id: string) => ({
    id,
    created_at: now,
    created_by: 'seed',
    updated_at: now,
    updated_by: 'seed',
    version: 1,
    is_deleted: false,
  });

  const branchHeaders = SPREADSHEETS.CORE.tabs.BRANCHES;
  const branches = [
    { code: 'CN01', name: 'Ụm Bò Milk Chi nhánh 1', lat: 10.7769, lng: 106.7009 },
    { code: 'CN02', name: 'Ụm Bò Milk Chi nhánh 2', lat: 10.8012, lng: 106.7143 },
    { code: 'CN03', name: 'Ụm Bò Milk Chi nhánh 3', lat: 10.7626, lng: 106.6602 },
    { code: 'CN04', name: 'Ụm Bò Milk Chi nhánh 4', lat: 10.8231, lng: 106.6297 },
  ].map((b) => ({
    ...sys(newId()),
    ...b,
    address: 'TP. Hồ Chí Minh',
    radius_m: 100,
    max_accuracy_m: 50,
    timezone: 'Asia/Ho_Chi_Minh',
    status: 'ACTIVE',
    phone_contact: '0901000000',
    manager_employee_id: '',
    open_time: '07:00',
    close_time: '22:30',
    effective_from: '2026-01-01',
    note: '',
  }));
  gw.seed(MEMORY_IDS.CORE, 'BRANCHES', [[...branchHeaders], ...branches.map((b) => row(branchHeaders, b))]);

  const shiftHeaders = SPREADSHEETS.CORE.tabs.SHIFT_TEMPLATES;
  const shifts = [
    { code: 'CA_SANG', name: 'Ca Sáng', start_time: '07:00', end_time: '12:00', standard_hours: 5 },
    { code: 'CA_CHIEU', name: 'Ca Chiều', start_time: '12:00', end_time: '17:00', standard_hours: 5 },
    { code: 'CA_TOI', name: 'Ca Tối', start_time: '17:00', end_time: '22:30', standard_hours: 5.5 },
  ].map((s) => ({
    ...sys(newId()),
    ...s,
    effective_from: '2026-01-01',
    effective_to: '',
    status: 'ACTIVE',
    shift_group: 'STORE',
    break_minutes: 0,
    is_overnight: false,
    note: '',
  }));
  gw.seed(MEMORY_IDS.CORE, 'SHIFT_TEMPLATES', [[...shiftHeaders], ...shifts.map((s) => row(shiftHeaders, s))]);

  const pwHash = await hashSecret(DEMO_PASSWORD);
  const pinHash = await hashSecret(DEMO_PIN);
  const cn1 = branches[0]!.id;
  const userHeaders = SPREADSHEETS.CORE.tabs.USERS;
  const base = {
    permissions_json: '[]',
    session_version: 1,
    failed_login_count: 0,
    locked_until: '',
    last_login_at: '',
    activated_by: 'seed',
    activated_at: now,
    revoked_at: '',
    email: '',
    revoked_by: '',
    revoke_reason: '',
  };
  const users = [
    { username: 'admin', display_name: 'Quản trị hệ thống', role: 'ADMIN', branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' },
    { username: 'hr', display_name: 'Nguyễn Thị Nhân Sự', role: 'HR', branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' },
    { username: 'store1', display_name: 'Trần Văn Cửa Hàng', role: 'STORE', branch_scope: cn1, phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' },
    { username: 'finance', display_name: 'Lê Thị Kế Toán', role: 'FINANCE', branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' },
    { username: 'mkt', display_name: 'Phạm Minh Truyền Thông', role: 'MKT', branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' },
    { username: 'nv.thuviec', display_name: 'Võ Thị Thử Việc', role: 'THU_VIEC', branch_scope: cn1, phone: '0901000001', password_hash: pinHash, employee_id: 'NV0001', status: 'ACTIVE' },
    { username: 'nv.chinhthuc', display_name: 'Đặng Văn Chính Thức', role: 'CHINH_THUC', branch_scope: cn1, phone: '0901000002', password_hash: pinHash, employee_id: 'NV0002', status: 'ACTIVE' },
    { username: 'nv.moi', display_name: 'Bùi Thị Mới', role: 'THU_VIEC', branch_scope: cn1, phone: '0901000003', password_hash: pinHash, employee_id: 'NV0003', status: 'PENDING_ACTIVATION', activated_by: '', activated_at: '' },
  ].map((u) => ({ ...sys(newId()), ...base, ...u }));
  gw.seed(MEMORY_IDS.CORE, 'USERS', [[...userHeaders], ...users.map((u) => row(userHeaders, u))]);

  const empHeaders = SPREADSHEETS.HR.tabs.EMPLOYEES;
  const employees = [
    { employee_code: 'NV0001', user_id: users[5]!.id, full_name: 'Võ Thị Thử Việc', phone: '0901000001', stage: 'PROBATION', branch_id: cn1, position_title: 'Pha chế', probation_start: '2026-10-01', probation_end: '2026-10-12', official_from: '', base_hourly_rate_vnd: 22000 },
    { employee_code: 'NV0002', user_id: users[6]!.id, full_name: 'Đặng Văn Chính Thức', phone: '0901000002', stage: 'OFFICIAL', branch_id: cn1, position_title: 'Thu ngân', probation_start: '2026-08-01', probation_end: '2026-08-12', official_from: '2026-08-13', base_hourly_rate_vnd: 28000 },
    { employee_code: 'NV0003', user_id: users[7]!.id, full_name: 'Bùi Thị Mới', phone: '0901000003', stage: 'PROBATION', branch_id: cn1, position_title: 'Phục vụ', probation_start: '', probation_end: '', official_from: '', base_hourly_rate_vnd: 22000 },
  ].map((e) => ({
    ...sys(newId()),
    staff_group: 'BARISTA',
    status: 'ACTIVE',
    candidate_id: '',
    email: '',
    date_of_birth: '2003-05-15',
    gender: 'Nữ',
    citizen_id: '',
    citizen_issue_date: '',
    permanent_address: 'TP. Hồ Chí Minh',
    current_address: 'TP. Hồ Chí Minh',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    employment_type: 'PART_TIME',
    default_shift_code: 'CA_SANG',
    probation_cycle_days: 12,
    probation_work_days: 7,
    probation_off_days: 5,
    resigned_at: '',
    resign_reason: '',
    bank_name: 'Techcombank',
    bank_account_number: '1903888999001',
    bank_account_holder: e.full_name.toUpperCase(),
    tax_code: '',
    note: '',
    ...e,
  }));
  gw.seed(MEMORY_IDS.HR, 'EMPLOYEES', [[...empHeaders], ...employees.map((e) => row(empHeaders, e))]);

  const rateHeaders = SPREADSHEETS.PAYROLL.tabs.PAY_RATES;
  // Hồ sơ lương CÁ NHÂN theo từng nhân sự (mỗi người 1 mức lương riêng + % lương thử việc)
  const rates = [
    { employee_id: employees[0]!.id, stage: 'PROBATION', rate_type: 'HOURLY', amount_vnd: 28000, probation_percent: 85, attendance_bonus_vnd: 300000, meal_allowance_per_shift_vnd: 15000, transport_allowance_vnd: 0, effective_from: '2026-10-01', note: 'Pha chế — thử việc hưởng 85% đơn giá chính thức' },
    { employee_id: employees[1]!.id, stage: 'OFFICIAL', rate_type: 'HOURLY', amount_vnd: 30000, probation_percent: 85, attendance_bonus_vnd: 300000, meal_allowance_per_shift_vnd: 15000, transport_allowance_vnd: 0, effective_from: '2026-08-01', note: 'Thu ngân chính thức' },
    { employee_id: employees[2]!.id, stage: 'PROBATION', rate_type: 'MONTHLY', amount_vnd: 7500000, probation_percent: 85, attendance_bonus_vnd: 0, meal_allowance_per_shift_vnd: 0, transport_allowance_vnd: 300000, effective_from: '2026-10-01', note: 'Lương tháng cố định, công chuẩn 26 ngày' },
  ].map((r) => ({
    ...sys(newId()),
    effective_to: '',
    approved_by: 'seed',
    approved_at: now,
    ot_multiplier: 1.5,
    night_shift_allowance_vnd: 0,
    responsibility_allowance_vnd: 0,
    other_allowance_vnd: 0,
    standard_work_days: 26,
    standard_hours_per_day: 8,
    staff_group: 'BARISTA',
    status: 'ACTIVE',
    change_reason: 'Thiết lập lương ban đầu',
    previous_rate_id: '',
    ...r,
  }));
  gw.seed(MEMORY_IDS.PAYROLL, 'PAY_RATES', [[...rateHeaders], ...rates.map((r) => row(rateHeaders, r))]);

  const assignHeaders = SPREADSHEETS.SCHEDULE.tabs.SHIFT_ASSIGNMENTS;
  const assignments = [
    { employee_id: employees[0]!.id, employee_stage: 'PROBATION', work_date: '2026-10-24', shift_code: 'CA_SANG', start_at: '07:00', end_at: '12:00', scheduled_hours: 5, status: 'PUBLISHED', day_type: 'WORK', note: 'Ca sáng thử việc' },
    { employee_id: employees[1]!.id, employee_stage: 'OFFICIAL', work_date: '2026-10-26', shift_code: 'CA_CHIEU', start_at: '12:00', end_at: '17:00', scheduled_hours: 5, status: 'PUBLISHED', day_type: 'WORK', note: 'Ca chiều chính thức' },
    { employee_id: employees[1]!.id, employee_stage: 'OFFICIAL', work_date: '2026-10-25', shift_code: 'CA_TOI', start_at: '17:00', end_at: '22:30', scheduled_hours: 5.5, status: 'DRAFT', day_type: 'WORK', note: 'Ca tối cuối tuần' },
  ].map((a) => ({
    ...sys(newId()),
    schedule_week_id: 'WK-2026-10',
    branch_id: cn1,
    shift_template_id: shifts[0]!.id,
    source: 'SEED',
    swapped_from_employee_id: '',
    replacement_for_employee_id: '',
    published_at: a.status === 'PUBLISHED' ? now : '',
    ...a,
  }));
  gw.seed(MEMORY_IDS.SCHEDULE, 'SHIFT_ASSIGNMENTS', [[...assignHeaders], ...assignments.map((a) => row(assignHeaders, a))]);

  seedExtraTables(gw, {
    cn1,
    emp1Id: employees[0]!.id,
    emp2Id: employees[1]!.id,
    assign1Id: assignments[0]!.id,
    assign2Id: assignments[1]!.id,
  });

  return gw;
}
