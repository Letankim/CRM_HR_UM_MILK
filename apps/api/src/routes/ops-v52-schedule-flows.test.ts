import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mondayOfWeek } from '@umbm/shared';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';
import { buildAttendanceFolderSegments, buildShiftFolderName } from './attendance-photo-storage.js';

let t: TestAppContext;
const web = { 'x-umbm-client': 'web' };
const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');

beforeAll(async () => { t = await buildTestApp('q'); });
afterAll(async () => { await t.app.close(); });

describe('Ops V5.2 — Chốt lịch tuần & tự động sắp ca theo ca mặc định', () => {
  it('HR xem OFF đã đăng ký, chốt lịch → duyệt OFF, xếp ca mặc định (mỗi ca 1 người khi chưa cấu hình định biên) và báo cáo trường hợp không xếp được', async () => {
    const hr = await t.loginHeaders('hr');
    const official = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const branchId = official.branch_id;
    for (const r of t.db.staffingRules.all()) await t.db.staffingRules.softDelete(r.id, r.version, 'test');
    const weekStart = mondayOfWeek(day(60));
    const offDate = dayjs(weekStart).add(2, 'day').format('YYYY-MM-DD');
    const off = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hr, payload: { employee_id: official.id, leave_date: offDate, reason: 'Nghỉ OFF giữa tuần' } });
    expect(off.statusCode).toBe(201);

    const dup = await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Trịnh Văn Trùng Ca', phone_number: '0913111222', branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: official.default_shift_code || 'CA_SANG', create_account: false } });
    expect(dup.statusCode).toBe(201);

    const preview = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${branchId}`, headers: hr });
    expect(preview.statusCode).toBe(200);
    const pv = preview.json().data;
    expect(pv.isLocked).toBe(false);
    expect(pv.offRequests.some((o: { leaveDate: string; status: string }) => o.leaveDate === offDate && o.status === 'PENDING')).toBe(true);
    expect(pv.planned.some((p: { employeeId: string; workDate: string }) => p.employeeId === official.id && p.workDate === offDate)).toBe(false);
    expect(pv.issues.some((i: { kind: string }) => i.kind === 'CAPACITY_FULL')).toBe(true);

    const store = await t.loginHeaders('store1');
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: store, payload: { week_start: weekStart, branch_id: branchId } })).statusCode).toBe(403);
    const lock = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: branchId } });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().data.createdCount).toBe(pv.planned.length);
    expect(lock.json().data.approvedOffCount).toBeGreaterThanOrEqual(1);
    expect(t.db.leaveRequests.get(off.json().data.id)?.status).toBe('APPROVED');
    const created = t.db.shiftAssignments.filter((a) => a.source === 'AUTO_PLAN' && a.employee_id === official.id);
    expect(created.length).toBe(6);
    expect(created.every((a) => a.status === 'PUBLISHED' && a.shift_code === (official.default_shift_code || 'CA_SANG'))).toBe(true);

    const relock = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: branchId } });
    expect(relock.json().data.createdCount).toBe(0);
    const after = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${branchId}`, headers: hr })).json().data;
    expect(after.isLocked).toBe(true);
  });

  it('Thử việc: chốt chu kỳ 12 ngày xếp đủ 7 ca trừ 5 OFF; đăng ký thêm ca (tối đa 2 ca/ngày) dời ca cuối khi HR duyệt', async () => {
    const hr = await t.loginHeaders('hr');
    const prob = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    await t.db.employees.update(prob.id, prob.version, { probation_start: day(1) }, 'test');
    for (const a of t.db.shiftAssignments.filter((x) => x.employee_id === prob.id || x.employee_id === prob.employee_code)) await t.db.shiftAssignments.softDelete(a.id, a.version, 'test');
    for (const l of t.db.leaveRequests.filter((x) => x.employee_id === prob.id || x.employee_id === prob.employee_code)) await t.db.leaveRequests.softDelete(l.id, l.version, 'test');
    const nv1 = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };
    for (const n of [2, 4, 6, 8, 10]) {
      expect((await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv1, payload: { employee_id: prob.id, leave_date: day(n), reason: 'OFF chu kỳ thử việc' } })).statusCode).toBe(201);
    }
    const list = (await t.app.inject({ method: 'GET', url: '/api/admin/schedule-planner/probation', headers: hr })).json().data;
    const item = list.find((i: { employeeId: string }) => i.employeeId === prob.id);
    expect(item.planned.length).toBe(7);
    const lock = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/probation/lock', headers: hr, payload: { employee_id: prob.id } });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().data.createdCount).toBe(7);
    expect(lock.json().data.approvedOffCount).toBe(5);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv1, payload: { employee_id: prob.id, leave_date: day(3), reason: 'Sau khi chốt' } })).statusCode).toBe(400);

    const myShifts = t.db.shiftAssignments.filter((a) => a.employee_id === prob.id && a.status === 'PUBLISHED').sort((a, b) => a.work_date.localeCompare(b.work_date));
    const firstDay = myShifts[0]!.work_date, lastShift = myShifts[myShifts.length - 1]!;
    const extraCode = myShifts[0]!.shift_code === 'CA_CHIEU' ? 'CA_TOI' : 'CA_CHIEU';
    const extra = await t.app.inject({ method: 'POST', url: '/api/my-attendance/shifts', headers: nv1, payload: { work_date: firstDay, shift_code: extraCode } });
    expect(extra.statusCode).toBe(201);
    expect(extra.json().data.linkedAssignmentId).toBe(lastShift.id);
    expect(extra.json().message).toContain('dời ca cuối');
    const third = await t.app.inject({ method: 'POST', url: '/api/my-attendance/shifts', headers: nv1, payload: { work_date: firstDay, shift_code: extraCode === 'CA_TOI' ? 'CA_SANG' : 'CA_TOI' } });
    expect(third.statusCode).toBe(400);

    const approve = await t.app.inject({ method: 'PUT', url: `/api/admin/schedules/${extra.json().data.id}`, headers: hr, payload: { version: extra.json().data.version, status: 'PUBLISHED' } });
    expect(approve.statusCode).toBe(200);
    expect(t.db.shiftAssignments.get(lastShift.id)).toBeUndefined();
    const sevenShifts = t.db.shiftAssignments.filter((a) => a.employee_id === prob.id && a.status === 'PUBLISHED');
    expect(sevenShifts.length).toBe(7);

    for (const s of sevenShifts) await t.db.shiftAssignments.update(s.id, s.version, { status: 'COMPLETED' }, 'test');
    await ensureSyncedNotifications(t.ctx);
    const readyList = (await t.app.inject({ method: 'GET', url: '/api/admin/schedule-planner/probation', headers: hr })).json().data;
    const readyItem = readyList.find((i: { employeeId: string }) => i.employeeId === prob.id);
    expect(readyItem.completedCount).toBe(7);
    expect(readyItem.readyForOfficial).toBe(true);
    expect(t.db.notifications.all().some((n) => n.entity_type === 'PROBATION_READY_HR' && n.entity_id === prob.id)).toBe(true);
  });

  it('Nhường ca cho đồng nghiệp chưa vượt 2 ca/ngày được cập nhật ngay khi người nhận đồng ý; người khác không thể xác nhận thay', async () => {
    const hr = await t.loginHeaders('hr');
    const giver = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const receiver = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const shift = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: giver.id, work_date: day(40), shift_code: 'CA_TOI', status: 'PUBLISHED' } })).json().data;
    const nv2 = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };
    const nv1 = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };
    const notOwn = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv1, payload: { kind: 'GIVE', requester_id: giver.id, peer_id: receiver.id, from_assignment_id: shift.id, reason: 'Giả mạo' } });
    expect(notOwn.statusCode).toBe(403);
    const swapNotAllowed = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'SWAP', requester_id: giver.id, peer_id: receiver.id, from_assignment_id: shift.id, to_assignment_id: shift.id, reason: 'Đổi với thử việc' } });
    expect(swapNotAllowed.statusCode).toBe(400);
    const give = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'GIVE', requester_id: giver.id, peer_id: receiver.id, from_assignment_id: shift.id, reason: 'Có việc gấp' } });
    expect(give.statusCode).toBe(201);
    expect(give.json().data.requires_hr_approval).toBe(false);
    const accept = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${give.json().data.id}/peer-respond`, headers: nv1, payload: { version: give.json().data.version, accept: true } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().data.status).toBe('APPROVED');
    expect(accept.json().data.allowance_eligible).toBe(true);
    expect(t.db.shiftAssignments.get(shift.id)?.employee_id).toBe(receiver.id);
  });

  it('Đổi ca 2 chiều giữa 2 NV chính thức tự cập nhật không qua HR; Nhường ca thứ 3 trong ngày bắt buộc qua HR duyệt / từ chối', async () => {
    const hr = await t.loginHeaders('hr');
    const admin = await t.loginHeaders('admin');
    const offA = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const createB = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hr,
      payload: { full_name: 'Phạm Chính Thức B', phone_number: '0914222333', branch_id: offA.branch_id, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_CHIEU', create_account: true, initial_pin: '654321' },
    });
    expect(createB.statusCode).toBe(201);
    const offBId = createB.json().data.id as string;
    const userB = t.db.users.find((u) => u.phone === '0914222333')!;
    await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: userB.id, version: userB.version }] } });
    const loginB = await t.login('0914222333', '654321', 'employee');
    const nvB = { ...web, cookie: loginB.cookie };
    await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers: nvB, payload: { current_secret: '654321', new_secret: '654322', confirm_secret: '654322' } });
    const nvA = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };

    const dSwap = day(45);
    const sA = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offA.id, work_date: dSwap, shift_code: 'CA_SANG', status: 'PUBLISHED' } })).json().data;
    const sB = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offBId, work_date: dSwap, shift_code: 'CA_CHIEU', status: 'PUBLISHED' } })).json().data;
    const swapReq = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvA, payload: { kind: 'SWAP', requester_id: offA.id, peer_id: offBId, from_assignment_id: sA.id, to_assignment_id: sB.id, reason: 'Đổi ca sáng chiều' } });
    expect(swapReq.statusCode).toBe(201);
    const swapAcc = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${swapReq.json().data.id}/peer-respond`, headers: nvB, payload: { version: swapReq.json().data.version, accept: true } });
    expect(swapAcc.statusCode).toBe(200);
    expect(swapAcc.json().data.status).toBe('APPROVED');
    expect(t.db.shiftAssignments.get(sA.id)?.employee_id).toBe(offBId);
    expect(t.db.shiftAssignments.get(sB.id)?.employee_id).toBe(offA.id);

    const d3 = day(46);
    await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offBId, work_date: d3, shift_code: 'CA_SANG', status: 'PUBLISHED' } });
    await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offBId, work_date: d3, shift_code: 'CA_CHIEU', status: 'PUBLISHED' } });
    const s3 = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offA.id, work_date: d3, shift_code: 'CA_TOI', status: 'PUBLISHED' } })).json().data;
    const give3 = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvA, payload: { kind: 'GIVE', requester_id: offA.id, peer_id: offBId, from_assignment_id: s3.id, reason: 'Nhường ca tối' } });
    expect(give3.statusCode).toBe(201);
    expect(give3.json().data.requires_hr_approval).toBe(true);
    const peer3 = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${give3.json().data.id}/peer-respond`, headers: nvB, payload: { version: give3.json().data.version, accept: true } });
    expect(peer3.json().data.status).toBe('PEER_ACCEPTED');
    expect(t.db.shiftAssignments.get(s3.id)?.employee_id).toBe(offA.id);
    const hrRej = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${give3.json().data.id}/decide`, headers: hr, payload: { version: peer3.json().data.version, decision: 'REJECTED', decision_reason: 'Không làm 3 ca/ngày' } });
    expect(hrRej.statusCode).toBe(200);
    expect(t.db.shiftAssignments.get(s3.id)?.employee_id).toBe(offA.id);
  });

  it('Phân cấp folder Tháng/Ngày/Ca & Báo lỗi Vào ca + Ra ca kèm minh chứng trên cùng 1 ca không bị xóa nhầm', async () => {
    expect(buildAttendanceFolderSegments('2026-11-05', buildShiftFolderName('Ca sáng', 'CA_SANG', '07:00', '12:00'))).toEqual(['2026-11', '2026-11-05', 'Ca sáng (07h00-12h00)']);
    const hr = await t.loginHeaders('hr');
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const nv2 = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };
    const workDate = day(0);
    const sh = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: emp.id, work_date: workDate, shift_code: 'CA_TOI', status: 'PUBLISHED' } })).json().data;
    const noPhoto = await t.app.inject({ method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2, payload: { employee_id: emp.id, assignment_id: sh.id, work_date: workDate, shift_code: 'CA_TOI', punch_type: 'CHECK_IN', reason: 'Lỗi GPS khi vào ca' } });
    expect(noPhoto.statusCode).toBe(400);
    const img = 'data:image/jpeg;base64,dGVzdF9ldmlkZW5jZV9waG90bw==';
    const inAdj = await t.app.inject({ method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2, payload: { employee_id: emp.id, assignment_id: sh.id, work_date: workDate, shift_code: 'CA_TOI', punch_type: 'CHECK_IN', reason: 'Lỗi GPS khi vào ca', evidence_photo_base64: img } });
    expect(inAdj.statusCode).toBe(201);
    const inApp = await t.app.inject({ method: 'POST', url: `/api/admin/attendance/adjustments/${inAdj.json().data.id}/decide`, headers: hr, payload: { version: inAdj.json().data.version, action: 'HR_APPROVE', decision_reason: 'Xác nhận vào ca' } });
    expect(inApp.statusCode).toBe(200);
    expect(t.db.attendanceEvents.all().some((e) => e.assignment_id === sh.id && e.type === 'CHECK_IN')).toBe(true);

    const outAdj = await t.app.inject({ method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2, payload: { employee_id: emp.id, assignment_id: sh.id, work_date: workDate, shift_code: 'CA_TOI', punch_type: 'CHECK_OUT', reason: 'Quá 3h mới gửi minh chứng ra ca', evidence_photo_base64: img } });
    expect(outAdj.statusCode).toBe(201);
    const outApp = await t.app.inject({ method: 'POST', url: `/api/admin/attendance/adjustments/${outAdj.json().data.id}/decide`, headers: hr, payload: { version: outAdj.json().data.version, action: 'HR_APPROVE', decision_reason: 'Xác nhận hoàn thành ca' } });
    expect(outApp.statusCode).toBe(200);
    expect(t.db.shiftAssignments.get(sh.id)?.status).toBe('COMPLETED');
    expect(t.db.attendanceAdjustments.get(inAdj.json().data.id)).toBeTruthy();
    expect(t.db.attendanceAdjustments.get(outAdj.json().data.id)).toBeTruthy();
  });
});
