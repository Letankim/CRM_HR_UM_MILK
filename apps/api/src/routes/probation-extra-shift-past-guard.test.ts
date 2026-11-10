import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

describe('Đăng ký thêm ca thử việc — Chặn tuyệt đối ca có giờ bắt đầu đã qua', () => {
  let t: TestAppContext;
  const web = { 'x-umbm-client': 'web' };

  beforeAll(async () => {
    t = await buildTestApp('prob_extra_past_guard');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('Chặn đăng ký ca hôm nay nếu giờ bắt đầu của ca đã qua so với giờ hiện tại', async () => {
    const { todayStr, nowHm } = getVnNowDateAndHm();
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;

    // Cập nhật chu kỳ thử việc của NV0001 bao gồm ngày hôm nay
    await t.db.employees.update(probEmp.id, probEmp.version, {
      probation_start: todayStr,
      probation_end: dayjs(todayStr).add(11, 'day').format('YYYY-MM-DD'),
    }, 'test');

    const admin = await t.loginHeaders('admin');
    const passedStartHm = '00:01';
    const futureEndHm = '23:59';
    const createTpl = await t.app.inject({
      method: 'POST',
      url: '/api/admin/shift-templates',
      headers: admin,
      payload: {
        code: 'CA_PAST_START',
        name: 'Ca bắt đầu sáng sớm',
        start_time: passedStartHm,
        end_time: futureEndHm,
        standard_hours: 5,
      },
    });
    expect(createTpl.statusCode).toBe(201);

    const nv1 = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };

    // 1. Kiểm tra API GET /api/my-attendance/shift-availability
    const availRes = await t.app.inject({
      method: 'GET',
      url: `/api/my-attendance/shift-availability?work_date=${todayStr}&shift_code=CA_PAST_START`,
      headers: nv1,
    });
    expect(availRes.statusCode).toBe(200);
    const availData = availRes.json().data;
    expect(availData.canRegister).toBe(false);
    expect(availData.message).toContain('đã qua giờ bắt đầu');

    // 2. Thử gọi API POST /api/my-attendance/shifts với ca đã qua giờ bắt đầu
    const postRes = await t.app.inject({
      method: 'POST',
      url: '/api/my-attendance/shifts',
      headers: nv1,
      payload: {
        work_date: todayStr,
        shift_code: 'CA_PAST_START',
        note: 'Đăng ký ca đã qua giờ bắt đầu',
      },
    });
    expect(postRes.statusCode).toBe(400);
    const postBody = postRes.json();
    expect(postBody.success).toBe(false);
    expect(JSON.stringify(postBody)).toContain('đã qua giờ bắt đầu');

    // 3. Thử gọi API POST /api/me/probation-extra-shift với ca đã qua giờ bắt đầu
    const postSelfRes = await t.app.inject({
      method: 'POST',
      url: '/api/me/probation-extra-shift',
      headers: nv1,
      payload: {
        work_date: todayStr,
        shift_code: 'CA_PAST_START',
        note: 'Đăng ký ca đẩy nhanh đã qua giờ bắt đầu',
      },
    });
    expect(postSelfRes.statusCode).toBe(400);
    const postSelfBody = postSelfRes.json();
    expect(postSelfBody.success).toBe(false);
    expect(JSON.stringify(postSelfBody)).toContain('đã qua giờ bắt đầu');
  });

  it('Cho phép đăng ký ca ngày mai trong chu kỳ thử việc', async () => {
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const tomorrowStr = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const nv1 = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };

    const availRes = await t.app.inject({
      method: 'GET',
      url: `/api/my-attendance/shift-availability?work_date=${tomorrowStr}&shift_code=CA_PAST_START`,
      headers: nv1,
    });
    expect(availRes.statusCode).toBe(200);
    const availData = availRes.json().data;
    expect(availData.canRegister).toBe(true);
  });
});
