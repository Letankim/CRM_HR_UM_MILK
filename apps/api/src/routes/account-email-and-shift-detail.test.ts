import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('m');
});

afterAll(async () => {
  await t.app.close();
});

describe('Account Credential Email Queue & Completed Shift Attendance Detail', () => {
  it('1. POST /api/admin/accounts with email queues credential email containing username & password/PIN without leaking secret to AUDIT_LOG', async () => {
    const headers = await t.loginHeaders('admin');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers,
      payload: {
        username: 'nv.letankim',
        display_name: 'Lê Tấn Kim',
        phone_number: '0919888777',
        email: 'letankim2003@gmail.com',
        role: 'THU_VIEC',
        secret: '163609',
        branch_scope: 'ALL',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.emailQueued).toBe(true);
    expect(body.data.queuedToEmail).toBe('letankim2003@gmail.com');

    const recent = t.email.recent(20);
    const queuedMail = recent.find((m) => m.to === 'letankim2003@gmail.com' && m.subject.includes('@nv.letankim'));
    expect(queuedMail).toBeTruthy();
    expect(queuedMail!.html).toContain('nv.letankim');
    expect(queuedMail!.html).toContain('0919888777');
    expect(queuedMail!.html).toContain('Mật khẩu / Mã PIN đăng nhập');
    expect(queuedMail!.html).toContain('163609');

    const auditRes = await t.app.inject({ method: 'GET', url: '/api/admin/audit-logs?per_page=20', headers });
    expect(JSON.stringify(auditRes.json())).not.toContain('163609');

    // Resetting password via PUT /api/admin/accounts/:id also queues new password email
    const putRes = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/accounts/${body.data.user.id}`,
      headers,
      payload: {
        version: body.data.version,
        secret: '654321',
        reason: 'Cấp lại mã PIN theo yêu cầu nhân sự',
      },
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.data.emailQueued).toBe(true);
    const resetMail = t.email.recent(20).find((m) => m.to === 'letankim2003@gmail.com' && m.subject.includes('Cập nhật tài khoản và mật khẩu @nv.letankim'));
    expect(resetMail).toBeTruthy();
    expect(resetMail!.html).toContain('654321');
  });

  it('2. POST /api/admin/accounts without email does not leak secret to fallback admin audit email', async () => {
    const headers = await t.loginHeaders('admin');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers,
      payload: {
        username: 'nv.nomail99',
        display_name: 'Nhân Viên Không Email',
        phone_number: '0919777666',
        email: '',
        role: 'THU_VIEC',
        secret: '987654',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.emailQueued).toBe(false);
    expect(body.data.queuedToEmail).toBeNull();

    const auditMail = t.email.recent(20).find((m) => m.subject.includes('@nv.nomail99'));
    expect(auditMail).toBeTruthy();
    expect(auditMail!.html).not.toContain('987654');
  });

  it('3. POST /api/admin/employees with create_account & email queues onboarding email with credentials', async () => {
    const headers = await t.loginHeaders('hr');
    const branch = t.db.branches.all()[0]!;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers,
      payload: {
        full_name: 'Trần Hoàng Minh',
        phone_number: '0919666555',
        email: 'tranhoangminh2002@gmail.com',
        branch_id: branch.id,
        staff_group: 'BARISTA',
        stage: 'PROBATION',
        create_account: true,
        username: 'nv.minh2002',
        initial_pin: '246810',
      },
    });
    expect(res.statusCode).toBe(201);
    const onboardMail = t.email.recent(20).find((m) => m.to === 'tranhoangminh2002@gmail.com');
    expect(onboardMail).toBeTruthy();
    expect(onboardMail!.html).toContain('nv.minh2002');
    expect(onboardMail!.html).toContain('246810');
  });

  it('4. GET /api/admin/attendance/shift-detail/:assignmentId returns check-in/out & adjustment details and enforces RBAC', async () => {
    const hrHeaders = await t.loginHeaders('hr');
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001') ?? t.db.employees.all()[0]!;
    const emp2 = t.db.employees.find((e) => e.id !== emp1.id)!;
    const branch = t.db.branches.get(emp1.branch_id)!;

    const createShiftRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: hrHeaders,
      payload: {
        employee_id: emp1.id,
        work_date: '2026-11-18',
        shift_code: 'CA_SANG',
        status: 'PUBLISHED',
        day_type: 'WORK',
        scheduled_hours: 5,
        note: 'Ca sáng hoàn thành',
      },
    });
    expect(createShiftRes.statusCode).toBe(201);
    const shift = createShiftRes.json().data;

    const checkInRes = await t.app.inject({
      method: 'POST',
      url: '/api/attendance/check',
      headers: hrHeaders,
      payload: {
        assignment_id: shift.id,
        type: 'CHECK_IN',
        lat: branch.lat,
        lng: branch.lng,
        accuracy_m: 10,
        selfie_source: 'LIVE_CAMERA',
      },
    });
    expect(checkInRes.statusCode).toBe(201);

    const checkOutRes = await t.app.inject({
      method: 'POST',
      url: '/api/attendance/check',
      headers: hrHeaders,
      payload: {
        assignment_id: shift.id,
        type: 'CHECK_OUT',
        lat: branch.lat,
        lng: branch.lng,
        accuracy_m: 12,
        selfie_source: 'LIVE_CAMERA',
      },
    });
    expect(checkOutRes.statusCode).toBe(201);

    const detailRes = await t.app.inject({
      method: 'GET',
      url: `/api/admin/attendance/shift-detail/${shift.id}`,
      headers: hrHeaders,
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json();
    expect(detailBody.success).toBe(true);
    expect(detailBody.data.shiftStatus).toBe('COMPLETED');
    expect(detailBody.data.checkInEvent).toBeTruthy();
    expect(detailBody.data.checkOutEvent).toBeTruthy();
    expect(detailBody.data.checkInEvent.photoUrl).toBeTruthy();
    expect(detailBody.data.checkOutEvent.photoUrl).toBeTruthy();

    // Employee self-access check: emp1 user can view own shift, blocked from emp2 shift
    const emp1User = t.db.users.find((u) => u.id === emp1.user_id || u.employee_id === emp1.employee_code);
    if (emp1User) {
      const empLogin = await t.login(emp1User.username, DEMO_PIN, 'employee');
      if (empLogin.cookie) {
        const empHeaders = { cookie: empLogin.cookie, 'x-umbm-client': 'web' };
        const selfRes = await t.app.inject({ method: 'GET', url: `/api/admin/attendance/shift-detail/${shift.id}`, headers: empHeaders });
        expect(selfRes.statusCode).toBe(200);

        const otherShift = t.db.shiftAssignments.find((s) => s.employee_id === emp2.id || s.employee_id === emp2.employee_code);
        if (otherShift) {
          const forbiddenRes = await t.app.inject({ method: 'GET', url: `/api/admin/attendance/shift-detail/${otherShift.id}`, headers: empHeaders });
          expect(forbiddenRes.statusCode).toBe(403);
        }
      }
    }
  });
});
