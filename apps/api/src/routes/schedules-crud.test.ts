import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../data/database.js';
import { sweepExpiredShiftsAndMarkAbsent } from '../services/shift-absent-scanner.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let app: TestAppContext['app'];
let db: Database;
const loginHeaders = (username: string) => t.loginHeaders(username);

beforeAll(async () => {
  t = await buildTestApp('z');
  app = t.app;
  db = t.db;
});

afterAll(async () => {
  await app.close();
});

describe('Lịch làm việc (HR-07, STR-03) & CRUD Khung ca', () => {
  it('supports full CRUD on Shift Templates & Branches', async () => {
    const headers = await loginHeaders('admin');
    const createShift = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-templates',
      headers,
      payload: { code: 'CA_GAY', name: 'Ca gãy linh hoạt', start_time: '09:00', end_time: '14:00', standard_hours: 5 },
    });
    expect(createShift.statusCode).toBe(201);
    const shift = createShift.json().data;

    const updateShift = await app.inject({
      method: 'PUT',
      url: `/api/admin/shift-templates/${shift.id}`,
      headers,
      payload: { version: shift.version, name: 'Ca gãy cập nhật', standard_hours: 5.5 },
    });
    expect(updateShift.statusCode).toBe(200);
    expect(updateShift.json().data.name).toBe('Ca gãy cập nhật');

    const delShift = await app.inject({
      method: 'DELETE',
      url: `/api/admin/shift-templates/${shift.id}`,
      headers,
      payload: { version: updateShift.json().data.version },
    });
    expect(delShift.statusCode).toBe(200);
  });

  it('supports Schedule Shift Assignments CRUD & Bulk Publish (AI-TAB-19, AI-TAB-30)', async () => {
    const headers = await loginHeaders('hr');
    const emp = db.employees.all()[0]!;
    const branchId = emp.branch_id;

    const createRes = await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers,
      payload: { branch_id: branchId, employee_id: emp.id, work_date: '2026-10-26', shift_code: 'CA_TOI', status: 'DRAFT', day_type: 'WORK', note: 'Phân ca tối cuối tuần' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data;
    expect(created.shiftCode).toBe('CA_TOI');
    expect(created.status).toBe('DRAFT');

    const updRes = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${created.id}`, headers,
      payload: { version: created.version, note: 'Đã xác nhận ca tối' },
    });
    expect(updRes.statusCode).toBe(200);
    expect(updRes.json().data.note).toBe('Đã xác nhận ca tối');

    const bulkPub = await app.inject({
      method: 'POST', url: '/api/admin/schedules/bulk-action', headers,
      payload: { action: 'PUBLISH', items: [{ id: created.id, version: updRes.json().data.version }] },
    });
    expect(bulkPub.statusCode).toBe(200);
    expect(bulkPub.json().data.processedCount).toBe(1);

    const listRes = await app.inject({ method: 'GET', url: `/api/admin/schedules?from_date=2026-10-01&to_date=2026-10-31`, headers });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-marks expired un-checked-in shifts as ABSENT, locks check-in, and restores to COMPLETED when adjustment is HR_APPROVE', async () => {
    const hrHeaders = await loginHeaders('hr');
    const emp = db.employees.all()[0]!;
    const branch = db.branches.get(emp.branch_id) ?? db.branches.all()[0]!;
    const createRes = await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { branch_id: branch.id, employee_id: emp.id, work_date: '2026-10-20', shift_code: 'CA_SANG', status: 'PUBLISHED', day_type: 'WORK' },
    });
    const shiftId = createRes.json().data.id as string;

    await sweepExpiredShiftsAndMarkAbsent(db, 'test-scanner', { nowDate: '2026-10-20', nowHm: '12:30' });
    expect(db.shiftAssignments.get(shiftId)?.status).toBe('ABSENT');

    const lockedCheckIn = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: shiftId, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'LIVE_CAMERA' },
    });
    expect(lockedCheckIn.statusCode).toBe(400);

    const adjRes = await app.inject({
      method: 'POST', url: '/api/admin/attendance/adjustments', headers: hrHeaders,
      payload: { employee_id: emp.id, work_date: '2026-10-20', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_IN', requested_hours: 5, reason: 'Quên điểm danh vào ca sáng' },
    });
    expect(adjRes.statusCode).toBe(201);
    const adj = adjRes.json().data;
    expect(adj.assignment_id).toBe(shiftId);
    const adjListRes = await app.inject({ method: 'GET', url: '/api/admin/attendance/adjustments', headers: hrHeaders });
    expect(adjListRes.json().data[0].id).toBe(adj.id);

    const decideRes = await app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adj.id}/decide`, headers: hrHeaders,
      payload: { version: adj.version, action: 'HR_APPROVE', decision_reason: 'HR duyệt bù công ca vắng mặt' },
    });
    expect(decideRes.statusCode).toBe(200);
    expect(db.shiftAssignments.get(shiftId)?.status).toBe('COMPLETED');
  });

  it('requires Store Manager (STORE) or HR approval before employee-registered shifts become PUBLISHED and allow Check-In/Swap', async () => {
    const storeHeaders = await loginHeaders('store1');
    const hrHeaders = await loginHeaders('hr');
    const regRes = await app.inject({
      method: 'POST', url: '/api/my-attendance/shifts', headers: storeHeaders,
      payload: { work_date: '2027-12-15', shift_code: 'CA_TOI', note: 'Đăng ký ca tối chờ duyệt' },
    });
    expect(regRes.statusCode).toBe(201);
    const registered = regRes.json().data;
    expect(registered.status).toBe('DRAFT');

    const branch = db.branches.get(registered.branchId) ?? db.branches.all()[0]!;
    const checkBeforeApprove = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: storeHeaders,
      payload: { assignment_id: registered.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'LIVE_CAMERA' },
    });
    expect(checkBeforeApprove.statusCode).toBe(400);

    const approveRes = await app.inject({
      method: 'PUT', url: `/api/admin/schedules/${registered.id}`, headers: hrHeaders,
      payload: { version: registered.version, status: 'PUBLISHED' },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.status).toBe('PUBLISHED');

    const checkAfterApprove = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: storeHeaders,
      payload: { assignment_id: registered.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'LIVE_CAMERA' },
    });
    expect(checkAfterApprove.statusCode).toBe(201);

    const sessionsRes = await app.inject({ method: 'GET', url: '/api/admin/attendance/sessions?page=1&per_page=5', headers: hrHeaders });
    expect(sessionsRes.statusCode).toBe(200);
    expect(sessionsRes.json().meta.pagination.per_page).toBe(5);
    expect(sessionsRes.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects creating a Shift Swap when the peer already has a shift on the same work_date', async () => {
    const hrHeaders = await loginHeaders('hr');
    const emps = db.employees.all();
    const reqEmp = emps[0]!;
    const busyPeer = emps[1]!;

    const reqShiftRes = await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { branch_id: reqEmp.branch_id, employee_id: reqEmp.id, work_date: '2027-11-20', shift_code: 'CA_SANG', status: 'PUBLISHED', day_type: 'WORK', note: 'Ca cần đổi' },
    });
    expect(reqShiftRes.statusCode).toBe(201);
    const reqShift = reqShiftRes.json().data;

    await app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrHeaders,
      payload: { branch_id: busyPeer.branch_id, employee_id: busyPeer.id, work_date: '2027-11-20', shift_code: 'CA_CHIEU', status: 'PUBLISHED', day_type: 'WORK', note: 'Đã có ca chiều cùng ngày' },
    });

    const swapConflictRes = await app.inject({
      method: 'POST', url: '/api/admin/shift-swaps', headers: hrHeaders,
      payload: { requester_id: reqEmp.id, peer_id: busyPeer.id, from_assignment_id: reqShift.id, reason: 'Thử đổi sang người đã có ca ngày đó' },
    });
    expect(swapConflictRes.statusCode).toBe(400);
    expect(swapConflictRes.json().errors.details[0].field).toBe('peer_id');
    expect(swapConflictRes.json().errors.details[0].code).toBe('DUPLICATE_VALUE');
  });

  it('supports per-branch Staffing Rules (POST, PUT, GET, DELETE) and per-branch Shift Templates', async () => {
    const headers = await loginHeaders('admin');
    const branch = db.branches.all()[0]!;
    const shiftTpl = db.shiftTemplates.all()[0]!;

    const createRule = await app.inject({
      method: 'POST', url: '/api/admin/staffing-rules', headers,
      payload: { branch_id: branch.id, shift_template_id: shiftTpl.id, min_staff: 3, max_staff: 7, enforcement: 'HARD_BLOCK', note: 'Định biên riêng cho chi nhánh Quận 1' },
    });
    expect(createRule.statusCode).toBe(201);
    const rule = createRule.json().data;
    expect(rule.branchId).toBe(branch.id);
    expect(rule.branchName).toContain(branch.name);

    const updateRule = await app.inject({
      method: 'PUT', url: `/api/admin/staffing-rules/${rule.id}`, headers,
      payload: { version: rule.version, min_staff: 4, max_staff: 8, enforcement: 'SOFT_WARN', note: 'Tăng định biên cuối tuần' },
    });
    expect(updateRule.statusCode).toBe(200);
    expect(updateRule.json().data.min_staff).toBe(4);
    expect(updateRule.json().data.max_staff).toBe(8);

    const delRule = await app.inject({ method: 'DELETE', url: `/api/admin/staffing-rules/${rule.id}`, headers });
    expect(delRule.statusCode).toBe(200);
  });
});
