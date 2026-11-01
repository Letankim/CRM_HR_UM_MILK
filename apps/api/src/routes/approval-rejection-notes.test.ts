import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adminH: Record<string, string>, hrH: Record<string, string>, storeH: Record<string, string>, financeH: Record<string, string>;

beforeAll(async () => {
  t = await buildTestApp('approval_rejection_notes');
  adminH = await t.loginHeaders('admin');
  hrH = await t.loginHeaders('hr');
  storeH = await t.loginHeaders('store1');
  financeH = await t.loginHeaders('finance');
});

afterAll(async () => {
  await t.app.close();
});

describe('Lưu trữ Ghi chú Phê duyệt & Lý do Từ chối / Thu hồi / Trả lại toàn hệ thống (OPS-13)', () => {
  it('1. Thu hồi & khóa tài khoản hàng loạt lưu đầy đủ revoke_reason, revoked_by và nhật ký kiểm toán', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/accounts', headers: adminH,
      payload: { username: 'nv.test.revoke', display_name: 'NV Test Thu Hồi', phone_number: '0977112233', role: 'THU_VIEC', branch_scope: 'ALL', secret: DEMO_PIN },
    });
    expect(createRes.statusCode).toBe(201);
    const userId = createRes.json().data.user.id as string;

    const actRes = await t.app.inject({
      method: 'POST', url: '/api/admin/accounts/bulk-action', headers: adminH,
      payload: { action: 'ACTIVATE', items: [{ id: userId, version: 1 }], reason: 'Đã đối chiếu hồ sơ CCCD hợp lệ' },
    });
    expect(actRes.statusCode).toBe(200);

    const lockUser = t.db.users.get(userId)!;
    const lockRes = await t.app.inject({
      method: 'POST', url: '/api/admin/accounts/bulk-action', headers: adminH,
      payload: { action: 'LOCK', items: [{ id: userId, version: lockUser.version }], reason: 'Tạm ngừng phân ca để rà soát hồ sơ' },
    });
    expect(lockRes.statusCode).toBe(200);

    const revUser = t.db.users.get(userId)!;
    const revokeReason = 'Nhân sự đã bàn giao đồng phục và nghỉ việc theo đơn';
    const revRes = await t.app.inject({
      method: 'POST', url: '/api/admin/accounts/bulk-action', headers: adminH,
      payload: { action: 'REVOKE', items: [{ id: userId, version: revUser.version }], reason: revokeReason },
    });
    expect(revRes.statusCode).toBe(200);

    const saved = t.db.users.get(userId)!;
    expect(saved.status).toBe('REVOKED');
    expect(saved.revoke_reason).toBe(revokeReason);
    expect(saved.revoked_by).toBeTruthy();

    const histRes = await t.app.inject({ method: 'GET', url: `/api/admin/accounts/${userId}/history`, headers: adminH });
    expect(histRes.statusCode).toBe(200);
    const summaries = (histRes.json().data as { summary: string }[]).map((x) => x.summary).join(' | ');
    expect(summaries).toContain(revokeReason);
    expect(summaries).toContain('Tạm ngừng phân ca để rà soát hồ sơ');
  });

  it('2. Duyệt phát hành ca & Từ chối ca đăng ký chờ duyệt lưu ghi chú và gửi thông báo lý do từ chối cho nhân viên', async () => {
    const branch = t.db.branches.find((b) => b.status === 'ACTIVE')!;
    const empRes = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hrH,
      payload: { full_name: 'NV Đăng Ký Ca', phone_number: '0977223344', branch_id: branch.id, stage: 'OFFICIAL', employment_type: 'PART_TIME', default_shift_code: 'CA_SANG', create_account: true, username: 'nv.dkca', initial_pin: DEMO_PIN },
    });
    expect(empRes.statusCode).toBe(201);
    const empId = empRes.json().data.id as string;
    const empUser = t.db.users.find((u) => u.username === 'nv.dkca')!;
    await t.db.users.update(empUser.id, empUser.version, { status: 'ACTIVE', must_change_pin: false }, 'test');
    const { cookie } = await t.login('0977223344', DEMO_PIN, 'employee');
    const empH = { cookie, 'x-umbm-client': 'web' };

    const s1 = await t.app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrH,
      payload: { employee_id: empId, branch_id: branch.id, work_date: '2027-09-10', shift_code: 'CA_SANG', status: 'DRAFT', note: 'NV đăng ký ca sáng' },
    });
    const s2 = await t.app.inject({
      method: 'POST', url: '/api/admin/schedules', headers: hrH,
      payload: { employee_id: empId, branch_id: branch.id, work_date: '2027-09-11', shift_code: 'CA_CHIEU', status: 'DRAFT', note: 'NV đăng ký ca chiều' },
    });
    expect([s1.statusCode, s2.statusCode]).toEqual([201, 201]);

    const pubRes = await t.app.inject({
      method: 'POST', url: '/api/admin/schedules/bulk-action', headers: hrH,
      payload: { action: 'PUBLISH', items: [{ id: s1.json().data.id, version: 1 }], note: 'Đã cân đối đủ định biên quầy pha chế' },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(t.db.shiftAssignments.get(s1.json().data.id)?.note).toContain('Đã cân đối đủ định biên quầy pha chế');

    const rejectReason = 'Khung ca chiều ngày 11/09 đã đủ nhân sự trực chính thức';
    const rejRes = await t.app.inject({
      method: 'POST', url: '/api/admin/schedules/bulk-action', headers: hrH,
      payload: { action: 'DELETE', items: [{ id: s2.json().data.id, version: 1 }], note: rejectReason },
    });
    expect(rejRes.statusCode).toBe(200);

    const deletedShift = t.db.shiftAssignments.all(true).find((a) => a.id === s2.json().data.id)!;
    expect(deletedShift.is_deleted).toBe(true);
    expect(deletedShift.note).toContain(rejectReason);

    const notifRes = await t.app.inject({ method: 'GET', url: '/api/notifications', headers: empH });
    expect(notifRes.statusCode).toBe(200);
    const rejectedNotif = (notifRes.json().data as { title: string; body: string }[]).find((n) => n.title.includes('2027-09-11') && n.title.includes('từ chối'));
    expect(rejectedNotif).toBeDefined();
    expect(rejectedNotif!.body).toContain(rejectReason);
  });

  it('3. Chốt lịch chu kỳ thử việc 12 ngày & Chuyển chính thức hàng loạt lưu đầy đủ ghi chú và lịch sử giai đoạn', async () => {
    const branch = t.db.branches.find((b) => b.status === 'ACTIVE')!;
    const empRes = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hrH,
      payload: { full_name: 'NV Thử Việc Note', phone_number: '0977334455', branch_id: branch.id, stage: 'PROBATION', employment_type: 'PROBATION', probation_start: '2027-10-01', default_shift_code: 'CA_SANG', create_account: true, username: 'nv.tvnote', initial_pin: DEMO_PIN },
    });
    expect(empRes.statusCode).toBe(201);
    const empId = empRes.json().data.id as string;

    const lockNote = 'Ưu tiên kèm cặp quầy thu ngân trong 7 ca đầu tiên';
    const lockRes = await t.app.inject({
      method: 'POST', url: '/api/admin/schedule-planner/probation/lock', headers: hrH,
      payload: { employee_id: empId, note: lockNote },
    });
    expect(lockRes.statusCode).toBe(200);

    const listProbRes = await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/probation?branch_id=${branch.id}`, headers: hrH });
    const row = (listProbRes.json().data as { employeeId: string; lockNote: string }[]).find((x) => x.employeeId === empId);
    expect(row?.lockNote).toBe(lockNote);

    const curEmp = t.db.employees.get(empId)!;
    const evalSummary = 'Hoàn thành 7 ca thử việc đúng giờ, điểm TEST đạt 95%, tác phong tốt';
    const promRes = await t.app.inject({
      method: 'POST', url: '/api/admin/employees/bulk-action', headers: hrH,
      payload: { action: 'PROMOTE_OFFICIAL', official_from: '2027-10-15', evaluation_summary: evalSummary, note: evalSummary, items: [{ id: empId, version: curEmp.version }] },
    });
    expect(promRes.statusCode).toBe(200);
    expect(t.db.employees.get(empId)?.stage).toBe('OFFICIAL');
    expect(t.db.users.find((u) => u.username === 'nv.tvnote')?.role).toBe('CHINH_THUC');

    const stageHist = t.db.employeeStageHistory.find((h) => h.employee_id === empId && h.change_type === 'PROMOTE_OFFICIAL');
    expect(stageHist).toBeDefined();
    expect(stageHist!.evaluation_summary).toBe(evalSummary);
  });

  it('4. Phê duyệt / Xác nhận / Từ chối Đơn OFF, Phiếu bổ sung công & Trả lại Kỳ lương lưu đúng nội dung người dùng nhập', async () => {
    const branch = t.db.branches.find((b) => b.status === 'ACTIVE')!;
    const emp = t.db.employees.find((e) => e.branch_id === branch.id && e.status === 'ACTIVE')!;

    const leaveCreate = await t.app.inject({
      method: 'POST', url: '/api/admin/leave-requests', headers: hrH,
      payload: { employee_id: emp.id, leave_date: '2027-11-05', shift_code: 'CA_SANG', reason: 'Xin nghỉ giải quyết việc gia đình' },
    });
    expect(leaveCreate.statusCode).toBe(201);
    const leaveDecide = await t.app.inject({
      method: 'POST', url: `/api/admin/leave-requests/${leaveCreate.json().data.id}/decide`, headers: hrH,
      payload: { version: 1, decision: 'REJECTED', decision_reason: 'Ngày 05/11 trùng lịch kiểm kê kho định kỳ của chi nhánh' },
    });
    expect(leaveDecide.statusCode).toBe(200);
    expect(leaveDecide.json().data.decision_reason).toBe('Ngày 05/11 trùng lịch kiểm kê kho định kỳ của chi nhánh');

    const adjCreate = await t.app.inject({
      method: 'POST', url: '/api/admin/attendance/adjustments', headers: hrH,
      payload: { employee_id: emp.id, work_date: '2027-11-06', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_OUT', reason: 'Quên bấm Ra ca do máy hết pin' },
    });
    expect(adjCreate.statusCode).toBe(201);
    const adjId = adjCreate.json().data.id as string;

    const storeConfirm = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adjId}/decide`, headers: storeH,
      payload: { version: 1, action: 'STORE_CONFIRM', decision_reason: 'Camera quầy xác nhận nhân viên tan ca lúc 12:03' },
    });
    expect(storeConfirm.statusCode).toBe(200);
    expect(storeConfirm.json().data.store_note).toBe('Camera quầy xác nhận nhân viên tan ca lúc 12:03');

    const hrApprove = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adjId}/decide`, headers: hrH,
      payload: { version: storeConfirm.json().data.version, action: 'HR_APPROVE', decision_reason: 'Đối chiếu khớp xác nhận của Quản lý cửa hàng, ghi nhận đủ 5h công' },
    });
    expect(hrApprove.statusCode).toBe(200);
    expect(hrApprove.json().data.decision_reason).toBe('Đối chiếu khớp xác nhận của Quản lý cửa hàng, ghi nhận đủ 5h công');

    const pCreate = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: financeH,
      payload: { name: 'Kỳ lương Test Trả Lại 11/2027', from_date: '2027-11-01', to_date: '2027-11-30' },
    });
    expect(pCreate.statusCode).toBe(201);
    const pId = pCreate.json().data.id as string;
    const toRec = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${pId}/transition`, headers: financeH,
      payload: { version: pCreate.json().data.version, target_status: 'RECONCILE', note: 'Đã đối soát xong công tháng 11' },
    });
    expect(toRec.statusCode).toBe(200);

    const returnReason = 'Cần bổ sung phụ cấp đổi ca ngày 18/11 trước khi phê duyệt';
    const toDraft = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${pId}/transition`, headers: adminH,
      payload: { version: toRec.json().data.version, target_status: 'DRAFT', note: returnReason },
    });
    expect(toDraft.statusCode).toBe(200);
    expect(toDraft.json().data.note).toBe(returnReason);
  });
});
