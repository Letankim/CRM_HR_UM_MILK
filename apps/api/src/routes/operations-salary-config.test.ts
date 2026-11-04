import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adm: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let fin: Awaited<ReturnType<TestAppContext['loginHeaders']>>;

beforeAll(async () => {
  t = await buildTestApp('s');
  adm = await t.loginHeaders('admin');
  fin = await t.loginHeaders('finance');
});
afterAll(async () => {
  await t.app.close();
});

describe('Cấu hình Vận hành & Công chuẩn cá nhân hóa (AI-TAB-42, FIN-05)', () => {
  it('GET /api/admin/operations-config trả về công chuẩn tháng và giờ chuẩn ngày mặc định', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/operations-config', headers: adm });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.settings.standardWorkDaysPerMonth).toBe(26);
    expect(body.data.settings.standardHoursPerDay).toBe(8);
  });

  it('PUT /api/admin/operations-config cho phép Quản trị cập nhật công chuẩn toàn hệ thống', async () => {
    const updateRes = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/operations-config',
      headers: adm,
      payload: {
        pin_rotation_days: 90,
        off_window_open_weekday: 1,
        off_window_open_time: '00:00',
        off_window_close_weekday: 3,
        off_window_close_time: '23:59',
        official_weekly_off_limit: 2,
        max_shifts_per_day: 2,
        checkout_max_late_hours: 2,
        standard_work_days_per_month: 24,
        standard_hours_per_day: 8,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.settings.standardWorkDaysPerMonth).toBe(24);
    expect(updateRes.json().data.settings.standardHoursPerDay).toBe(8);
  });

  it('Tạo hồ sơ lương mới tự động kế thừa công chuẩn hệ thống (24 ngày) khi không chỉ định', async () => {
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/payroll/salary-profiles',
      headers: fin,
      payload: {
        employee_id: emp.id,
        rate_type: 'MONTHLY',
        amount_vnd: 8_400_000,
        probation_percent: 85,
        effective_from: '2026-11-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.standardWorkDays).toBe(24);
    expect(res.json().data.standardHoursPerDay).toBe(8);
  });

  it('Tùy chỉnh riêng công chuẩn (22 ngày, 8h/ngày) cho nhân sự văn phòng nội bộ', async () => {
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/payroll/salary-profiles',
      headers: fin,
      payload: {
        employee_id: emp.id,
        rate_type: 'MONTHLY',
        amount_vnd: 12_000_000,
        probation_percent: 100,
        standard_work_days: 22,
        standard_hours_per_day: 8,
        ot_multiplier: 1.5,
        effective_from: '2026-11-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.standardWorkDays).toBe(22);
    expect(res.json().data.standardHoursPerDay).toBe(8);
  });

  it('Hỗ trợ thiết lập hồ sơ lương cho tài khoản nội bộ (HR / MKT / FINANCE / STORE)', async () => {
    const hrUser = t.db.users.find((u) => u.role === 'HR')!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/payroll/salary-profiles',
      headers: fin,
      payload: {
        employee_id: hrUser.id,
        rate_type: 'MONTHLY',
        amount_vnd: 10_500_000,
        probation_percent: 100,
        standard_work_days: 22,
        standard_hours_per_day: 8,
        effective_from: '2026-11-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.employeeCode).toBeTruthy();
    expect(res.json().data.amountVnd).toBe(10_500_000);
  });
});
