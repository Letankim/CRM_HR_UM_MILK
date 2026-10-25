/**
 * Đồng bộ toàn bộ cấu trúc bảng (7 Spreadsheets, đầy đủ cột) và dữ liệu mẫu chuẩn
 * (SĐT bắt đầu bằng số 0, Nhân sự, Bậc lương, Kỳ lương, Phiếu lương mẫu) lên Google Sheets.
 */
import { createGoogleClients } from '@umbm/google';
import { SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import { hashSecret } from '../src/auth/password.js';
import { loadEnv, sheetIds } from '../src/config/env.js';
import { Database } from '../src/data/database.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../src/data/memory-seed.js';
import { nowIso } from '../src/lib/time.js';
import { GoogleSheetsGateway } from '../src/sheets/gateway.js';
import { WriteQueue } from '../src/sheets/write-queue.js';

async function main() {
  const env = loadEnv();
  const clients = createGoogleClients({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });
  const ids = sheetIds(env);
  const gw = new GoogleSheetsGateway(clients.sheets);

  for (const key of Object.keys(SPREADSHEETS) as SpreadsheetKey[]) {
    const spreadsheetId = ids[key];
    for (const [tab, headers] of Object.entries(SPREADSHEETS[key].tabs)) {
      if (tab === 'AUDIT_LOG') continue;
      await gw.ensureTab(spreadsheetId, tab, headers as readonly string[]);
      await gw.updateRow(spreadsheetId, tab, 1, [...(headers as readonly string[])]);
    }
  }
  console.log('Đã đồng bộ đầy đủ cấu trúc cột (Schema V5.1) trên toàn bộ 7 Google Spreadsheets.');

  const db = new Database(gw, new WriteQueue(), ids);
  await db.loadAll();

  if (db.branches.all().length === 0) {
    const branches = [
      { code: 'CN01', name: 'Ụm Bò Milk Chi nhánh 1', lat: 10.7769, lng: 106.7009 },
      { code: 'CN02', name: 'Ụm Bò Milk Chi nhánh 2', lat: 10.8012, lng: 106.7143 },
      { code: 'CN03', name: 'Ụm Bò Milk Chi nhánh 3', lat: 10.7626, lng: 106.6602 },
      { code: 'CN04', name: 'Ụm Bò Milk Chi nhánh 4', lat: 10.8231, lng: 106.6297 },
    ];
    for (const b of branches) {
      await db.branches.insert(
        {
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
        },
        'seed',
      );
    }
  }

  const cn1 = db.branches.all()[0]!.id;
  const pwHash = await hashSecret(DEMO_PASSWORD);
  const pinHash = await hashSecret(DEMO_PIN);
  const now = nowIso();

  const sampleUsers = [
    { username: 'hr', display_name: 'Nguyễn Thị Nhân Sự', role: 'HR' as const, branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'store1', display_name: 'Trần Văn Cửa Hàng', role: 'STORE' as const, branch_scope: cn1, phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'finance', display_name: 'Lê Thị Kế Toán', role: 'FINANCE' as const, branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'mkt', display_name: 'Phạm Minh Truyền Thông', role: 'MKT' as const, branch_scope: 'ALL', phone: '', password_hash: pwHash, employee_id: '', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'nv.thuviec', display_name: 'Võ Thị Thử Việc', role: 'THU_VIEC' as const, branch_scope: cn1, phone: '0901000001', password_hash: pinHash, employee_id: 'NV0001', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'nv.chinhthuc', display_name: 'Đặng Văn Chính Thức', role: 'CHINH_THUC' as const, branch_scope: cn1, phone: '0901000002', password_hash: pinHash, employee_id: 'NV0002', status: 'ACTIVE' as const, activated_by: 'seed', activated_at: now },
    { username: 'nv.moi', display_name: 'Bùi Thị Mới', role: 'THU_VIEC' as const, branch_scope: cn1, phone: '0901000003', password_hash: pinHash, employee_id: 'NV0003', status: 'PENDING_ACTIVATION' as const, activated_by: '', activated_at: '' },
  ];

  for (const u of sampleUsers) {
    const existing = db.users.find((x) => x.username.toLowerCase() === u.username.toLowerCase());
    if (!existing) {
      await db.users.insert(
        { ...u, permissions_json: '[]', session_version: 1, failed_login_count: 0, locked_until: '', last_login_at: '', revoked_at: '', email: '', revoked_by: '', revoke_reason: '' },
        'seed',
      );
    } else if ((u.phone && existing.phone !== u.phone) || (u.employee_id && existing.employee_id !== u.employee_id)) {
      await db.users.update(existing.id, existing.version, { phone: u.phone || existing.phone, employee_id: u.employee_id || existing.employee_id }, 'seed');
    }
  }

  if (db.employees.all().length === 0) {
    const uTv = db.users.find((x) => x.username === 'nv.thuviec');
    const uCt = db.users.find((x) => x.username === 'nv.chinhthuc');
    const uMoi = db.users.find((x) => x.username === 'nv.moi');
    const sampleEmps = [
      { employee_code: 'NV0001', user_id: uTv?.id ?? '', full_name: 'Võ Thị Thử Việc', phone: '0901000001', stage: 'PROBATION' as const, branch_id: cn1, position_title: 'Pha chế', probation_start: '2026-10-01', probation_end: '2026-10-12', official_from: '', base_hourly_rate_vnd: 22000 },
      { employee_code: 'NV0002', user_id: uCt?.id ?? '', full_name: 'Đặng Văn Chính Thức', phone: '0901000002', stage: 'OFFICIAL' as const, branch_id: cn1, position_title: 'Thu ngân', probation_start: '2026-08-01', probation_end: '2026-08-12', official_from: '2026-08-13', base_hourly_rate_vnd: 28000 },
      { employee_code: 'NV0003', user_id: uMoi?.id ?? '', full_name: 'Bùi Thị Mới', phone: '0901000003', stage: 'PROBATION' as const, branch_id: cn1, position_title: 'Phục vụ', probation_start: '', probation_end: '', official_from: '', base_hourly_rate_vnd: 22000 },
    ];
    for (const e of sampleEmps) {
      await db.employees.insert(
        {
          ...e, staff_group: 'BARISTA', status: 'ACTIVE', candidate_id: '', email: '', date_of_birth: '2003-05-15', gender: 'Nữ',
          citizen_id: '', citizen_issue_date: '', permanent_address: 'TP. Hồ Chí Minh', current_address: 'TP. Hồ Chí Minh',
          emergency_contact_name: '', emergency_contact_phone: '', employment_type: 'PART_TIME', default_shift_code: 'CA_SANG',
          probation_cycle_days: 12, probation_work_days: 7, probation_off_days: 5, resigned_at: '', resign_reason: '',
          bank_name: 'Techcombank', bank_account_number: '1903888999001', bank_account_holder: e.full_name.toUpperCase(), tax_code: '', note: '',
        },
        'seed',
      );
    }
  } else {
    for (const emp of db.employees.all()) {
      const matched = db.users.find((u) => u.employee_id === emp.employee_code || Boolean(emp.phone && u.phone === emp.phone));
      if (matched && emp.user_id !== matched.id) {
        await db.employees.update(emp.id, emp.version, { user_id: matched.id }, 'seed');
      }
    }
  }

  if (db.shiftTemplates.all().length === 0) {
    const shiftDefs = [
      { code: 'CA_SANG', name: 'Ca sáng', start_time: '07:00', end_time: '12:00', standard_hours: 5 },
      { code: 'CA_CHIEU', name: 'Ca chiều', start_time: '12:00', end_time: '17:00', standard_hours: 5 },
      { code: 'CA_TOI', name: 'Ca tối', start_time: '17:00', end_time: '22:30', standard_hours: 5.5 },
    ];
    for (const s of shiftDefs) {
      await db.shiftTemplates.insert(
        {
          ...s,
          effective_from: '2026-01-01',
          effective_to: '',
          status: 'ACTIVE',
          shift_group: 'STORE',
          break_minutes: 0,
          is_overnight: false,
          note: '',
        },
        'seed',
      );
    }
  }

  // Chuyển đổi: bỏ cấu hình lương theo vai trò cũ (employee_id = ALL) -> Hồ sơ lương CÁ NHÂN từng nhân sự
  for (const legacy of db.payRates.filter((r) => r.employee_id === 'ALL' || !db.employees.get(r.employee_id))) {
    await db.payRates.softDelete(legacy.id, legacy.version, 'seed');
  }
  const demoSalary: Record<string, { rate_type: 'HOURLY' | 'MONTHLY'; amount_vnd: number; attendance_bonus_vnd: number; meal_allowance_per_shift_vnd: number; transport_allowance_vnd: number; note: string }> = {
    NV0001: { rate_type: 'HOURLY', amount_vnd: 28000, attendance_bonus_vnd: 300000, meal_allowance_per_shift_vnd: 15000, transport_allowance_vnd: 0, note: 'Pha chế — thử việc hưởng 85% đơn giá chính thức' },
    NV0002: { rate_type: 'HOURLY', amount_vnd: 30000, attendance_bonus_vnd: 300000, meal_allowance_per_shift_vnd: 15000, transport_allowance_vnd: 0, note: 'Thu ngân chính thức' },
    NV0003: { rate_type: 'MONTHLY', amount_vnd: 7500000, attendance_bonus_vnd: 0, meal_allowance_per_shift_vnd: 0, transport_allowance_vnd: 300000, note: 'Lương tháng cố định, công chuẩn 26 ngày' },
  };
  for (const emp of db.employees.all()) {
    const def = demoSalary[emp.employee_code];
    if (!def || db.payRates.find((r) => r.employee_id === emp.id)) continue;
    await db.payRates.insert(
      {
        employee_id: emp.id, ...def, stage: emp.stage, staff_group: emp.staff_group, probation_percent: 85, standard_work_days: 26,
        standard_hours_per_day: 8, ot_multiplier: 1.5, night_shift_allowance_vnd: 0, responsibility_allowance_vnd: 0, other_allowance_vnd: 0,
        effective_from: emp.probation_start || emp.official_from || '2026-10-01', effective_to: '', status: 'ACTIVE',
        approved_by: 'seed', approved_at: now, change_reason: 'Thiết lập lương ban đầu', previous_rate_id: '',
      },
      'seed',
    );
  }

  if (db.shiftAssignments.all().length === 0) {
    const emps = db.employees.all();
    const shifts = db.shiftTemplates.all();
    const today = new Date().toISOString().slice(0, 10);
    if (emps[0] && emps[1]) {
      for (const item of [
        { employee_id: emps[0].id, employee_stage: emps[0].stage, work_date: today, shift_code: 'CA_SANG', start_at: '07:00', end_at: '12:00', scheduled_hours: 5 },
        { employee_id: emps[1].id, employee_stage: emps[1].stage, work_date: today, shift_code: 'CA_CHIEU', start_at: '12:00', end_at: '17:00', scheduled_hours: 5 },
      ]) {
        await db.shiftAssignments.insert(
          {
            schedule_week_id: `WK-${today.slice(0, 7)}`,
            branch_id: cn1,
            shift_template_id: shifts[0]?.id ?? '',
            ...item,
            day_type: 'WORK',
            source: 'SEED',
            status: 'PUBLISHED',
            swapped_from_employee_id: '',
            replacement_for_employee_id: '',
            published_at: now,
            note: 'Phân ca mẫu',
          },
          'seed',
        );
      }
    }
  }

  console.log(
    `Hoàn tất! Chi nhánh: ${db.branches.all().length}, Khung ca: ${db.shiftTemplates.all().length}, Hồ sơ lương cá nhân: ${db.payRates.all().length}, Phân ca: ${db.shiftAssignments.all().length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
