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
  it('HR xem OFF đã đăng ký, chốt lịch → duyệt OFF, xếp đủ kín tuần đúng 1 người/ca (tự bù ca OFF) và cảnh báo khi thiếu người', async () => {
    const hr = await t.loginHeaders('hr');
    const official = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const branchId = official.branch_id;
    for (const r of t.db.staffingRules.all()) await t.db.staffingRules.softDelete(r.id, r.version, 'test');
    const weekStart = mondayOfWeek(day(60));
    const offDate = dayjs(weekStart).add(2, 'day').format('YYYY-MM-DD');

    // Khi chi nhánh mới chỉ có 1 NV chính thức (tối đa 2 ca/ngày < 3 ca/ngày) -> báo UNDERSTAFFED cho ca thứ 3 chưa đủ 1/1 người
    const underPv = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${branchId}`, headers: hr })).json().data;
    expect(underPv.issues.some((i: { kind: string }) => i.kind === 'UNDERSTAFFED')).toBe(true);

    // Bổ sung đủ đội ngũ chính thức tại chi nhánh & cân bằng ca mặc định (CA_SANG có 2 người để xoay vòng bù OFF trong nội bộ Ca sáng)
    const e1b = (await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Phạm Chính Thức Sáng 2', phone_number: '0913111221', branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_SANG', create_account: false } })).json().data;
    const e2 = (await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Trần Chính Thức Chiều', phone_number: '0913111222', branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_CHIEU', create_account: false } })).json().data;
    const e3 = (await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Lê Chính Thức Tối', phone_number: '0913111223', branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_TOI', create_account: false } })).json().data;
    expect(e1b.id && e2.id && e3.id).toBeTruthy();

    const off = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: hr, payload: { employee_id: official.id, leave_date: offDate, reason: 'Nghỉ OFF giữa tuần' } });
    expect(off.statusCode).toBe(201);

    const preview = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${branchId}`, headers: hr });
    expect(preview.statusCode).toBe(200);
    const pv = preview.json().data;
    expect(pv.isLocked).toBe(false);
    expect(pv.offRequests.some((o: { leaveDate: string; status: string }) => o.leaveDate === offDate && o.status === 'PENDING')).toBe(true);
    expect(pv.planned.some((p: { employeeId: string; workDate: string }) => p.employeeId === official.id && p.workDate === offDate)).toBe(false);
    expect(pv.planned.length).toBe(21);
    expect(pv.issues.length).toBe(0);

    const store = await t.loginHeaders('store1');
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: store, payload: { week_start: weekStart, branch_id: branchId } })).statusCode).toBe(403);
    const lock = await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: branchId } });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().data.createdCount).toBe(21);
    expect(lock.json().data.approvedOffCount).toBeGreaterThanOrEqual(1);
    expect(t.db.leaveRequests.get(off.json().data.id)?.status).toBe('APPROVED');

    const weekEnd = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
    const weekShifts = t.db.shiftAssignments.filter((a) => a.branch_id === branchId && a.work_date >= weekStart && a.work_date <= weekEnd && a.status === 'PUBLISHED');
    expect(weekShifts.length).toBe(21);
    for (let i = 0; i < 7; i++) for (const sc of ['CA_SANG', 'CA_CHIEU', 'CA_TOI']) expect(weekShifts.filter((a) => a.work_date === dayjs(weekStart).add(i, 'day').format('YYYY-MM-DD') && a.shift_code === sc).length).toBe(1);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: branchId } })).json().data.createdCount).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${branchId}`, headers: hr })).json().data.isLocked).toBe(true);
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

  it('Chặn thử việc đổi/nhường ca; Nhường ca cho NV chính thức chưa vượt 2 ca/ngày tự cập nhật ngay khi đồng ý', async () => {
    const hr = await t.loginHeaders('hr'), admin = await t.loginHeaders('admin');
    const giver = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const prob = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const createOff = await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Lê Chính Thức Nhận Ca', phone_number: '0914111222', branch_id: giver.branch_id, stage: 'OFFICIAL', employment_type: 'FULL_TIME', create_account: true, initial_pin: DEMO_PIN } });
    const receiverId = createOff.json().data.id as string, recUser = t.db.users.find((u) => u.phone === '0914111222')!;
    await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: recUser.id, version: recUser.version }] } });
    const shift = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: giver.id, work_date: day(40), shift_code: 'CA_TOI', status: 'PUBLISHED' } })).json().data;
    const nv2 = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };
    const nv1 = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };
    const nvRec = { ...web, cookie: (await t.login('0914111222', DEMO_PIN, 'employee')).cookie };
    await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers: nvRec, payload: { current_secret: DEMO_PIN, new_secret: '654329', confirm_secret: '654329' } });
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv1, payload: { kind: 'GIVE', requester_id: giver.id, peer_id: receiverId, from_assignment_id: shift.id, reason: 'Giả mạo' } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'GIVE', requester_id: giver.id, peer_id: prob.id, from_assignment_id: shift.id, reason: 'Nhường cho thử việc' } })).statusCode).toBe(400);
    const give = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'GIVE', requester_id: giver.id, peer_id: receiverId, from_assignment_id: shift.id, reason: 'Có việc gấp' } });
    expect(give.statusCode).toBe(201);
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${give.json().data.id}/peer-respond`, headers: nv1, payload: { version: give.json().data.version, accept: true } })).statusCode).toBe(403);
    const accept = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${give.json().data.id}/peer-respond`, headers: nvRec, payload: { version: give.json().data.version, accept: true } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().data.status).toBe('APPROVED');
    expect(accept.json().data.allowance_eligible).toBe(true);
    expect(t.db.shiftAssignments.get(shift.id)?.employee_id).toBe(receiverId);
  });

  it('Đổi ca 2 chiều giữa 2 NV chính thức tự cập nhật không qua HR; Nhường ca thứ 3 trong ngày bắt buộc qua HR duyệt / từ chối', async () => {
    const hr = await t.loginHeaders('hr'), admin = await t.loginHeaders('admin'), offA = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const createB = await t.app.inject({ method: 'POST', url: '/api/admin/employees', headers: hr, payload: { full_name: 'Phạm Chính Thức B', phone_number: '0914222333', branch_id: offA.branch_id, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: 'CA_CHIEU', create_account: true, initial_pin: '654321' } });
    expect(createB.statusCode).toBe(201);
    const offBId = createB.json().data.id as string, userB = t.db.users.find((u) => u.phone === '0914222333')!;
    await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: userB.id, version: userB.version }] } });
    const nvB = { ...web, cookie: (await t.login('0914222333', '654321', 'employee')).cookie };
    await t.app.inject({ method: 'PUT', url: '/api/auth/password', headers: nvB, payload: { current_secret: '654321', new_secret: '654322', confirm_secret: '654322' } });
    const nvA = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie }, dSwap = day(45);
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

  it('Khóa nút Vào ca / Ra ca khi đang chờ duyệt phiếu bù công; từ chối thì mở khóa lại & ảnh minh chứng phục vụ tức thì từ cache', async () => {
    const hr = await t.loginHeaders('hr');
    const emp = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const branch = t.db.branches.get(emp.branch_id)!;
    const nv2 = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };
    const workDate = day(50);
    const sh = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: emp.id, work_date: workDate, shift_code: 'CA_SANG', status: 'PUBLISHED' } })).json().data;
    const bigImg = `data:image/jpeg;base64,${Buffer.alloc(128, 7).toString('base64')}`;
    const adjIn = (await t.app.inject({ method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2, payload: { employee_id: emp.id, assignment_id: sh.id, work_date: workDate, shift_code: 'CA_SANG', punch_type: 'CHECK_IN', reason: 'Lỗi mạng khi vào ca', evidence_photo_base64: bigImg } })).json().data;
    expect((await t.app.inject({ method: 'GET', url: adjIn.evidencePhotoUrl })).statusCode).toBe(200);

    const myPending = (await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: nv2 })).json().data.shifts.find((s: { id: string }) => s.id === sh.id);
    expect(myPending.pendingAdjustmentCode).toBe(adjIn.adjustment_code);
    expect(myPending.pendingAdjustmentPunchType).toBe('CHECK_IN');
    expect(myPending.attendanceStatusLabel).toContain('Đã gửi yêu cầu Vào ca');
    const blockedIn = await t.app.inject({ method: 'POST', url: '/api/attendance/check', headers: nv2, payload: { assignment_id: sh.id, type: 'CHECK_IN', lat: branch.lat, lng: branch.lng } });
    expect(blockedIn.statusCode).toBe(400);

    await t.app.inject({ method: 'POST', url: `/api/admin/attendance/adjustments/${adjIn.id}/decide`, headers: hr, payload: { version: adjIn.version, action: 'HR_REJECT', decision_reason: 'Ảnh minh chứng bị mờ' } });
    const myRej = (await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: nv2 })).json().data.shifts.find((s: { id: string }) => s.id === sh.id);
    expect(myRej.pendingAdjustmentCode).toBeNull();
    expect(myRej.rejectedAdjustmentCode).toBe(adjIn.adjustment_code);
    expect(myRej.rejectedAdjustmentReason).toBe('Ảnh minh chứng bị mờ');
    expect((await t.app.inject({ method: 'POST', url: '/api/attendance/check', headers: nv2, payload: { assignment_id: sh.id, type: 'CHECK_IN', lat: branch.lat, lng: branch.lng } })).statusCode).toBe(201);

    const adjOut = (await t.app.inject({ method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2, payload: { employee_id: emp.id, assignment_id: sh.id, work_date: workDate, shift_code: 'CA_SANG', punch_type: 'CHECK_OUT', reason: 'Lỗi GPS khi ra ca', evidence_photo_base64: bigImg } })).json().data;
    expect((await t.app.inject({ method: 'POST', url: '/api/attendance/check', headers: nv2, payload: { assignment_id: sh.id, type: 'CHECK_OUT', lat: branch.lat, lng: branch.lng } })).statusCode).toBe(400);
    expect(adjOut.punch_type).toBe('CHECK_OUT');
  });
});
