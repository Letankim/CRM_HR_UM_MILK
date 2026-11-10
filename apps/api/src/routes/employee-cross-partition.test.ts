import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('p');
});

afterAll(async () => {
  await t.app.close();
});

describe('Bảo toàn Dữ liệu Cổng Nhân viên (Employee Portal) xuyên Phân vùng Tháng', () => {
  it('nhân viên vẫn thấy đủ ca làm việc và điểm danh khi Backoffice đổi sang phân vùng tháng khác', async () => {
    const admin = await t.loginHeaders('admin');
    const { cookie: empCookie } = await t.login('0901000002', DEMO_PIN, 'employee');
    const empH = { cookie: empCookie, 'x-umbm-client': 'web' };
    const empUser = t.db.users.find((u) => u.phone === '0901000002')!;
    const emp = t.db.employees.find((e) => e.user_id === empUser.id || e.employee_code === empUser.employee_id)!;
    const branch = t.db.branches.get(emp.branch_id)!;
    const today = dayjs().format('YYYY-MM-DD');

    // 1. Tạo 1 ca làm việc hôm nay cho nhân viên trên tệp hiện tại
    const shift = await t.db.shiftAssignments.insert({
      schedule_week_id: `WK-${today.slice(0, 7)}`,
      employee_id: emp.id,
      branch_id: branch.id,
      work_date: today,
      shift_template_id: 'tpl-sang',
      shift_code: 'CA_SANG',
      start_at: '07:00',
      end_at: '12:00',
      scheduled_hours: 5,
      status: 'PUBLISHED',
      source: 'MANUAL',
      employee_stage: 'OFFICIAL',
      day_type: 'WORK',
      published_at: today,
      note: 'Ca làm việc thử nghiệm xuyên phân vùng',
      swapped_from_employee_id: '',
      replacement_for_employee_id: '',
      linked_assignment_id: '',
    }, 'admin');

    // 2. Điểm danh vào ca để có sự kiện điểm danh
    const inRes = await t.app.inject({
      method: 'POST',
      url: '/api/attendance/check',
      headers: empH,
      payload: {
        assignment_id: shift.id,
        type: 'CHECK_IN',
        lat: branch.lat,
        lng: branch.lng,
        accuracy_m: 10,
        selfie_source: 'LIVE_CAMERA',
        photo_base64: 'data:image/jpeg;base64,test_selfie_data',
      },
    });
    expect(inRes.statusCode).toBe(201);

    // 3. Nhân viên gọi GET /api/my-attendance: thấy ca và sự kiện
    const resBefore = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: empH });
    expect(resBefore.statusCode).toBe(200);
    const bodyBefore = resBefore.json().data;
    expect(bodyBefore.shifts.some((s: { id: string }) => s.id === shift.id)).toBe(true);

    // 4. Backoffice chuyển sang phân vùng tháng mới (2027_06) - tệp rỗng
    const roll = await t.app.inject({
      method: 'POST',
      url: '/api/admin/data-partitions/rollover',
      headers: admin,
      payload: { month_key: '2027_06', carry_forward: false },
    });
    expect(roll.statusCode).toBe(201);
    expect(t.db.partitionMonth).toBe('2027_06');
    // Store in-memory hiện tại chỉ chứa phân vùng 2027_06 (0 ca)
    expect(t.db.shiftAssignments.all().length).toBe(0);

    // 5. CỔNG NHÂN VIÊN VẪN HOẠT ĐỘNG BÌNH THƯỜNG:
    // GET /api/my-attendance vẫn lấy được ca làm việc và sự kiện điểm danh hôm nay
    const resAfter = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: empH });
    expect(resAfter.statusCode).toBe(200);
    const bodyAfter = resAfter.json().data;
    expect(bodyAfter.shifts.length).toBeGreaterThan(0);
    expect(bodyAfter.shifts.some((s: { id: string }) => s.id === shift.id)).toBe(true);
    expect(bodyAfter.events.length).toBeGreaterThan(0);

    // 6. Nhân viên vẫn có thể điểm danh Ra ca (CHECK_OUT) mà không bị lỗi "Ca làm việc không tồn tại"
    const outRes = await t.app.inject({
      method: 'POST',
      url: '/api/attendance/check',
      headers: empH,
      payload: {
        assignment_id: shift.id,
        type: 'CHECK_OUT',
        lat: branch.lat,
        lng: branch.lng,
        accuracy_m: 10,
        selfie_source: 'LIVE_CAMERA',
        photo_base64: 'data:image/jpeg;base64,test_selfie_data_out',
      },
    });
    expect(outRes.statusCode).toBe(201);
  });
});
