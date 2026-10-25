import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../data/database.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let app: FastifyInstance;
let db: Database;
let loginHeaders: TestAppContext['loginHeaders'];

beforeAll(async () => {
  ({ app, db, loginHeaders } = await buildTestApp('y'));
});

afterAll(async () => {
  await app.close();
});

describe('AI-TAB-04, 16, 17, 18, 29: Hồ sơ Nhân sự, Cô lập Chi nhánh & Chuyển Chính thức', () => {
  it('ADMIN xem được danh sách nhân sự nhưng bị chặn tạo mới; STORE bị chặn truy cập chéo chi nhánh (ADM-04, STR-02)', async () => {
    const adminHeaders = await loginHeaders('admin');
    const storeHeaders = await loginHeaders('store1');
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/employees?page=1&per_page=10',
      headers: adminHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().meta.pagination.total).toBeGreaterThanOrEqual(3);

    const cn1 = db.branches.all()[0]!.id;
    const cn2 = db.branches.all()[1]!.id;
    const crossBranchRes = await app.inject({ method: 'GET', url: `/api/admin/employees?branch_id=${cn2}`, headers: storeHeaders });
    expect(crossBranchRes.statusCode).toBe(403);

    const storeBranchesRes = await app.inject({ method: 'GET', url: '/api/admin/branches', headers: storeHeaders });
    expect(storeBranchesRes.statusCode).toBe(200);
    expect(storeBranchesRes.json().data.map((b: { id: string }) => b.id)).toEqual([cn1]);

    const storeEmpsRes = await app.inject({ method: 'GET', url: '/api/admin/employees', headers: storeHeaders });
    expect(storeEmpsRes.statusCode).toBe(200);
    for (const emp of storeEmpsRes.json().data) {
      expect(emp.branchId).toBe(cn1);
      expect(emp.salaryOfficialAmountVnd).toBe(0);
      expect(emp.bankAccountNumber).toBe('');
      expect(emp.citizenId).toBe('');
    }

    const rawEv = db.attendanceEvents.all()[0]!;
    const storeDelEventRes = await app.inject({ method: 'DELETE', url: `/api/admin/attendance/events/${rawEv.id}`, headers: storeHeaders, payload: { version: 1 } });
    expect(storeDelEventRes.statusCode).toBe(403);

    const createRes = await app.inject({
      method: 'POST', url: '/api/admin/employees', headers: adminHeaders,
      payload: { full_name: 'Admin Cố Tạo', phone: '0908887771', branch_id: cn1, staff_group: 'BARISTA', position_title: 'Pha chế', stage: 'PROBATION', employment_type: 'PART_TIME', default_shift_code: 'CA_SANG' },
    });
    expect(createRes.statusCode).toBe(403);
  });

  it('HR tạo hồ sơ nhân sự mới -> tự động tạo tài khoản PENDING_ACTIVATION qua Saga và chuyển chính thức giữ nguyên mã NV', async () => {
    const hrHeaders = await loginHeaders('hr');
    const cn1 = db.branches.all()[0]!.id;

    const badPhoneRes = await app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hrHeaders,
      payload: { full_name: 'Nguyễn Sai SĐT', phone: '123456', branch_id: cn1, staff_group: 'BARISTA', position_title: 'Pha chế', stage: 'PROBATION', employment_type: 'PART_TIME', default_shift_code: 'CA_SANG' },
    });
    expect(badPhoneRes.statusCode).toBe(400);
    expect(badPhoneRes.json().errors.details[0].code).toBe('INVALID_PHONE');

    const createRes = await app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hrHeaders,
      payload: {
        full_name: 'Lê Hoàng Minh Anh', phone: '0908889990', branch_id: cn1, staff_group: 'BARISTA',
        position_title: 'Pha chế', stage: 'PROBATION', employment_type: 'PART_TIME', default_shift_code: 'CA_SANG',
        probation_start: '2026-10-10', probation_end: '2026-10-21', salary: { rate_type: 'HOURLY', amount_vnd: 28000, probation_percent: 85 },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdEmp = createRes.json().data;
    expect(createdEmp.phone).toBe('0908889990');
    expect(createdEmp.stage).toBe('PROBATION');
    expect(createdEmp.accountStatus).toBe('PENDING_ACTIVATION');
    expect(createdEmp.salaryEffectiveAmountVnd).toBe(23800);

    const promoteRes = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${createdEmp.id}/promote-official`,
      headers: hrHeaders,
      payload: {
        version: createdEmp.version,
        official_from: '2026-10-22',
        note: 'Đạt 100% chu kỳ thử việc 12 ngày',
      },
    });
    expect(promoteRes.statusCode).toBe(200);
    const promoted = promoteRes.json().data;
    expect(promoted.employeeCode).toBe(createdEmp.employeeCode);
    expect(promoted.stage).toBe('OFFICIAL');
    expect(promoted.probationStart).toBe('2026-10-10');
    expect(promoted.salaryEffectiveAmountVnd).toBe(28000);

    const linkedUser = db.users.get(promoted.userId);
    expect(linkedUser?.role).toBe('CHINH_THUC');
    expect(linkedUser?.employee_id).toBe(promoted.employeeCode);

    // Kiểm tra liên kết 2 chiều khi tạo tài khoản độc lập rồi gắn với hồ sơ nhân sự
    const adminHeaders = await loginHeaders('admin');
    const standaloneUserRes = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: adminHeaders,
      payload: {
        username: 'nv.lienket2chieu',
        display_name: 'Tài khoản Liên kết 2 Chiều',
        phone_number: '0908889995',
        role: 'CHINH_THUC',
        secret: '246810',
      },
    });
    expect(standaloneUserRes.statusCode).toBe(201);
    const standaloneUser = standaloneUserRes.json().data.user;

    // Gắn tài khoản từ phía Hồ sơ nhân sự (PUT /api/admin/employees/:id với link_user_id)
    const linkFromEmpRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/employees/${promoted.id}`,
      headers: hrHeaders,
      payload: {
        version: promoted.version,
        link_user_id: standaloneUser.id,
      },
    });
    expect(linkFromEmpRes.statusCode).toBe(200);
    expect(linkFromEmpRes.json().data.username).toBe('nv.lienket2chieu');
    expect(db.users.get(standaloneUser.id)?.employee_id).toBe(promoted.employeeCode);

    // Kiểm tra GET /api/admin/accounts trả về thông tin Hồ sơ nhân sự liên kết
    const accListRes = await app.inject({
      method: 'GET',
      url: '/api/admin/accounts?search=nv.lienket2chieu',
      headers: adminHeaders,
    });
    expect(accListRes.statusCode).toBe(200);
    expect(accListRes.json().data[0].employeeId).toBe(promoted.employeeCode);
    expect(accListRes.json().data[0].employeeName).toBe('Lê Hoàng Minh Anh');

    // Tạo 1 ca làm việc cho nhân sự tại CN01, sau đó đổi chi nhánh bên Tài khoản sang CN02 -> Lịch ca & Hồ sơ nhân sự tự động chuyển sang CN02, Quản lý CN01 (store1) không còn thấy
    await app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrHeaders, payload: { employee_id: promoted.id, work_date: '2026-10-25', shift_code: 'CA_SANG' } });
    const cn2 = db.branches.all()[1]!.id;
    const curUser = db.users.get(standaloneUser.id)!;
    const updAccBranchRes = await app.inject({
      method: 'PUT', url: `/api/admin/accounts/${standaloneUser.id}`, headers: adminHeaders,
      payload: { version: curUser.version, branch_scope: cn2, employee_id: promoted.employeeCode },
    });
    expect(updAccBranchRes.statusCode).toBe(200);
    expect(db.employees.get(promoted.id)?.branch_id).toBe(cn2);
    const storeHeaders = await loginHeaders('store1');
    const storeSchedAfterMove = await app.inject({ method: 'GET', url: '/api/admin/schedules', headers: storeHeaders });
    expect(storeSchedAfterMove.json().data.some((s: { employeeId: string }) => s.employeeId === promoted.id)).toBe(false);

    // Ngược lại, khi đổi chi nhánh bên Hồ sơ nhân sự về lại CN01 -> Tài khoản & Lịch phân ca tự động đồng bộ về CN01
    const curEmp = db.employees.get(promoted.id)!;
    const updEmpBranchRes = await app.inject({
      method: 'PUT', url: `/api/admin/employees/${promoted.id}`, headers: hrHeaders,
      payload: { version: curEmp.version, branch_id: cn1, link_user_id: standaloneUser.id },
    });
    expect(updEmpBranchRes.statusCode).toBe(200);
    expect(db.users.get(standaloneUser.id)?.branch_scope).toBe(cn1);
    const storeSchedAfterBack = await app.inject({ method: 'GET', url: '/api/admin/schedules', headers: storeHeaders });
    expect(storeSchedAfterBack.json().data.some((s: { employeeId: string }) => s.employeeId === promoted.id)).toBe(true);
  });
});

describe('AI-TAB-05 & AI-TAB-10: Chi nhánh, Khung ca & Nhật ký Kiểm toán', () => {
  it('ADMIN quản lý Chi nhánh & Khung ca và truy vấn Nhật ký Kiểm toán Bất biến', async () => {
    const adminHeaders = await loginHeaders('admin');
    const hrHeaders = await loginHeaders('hr');

    const createBranchRes = await app.inject({
      method: 'POST', url: '/api/admin/branches', headers: adminHeaders,
      payload: { code: 'CN05', name: 'Ụm Bò Milk Chi nhánh 5', address: 'Quận 7, TP. Hồ Chí Minh', lat: 10.734, lng: 106.721, radius_m: 100, max_accuracy_m: 50, phone_contact: '0901000005', open_time: '07:00', close_time: '22:30', effective_from: '2026-10-24' },
    });
    expect(createBranchRes.statusCode).toBe(201);
    expect(createBranchRes.json().data.code).toBe('CN05');

    const shiftsRes = await app.inject({ method: 'GET', url: '/api/admin/shift-templates', headers: adminHeaders });
    expect(shiftsRes.statusCode).toBe(200);
    expect(shiftsRes.json().data.length).toBeGreaterThanOrEqual(3);

    const hrAuditRes = await app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: hrHeaders });
    expect(hrAuditRes.statusCode).toBe(403);

    const adminAuditRes = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?page=1&per_page=20', headers: adminHeaders });
    expect(adminAuditRes.statusCode).toBe(200);
    expect(adminAuditRes.json().data.length).toBeGreaterThan(0);
  });
});
