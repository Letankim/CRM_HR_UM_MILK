import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpiredShiftsAndMarkAbsent } from '../services/shift-absent-scanner.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let hr: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let adm: Awaited<ReturnType<TestAppContext['loginHeaders']>>;

beforeAll(async () => {
  t = await buildTestApp('s');
  hr = await t.loginHeaders('hr');
  adm = await t.loginHeaders('admin');
});

afterAll(async () => {
  await t.app.close();
});

describe('Phát hành ca Hành chính Khối Văn phòng (MON_TO_FRI, MON_TO_SAT, MON_TO_SAT_MORNING)', () => {
  const targetWeek = '2026-11-09'; // Thứ 2

  it('1. Xem trước ca Văn phòng chế độ MON_TO_FRI: Thứ 2 – Thứ 6 làm việc, Thứ 7 & CN nghỉ', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/schedule-planner/office-shifts?week_start=${targetWeek}&mode=MON_TO_FRI`,
      headers: hr,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.mode).toBe('MON_TO_FRI');
    expect(body.data.workdays).toHaveLength(7);
    expect(body.data.workdays[0].isWorkday).toBe(true); // T2
    expect(body.data.workdays[4].isWorkday).toBe(true); // T6
    expect(body.data.workdays[5].isWorkday).toBe(false); // T7
    expect(body.data.workdays[6].isWorkday).toBe(false); // CN
    expect(body.data.staffCount).toBeGreaterThan(0);
  });

  it('2. Xem trước ca Văn phòng chế độ MON_TO_SAT: Thứ 2 – Thứ 7 làm việc, chỉ CN nghỉ', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/schedule-planner/office-shifts?week_start=${targetWeek}&mode=MON_TO_SAT`,
      headers: hr,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.mode).toBe('MON_TO_SAT');
    expect(body.data.workdays[5].isWorkday).toBe(true); // T7 làm cả ngày
    expect(body.data.workdays[5].isHalfDay).toBe(false);
    expect(body.data.workdays[6].isWorkday).toBe(false); // CN nghỉ
  });

  it('3. Xem trước ca Văn phòng chế độ MON_TO_SAT_MORNING: T2 – T6 cả ngày, T7 nửa ngày sáng', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/schedule-planner/office-shifts?week_start=${targetWeek}&mode=MON_TO_SAT_MORNING`,
      headers: hr,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.mode).toBe('MON_TO_SAT_MORNING');
    expect(body.data.workdays[5].isWorkday).toBe(true);
    expect(body.data.workdays[5].isHalfDay).toBe(true);
    const satShifts = body.data.toCreate.filter((c: { workDate: string }) => c.workDate === '2026-11-14');
    expect(satShifts.length).toBeGreaterThan(0);
    expect(satShifts[0].shiftCode).toBe('HC_SANG');
    expect(satShifts[0].hours).toBe(4);
  });

  it('4. Nhân viên có đơn OFF đã duyệt thì tự động bỏ qua ngày đó, không tạo ca', async () => {
    const emp = t.ctx.db.employees.find((e) => e.staff_group === 'BACKOFFICE');
    expect(emp).toBeDefined();

    // Thêm 1 đơn OFF APPROVED vào Thứ 4 (2026-11-11)
    await t.ctx.db.leaveRequests.insert({
      employee_id: emp!.id,
      branch_id: emp!.branch_id,
      request_code: 'OFF_TEST_01',
      leave_date: '2026-11-11',
      kind: 'WEEKLY_OFF',
      shift_code: 'HANH_CHINH',
      reason: 'Nghỉ phép cá nhân đã duyệt',
      status: 'APPROVED',
      employee_stage: 'OFFICIAL',
      assignment_id: '',
      schedule_week_id: '',
      quota_cycle_used: 1,
      quota_cycle_limit: 5,
      staffing_after_leave: 2,
      min_staff_required: 2,
      submitted_at: new Date().toISOString(),
      store_reviewed_by: '',
      store_reviewed_at: '',
      decided_by: 'hr-actor',
      decided_at: new Date().toISOString(),
      decision_reason: 'Duyệt phép',
    }, 'hr-actor');

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/admin/schedule-planner/office-shifts?week_start=${targetWeek}&mode=MON_TO_FRI`,
      headers: hr,
    });
    const body = res.json();
    expect(body.data.skippedOff).toBeGreaterThanOrEqual(1);
    const empWed = body.data.toCreate.find((c: { employeeId: string; workDate: string }) => c.employeeId === emp!.id && c.workDate === '2026-11-11');
    expect(empWed).toBeUndefined();
  });

  it('5. Phát hành ca Hành chính cho khối Văn phòng (POST /office-shifts/publish)', async () => {
    const pubRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedule-planner/office-shifts/publish',
      headers: hr,
      payload: {
        week_start: targetWeek,
        mode: 'MON_TO_SAT_MORNING',
        note: 'Đã chốt lịch khối VP tuần 46',
      },
    });
    expect(pubRes.statusCode).toBe(200);
    const data = pubRes.json().data;
    expect(data.createdCount).toBeGreaterThan(0);
    expect(data.mode).toBe('MON_TO_SAT_MORNING');

    // Kiểm tra trong DB ca đã được tạo với status = PUBLISHED và source = OFFICE_ROSTER
    const createdShifts = t.ctx.db.shiftAssignments.filter((a) => a.source === 'OFFICE_ROSTER' && a.work_date >= '2026-11-09' && a.work_date <= '2026-11-15');
    expect(createdShifts.length).toBe(data.createdCount);
    expect(createdShifts.every((s) => s.status === 'PUBLISHED')).toBe(true);
  });

  it('6. Quét tự động (sweepExpiredShiftsAndMarkAbsent) đánh dấu Vắng mặt (ABSENT) khi quá giờ chưa điểm danh', async () => {
    // Giả lập quét vào lúc 18:00 ngày Thứ 2 (2026-11-09)
    const sweep = await sweepExpiredShiftsAndMarkAbsent(t.ctx.db, 'system-test', {
      nowDate: '2026-11-09',
      nowHm: '18:00',
    });
    expect(sweep.markedAbsent).toBeGreaterThan(0);

    const monOfficeShifts = t.ctx.db.shiftAssignments.filter((a) => a.source === 'OFFICE_ROSTER' && a.work_date === '2026-11-09');
    expect(monOfficeShifts.every((s) => s.status === 'ABSENT')).toBe(true);
  });
});
