import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OPERATION_SETTING_KEYS } from '@umbm/shared';
import { Database } from '../data/database.js';
import { SocketEvents } from '../realtime/realtime.js';
import { WriteQueue } from '../sheets/write-queue.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const broadcasts: { event: string; payload: Record<string, unknown> }[] = [];

beforeAll(async () => {
  t = await buildTestApp('q');
  t.ctx.realtime = () => ({
    broadcast: (event: string, payload: Record<string, unknown>) => { broadcasts.push({ event, payload }); },
    toTargets: () => undefined, toBranch: () => undefined, toRole: () => undefined, toUser: () => undefined, connectionCount: () => 4,
  }) as never;
});
afterAll(async () => { await t.app.close(); });

describe('Toàn vẹn Phân vùng Google Sheets theo tháng & Đồng bộ Realtime toàn hệ thống', () => {
  it('phát sự kiện realtime system:partitionChanged ngay khi tạo tệp mới hoặc chuyển nhanh giữa các kỳ', async () => {
    const admin = await t.loginHeaders('admin');
    broadcasts.length = 0;
    const roll = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2027_03', carry_forward: false } });
    expect(roll.statusCode).toBe(201);
    const rollEvt = broadcasts.find((b) => b.event === SocketEvents.DATA_PARTITION_CHANGED);
    expect(rollEvt?.payload).toMatchObject({ kind: 'ROLLOVER', activeMonth: '2027_03', activeLabel: 'Tháng 03/2027', previousMonth: '' });
    expect(String(rollEvt!.payload.message)).toContain('Tháng 03/2027');

    broadcasts.length = 0;
    const sw = await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '' } });
    expect(sw.statusCode).toBe(200);
    const swEvt = broadcasts.find((b) => b.event === SocketEvents.DATA_PARTITION_CHANGED);
    expect(swEvt?.payload).toMatchObject({ kind: 'SWITCH', activeMonth: '', activeLabel: 'Tệp gốc (Mặc định ban đầu)', previousMonth: '2027_03' });
  });

  it('cô lập khóa chốt lịch tuần giữa Tệp gốc và Tệp tháng rỗng, vận hành đầy đủ Lịch/OFF/Bù công/Đối soát trên tệp mới', async () => {
    const admin = await t.loginHeaders('admin'), hr = await t.loginHeaders('hr');
    const branch = t.db.branches.find((b) => b.code === 'CN01')!;

    // 1. Ở Tệp gốc: chốt lịch tuần 2027-03-01 cho CN01
    const lockRoot = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: '2027-03-01', branch_id: branch.id } });
    expect(lockRoot.statusCode).toBe(200);
    const rootCreated = Number(lockRoot.json().data.createdCount);
    expect(rootCreated).toBeGreaterThanOrEqual(7);

    // 2. Chuyển sang Tệp Tháng 03/2027 (0 dòng): KHÔNG bị dính khóa chốt lịch của Tệp gốc
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2027_03' } });
    expect(t.db.shiftAssignments.all().length).toBe(0);
    const previewMarch = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=2027-03-01&branch_id=${branch.id}`, headers: hr });
    expect(previewMarch.json().data.isLocked).toBe(false);
    expect(previewMarch.json().data.summary.plannedCount).toBe(rootCreated);

    // 3. Chốt lịch tuần 2027-03-01 trên Tệp Tháng 03/2027 -> tạo đủ số ca vào UMBM_MONTHLY_2027_03
    const lockMarch = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: '2027-03-01', branch_id: branch.id } });
    expect(lockMarch.json().data.createdCount).toBe(rootCreated);
    expect(t.db.shiftAssignments.all().length).toBe(rootCreated);

    // 4. Kiểm tra CRUD đơn nghỉ OFF, Phiếu bổ sung công và Đối soát trên Tệp Tháng 03/2027
    const emp = t.db.employees.find((e) => e.branch_id === branch.id && e.stage === 'OFFICIAL' && e.status === 'ACTIVE')!;
    const leaveRes = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hr, payload: { employee_id: emp.id, leave_date: '2027-03-15', shift_code: emp.default_shift_code || 'CA_SANG', reason: 'Việc gia đình tháng 3' } });
    expect(leaveRes.statusCode).toBe(201);

    const firstShift = t.db.shiftAssignments.find((a) => a.employee_id === emp.id && a.work_date >= '2027-03-01')!;
    const adjRes = await t.app.inject({
      method: 'POST', url: '/api/admin/attendance/adjustments', headers: hr,
      payload: { employee_id: emp.id, assignment_id: firstShift.id, work_date: firstShift.work_date, shift_code: firstShift.shift_code, punch_type: 'FULL_SHIFT', requested_hours: firstShift.scheduled_hours, reason: 'Quên bấm chấm công trên tệp tháng 3' },
    });
    expect(adjRes.statusCode).toBe(201);

    const refreshList = await t.app.inject({ method: 'GET', url: '/api/admin/data-partitions?refresh=1', headers: admin });
    const counts = Object.fromEntries(refreshList.json().data.counts.map((c: { base: string; rows: number }) => [c.base, c.rows]));
    expect(counts).toMatchObject({ SHIFT_ASSIGNMENTS: rootCreated, LEAVE_REQUESTS: 1, ATTENDANCE_ADJUSTMENTS: 1 });

    const rec = await t.app.inject({ method: 'GET', url: '/api/admin/integrations/reconcile', headers: admin });
    expect(rec.json().data.issues.filter((i: { code: string }) => i.code === 'SCHEMA_INVALID_ROW')).toHaveLength(0);
  });

  it('bảo vệ tuyệt đối Snapshot kỳ lương nháp của tháng cũ không bị ghi đè về 0 giờ khi chuyển sang tệp tháng mới', async () => {
    const admin = await t.loginHeaders('admin'), finance = await t.loginHeaders('finance'), hr = await t.loginHeaders('hr');
    const branch = t.db.branches.find((b) => b.code === 'CN01')!;

    const pendingAdj = t.db.attendanceAdjustments.all()[0]!;
    await t.app.inject({ method: 'POST', url: `/api/admin/attendance/adjustments/${pendingAdj.id}/decide`, headers: hr, payload: { version: pendingAdj.version, action: 'HR_APPROVE', decision_reason: 'Xác nhận đủ công ca tháng 3' } });

    const createPeriod = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/periods', headers: finance, payload: { period_code: 'PR-2027-03', name: 'Kỳ lương Tháng 03/2027', from_date: '2027-03-01', to_date: '2027-03-31' } });
    expect(createPeriod.statusCode).toBe(201);
    const marchPeriodId = createPeriod.json().data.id as string;

    const marchSnapBefore = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${marchPeriodId}/snapshots`, headers: finance });
    const hoursBefore = Number(marchSnapBefore.json().data.summary.totalApprovedHours);
    expect(hoursBefore).toBeGreaterThan(0);

    const marchShiftCount = t.db.shiftAssignments.all().length;
    // Xếp trước tuần 2027-04-05 rồi tạo & chuyển sang tệp Tháng 04/2027 (carry_forward = true)
    const lockApr = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: '2027-04-05', branch_id: branch.id } });
    const aprCount = Number(lockApr.json().data.createdCount);
    expect(aprCount).toBeGreaterThanOrEqual(7);
    const rollApril = await t.app.inject({ method: 'POST', url: '/api/admin/data-partitions/rollover', headers: admin, payload: { month_key: '2027_04', carry_forward: true } });
    expect(rollApril.json().data.carried.SHIFT_ASSIGNMENTS).toBe(aprCount);

    const aprilPlanner = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=2027-04-05&branch_id=${branch.id}`, headers: hr });
    expect(aprilPlanner.json().data.isLocked).toBe(true);
    expect(aprilPlanner.json().data.existingShifts).toHaveLength(aprCount);

    // Đang ở Tháng 04/2027: truy vấn làm mới kỳ lương Tháng 03/2027 KHÔNG làm mất số giờ công Tháng 03
    await t.app.inject({ method: 'GET', url: '/api/admin/payroll/periods?refresh=1', headers: finance });
    const marchSnapDuringApril = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${marchPeriodId}/snapshots`, headers: finance });
    expect(Number(marchSnapDuringApril.json().data.summary.totalApprovedHours)).toBe(hoursBefore);

    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2027_03' } });
    expect(t.db.shiftAssignments.all()).toHaveLength(marchShiftCount);
    expect(t.db.leaveRequests.all()).toHaveLength(1);
    expect(t.db.attendanceAdjustments.all()).toHaveLength(1);
  });

  it('tự phục hồi khi tệp tháng trên Drive bị xóa (404) và khởi động an toàn về tệp gốc nếu nạp lỗi lúc cold-start', async () => {
    const admin = await t.loginHeaders('admin');
    const regRow = t.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY)!;
    const origListTabs = t.db.gateway.listTabs.bind(t.db.gateway);
    const listSpy = vi.spyOn(t.db.gateway, 'listTabs').mockImplementation(async (sid: string) => {
      if (sid === 'deleted-drive-sheet-id') throw Object.assign(new Error('Requested entity was not found'), { code: 404 });
      return origListTabs(sid);
    });

    const brokenEntry = [{ monthKey: '2027_08', fileName: 'UMBM_MONTHLY_2027_08', spreadsheetId: 'deleted-drive-sheet-id', folderId: '', folderPath: '07_MONTHLY_DATABASES/2027-08', webViewLink: '', mode: 'MONTHLY_FILE', createdAt: '', createdBy: 'test' }];
    await t.db.systemSettings.update(regRow.id, regRow.version, { value: JSON.stringify(brokenEntry) }, 'test');

    const healed = await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '2027_08' } });
    expect(healed.statusCode).toBe(200);
    expect(t.db.shiftAssignments.spreadsheetId).toBe('mem-monthly-2027_08');

    const readSpy = vi.spyOn(t.db.gateway, 'ensureTab').mockImplementationOnce(async () => { throw new Error('Drive temporary failure'); });
    const coldDb = new Database(t.db.gateway, new WriteQueue(), t.db.ids);
    await coldDb.loadAll();
    expect(coldDb.isReady()).toBe(true);
    expect(coldDb.partitionMonth).toBe('');

    readSpy.mockRestore();
    listSpy.mockRestore();
    await t.app.inject({ method: 'PUT', url: '/api/admin/data-partitions/active', headers: admin, payload: { month_key: '' } });
  });
});
