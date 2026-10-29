import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../auth/password.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adminHeaders: Record<string, string>;
let financeHeaders: Record<string, string>;
let hrHeaders: Record<string, string>;
let store1Headers: Record<string, string>;
let store2Headers: Record<string, string>;
let mktHeaders: Record<string, string>;
let nv1Headers: Record<string, string>;

let financeUserId = '';
let hrUserId = '';

const FINANCE_EMAIL = 'finance.umbm.real@gmail.com';
const HR_EMAIL = 'hr.ticket.real@gmail.com';
const STORE1_EMAIL = 'store1.ticket.real@gmail.com';
const STORE2_EMAIL = 'store2.ticket.real@gmail.com';
const NV1_EMAIL = 'nv1.ticket.real@gmail.com';

beforeAll(async () => {
  t = await buildTestApp('tickets');
  t.email.attachDatabase(t.db);

  const financeUser = t.db.users.find((u) => u.username === 'finance')!;
  const hrUser = t.db.users.find((u) => u.username === 'hr')!;
  const store1User = t.db.users.find((u) => u.username === 'store1')!;
  const nv1User = t.db.users.find((u) => u.phone === '0901000001')!;
  const nv1Emp = t.db.employees.find((e) => e.phone === '0901000001')!;
  const cn2 = t.db.branches.find((b) => b.code === 'CN02')!;

  financeUserId = financeUser.id;
  hrUserId = hrUser.id;

  await t.db.users.update(financeUser.id, financeUser.version, { email: FINANCE_EMAIL }, 'test');
  await t.db.users.update(hrUser.id, hrUser.version, { email: HR_EMAIL }, 'test');
  await t.db.users.update(store1User.id, store1User.version, { email: STORE1_EMAIL }, 'test');
  await t.db.users.update(nv1User.id, nv1User.version, { email: NV1_EMAIL }, 'test');
  await t.db.employees.update(nv1Emp.id, nv1Emp.version, { email: NV1_EMAIL }, 'test');

  const pwHash = await hashSecret(DEMO_PASSWORD);
  await t.db.users.insert({
    username: 'store2_tck', display_name: 'Quản lý Chi nhánh 2', role: 'STORE', branch_scope: cn2.id, phone: '', email: STORE2_EMAIL,
    password_hash: pwHash, employee_id: '', status: 'ACTIVE', permissions_json: '[]', session_version: 1, failed_login_count: 0,
    locked_until: '', last_login_at: '', activated_by: 'test', activated_at: new Date().toISOString(), revoked_at: '', revoked_by: '', revoke_reason: '',
  }, 'test');

  adminHeaders = await t.loginHeaders('admin');
  financeHeaders = await t.loginHeaders('finance');
  hrHeaders = await t.loginHeaders('hr');
  store1Headers = await t.loginHeaders('store1');
  store2Headers = await t.loginHeaders('store2_tck');
  mktHeaders = await t.loginHeaders('mkt');
  nv1Headers = { cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
});

afterAll(async () => {
  await t.app.close();
});

describe('Hệ thống Phiếu hỗ trợ (Support Tickets) & Liên kết Thắc mắc Phiếu lương', () => {
  it('Lấy danh sách bộ phận và người phụ trách hỗ trợ chuẩn phân nhánh cho Nhân viên', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/tickets/assignees', headers: nv1Headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.some((a: { id: string; department: string }) => a.id === financeUserId && a.department === 'FINANCE')).toBe(true);
    expect(body.data.some((a: { id: string; department: string }) => a.id === hrUserId && a.department === 'HR')).toBe(true);
    // Nhân viên CN01 chỉ thấy Quản lý cửa hàng CN01, không thấy Quản lý CN02
    expect(body.data.some((a: { username: string }) => a.username === 'store1')).toBe(true);
    expect(body.data.some((a: { username: string }) => a.username === 'store2_tck')).toBe(false);
  });

  it('Từ chối lỗi Validation tiếng Việt nếu chọn người phụ trách không thuộc bộ phận tiếp nhận', async () => {
    const res = await t.app.inject({
      method: 'POST', url: '/api/tickets', headers: nv1Headers,
      payload: { category: 'PAYSLIP_INQUIRY', priority: 'HIGH', target_department: 'FINANCE', assignee_user_id: hrUserId, subject: 'Thắc mắc phụ cấp đổi ca tháng 10', description: 'Xin kiểm tra giúp em phụ cấp nhận ca thay ngày 18/10.' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.errors.code).toBe('VALIDATION_ERROR');
    expect(body.errors.details[0].field).toBe('assignee_user_id');
  });

  it('Luồng khép kín: Nhân viên gửi thắc mắc phiếu lương chọn Bộ phận Kế toán & Người cụ thể -> Kế toán thấy Ticket, Chuông, Email -> Phản hồi & Giải quyết -> Nhân viên nhận phản hồi', async () => {
    // Tạo & phát hành kỳ lương mẫu có phiếu lương cho NV1
    const createPeriod = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: financeHeaders,
      payload: { name: 'Kỳ lương T10 Ticket Test', from_date: '2026-10-01', to_date: '2026-10-31' },
    });
    expect(createPeriod.statusCode).toBe(201);
    let period = createPeriod.json().data;
    for (const target of ['RECONCILE', 'APPROVED', 'PUBLISHED'] as const) {
      const tr = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${period.id}/transition`, headers: financeHeaders, payload: { version: period.version, target_status: target } });
      expect(tr.statusCode).toBe(200);
      period = tr.json().data;
    }

    const mySlipsRes = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv1Headers });
    expect(mySlipsRes.statusCode).toBe(200);
    const mySlip = mySlipsRes.json().data[0];
    expect(mySlip).toBeTruthy();

    await t.email.processQueueBatch(20);
    const seenBeforeIds = new Set(t.email.recent(100).map((m) => m.id));
    const disputeRes = await t.app.inject({
      method: 'POST',
      url: `/api/me/payslips/${mySlip.id}/dispute`,
      headers: nv1Headers,
      payload: {
        reason: 'Em thiếu 1 ca tối ngày 18/10 và 30.000đ phụ cấp đổi ca, nhờ chị Kế toán kiểm tra giúp em.',
        target_department: 'FINANCE',
        assignee_user_id: financeUserId,
      },
    });
    expect(disputeRes.statusCode).toBe(200);
    const disputedSlip = disputeRes.json().data;
    expect(disputedSlip.disputeStatus).toBe('OPEN');
    expect(disputedSlip.linkedTicket).toBeTruthy();
    const ticketId = disputedSlip.linkedTicket.id as string;
    const ticketCode = disputedSlip.linkedTicket.ticketCode as string;

    await t.email.processQueueBatch(10);
    const newMailsToFinance = t.email.recent(100).filter((m) => !seenBeforeIds.has(m.id) && m.to === FINANCE_EMAIL);
    expect(newMailsToFinance.length).toBe(1);
    expect(newMailsToFinance[0]!.subject).toContain(ticketCode);

    // Bộ phận Kế toán thấy ngay phiếu hỗ trợ trong /api/tickets và thông báo chuông /api/notifications
    const finList = await t.app.inject({ method: 'GET', url: '/api/tickets?scope=DIRECT_TO_ME', headers: financeHeaders });
    expect(finList.statusCode).toBe(200);
    expect(finList.json().data.some((x: { id: string }) => x.id === ticketId)).toBe(true);

    const finNotifs = await t.app.inject({ method: 'GET', url: '/api/notifications', headers: financeHeaders });
    expect(finNotifs.json().data.some((n: { entity_type: string; title: string }) => n.entity_type === 'TICKET_ASSIGNEE' && n.title.includes(ticketCode))).toBe(true);

    // MKT tuyệt đối không nhìn thấy ticket lương của Kế toán (SEC-02)
    const mktList = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: mktHeaders });
    expect(mktList.json().data.some((x: { id: string }) => x.id === ticketId)).toBe(false);
    const mktDirect = await t.app.inject({ method: 'GET', url: `/api/tickets/${ticketId}`, headers: mktHeaders });
    expect(mktDirect.statusCode).toBe(403);

    // Kế toán phản hồi và đánh dấu Đã giải quyết (RESOLVED)
    const seenBeforeReply = new Set(t.email.recent(100).map((m) => m.id));
    const replyRes = await t.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/reply`,
      headers: financeHeaders,
      payload: {
        content: 'Kế toán đã đối soát bảng công và tạo phiếu điều chỉnh cộng bổ sung cho em.',
        status: 'RESOLVED',
      },
    });
    expect(replyRes.statusCode).toBe(200);
    expect(replyRes.json().data.status).toBe('RESOLVED');
    expect(replyRes.json().data.messageCount).toBe(2);

    await t.email.processQueueBatch(10);
    const replyMailsToNv = t.email.recent(100).filter((m) => !seenBeforeReply.has(m.id) && m.to === NV1_EMAIL);
    expect(replyMailsToNv.length).toBe(1);
    expect(replyMailsToNv[0]!.subject).toContain(ticketCode);

    // Nhân viên thấy trạng thái phiếu lương chuyển sang RESOLVED và nhận thông báo chuông phản hồi
    const nvSlipsAfter = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv1Headers });
    expect(nvSlipsAfter.json().data[0].disputeStatus).toBe('RESOLVED');
    expect(nvSlipsAfter.json().data[0].linkedTicket.status).toBe('RESOLVED');

    const nvNotifs = await t.app.inject({ method: 'GET', url: '/api/notifications', headers: nv1Headers });
    expect(nvNotifs.json().data.some((n: { entity_type: string; title: string }) => n.entity_type === 'TICKET_USER' && n.title.includes(ticketCode))).toBe(true);
  });

  it('Cách ly chi nhánh Cửa hàng (SEC-01) và hỗ trợ điều phối chuyển Bộ phận (STORE -> HR) + Bulk Action', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/tickets', headers: nv1Headers,
      payload: { category: 'STORE_OPERATION', priority: 'NORMAL', target_department: 'STORE', subject: 'Đề xuất bổ sung dụng cụ pha chế ca sáng tại CN01', description: 'Máy định lượng đường tại quầy CN01 cần bảo dưỡng và kiểm tra lại.' },
    });
    expect(createRes.statusCode).toBe(201);
    const tckId = createRes.json().data.id as string;

    const s1List = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: store1Headers });
    expect(s1List.json().data.some((x: { id: string }) => x.id === tckId)).toBe(true);
    const s2List = await t.app.inject({ method: 'GET', url: '/api/tickets', headers: store2Headers });
    expect(s2List.json().data.some((x: { id: string }) => x.id === tckId)).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: `/api/tickets/${tckId}`, headers: store2Headers })).statusCode).toBe(403);

    const forwardRes = await t.app.inject({ method: 'PUT', url: `/api/tickets/${tckId}`, headers: store1Headers, payload: { target_department: 'HR', assignee_user_id: hrUserId } });
    expect(forwardRes.statusCode).toBe(200);
    expect(forwardRes.json().data.target_department).toBe('HR');
    expect(forwardRes.json().data.assignee_user_id).toBe(hrUserId);

    const hrList = await t.app.inject({ method: 'GET', url: '/api/tickets?scope=DIRECT_TO_ME', headers: hrHeaders });
    expect(hrList.json().data.some((x: { id: string }) => x.id === tckId)).toBe(true);

    const bulkRes = await t.app.inject({ method: 'POST', url: '/api/tickets/bulk-action', headers: hrHeaders, payload: { ids: [tckId], action: 'RESOLVE', note: 'Phòng Nhân sự & Hành chính đã tiếp nhận và đặt lịch bảo trì.' } });
    expect(bulkRes.statusCode).toBe(200);
    expect(bulkRes.json().data.count).toBe(1);
  });
});
