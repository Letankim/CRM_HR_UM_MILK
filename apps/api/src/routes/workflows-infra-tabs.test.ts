import { describe, expect, it } from 'vitest';
import { dayjs } from '../lib/time.js';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('Workflows, Infrastructure & Full Tab APIs (AI-INFRA-07..09, FLOW-02..04)', () => {
  it('enforces Probation OFF quota (5/12 ngày) and mutual Shift Swap between officials applied right after peer accepts (no HR step)', async () => {
    const { app, db, login, loginHeaders } = await buildTestApp('w');
    const hrHeaders = await loginHeaders('hr');
    const adminHeaders = await loginHeaders('admin');
    const web = { 'x-umbm-client': 'web' };
    const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');
    const probEmp = db.employees.find((e) => e.employee_code === 'NV0001')!;
    const offEmp = db.employees.find((e) => e.employee_code === 'NV0002')!;
    await db.employees.update(probEmp.id, probEmp.version, { probation_start: day(0) }, 'test');
    for (const l of db.leaveRequests.filter((x) => x.employee_id === probEmp.id || x.employee_id === probEmp.employee_code)) await db.leaveRequests.softDelete(l.id, l.version, 'test');

    const nv1 = { ...web, cookie: (await login('0901000001', '246810', 'employee')).cookie };
    for (let i = 1; i <= 5; i++) {
      const ok = await app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv1, payload: { employee_id: probEmp.id, leave_date: day(i), reason: `Nghỉ OFF chu kỳ thử việc ngày ${i}` } });
      expect(ok.statusCode).toBe(201);
    }
    const over = await app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv1, payload: { employee_id: probEmp.id, leave_date: day(6), reason: 'Vượt định mức thử việc' } });
    expect(over.statusCode).toBe(400);
    expect(over.json().errors.details[0].code).toBe('OUT_OF_RANGE');
    const outOfCycle = await app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv1, payload: { employee_id: probEmp.id, leave_date: day(20), reason: 'Ngoài chu kỳ' } });
    expect(outOfCycle.statusCode).toBe(400);

    const newEmpRes = await app.inject({ method: 'POST', url: '/api/admin/employees', headers: hrHeaders, payload: { full_name: 'Phan Văn Đổi Ca', phone_number: '0912345670', branch_id: offEmp.branch_id, stage: 'OFFICIAL', employment_type: 'FULL_TIME', create_account: true, username: 'nv.doica', initial_pin: '135791' } });
    expect(newEmpRes.statusCode).toBe(201);
    const peer = db.employees.get(newEmpRes.json().data.id)!;
    const peerUser = db.users.find((u) => u.username === 'nv.doica')!;
    expect(peerUser.must_change_pin).toBe(true);
    await app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: adminHeaders, payload: { action: 'ACTIVATE', items: [{ id: peerUser.id, version: peerUser.version }] } });
    const peerHeaders = { ...web, cookie: (await login('0912345670', '135791', 'employee')).cookie };
    expect((await app.inject({ method: 'PUT', url: '/api/auth/password', headers: peerHeaders, payload: { current_secret: '135791', new_secret: '975310', confirm_secret: '975310' } })).statusCode).toBe(200);

    const mine = (await app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrHeaders, payload: { employee_id: offEmp.id, work_date: day(3), shift_code: 'CA_SANG', status: 'PUBLISHED' } })).json().data;
    const theirs = (await app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrHeaders, payload: { employee_id: peer.id, work_date: day(4), shift_code: 'CA_CHIEU', status: 'PUBLISHED' } })).json().data;
    const nv2 = { ...web, cookie: (await login('0901000002', '246810', 'employee')).cookie };
    const noTarget = await app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'SWAP', requester_id: offEmp.id, peer_id: peer.id, from_assignment_id: mine.id, reason: 'Đổi ca' } });
    expect(noTarget.statusCode).toBe(400);
    const swapRes = await app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv2, payload: { kind: 'SWAP', requester_id: offEmp.id, peer_id: peer.id, from_assignment_id: mine.id, to_assignment_id: theirs.id, reason: 'Đổi ca sáng lấy ca chiều hôm sau' } });
    expect(swapRes.statusCode).toBe(201);
    const swap = swapRes.json().data;
    expect(db.shiftAssignments.get(mine.id)?.employee_id).toBe(offEmp.id);
    expect((await app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${swap.id}/decide`, headers: hrHeaders, payload: { version: swap.version, decision: 'APPROVED' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${swap.id}/peer-respond`, headers: nv2, payload: { version: swap.version, accept: true } })).statusCode).toBe(403);

    const accept = await app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${swap.id}/peer-respond`, headers: peerHeaders, payload: { version: swap.version, accept: true, peer_note: 'Đồng ý đổi' } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().data.status).toBe('APPROVED');
    expect(db.shiftAssignments.get(mine.id)?.employee_id).toBe(peer.id);
    expect(db.shiftAssignments.get(theirs.id)?.employee_id).toBe(offEmp.id);
    const myAtt = (await app.inject({ method: 'GET', url: '/api/my-attendance', headers: nv2 })).json().data;
    expect(myAtt.swaps[0].kind).toBe('SWAP');
    expect(myAtt.emergencyLeaves).toBeUndefined();
    await app.close();
  });
  it('enforces GPS Haversine radius, blocks gallery selfie uploads, and preserves raw attendance events on adjustment', async () => {
    const { app, db, loginHeaders } = await buildTestApp('v');
    const hrHeaders = await loginHeaders('hr');
    const publishedAssign = db.shiftAssignments.find((a) => a.status === 'PUBLISHED')!;
    const branch = db.branches.get(publishedAssign.branch_id)!;

    const galleryAttempt = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'GALLERY' },
    });
    expect(galleryAttempt.statusCode).toBe(400);

    const farGpsAttempt = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat + 0.05, lng: branch.lng + 0.05, selfie_source: 'LIVE_CAMERA' },
    });
    expect(farGpsAttempt.statusCode).toBe(400);
    expect(farGpsAttempt.json().errors.details[0].code).toBe('OUT_OF_RANGE');

    const validCheckIn = await app.inject({
      method: 'POST', url: '/api/attendance/check', headers: hrHeaders,
      payload: { assignment_id: publishedAssign.id, kind: 'CHECK_IN', lat: branch.lat, lng: branch.lng, selfie_source: 'LIVE_CAMERA' },
    });
    expect(validCheckIn.statusCode).toBe(201);
    const rawEventCountBefore = db.attendanceEvents.all().length;

    const seededAdj = db.attendanceAdjustments.all()[0]!;
    const storeConfirm = await app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${seededAdj.id}/decide`, headers: hrHeaders,
      payload: { version: 1, action: 'STORE_CONFIRM', decision_reason: 'CH xác nhận nhân viên có làm hết ca' },
    });
    expect(storeConfirm.statusCode).toBe(200);
    expect(storeConfirm.json().data.status).toBe('STORE_CONFIRMED');

    const hrApprove = await app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${seededAdj.id}/decide`, headers: hrHeaders,
      payload: { version: 2, action: 'HR_APPROVE', decision_reason: 'HR duyệt bổ sung công' },
    });
    expect(hrApprove.statusCode).toBe(200);
    expect(hrApprove.json().data.status).toBe('APPROVED');
    expect(db.attendanceEvents.all().length).toBe(rawEventCountBefore);
    await app.close();
  });
});
