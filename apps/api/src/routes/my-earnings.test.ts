import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('e');
});

afterAll(async () => {
  await t.app.close();
});

async function employeeHeaders(username: string) {
  const user = t.db.users.find((u) => u.username === username)!;
  const { cookie } = await t.login(user.phone || username, DEMO_PIN, 'employee');
  return { cookie, 'x-umbm-client': 'web' };
}

describe('GET /api/me/earnings — Theo dõi Ca đã làm & Thu nhập hiện tại cho nhân viên', () => {
  it('chặn truy cập khi chưa đăng nhập (401) và trả lỗi validation tiếng Việt chuẩn khi khoảng ngày sai (400)', async () => {
    const unauth = await t.app.inject({ method: 'GET', url: '/api/me/earnings' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().success).toBe(false);

    const headers = await employeeHeaders('nv.chinhthuc');
    const badFmt = await t.app.inject({
      method: 'GET',
      url: '/api/me/earnings?from_date=31-10-2026&to_date=2026-10-31',
      headers,
    });
    expect(badFmt.statusCode).toBe(400);
    expect(badFmt.json()).toMatchObject({
      success: false,
      errors: {
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ field: 'from_date', code: 'INVALID_FORMAT' })],
      },
    });

    const reversed = await t.app.inject({
      method: 'GET',
      url: '/api/me/earnings?from_date=2027-05-10&to_date=2027-05-03',
      headers,
    });
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json()).toMatchObject({
      success: false,
      errors: {
        code: 'VALIDATION_ERROR',
        details: [expect.objectContaining({ field: 'to_date', code: 'OUT_OF_RANGE' })],
      },
    });
  });

  it('tính chính xác số ca thực tế đã hoàn thành, tiền hiện tại nhận được, dự kiến ca sắp tới và lọc theo ngày/tuần/khoảng ngày', async () => {
    const headers = await employeeHeaders('nv.chinhthuc');
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const branchId = emp.branch_id;
    const rate = emp.base_hourly_rate_vnd || 28000;

    for (const old of t.db.payRates.filter((r) => r.employee_id === emp.id || r.employee_id === emp.employee_code)) {
      await t.db.payRates.softDelete(old.id, old.version, 'test');
    }
    await t.db.payRates.insert({
      employee_id: emp.id, rate_type: 'HOURLY', amount_vnd: rate, probation_percent: 85,
      effective_from: '2026-01-01', effective_to: '', approved_by: 'admin', approved_at: '2026-01-01T00:00:00.000Z',
      stage: 'OFFICIAL', staff_group: 'BARISTA', ot_multiplier: 1.5, night_shift_allowance_vnd: 0,
      attendance_bonus_vnd: 0, meal_allowance_per_shift_vnd: 15000, transport_allowance_vnd: 0,
      responsibility_allowance_vnd: 0, other_allowance_vnd: 0, standard_work_days: 26, standard_hours_per_day: 8,
      status: 'ACTIVE', change_reason: 'Thiết lập test thu nhập', previous_rate_id: '', note: '',
    }, 'admin');

    // Ca 1 (2027-05-03): Đã hoàn thành đủ Vào ca + Ra ca (5 giờ)
    const s1 = await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-TEST-EARN', employee_id: emp.id, branch_id: branchId, work_date: '2027-05-03',
      shift_template_id: '', start_at: '07:00', end_at: '12:00', status: 'COMPLETED', source: 'MANUAL',
      employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_SANG', scheduled_hours: 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'admin');
    const baseEvent = {
      employee_id: emp.id, branch_id: branchId, lat: 10.77, lng: 106.7, accuracy_m: 10, distance_m: 5,
      within_radius: true, photo_id: 'p_test', photo_sha256: 'sha_test', device_info: 'Test', result: 'VALID' as const,
      late_minutes: 0, early_leave_minutes: 0, allowed_radius_m: 120, gps_status: 'OK' as const,
      photo_drive_file_id: '', ip_address: '127.0.0.1', anomaly_flags_json: '[]', note: 'Hợp lệ',
    };
    await t.db.attendanceEvents.insert({
      ...baseEvent, idempotency_key: 'earn-ci-1', assignment_id: s1.id, work_date: '2027-05-03',
      shift_code: 'CA_SANG', type: 'CHECK_IN', server_time: '2027-05-03T06:58:00+07:00', scheduled_time: '07:00',
    }, emp.id);
    await t.db.attendanceEvents.insert({
      ...baseEvent, idempotency_key: 'earn-co-1', assignment_id: s1.id, work_date: '2027-05-03',
      shift_code: 'CA_SANG', type: 'CHECK_OUT', server_time: '2027-05-03T12:02:00+07:00', scheduled_time: '12:00',
    }, emp.id);

    // Ca 2 (2027-05-04): Ca nhận đổi ca + đã duyệt phiếu bổ sung công (5 giờ + phụ cấp đổi ca 30.000đ)
    const s2 = await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-TEST-EARN', employee_id: emp.id, branch_id: branchId, work_date: '2027-05-04',
      shift_template_id: '', start_at: '12:00', end_at: '17:00', status: 'PUBLISHED', source: 'MANUAL',
      employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_CHIEU', scheduled_hours: 5,
      swapped_from_employee_id: 'NV0009', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'admin');
    await t.db.attendanceAdjustments.insert({
      adjustment_code: 'ADJ-EARN-1', event_id: '', assignment_id: s2.id, employee_id: emp.id, branch_id: branchId,
      work_date: '2027-05-04', shift_code: 'CA_CHIEU', kind: 'FORGOT_CHECK_OUT', punch_type: 'FULL_SHIFT',
      requested_time: '17:00', requested_check_in_at: '12:00', requested_check_out_at: '17:00', requested_hours: 5,
      reason: 'Quên mang điện thoại đã xác nhận camera', evidence_file_id: 'ev-1', exception_source: 'EMPLOYEE',
      status: 'APPROVED', store_confirmed_by: '', store_confirmed_at: '', store_note: '',
      hr_decision: 'APPROVED', decided_by: 'admin', decision_reason: 'Đồng ý', decided_at: '2027-05-04T18:00:00+07:00',
      record_id: '', applied_to_record: true,
    }, 'admin');

    // Ca 3 (2027-05-05): Mới chấm Vào ca, thiếu Ra ca (chưa cộng vào Tiền hiện tại)
    const s3 = await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-TEST-EARN', employee_id: emp.id, branch_id: branchId, work_date: '2027-05-05',
      shift_template_id: '', start_at: '07:00', end_at: '12:00', status: 'PUBLISHED', source: 'MANUAL',
      employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_SANG', scheduled_hours: 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'admin');
    await t.db.attendanceEvents.insert({
      ...baseEvent, idempotency_key: 'earn-ci-3', assignment_id: s3.id, work_date: '2027-05-05',
      shift_code: 'CA_SANG', type: 'CHECK_IN', server_time: '2027-05-05T07:00:00+07:00', scheduled_time: '07:00',
    }, emp.id);

    // Ca 4 (2027-05-08): Ca đã xếp sắp tới trong tuần (chưa làm -> chỉ nằm ở Dự kiến)
    await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-TEST-EARN', employee_id: emp.id, branch_id: branchId, work_date: '2027-05-08',
      shift_template_id: '', start_at: '17:00', end_at: '22:00', status: 'PUBLISHED', source: 'MANUAL',
      employee_stage: 'OFFICIAL', day_type: 'WORK', shift_code: 'CA_TOI', scheduled_hours: 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'admin');

    // Khoản thưởng +50.000đ và khấu trừ -20.000đ ngày 2027-05-04
    const periodId = t.db.payPeriods.all()[0]?.id ?? 'PP-TEST';
    await t.db.payrollItems.insert({
      period_id: periodId, employee_id: emp.id, branch_id: branchId, work_date: '2027-05-04',
      item_type: 'BONUS_KPI', category_code: 'BONUS', title: 'Thưởng ca đông khách', direction: 'ADD',
      quantity: 1, unit_amount_vnd: 50000, total_amount_vnd: 50000, source_ref_id: '', policy_version: 'v5.1',
      approval_status: 'APPROVED', approved_by: 'admin', approved_at: '2027-05-04T19:00:00+07:00', note: '',
    }, 'admin');
    await t.db.payrollItems.insert({
      period_id: periodId, employee_id: emp.id, branch_id: branchId, work_date: '2027-05-04',
      item_type: 'DEDUCTION_APPROVED', category_code: 'DEDUCT', title: 'Làm vỡ ly', direction: 'DEDUCT',
      quantity: 1, unit_amount_vnd: 20000, total_amount_vnd: 20000, source_ref_id: '', policy_version: 'v5.1',
      approval_status: 'APPROVED', approved_by: 'admin', approved_at: '2027-05-04T19:00:00+07:00', note: '',
    }, 'admin');

    // 1. Lọc theo 1 ngày duy nhất (2027-05-03)
    const dayRes = await t.app.inject({ method: 'GET', url: '/api/me/earnings?from_date=2027-05-03&to_date=2027-05-03', headers });
    expect(dayRes.statusCode).toBe(200);
    const dayData = dayRes.json().data;
    expect(dayData.counts.completedShiftsCount).toBe(1);
    expect(dayData.counts.completedHours).toBe(5);
    expect(dayData.earned.netVnd).toBe(5 * rate + 15000);

    // 2. Lọc theo cả tuần (2027-05-03 đến 2027-05-09)
    const weekRes = await t.app.inject({ method: 'GET', url: '/api/me/earnings?from_date=2027-05-03&to_date=2027-05-09', headers });
    expect(weekRes.statusCode).toBe(200);
    const weekData = weekRes.json().data;
    expect(weekData.counts).toMatchObject({
      completedShiftsCount: 2,
      completedHours: 10,
      incompleteShiftsCount: 1,
      upcomingShiftsCount: 1,
      swapInCompletedCount: 1,
    });
    const expectedEarned = 10 * rate + 2 * 15000 + 30000 + 50000 - 20000;
    const expectedProjected = expectedEarned + 2 * (5 * rate + 15000);
    expect(weekData.earned.netVnd).toBe(expectedEarned);
    expect(weekData.projected.projectedNetVnd).toBe(expectedProjected);

    // 3. Lọc theo khoảng ngày tùy chọn (2027-05-03 đến 2027-05-04) & đồng bộ ?refresh=1
    const rangeRes = await t.app.inject({ method: 'GET', url: '/api/me/earnings?from_date=2027-05-03&to_date=2027-05-04&refresh=1', headers });
    expect(rangeRes.statusCode).toBe(200);
    expect(rangeRes.json().data.counts.completedShiftsCount).toBe(2);
    expect(rangeRes.json().data.counts.upcomingShiftsCount).toBe(0);
    expect(rangeRes.json().data.earned.netVnd).toBe(expectedEarned);
  });

  it('áp dụng đúng % lương thử việc trên từng ca hoàn thành của nhân viên thử việc', async () => {
    const headers = await employeeHeaders('nv.thuviec');
    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const s = await t.db.shiftAssignments.insert({
      schedule_week_id: 'WK-PROB-EARN', employee_id: probEmp.id, branch_id: probEmp.branch_id, work_date: '2027-05-06',
      shift_template_id: '', start_at: '07:00', end_at: '12:00', status: 'COMPLETED', source: 'MANUAL',
      employee_stage: 'PROBATION', day_type: 'WORK', shift_code: 'CA_SANG', scheduled_hours: 5,
      swapped_from_employee_id: '', replacement_for_employee_id: '', published_at: '', note: '', linked_assignment_id: '',
    }, 'admin');
    expect(s.id).toBeTruthy();

    const res = await t.app.inject({ method: 'GET', url: '/api/me/earnings?from_date=2027-05-06&to_date=2027-05-06', headers });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.counts.completedShiftsCount).toBe(1);
    expect(d.counts.completedProbationShiftsCount).toBe(1);
    expect(d.shifts[0].percent).toBeLessThan(100);
    expect(d.earned.probationBasePayVnd).toBeGreaterThan(0);
  });

  it('vẫn tra cứu được ca đã làm của tháng cũ qua Snapshot bảng lương ngay cả khi hệ thống đã chuyển sang tệp Google Sheets tháng mới', async () => {
    const admin = await t.loginHeaders('admin'), finance = await t.loginHeaders('finance'), empHeaders = await employeeHeaders('nv.chinhthuc');
    const pp = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/periods', headers: finance, payload: { name: 'Kỳ Tháng 05/2027', from_date: '2027-05-01', to_date: '2027-05-31' } });
    expect(pp.statusCode).toBe(201);
    const periodId = pp.json().data.id as string;
    await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/recalculate`, headers: finance });

    // Chuyển hệ thống sang tệp Google Sheets Tháng 06/2027 rỗng (carry_forward=false)
    const roll = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2027_06', carry_forward: false } });
    expect(roll.statusCode).toBe(201);
    expect(t.db.shiftAssignments.all().length).toBe(0);

    // Nhân viên lọc ngược lại tuần 03/05 - 09/05/2027 vẫn thấy đủ 2 ca hoàn thành
    const histRes = await t.app.inject({ method: 'GET', url: '/api/me/earnings?from_date=2027-05-03&to_date=2027-05-09', headers: empHeaders });
    expect(histRes.statusCode).toBe(200);
    expect(histRes.json().data.counts.completedShiftsCount).toBe(2);
    expect(histRes.json().data.earned.netVnd).toBeGreaterThan(0);
  });
});
