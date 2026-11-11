import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttendanceAdjustment, LeaveRequest, ShiftAssignment } from '@umbm/shared';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildEmployeeDossierSummary } from './employee-dossier-summary.js';
import { collectDevDomainAndRuntimeTelemetry } from '../services/dev-domain-telemetry.js';
import { readPartitionRegistry } from '../services/data-partition.service.js';
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

describe('Đồng bộ Lưu trữ Đúng Phân vùng Tháng, Chuyển tiếp Tháng Trễ & Thử việc Vắt Tháng', () => {
  it('tạo phiếu bổ sung công tháng 11 khi Backoffice đang ở tháng 10 hoặc Tệp gốc thì phiếu luôn lưu đúng vào tháng 11 và Cổng NV không bị ảnh hưởng', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const { cookie: empCookie } = await t.login('0901000002', DEMO_PIN, 'employee');
    const empH = { cookie: empCookie, 'x-umbm-client': 'web' };
    const empUser = t.db.users.find((u) => u.phone === '0901000002')!;
    const emp = t.db.employees.find((e) => e.user_id === empUser.id || e.employee_code === empUser.employee_id)!;
    const branch = t.db.branches.get(emp.branch_id)!;
    await t.db.employees.update(emp.id, emp.version, { attendance_credit_points: 50 }, 'admin');

    await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2026_10', carry_forward: false } });
    await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2026_11', carry_forward: false } });
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '' } });
    expect(t.db.partitionMonth).toBe('');

    const shiftNov = await insertPartitionAwareRecord<ShiftAssignment>(
      t.db,
      'SHIFT_ASSIGNMENTS',
      {
        schedule_week_id: 'WK-2026_11', employee_id: emp.id, branch_id: branch.id, work_date: '2026-11-09',
        shift_template_id: 'tpl-sang', shift_code: 'CA_SANG', start_at: '07:00', end_at: '12:00', scheduled_hours: 5,
        status: 'ABSENT', source: 'MANUAL', employee_stage: 'OFFICIAL', day_type: 'WORK', published_at: '2026-11-09',
        note: 'Ca làm việc tháng 11', swapped_from_employee_id: '', replacement_for_employee_id: '', linked_assignment_id: '',
      },
      '2026-11-09',
      'admin',
    );

    const adjRes = await t.app.inject({
      method: 'POST',
      url: '/api/me/attendance-adjustments',
      headers: empH,
      payload: {
        assignment_id: shiftNov.id, work_date: '2026-11-09', shift_code: 'CA_SANG', punch_type: 'FULL_SHIFT',
        kind: 'OTHER', reason: 'Quên chấm công ca sáng ngày 09/11/2026', evidence_photo_base64: 'data:image/jpeg;base64,evidence_data_test',
      },
    });
    expect(adjRes.statusCode).toBe(201);
    const createdAdj = adjRes.json().data;

    const storeNov = await getPartitionStore(t.db, 'ATTENDANCE_ADJUSTMENTS', '2026_11');
    const storeOct = await getPartitionStore(t.db, 'ATTENDANCE_ADJUSTMENTS', '2026_10');
    const storeRoot = await getPartitionStore(t.db, 'ATTENDANCE_ADJUSTMENTS', '');
    expect(storeNov.get(createdAdj.id)).toBeDefined();
    expect(storeOct.get(createdAdj.id)).toBeUndefined();
    expect(storeRoot.get(createdAdj.id)).toBeUndefined();

    const myAttRoot = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: empH });
    expect(myAttRoot.json().data.shifts.some((s: { id: string }) => s.id === shiftNov.id)).toBe(true);
    expect(myAttRoot.json().data.adjustments.some((a: { id: string }) => a.id === createdAdj.id)).toBe(true);

    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_10' } });
    const boListOct = await t.app.inject({ method: 'GET', url: '/api/admin/attendance/adjustments', headers: hr });
    expect(boListOct.json().data.some((a: { id: string }) => a.id === createdAdj.id)).toBe(false);

    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_11' } });
    const decideRes = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${createdAdj.id}/decide`, headers: hr,
      payload: { action: 'HR_APPROVE', decision_reason: 'Duyệt bù công hợp lệ' },
    });
    expect(decideRes.statusCode).toBe(200);
    const shiftStoreNov = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_11');
    expect(shiftStoreNov.get(shiftNov.id)?.status).toBe('COMPLETED');
  });

  it('tự động di dời bản ghi lưu nhầm ở tháng 10 hoặc tệp gốc về đúng Tháng 11 mà bảo toàn dữ liệu gốc', async () => {
    const hr = await t.loginHeaders('hr');
    const admin = await t.loginHeaders('admin');
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_11' } });

    const rootStore = await getPartitionStore<AttendanceAdjustment>(t.db, 'ATTENDANCE_ADJUSTMENTS', '');
    const seededRootAdj = await rootStore.insert({
      adjustment_code: 'ADJ-9999', event_id: '', assignment_id: 'SH-NOV-ROOT', employee_id: 'emp-1', branch_id: 'br-1',
      work_date: '2026-11-10', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_IN', punch_type: 'FULL_SHIFT', requested_time: '07:00',
      requested_check_in_at: '07:00', requested_check_out_at: '12:00', requested_hours: 5, reason: 'Tạo ở tệp gốc test đồng bộ',
      evidence_file_id: '', exception_source: 'EMPLOYEE', status: 'PENDING', store_confirmed_by: '', store_confirmed_at: '', store_note: '',
      hr_decision: 'PENDING', decided_by: '', decision_reason: '', decided_at: '', record_id: '', applied_to_record: false,
    }, 'test');

    const report = await rehomeMisplacedPartitionRecords(t.db, 'tester');
    expect(report.details.some((d) => d.id === seededRootAdj.id && d.toMonth === '2026_11')).toBe(true);
    const storeNov = await getPartitionStore<AttendanceAdjustment>(t.db, 'ATTENDANCE_ADJUSTMENTS', '2026_11');
    expect(storeNov.get(seededRootAdj.id)).toBeDefined();
    const listAfter = await t.app.inject({ method: 'GET', url: '/api/admin/attendance/adjustments', headers: hr });
    expect(listAfter.json().data.some((a: { id: string }) => a.id === seededRootAdj.id)).toBe(true);
  });

  it('cuối tháng 11 tạo lịch trước cho tháng 12, qua ngày 03/12 Admin mới tạo sheet tháng 12 thì kéo đủ 100% dữ liệu tháng 12 và hỗ trợ nhân sự thử việc vắt tháng', async () => {
    const admin = await t.loginHeaders('admin');
    const probEmp = t.db.employees.find((e) => e.stage === 'PROBATION')!;
    const branch = t.db.branches.get(probEmp.branch_id)!;
    await t.db.employees.update(probEmp.id, probEmp.version, { probation_start: '2026-11-25', probation_end: '2026-12-06' }, 'admin');

    // 1. Khi chưa tạo sheet 2026_12: tạo ca tháng 11 (25..28/11) & tháng 12 (01..03/12) + đơn OFF tháng 12
    const novDates = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
    const decDates = ['2026-12-01', '2026-12-02', '2026-12-03'];
    const decShiftIds: string[] = [];
    for (const d of [...novDates, ...decDates]) {
      const sh = await insertPartitionAwareRecord<ShiftAssignment>(
        t.db,
        'SHIFT_ASSIGNMENTS',
        {
          schedule_week_id: 'PB-2026_11_12', employee_id: probEmp.id, branch_id: branch.id, work_date: d,
          shift_template_id: 'tpl-sang', shift_code: 'CA_SANG', start_at: '07:00', end_at: '12:00', scheduled_hours: 5,
          status: 'COMPLETED', source: 'PROBATION_AUTO', employee_stage: 'PROBATION', day_type: 'WORK', published_at: d,
          note: 'Chu kỳ thử việc vắt tháng', swapped_from_employee_id: '', replacement_for_employee_id: '', linked_assignment_id: '',
        },
        d,
        'admin',
      );
      if (d.startsWith('2026-12')) decShiftIds.push(sh.id);
    }
    const decLeave = await insertPartitionAwareRecord<LeaveRequest>(
      t.db,
      'LEAVE_REQUESTS',
      {
        request_code: 'POFF-0099', employee_id: probEmp.id, branch_id: branch.id, leave_date: '2026-12-04',
        kind: 'PROBATION_OFF', shift_code: 'CA_SANG', reason: 'Nghỉ OFF thử việc tháng 12', status: 'APPROVED',
        employee_stage: 'PROBATION', schedule_week_id: 'PB-2026_11_12', assignment_id: '',
        quota_cycle_used: 1, quota_cycle_limit: 5, staffing_after_leave: 1, min_staff_required: 1,
        submitted_at: '2026-11-28', store_reviewed_by: '', store_reviewed_at: '',
        decided_by: 'admin', decision_reason: 'Duyệt', decided_at: '2026-11-28',
      },
      '2026-12-04',
      'admin',
    );

    // Chưa tạo 2026_12 -> toàn bộ ca tháng 12 nằm trong sheet 2026_11 và KHÔNG tự tạo 2026_12 ngầm
    expect(readPartitionRegistry(t.db).some((r) => r.monthKey === '2026_12')).toBe(false);
    await rehomeMisplacedPartitionRecords(t.db, 'tester');
    expect(readPartitionRegistry(t.db).some((r) => r.monthKey === '2026_12')).toBe(false);
    const shiftStoreNov = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_11');
    for (const id of decShiftIds) expect(shiftStoreNov.get(id)).toBeDefined();

    // 2. Giả sử ngày 03/12 Admin đang đứng ở 2026_10 rồi bấm Tạo tệp tháng mới cho 2026_12
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2026_10' } });
    const rollRes = await t.app.inject({
      method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin,
      payload: { month_key: '2026_12', carry_forward: true },
    });
    expect(rollRes.statusCode).toBe(201);
    const carriedMap = rollRes.json().data.carried as Record<string, number>;
    expect((carriedMap.SHIFT_ASSIGNMENTS ?? 0) + (carriedMap.LEAVE_REQUESTS ?? 0)).toBeGreaterThanOrEqual(4);

    // 3. Toàn bộ ca và đơn OFF tháng 12 đã được kéo sang sheet 2026_12 và xóa mềm khỏi 2026_11
    const shiftStoreDec = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_12');
    const shiftStoreNovAfter = await getPartitionStore<ShiftAssignment>(t.db, 'SHIFT_ASSIGNMENTS', '2026_11');
    const leaveStoreDec = await getPartitionStore<LeaveRequest>(t.db, 'LEAVE_REQUESTS', '2026_12');
    for (const id of decShiftIds) {
      expect(shiftStoreDec.get(id)?.is_deleted).toBe(false);
      expect(shiftStoreNovAfter.get(id)).toBeUndefined();
    }
    expect(leaveStoreDec.get(decLeave.id)?.is_deleted).toBe(false);

    // 4. Nhân sự thử việc vắt tháng (25/11 -> 06/12) được tính đủ 7 ca (35h) xuyên 2 sheet 2026_11 & 2026_12
    const freshProbEmp = t.db.employees.get(probEmp.id)!;
    const summary = await buildEmployeeDossierSummary(freshProbEmp, t.ctx);
    expect(summary.probationHoursCompleted).toBeGreaterThanOrEqual(35);
    expect(summary.totalShiftsCount).toBeGreaterThanOrEqual(7);
  });

  it('chặn chốt lịch và tự động sắp ca khi cổng đăng ký nghỉ OFF đang mở, chỉ cho phép chốt khi cổng đã đóng', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const { saveOperationSettings } = await import('../services/operations-settings.service.js');
    // Mở cổng OFF: Thứ 1 đến Thứ 7 từ 00:00 đến 23:59 -> chắc chắn isOpen = true
    await saveOperationSettings(t.db, { offWindowOpenWeekday: 1, offWindowOpenTime: '00:00', offWindowCloseWeekday: 7, offWindowCloseTime: '23:59' }, 'admin');
    const lockBlocked = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: '2026-11-09', branch_id: 'ALL' } });
    expect(lockBlocked.statusCode).toBe(400);
    expect(lockBlocked.json().message).toContain('Cổng đăng ký nghỉ OFF đang mở');

    // Đóng cổng OFF: Giờ đóng là 00:01 sáng Thứ 2 -> chắc chắn hiện tại đã đóng
    await saveOperationSettings(t.db, { offWindowOpenWeekday: 1, offWindowOpenTime: '00:00', offWindowCloseWeekday: 1, offWindowCloseTime: '00:01' }, 'admin');
    const lockAllowed = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: '2026-11-09', branch_id: 'ALL' } });
    expect(lockAllowed.statusCode).toBe(200);
    expect(lockAllowed.json().data.createdCount).toBeGreaterThanOrEqual(0);
  });

  it('thông số V8 Heap trả về tỷ lệ phần trăm thực tế dựa trên giới hạn heap_size_limit', async () => {
    const telem = await collectDevDomainAndRuntimeTelemetry(t.ctx);
    expect(telem.runtime.memory.heapTotalMb).toBeGreaterThan(0);
    expect(telem.runtime.memory.heapUsagePercent).toBeLessThan(90);
  });
});
