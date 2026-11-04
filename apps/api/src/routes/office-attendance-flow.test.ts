import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adm: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let hr: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let fin: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let mkt: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let store: Awaited<ReturnType<TestAppContext['loginHeaders']>>;

beforeAll(async () => {
  t = await buildTestApp('s');
  adm = await t.loginHeaders('admin');
  hr = await t.loginHeaders('hr');
  fin = await t.loginHeaders('finance');
  mkt = await t.loginHeaders('mkt');
  store = await t.loginHeaders('store1');
});
afterAll(async () => {
  await t.app.close();
});

describe('Điểm danh & Ca làm việc linh hoạt cho Vai trò Nội bộ (HR, FINANCE, MKT, STORE, ADMIN)', () => {
  it('1. Khung ca mẫu Ca Hành chính (HANH_CHINH) tự động tồn tại và có thể cấu hình lại thời gian', async () => {
    const listRes = await t.app.inject({ method: 'GET', url: '/api/admin/shift-templates', headers: hr });
    expect(listRes.statusCode).toBe(200);
    const templates = listRes.json().data as { id: string; code: string; startTime: string; endTime: string; standardHours: number; version: number }[];
    const hc = templates.find((s) => s.code === 'HANH_CHINH');
    expect(hc).toBeDefined();
    expect(hc!.code).toBe('HANH_CHINH');

    // Chỉnh sửa thời gian ca Hành chính sang 08:30 - 17:30
    const updateRes = await t.app.inject({
      method: 'PUT',
      url: `/api/admin/shift-templates/${hc!.id}`,
      headers: adm,
      payload: {
        version: hc!.version,
        name: 'Ca Hành chính (08:30 – 17:30)',
        start_time: '08:30',
        end_time: '17:30',
        standard_hours: 8,
        break_minutes: 60,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.startTime).toBe('08:30');
    expect(updateRes.json().data.endTime).toBe('17:30');
  });

  it('2. Các vai trò HR, FINANCE, MKT, STORE, ADMIN gọi my-attendance tự động có ca hành chính hôm nay theo giờ cấu hình', async () => {
    // MKT truy cập my-attendance
    const mktRes = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: mkt });
    expect(mktRes.statusCode).toBe(200);
    const mktData = mktRes.json().data;
    expect(mktData.profile.role).toBe('MKT');
    expect(mktData.shifts.length).toBeGreaterThanOrEqual(1);
    const todayShift = mktData.shifts.find((s: { shiftCode: string }) => s.shiftCode === 'HANH_CHINH');
    expect(todayShift).toBeDefined();
    expect(todayShift.startAt).toBe('08:30');
    expect(todayShift.endAt).toBe('17:30');

    // Kế toán Finance truy cập my-attendance
    const finRes = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: fin });
    expect(finRes.statusCode).toBe(200);
    expect(finRes.json().data.shifts.some((s: { shiftCode: string }) => s.shiftCode === 'HANH_CHINH')).toBe(true);

    // Cửa hàng trưởng Store truy cập my-attendance
    const storeRes = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: store });
    expect(storeRes.statusCode).toBe(200);
    expect(storeRes.json().data.shifts.some((s: { shiftCode: string }) => s.shiftCode === 'HANH_CHINH')).toBe(true);
  });

  it('3. MKT và nhân sự văn phòng điểm danh GPS vào ca thành công không bị chặn', async () => {
    const mktGet = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: mkt });
    const shift = mktGet.json().data.shifts.find((s: { shiftCode: string }) => s.shiftCode === 'HANH_CHINH');
    const branch = t.db.branches.find((b) => b.code === 'VAN_PHONG')!;

    const checkInRes = await t.app.inject({
      method: 'POST',
      url: '/api/attendance/check',
      headers: mkt,
      payload: {
        assignment_id: shift.id,
        kind: 'CHECK_IN',
        lat: branch.lat,
        lng: branch.lng,
        accuracy_m: 10,
        selfie_source: 'LIVE_CAMERA',
        photo_base64: 'data:image/jpeg;base64,office_selfie_face_mkt_valid',
        enforce_shift_state: true,
        uniform_verified: true,
      },
    });
    expect(checkInRes.statusCode).toBe(201);
    expect(checkInRes.json().data.type).toBe('CHECK_IN');
  });

  it('4. Nhân sự nội bộ gửi phiếu bổ sung công (quên chấm công, công tác ngoài) và được HR duyệt thành công', async () => {
    const finGet = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: fin });
    const finShift = finGet.json().data.shifts.find((s: { shiftCode: string }) => s.shiftCode === 'HANH_CHINH');

    // Kế toán gửi phiếu bù công
    const adjRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/attendance/adjustments',
      headers: fin,
      payload: {
        assignment_id: finShift.id,
        work_date: finShift.workDate,
        shift_code: 'HANH_CHINH',
        kind: 'OTHER',
        punch_type: 'FULL_SHIFT',
        requested_check_in_at: '08:30',
        requested_check_out_at: '17:30',
        requested_hours: 8,
        reason: 'Đi công tác làm việc với ngân hàng Techcombank về cổng thanh toán VietQR',
      },
    });
    expect(adjRes.statusCode).toBe(201);
    const createdAdj = adjRes.json().data;
    expect(createdAdj.punch_type).toBe('FULL_SHIFT');
    expect(createdAdj.status).toBe('PENDING');

    // HR phê duyệt phiếu bổ sung công
    const approveRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/attendance/adjustments/${createdAdj.id}/decide`,
      headers: hr,
      payload: {
        version: createdAdj.version,
        action: 'HR_APPROVE',
        decision_reason: 'HR xác nhận lịch công tác ngoài hợp lệ',
      },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.status).toBe('APPROVED');
  });
});
