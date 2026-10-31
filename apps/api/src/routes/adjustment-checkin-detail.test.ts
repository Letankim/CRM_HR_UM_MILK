import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { collectWorkEntries } from '../services/payroll-work-collector.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

const SAMPLE_PNG_IN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const SAMPLE_PNG_OUT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('m');
});

afterAll(async () => {
  await t.app.close();
});

describe('Approved CHECK_IN adjustment never fabricates CHECK_OUT or clones photo', () => {
  it('keeps shift CHECKED_IN with checkOutEvent=null until real CHECK_OUT or CHECK_OUT adjustment is approved', async () => {
    const hrHeaders = await t.loginHeaders('hr');
    const empUser = t.db.users.find((u) => u.role === 'CHINH_THUC' && Boolean(u.phone))!;
    const empLogin = await t.login(empUser.phone, DEMO_PIN, 'employee');
    const empHeaders = { cookie: empLogin.cookie, 'x-umbm-client': 'web' };
    const myRes0 = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: empHeaders });
    expect(myRes0.statusCode).toBe(200);
    const empId = myRes0.json().data.profile.employeeId as string;

    const workDate = '2026-12-08';
    const createShiftRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: hrHeaders,
      payload: {
        employee_id: empId,
        work_date: workDate,
        shift_code: 'CA_CHIEU',
        status: 'PUBLISHED',
        day_type: 'WORK',
        scheduled_hours: 5,
        note: 'Ca chiều kiểm thử phiếu xác nhận Vào ca',
      },
    });
    expect(createShiftRes.statusCode).toBe(201);
    const shiftId = createShiftRes.json().data.id as string;

    // 1. Nhân sự gửi phiếu báo lỗi Vào ca kèm ảnh minh chứng #1
    const adjInRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/attendance/adjustments',
      headers: empHeaders,
      payload: {
        employee_id: empId,
        assignment_id: shiftId,
        work_date: workDate,
        shift_code: 'CA_CHIEU',
        kind: 'FORGOT_CHECK_IN',
        punch_type: 'CHECK_IN',
        requested_check_in_at: '12:00',
        requested_check_out_at: '17:00',
        requested_hours: 5,
        reason: 'Lỗi chấm công Vào ca tại cửa hàng — gửi ảnh minh chứng Vào ca',
        evidence_photo_base64: SAMPLE_PNG_IN,
      },
    });
    expect(adjInRes.statusCode).toBe(201);
    const adjIn = adjInRes.json().data;
    expect(adjIn.punch_type).toBe('CHECK_IN');

    // 2. HR phê duyệt phiếu Vào ca
    const approveInRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/attendance/adjustments/${adjIn.id}/decide`,
      headers: hrHeaders,
      payload: { version: adjIn.version, action: 'HR_APPROVE', decision_reason: 'HR duyệt minh chứng Vào ca' },
    });
    expect(approveInRes.statusCode).toBe(200);

    // 3. Chi tiết điểm danh ca tuyệt đối KHÔNG được bịa Ra ca, KHÔNG được báo Hoàn thành ca, KHÔNG copy ảnh sang Ra ca
    const detailAfterIn = await t.app.inject({
      method: 'GET',
      url: `/api/admin/attendance/shift-detail/${shiftId}`,
      headers: hrHeaders,
    });
    expect(detailAfterIn.statusCode).toBe(200);
    const d1 = detailAfterIn.json().data;
    expect(d1.shiftStatus).toBe('CHECKED_IN');
    expect(d1.hasRawCheckIn).toBe(true);
    expect(d1.hasRawCheckOut).toBe(false);
    expect(d1.isAutoOut).toBe(false);
    expect(d1.checkInEvent).toBeTruthy();
    expect(d1.checkInEvent.photoUrl).toContain('/api/attendance/photos/');
    expect(d1.checkOutEvent).toBeNull();
    expect(d1.adjustment?.punch_type).toBe('CHECK_IN');
    expect(d1.adjustments).toHaveLength(1);

    // 4. Bảng phiên điểm danh & Cổng nhân viên cũng phải giữ trạng thái Đã vào ca (chưa Ra ca)
    const sessionsRes = await t.app.inject({
      method: 'GET',
      url: `/api/admin/attendance/sessions?from_date=${workDate}&to_date=${workDate}`,
      headers: hrHeaders,
    });
    expect(sessionsRes.statusCode).toBe(200);
    const sessionRow = (sessionsRes.json().data as { assignment_id?: string; checkInEvent: unknown; checkOutEvent: unknown }[])
      .find((s) => s.assignment_id === shiftId);
    expect(sessionRow).toBeTruthy();
    expect(sessionRow!.checkInEvent).toBeTruthy();
    expect(sessionRow!.checkOutEvent).toBeNull();

    const myRes1 = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: empHeaders });
    const myShift1 = (myRes1.json().data.shifts as { id: string; status: string; checkInEvent: unknown; checkOutEvent: unknown; attendanceStatusLabel: string }[])
      .find((s) => s.id === shiftId);
    expect(myShift1).toBeTruthy();
    expect(myShift1!.status).toBe('PUBLISHED');
    expect(myShift1!.checkInEvent).toBeTruthy();
    expect(myShift1!.checkOutEvent).toBeNull();
    expect(myShift1!.attendanceStatusLabel).toContain('Đã vào ca');

    // 5. Bộ thu thập công tính lương phải ghi nhận ATTENDANCE_CHECKIN (thiếu Ra ca), KHÔNG tính thành ADJUSTMENT_APPROVED
    const workWhileInShift = collectWorkEntries(t.ctx, empId, workDate, workDate);
    const log1 = workWhileInShift.shiftLogs.find((l) => l.assignmentId === shiftId);
    expect(log1?.status).toBe('ATTENDANCE_CHECKIN');

    // 6. Cuối ca nhân sự gửi phiếu báo lỗi Ra ca kèm ảnh minh chứng #2 -> HR duyệt -> Ca mới Hoàn thành với 2 ảnh riêng biệt
    const adjOutRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/attendance/adjustments',
      headers: empHeaders,
      payload: {
        employee_id: empId,
        assignment_id: shiftId,
        work_date: workDate,
        shift_code: 'CA_CHIEU',
        kind: 'FORGOT_CHECK_OUT',
        punch_type: 'CHECK_OUT',
        requested_check_in_at: '12:00',
        requested_check_out_at: '17:00',
        requested_hours: 5,
        reason: 'Cuối ca lỗi GPS khi Ra ca — gửi ảnh minh chứng Ra ca',
        evidence_photo_base64: SAMPLE_PNG_OUT,
      },
    });
    expect(adjOutRes.statusCode).toBe(201);
    const adjOut = adjOutRes.json().data;
    const approveOutRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/attendance/adjustments/${adjOut.id}/decide`,
      headers: hrHeaders,
      payload: { version: adjOut.version, action: 'HR_APPROVE', decision_reason: 'HR duyệt minh chứng Ra ca' },
    });
    expect(approveOutRes.statusCode).toBe(200);

    const detailAfterOut = await t.app.inject({
      method: 'GET',
      url: `/api/admin/attendance/shift-detail/${shiftId}`,
      headers: hrHeaders,
    });
    const d2 = detailAfterOut.json().data;
    expect(d2.shiftStatus).toBe('COMPLETED');
    expect(d2.checkInEvent).toBeTruthy();
    expect(d2.checkOutEvent).toBeTruthy();
    expect(d2.checkInEvent.photoUrl).not.toBe(d2.checkOutEvent.photoUrl);
    expect(d2.adjustments).toHaveLength(2);

    const workCompleted = collectWorkEntries(t.ctx, empId, workDate, workDate);
    const log2 = workCompleted.shiftLogs.find((l) => l.assignmentId === shiftId);
    expect(log2?.status).toBe('ADJUSTMENT_APPROVED');
  });
});
