import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../auth/password.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let hrHeaders: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let store1Headers: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let store2Headers: Record<string, string>;
let nv1Headers: Record<string, string>;
let nv2Headers: Record<string, string>;

const HR_EMAIL = 'hr.umbm.real@gmail.com';
const STORE1_EMAIL = 'qlch.q1.real@gmail.com';
const STORE2_EMAIL = 'qlch.q2.real@gmail.com';
const NV1_EMAIL = 'nv1.real@gmail.com';
const NV2_EMAIL = 'nv2.real@gmail.com';
const EVIDENCE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeAll(async () => {
  t = await buildTestApp('wf');
  t.email.attachDatabase(t.db);

  const hrUser = t.db.users.find((u) => u.username === 'hr')!;
  const store1User = t.db.users.find((u) => u.username === 'store1')!;
  const cn2 = t.db.branches.find((b) => b.code === 'CN02')!;

  // Cố tình gán branch_scope hẹp cho HR trong DB để kiểm chứng HR vẫn luôn giữ phạm vi toàn hệ thống (ALL)
  await t.db.users.update(hrUser.id, hrUser.version, { email: HR_EMAIL, branch_scope: cn2.id }, 'test');
  await t.db.users.update(store1User.id, store1User.version, { email: STORE1_EMAIL }, 'test');

  const pwHash = await hashSecret(DEMO_PASSWORD);
  await t.db.users.insert({
    username: 'store2', display_name: 'Quản lý Chi nhánh 2', role: 'STORE', branch_scope: cn2.id, phone: '', email: STORE2_EMAIL,
    password_hash: pwHash, employee_id: '', status: 'ACTIVE', permissions_json: '[]', session_version: 1, failed_login_count: 0,
    locked_until: '', last_login_at: '', activated_by: 'test', activated_at: new Date().toISOString(), revoked_at: '', revoked_by: '', revoke_reason: '',
  }, 'test');

  hrHeaders = await t.loginHeaders('hr');
  store1Headers = await t.loginHeaders('store1');
  store2Headers = await t.loginHeaders('store2');
  expect((await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: hrHeaders })).statusCode).toBe(200);

  nv1Headers = { cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
  nv2Headers = { cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
});

afterAll(async () => { await t.app.close(); });

async function getNotifs(headers: Record<string, string>) {
  const res = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=50', headers });
  expect(res.statusCode).toBe(200);
  return res.json().data as Array<{ entity_id: string; entity_type: string; title: string; link: string }>;
}

describe('Luồng Chuông Thông Báo & Email Phân Vai Chuẩn Xác (HR / Cửa Hàng / Nhân Viên)', () => {
  it('Phiếu bù công (NV chưa có email cá nhân): HR & Cửa hàng nhận thông báo + mail quản lý ngay khi tạo; Cửa hàng xác nhận KHÔNG bị nhận nhầm mail nhân viên và tự động báo lên HR', async () => {
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const knownBeforeCreate = new Set(t.email.recent(100).map((m) => m.id));

    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv1Headers,
      payload: { employee_id: emp1.id, work_date: '2026-10-20', shift_code: 'CA_SANG', kind: 'FORGOT_CHECK_OUT', reason: 'Quên bấm ra ca do đông khách', evidence_photo_base64: EVIDENCE },
    });
    expect(createRes.statusCode).toBe(201);
    const adj1 = createRes.json().data;

    const [hrNotifs1, s1Notifs1, s2Notifs1] = await Promise.all([getNotifs(hrHeaders), getNotifs(store1Headers), getNotifs(store2Headers)]);
    expect(hrNotifs1.some((n) => n.entity_id === adj1.id && n.link.includes('/admin/schedules'))).toBe(true);
    expect(s1Notifs1.some((n) => n.entity_id === adj1.id)).toBe(true);
    expect(s2Notifs1.some((n) => n.entity_id.includes(adj1.id))).toBe(false);

    await t.email.processQueueBatch(10);
    const createdMails = t.email.recent(100).filter((m) => !knownBeforeCreate.has(m.id));
    expect(createdMails.some((m) => m.to === HR_EMAIL && m.html.includes('/admin/schedules?section=workflows'))).toBe(true);
    expect(createdMails.some((m) => m.to === STORE1_EMAIL && m.html.includes('/admin/schedules?section=workflows'))).toBe(true);
    expect(createdMails.some((m) => m.to === STORE2_EMAIL)).toBe(false);
    expect(createdMails.some((m) => m.html.includes('/nv/cong'))).toBe(false);

    const knownBeforeConfirm = new Set(t.email.recent(100).map((m) => m.id));
    const confirmRes = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adj1.id}/decide`, headers: store1Headers,
      payload: { version: adj1.version, action: 'STORE_CONFIRM', decision_reason: 'Xác nhận nhân viên có làm đủ ca' },
    });
    expect(confirmRes.statusCode).toBe(200);

    await t.email.processQueueBatch(10);
    const confirmMails = t.email.recent(100).filter((m) => !knownBeforeConfirm.has(m.id));
    expect(confirmMails.filter((m) => m.to === STORE1_EMAIL)).toHaveLength(0);
    expect(confirmMails.some((m) => m.to === HR_EMAIL && m.subject.includes('Chờ HR duyệt') && m.html.includes('/admin/schedules?section=workflows'))).toBe(true);

    const [hrNotifs2, s1Notifs2, nv1Notifs2] = await Promise.all([getNotifs(hrHeaders), getNotifs(store1Headers), getNotifs(nv1Headers)]);
    expect(hrNotifs2.some((n) => n.entity_id === `${adj1.id}_STORE_CONFIRMED`)).toBe(true);
    expect(s1Notifs2.some((n) => n.entity_id.includes(adj1.id))).toBe(false);
    expect(nv1Notifs2.some((n) => n.entity_id.includes(adj1.id) && n.link === '/nv/cong')).toBe(true);

    const knownBeforeApprove = new Set(t.email.recent(100).map((m) => m.id));
    const approveRes = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adj1.id}/decide`, headers: hrHeaders,
      payload: { version: confirmRes.json().data.version, action: 'HR_APPROVE', decision_reason: 'Đồng ý ghi nhận 5 giờ công' },
    });
    expect(approveRes.statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    const approveMails = t.email.recent(100).filter((m) => !knownBeforeApprove.has(m.id));
    expect(approveMails.filter((m) => m.to === STORE1_EMAIL || m.to === HR_EMAIL)).toHaveLength(0);
    expect((await getNotifs(hrHeaders)).some((n) => n.entity_id.includes(adj1.id))).toBe(false);
  });

  it('Phiếu bù công (NV có email cá nhân): Gửi đúng mail quản lý cho HR/Cửa hàng và đúng mail cá nhân (/nv/cong) cho riêng Nhân viên', async () => {
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const emp2 = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    await t.db.employees.update(emp1.id, emp1.version, { email: NV1_EMAIL }, 'test');
    await t.db.employees.update(emp2.id, emp2.version, { email: NV2_EMAIL }, 'test');

    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/attendance/adjustments', headers: nv2Headers,
      payload: { employee_id: emp2.id, work_date: '2026-10-21', shift_code: 'CA_CHIEU', kind: 'GPS_ERROR', reason: 'Điện thoại mất sóng GPS tại quầy', evidence_photo_base64: EVIDENCE },
    });
    expect(createRes.statusCode).toBe(201);
    const adj2 = createRes.json().data;
    await t.email.processQueueBatch(10);

    const knownBeforeConfirm = new Set(t.email.recent(100).map((m) => m.id));
    const confirmRes = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adj2.id}/decide`, headers: store1Headers,
      payload: { version: adj2.version, action: 'STORE_CONFIRM', decision_reason: 'Đã kiểm tra camera tại quầy' },
    });
    expect(confirmRes.statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    const confirmMails = t.email.recent(100).filter((m) => !knownBeforeConfirm.has(m.id));
    expect(confirmMails.some((m) => m.to === HR_EMAIL && m.html.includes('/admin/schedules?section=workflows'))).toBe(true);
    expect(confirmMails.some((m) => m.to === NV2_EMAIL && m.html.includes('/nv/cong'))).toBe(true);
    expect(confirmMails.some((m) => m.to === STORE1_EMAIL)).toBe(false);

    const knownBeforeApprove = new Set(t.email.recent(100).map((m) => m.id));
    const hrApprove = await t.app.inject({
      method: 'POST', url: `/api/admin/attendance/adjustments/${adj2.id}/decide`, headers: hrHeaders,
      payload: { version: confirmRes.json().data.version, action: 'HR_APPROVE', decision_reason: 'Phê duyệt bù công' },
    });
    expect(hrApprove.statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    const finalMails = t.email.recent(100).filter((m) => !knownBeforeApprove.has(m.id));
    expect(finalMails).toHaveLength(1);
    expect(finalMails[0]!.to).toBe(NV2_EMAIL);
    expect(finalMails[0]!.html.includes('/nv/cong')).toBe(true);
  });

  it('Đơn nghỉ OFF theo cổng tuần, Thử việc đăng ký thêm ca, Nhường ca vượt 2 ca/ngày chuyển HR đều phân tuyến đúng Chuông + Email', async () => {
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const emp2 = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    const adminHeaders = await t.loginHeaders('admin');
    await t.app.inject({ method: 'PUT', url: '/api/admin/operations-config', headers: adminHeaders, payload: { off_window_open_weekday: 1, off_window_open_time: '00:00', off_window_close_weekday: 7, off_window_close_time: '23:59' } });
    const win = (await t.app.inject({ method: 'GET', url: '/api/schedule/off-window', headers: nv2Headers })).json().data;
    expect(win.isOpen).toBe(true);
    const outside = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv2Headers, payload: { employee_id: emp2.id, leave_date: dayjs(win.targetWeekEnd).add(3, 'day').format('YYYY-MM-DD'), reason: 'Ngoài tuần đăng ký' } });
    expect(outside.statusCode).toBe(400);

    const lvRes = await t.app.inject({ method: 'POST', url: '/api/admin/leave-requests', headers: nv2Headers, payload: { employee_id: emp2.id, leave_date: win.targetWeekEnd, shift_code: 'CA_SANG', reason: 'Xin nghỉ giải quyết việc gia đình' } });
    expect(lvRes.statusCode).toBe(201);
    const lv = lvRes.json().data;
    expect((await getNotifs(hrHeaders)).some((n) => n.entity_id === lv.id)).toBe(true);
    const lvDecide = await t.app.inject({ method: 'POST', url: `/api/admin/leave-requests/${lv.id}/decide`, headers: hrHeaders, payload: { version: lv.version, decision: 'APPROVED', decision_reason: 'Đồng ý lịch nghỉ' } });
    expect(lvDecide.statusCode).toBe(200);
    expect((await getNotifs(nv2Headers)).some((n) => n.entity_id.includes(lv.id) && n.link === '/nv/nghi-phep')).toBe(true);

    const officialReg = await t.app.inject({ method: 'POST', url: '/api/my-attendance/shifts', headers: nv2Headers, payload: { work_date: win.targetWeekEnd, shift_code: 'CA_SANG' } });
    expect(officialReg.statusCode).toBe(403);
    const today = dayjs().format('YYYY-MM-DD'), workDate = dayjs().add(2, 'day').format('YYYY-MM-DD');
    await t.db.employees.update(emp1.id, t.db.employees.get(emp1.id)!.version, { probation_start: today }, 'test');
    const regShift = await t.app.inject({ method: 'POST', url: '/api/my-attendance/shifts', headers: nv1Headers, payload: { work_date: workDate, shift_code: 'CA_SANG', note: 'Đăng ký làm thêm ca sáng' } });
    expect(regShift.statusCode).toBe(201);
    const draftShift = regShift.json().data;
    expect(draftShift.source).toBe('PROBATION_EXTRA');
    expect((await getNotifs(hrHeaders)).some((n) => n.entity_id === draftShift.id)).toBe(true);
    const pubShift = await t.app.inject({ method: 'PUT', url: `/api/admin/schedules/${draftShift.id}`, headers: hrHeaders, payload: { version: draftShift.version, status: 'PUBLISHED' } });
    expect(pubShift.statusCode).toBe(200);

    for (const code of ['CA_CHIEU', 'CA_TOI']) {
      const r = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrHeaders, payload: { employee_id: emp2.id, work_date: workDate, shift_code: code, status: 'PUBLISHED' } });
      expect(r.statusCode).toBe(201);
    }
    const third = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrHeaders, payload: { employee_id: emp2.id, work_date: workDate, shift_code: 'CA_HANH_CHINH', status: 'PUBLISHED' } });
    expect(third.statusCode).toBe(400);

    // Nhân viên thử việc (emp1) chưa được nhường / đổi ca -> bị từ chối 400; sau khi được duyệt lên Chính thức mới nhường ca thành công
    const probSwapBlocked = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv1Headers, payload: { kind: 'GIVE', requester_id: emp1.id, peer_id: emp2.id, from_assignment_id: draftShift.id, reason: 'Thử việc thử nhường ca' } });
    expect(probSwapBlocked.statusCode).toBe(400);
    const curEmp1 = t.db.employees.get(emp1.id)!;
    await t.db.employees.update(emp1.id, curEmp1.version, { stage: 'OFFICIAL', official_from: today }, 'test');
    if (curEmp1.user_id) { const u1 = t.db.users.get(curEmp1.user_id)!; await t.db.users.update(u1.id, u1.version, { role: 'CHINH_THUC' }, 'test'); }

    const swCreate = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv1Headers, payload: { kind: 'GIVE', requester_id: emp1.id, peer_id: emp2.id, from_assignment_id: draftShift.id, reason: 'Có việc gấp, nhờ đồng nghiệp nhận ca sáng' } });
    expect(swCreate.statusCode).toBe(201);
    const sw = swCreate.json().data;
    expect(sw.requires_hr_approval).toBe(true);
    expect((await getNotifs(nv2Headers)).some((n) => n.entity_id.includes(sw.id))).toBe(true);
    expect((await getNotifs(hrHeaders)).some((n) => n.entity_id.includes(sw.id))).toBe(false);

    const swPeer = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${sw.id}/peer-respond`, headers: nv2Headers, payload: { version: sw.version, accept: true, peer_note: 'Đồng ý nhận ca' } });
    expect(swPeer.statusCode).toBe(200);
    expect(swPeer.json().data.status).toBe('PEER_ACCEPTED');
    expect(t.db.shiftAssignments.get(draftShift.id)?.employee_id).toBe(emp1.id);
    expect((await getNotifs(hrHeaders)).some((n) => n.entity_id === `${sw.id}_PEER_ACCEPTED`)).toBe(true);
    expect((await getNotifs(store1Headers)).some((n) => n.entity_id === `${sw.id}_PEER_ACCEPTED`)).toBe(false);

    const hrDecide = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${sw.id}/decide`, headers: hrHeaders, payload: { version: swPeer.json().data.version, decision: 'APPROVED', decision_reason: 'Đồng ý cho làm 3 ca' } });
    expect(hrDecide.statusCode).toBe(200);
    expect(t.db.shiftAssignments.get(draftShift.id)?.employee_id).toBe(emp2.id);
  });
});