import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttendanceAdjustment, ShiftAssignment } from '@umbm/shared';
import { DEMO_PIN } from '../data/memory-seed.js';
import { collectDevDomainAndRuntimeTelemetry } from '../services/dev-domain-telemetry.js';
import { rehomeMisplacedPartitionRecords } from '../services/partition-rehome.service.js';
import { getPartitionStore, insertPartitionAwareRecord } from '../services/partition-write-router.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('p');
});

afterAll(async () => {
  await t.app.close();
});

describe('Đồng bộ Lưu trữ Đúng Phân vùng Tháng & Tự động Di dời Bản ghi Lệch', () => {
  it('tạo phiếu bổ sung công tháng 11 khi Backoffice đang ở tháng 10 thì phiếu lưu đúng vào tháng 11', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const { cookie: empCookie } = await t.login('0901000002', DEMO_PIN, 'employee');
    const empH = { cookie: empCookie, 'x-umbm-client': 'web' };
    const empUser = t.db.users.find((u) => u.phone === '0901000002')!;
    const emp = t.db.employees.find((e) => e.user_id === empUser.id || e.employee_code === empUser.employee_id)!;
    const branch = t.db.branches.get(emp.branch_id)!;
    await t.db.employees.update(emp.id, emp.version, { attendance_credit_points: 50 }, 'admin');

    // 1. Đặt Backoffice ở phân vùng tháng 10 (2026_10)
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/data-partitions/rollover',
      headers: admin,
      payload: { month_key: '2026_10', carry_forward: false },
    });
    expect(t.db.partitionMonth).toBe('2026_10');

    // 2. Tạo 1 ca làm việc tháng 11 (2026-11-09) lưu vào phân vùng 2026_11
    const shiftNov = await insertPartitionAwareRecord<ShiftAssignment>(
      t.db,
      'SHIFT_ASSIGNMENTS',
      {
        schedule_week_id: 'WK-2026_11',
        employee_id: emp.id,
        branch_id: branch.id,
        work_date: '2026-11-09',
        shift_template_id: 'tpl-sang',
        shift_code: 'CA_SANG',
        start_at: '07:00',
        end_at: '12:00',
        scheduled_hours: 5,
        status: 'ABSENT',
        source: 'MANUAL',
        employee_stage: 'OFFICIAL',
        day_type: 'WORK',
        published_at: '2026-11-09',
        note: 'Ca làm việc tháng 11',
        swapped_from_employee_id: '',
        replacement_for_employee_id: '',
        linked_assignment_id: '',
      },
      '2026-11-09',
      'admin',
    );
    expect(shiftNov.id).toBeDefined();

    // 3. Nhân viên gửi phiếu bổ sung công cho ca 2026-11-09
    const adjRes = await t.app.inject({
      method: 'POST',
      url: '/api/me/attendance-adjustments',
      headers: empH,
      payload: {
        assignment_id: shiftNov.id,
        work_date: '2026-11-09',
        shift_code: 'CA_SANG',
        punch_type: 'FULL_SHIFT',
        kind: 'OTHER',
        reason: 'Quên chấm công ca sáng ngày 09/11/2026',
        evidence_photo_base64: 'data:image/jpeg;base64,evidence_data_test',
      },
    });
    expect(adjRes.statusCode).toBe(201);
    const createdAdj = adjRes.json().data;
    expect(createdAdj.work_date).toBe('2026-11-09');

    // 4. Kiểm tra: phiếu ADJ được lưu đúng vào phân vùng 2026_11, KHÔNG bị lưu nhầm vào phân vùng 2026_10
    const storeNov = await getPartitionStore(t.db, 'ATTENDANCE_ADJUSTMENTS', '2026_11');
    expect(storeNov.get(createdAdj.id)).toBeDefined();

    // Phân vùng 2026_10 (đang active trong db) KHÔNG chứa phiếu tháng 11
    expect(t.db.attendanceAdjustments.get(createdAdj.id)).toBeUndefined();

    // 5. Backoffice đang đứng ở 2026_10 KHÔNG hiển thị phiếu của tháng 11 (cách ly phân vùng nghiêm ngặt)
    const boListOct = await t.app.inject({
      method: 'GET',
      url: '/api/admin/attendance/adjustments',
      headers: hr,
    });
    expect(boListOct.statusCode).toBe(200);
    const octItems = boListOct.json().data;
    expect(octItems.some((a: { id: string }) => a.id === createdAdj.id)).toBe(false);

    // 6. Chuyển Backoffice sang Tháng 11 (2026_11) -> chỉ thấy phiếu thuộc tháng 11
    await t.app.inject({
      method: 'PUT',
      url: '/api/admin/data-partitions/active',
      headers: admin,
      payload: { month_key: '2026_11' },
    });
    expect(t.db.partitionMonth).toBe('2026_11');

    const boListNov = await t.app.inject({
      method: 'GET',
      url: '/api/admin/attendance/adjustments',
      headers: hr,
    });
    expect(boListNov.statusCode).toBe(200);
    const novItems = boListNov.json().data;
    expect(novItems.some((a: { id: string }) => a.id === createdAdj.id)).toBe(true);

    // 7. HR phê duyệt phiếu bổ sung công tại Tháng 11: ca tháng 11 được cập nhật sang COMPLETED
    const decideRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/attendance/adjustments/${createdAdj.id}/decide`,
      headers: hr,
      payload: {
        action: 'HR_APPROVE',
        decision_reason: 'Duyệt bù công hợp lệ',
      },
    });
    expect(decideRes.statusCode).toBe(200);

    const shiftStoreNov = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_11');
    const freshShift = shiftStoreNov.get(shiftNov.id);
    expect(freshShift?.status).toBe('COMPLETED');
  });

  it('tự động quét và di dời bản ghi lưu sai phân vùng về đúng file Google Sheets', async () => {
    // Cố tình chèn 1 bản ghi có work_date = 2026-12-05 vào file tháng 10 (2026_10)
    const storeOct = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_10');
    const misplaced = await storeOct.insert(
      {
        schedule_week_id: 'WK-2026_12',
        employee_id: 'emp-1',
        branch_id: 'br-1',
        work_date: '2026-12-05',
        shift_template_id: 'tpl-1',
        shift_code: 'CA_SANG',
        start_at: '07:00',
        end_at: '12:00',
        scheduled_hours: 5,
        status: 'PUBLISHED',
        source: 'MANUAL',
        employee_stage: 'OFFICIAL',
        day_type: 'WORK',
        published_at: '2026-12-05',
        note: 'Bản ghi lưu nhầm vào tháng 10',
        swapped_from_employee_id: '',
        replacement_for_employee_id: '',
        linked_assignment_id: '',
      },
      'test',
    );
    expect(misplaced.id).toBeDefined();

    // Chạy dịch vụ rehome
    const report = await rehomeMisplacedPartitionRecords(t.db, 'tester');
    expect(report.rehomedCount).toBeGreaterThan(0);
    expect(report.details.some((d) => d.id === misplaced.id && d.toMonth === '2026_12')).toBe(true);

    // Bản ghi ở store tháng 10 đã bị soft delete (get() trả về undefined)
    expect(storeOct.get(misplaced.id)).toBeUndefined();
    expect(storeOct.all(true).find((r) => r.id === misplaced.id)?.is_deleted).toBe(true);

    // Bản ghi ở store tháng 12 đã tồn tại và hoạt động
    const storeDec = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_12');
    expect(storeDec.get(misplaced.id)).toBeDefined();
    expect(storeDec.get(misplaced.id)?.is_deleted).toBe(false);
  });

  it('thông số V8 Heap trả về tỷ lệ phần trăm thực tế dựa trên giới hạn heap_size_limit', async () => {
    const telem = await collectDevDomainAndRuntimeTelemetry(t.ctx);
    expect(telem.runtime.memory.heapTotalMb).toBeGreaterThan(0);
    expect(telem.runtime.memory.heapUsagePercent).toBeLessThan(90);
  });

  it('tự động di dời phiếu bổ sung công lưu nhầm ở tệp gốc về đúng Tháng 11 khi rehome', async () => {
    const hr = await t.loginHeaders('hr');
    const admin = await t.loginHeaders('admin');
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_11' } });
    expect(t.db.partitionMonth).toBe('2026_11');

    const rootStore = await getPartitionStore<AttendanceAdjustment>(t.db, 'ATTENDANCE_ADJUSTMENTS', '');
    const seededRootAdj = await rootStore.insert({
      adjustment_code: 'ADJ-9999', event_id: '', assignment_id: 'SH-NOV-ROOT', employee_id: 'emp-1', branch_id: 'br-1',
      work_date: '2026-11-10', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_IN', punch_type: 'FULL_SHIFT', requested_time: '07:00',
      requested_check_in_at: '07:00', requested_check_out_at: '12:00', requested_hours: 5, reason: 'Tạo ở tệp gốc test đồng bộ',
      evidence_file_id: '', exception_source: 'EMPLOYEE', status: 'PENDING', store_confirmed_by: '', store_confirmed_at: '', store_note: '',
      hr_decision: 'PENDING', decided_by: '', decision_reason: '', decided_at: '', record_id: '', applied_to_record: false,
    }, 'test');

    // Trước khi rehome: Backoffice Tháng 11 không thấy phiếu ở tệp gốc (cách ly nghiêm ngặt)
    const listBefore = await t.app.inject({ method: 'GET', url: '/api/admin/attendance/adjustments', headers: hr });
    expect(listBefore.statusCode).toBe(200);
    expect(listBefore.json().data.some((a: { id: string }) => a.id === seededRootAdj.id)).toBe(false);

    // Chạy rehome di dời bản ghi lưu sai tệp
    await rehomeMisplacedPartitionRecords(t.db, 'tester');

    // Sau khi rehome: Phiếu đã chuyển sang store Tháng 11 và Backoffice Tháng 11 hiển thị
    const storeNov = await getPartitionStore<AttendanceAdjustment>(t.db, 'ATTENDANCE_ADJUSTMENTS', '2026_11');
    expect(storeNov.get(seededRootAdj.id)).toBeDefined();

    const listAfter = await t.app.inject({ method: 'GET', url: '/api/admin/attendance/adjustments', headers: hr });
    expect(listAfter.statusCode).toBe(200);
    expect(listAfter.json().data.some((a: { id: string }) => a.id === seededRootAdj.id)).toBe(true);
  });
});
