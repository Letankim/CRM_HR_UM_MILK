import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySecret } from '../auth/password.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

describe('Đồng bộ & lấy thông tin chung khi liên kết Tài khoản có sẵn <-> Hồ sơ Nhân sự & chuyển đổi Vai trò', () => {
  let t: TestAppContext;

  beforeAll(async () => {
    t = await buildTestApp('acc_emp_link_sync');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('1. GET /api/admin/accounts/:id trả đầy đủ thông tin chung và liên kết vào Hồ sơ Nhân sự mới (giữ nguyên PIN hiện tại, dọn sạch hồ sơ tạm)', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const branches = t.db.branches.all();
    const branch2 = branches[1] ?? branches[0]!;

    // Admin tạo tài khoản trước (chưa có hồ sơ nhân sự HR) với mã PIN riêng 846291
    const createAcc = await t.app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: {
        username: 'nv.minhanh',
        display_name: 'Nguyễn Thị Minh Anh',
        phone_number: '0919111222',
        email: 'minhanh.link@gmail.com',
        role: 'CHINH_THUC',
        secret: '846291',
        branch_scope: branch2.id,
      },
    });
    expect(createAcc.statusCode).toBe(201);
    const createdUserId = createAcc.json().data.user.id as string;

    // Kích hoạt và giả lập người dùng vào /api/my-attendance khiến hệ thống sinh hồ sơ tạm (giống thực tế production)
    await t.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${createdUserId}/activate`,
      headers: admin,
      payload: { version: createAcc.json().data.version },
    });
    const uBefore = t.db.users.get(createdUserId)!;
    await t.db.users.update(createdUserId, uBefore.version, { must_change_pin: false }, 'test');
    const empLogin = await t.login('0919111222', '846291', 'employee');
    const myAtt = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: { cookie: empLogin.cookie, 'x-umbm-client': 'web' } });
    expect(myAtt.statusCode).toBe(200);
    const placeholderEmp = t.db.employees.find((e) => e.user_id === createdUserId)!;
    expect(placeholderEmp.note).toBe('Hồ sơ nhân sự liên kết tài khoản hệ thống');

    // HR gọi GET /api/admin/accounts/:id để lấy thông tin chung đối chiếu biểu mẫu
    const accDetail = await t.app.inject({
      method: 'GET',
      url: `/api/admin/accounts/${createdUserId}`,
      headers: hr,
    });
    expect(accDetail.statusCode).toBe(200);
    const accData = accDetail.json().data;
    expect(accData.displayName).toBe('Nguyễn Thị Minh Anh');
    expect(accData.phone).toBe('0919111222');
    expect(accData.email).toBe('minhanh.link@gmail.com');
    expect(accData.primaryBranchId).toBe(branch2.id);
    expect(accData.isPlaceholderEmployee).toBe(true);
    expect(accData.employeeId).toBeNull();

    // HR tạo Hồ sơ Nhân sự mới và chọn Liên kết tài khoản có sẵn (auto-fill Họ tên, SĐT, Email, Chi nhánh, Giai đoạn; để trống initial_pin)
    const createEmp = await t.app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers: hr,
      payload: {
        full_name: accData.displayName,
        phone_number: accData.phone,
        email: accData.email,
        branch_id: accData.primaryBranchId,
        stage: 'OFFICIAL',
        employment_type: 'FULL_TIME',
        staff_group: 'BARISTA',
        create_account: false,
        link_user_id: createdUserId,
        initial_pin: '',
      },
    });
    expect(createEmp.statusCode).toBe(201);
    const empData = createEmp.json().data;
    expect(empData.userId).toBe(createdUserId);
    expect(empData.username).toBe('nv.minhanh');

    // Hồ sơ tạm đã được dọn sạch (soft-delete) và mã PIN gốc 846291 của tài khoản được giữ nguyên (không bị ghi đè thành DEMO_PIN)
    expect(t.db.employees.get(placeholderEmp.id)).toBeUndefined();
    const userAfter = t.db.users.get(createdUserId)!;
    expect(userAfter.employee_id).toBe(empData.employeeCode);
    expect(await verifySecret(userAfter.password_hash, '846291')).toBe(true);
  });

  it('2. GET /api/admin/employees/:id lấy thông tin chung nhân sự và liên kết mượt vào Tài khoản mới + chuyển đổi Vai trò PIN/Mật khẩu chuẩn xác', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const branch1 = t.db.branches.all()[0]!;

    // HR tạo Hồ sơ Nhân sự chưa gắn tài khoản trước
    const createEmp = await t.app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers: hr,
      payload: {
        full_name: 'Lê Hoàng Nam',
        phone_number: '0919333444',
        email: 'hoangnam.nv@gmail.com',
        branch_id: branch1.id,
        stage: 'OFFICIAL',
        employment_type: 'FULL_TIME',
        staff_group: 'CASHIER',
        create_account: false,
      },
    });
    expect(createEmp.statusCode).toBe(201);
    const empCode = createEmp.json().data.employeeCode as string;

    // Admin gọi GET /api/admin/employees/:code khi chọn Nhân sự liên kết trên modal Thêm Tài khoản
    const empDetail = await t.app.inject({
      method: 'GET',
      url: `/api/admin/employees/${empCode}`,
      headers: admin,
    });
    expect(empDetail.statusCode).toBe(200);
    const fetchedEmp = empDetail.json().data;
    expect(fetchedEmp.fullName).toBe('Lê Hoàng Nam');
    expect(fetchedEmp.phone).toBe('0919333444');
    expect(fetchedEmp.email).toBe('hoangnam.nv@gmail.com');
    expect(fetchedEmp.branchId).toBe(branch1.id);
    expect(fetchedEmp.stage).toBe('OFFICIAL');

    // Admin lưu Tài khoản mới với thông tin đã auto-fill từ hồ sơ nhân sự (không bị báo lỗi trùng SĐT/Email với chính nhân sự đó)
    const createAcc = await t.app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: {
        username: 'nv.namlh',
        display_name: fetchedEmp.fullName,
        phone_number: fetchedEmp.phone,
        email: fetchedEmp.email,
        role: 'CHINH_THUC',
        secret: '228826',
        employee_id: empCode,
        branch_scope: fetchedEmp.branchId,
      },
    });
    expect(createAcc.statusCode).toBe(201);
    const newUserId = createAcc.json().data.user.id as string;
    expect(t.db.employees.get(fetchedEmp.id)!.user_id).toBe(newUserId);

    // Chuyển đổi vai trò từ CHINH_THUC -> STORE (mật khẩu chữ) và ngược lại STORE -> THU_VIEC (mã PIN 6 chữ số)
    const toStore = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/accounts/${newUserId}`,
      headers: admin,
      payload: { version: t.db.users.get(newUserId)!.version, role: 'STORE', secret: 'Umbm@2026S' },
    });
    expect(toStore.statusCode).toBe(200);

    const toProbation = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/accounts/${newUserId}`,
      headers: admin,
      payload: { version: t.db.users.get(newUserId)!.version, role: 'THU_VIEC', secret: '556677' },
    });
    expect(toProbation.statusCode).toBe(200);
  });
});
