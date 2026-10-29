import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../auth/password.js';
import { DEMO_PASSWORD, DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let adminHeaders: Record<string, string>;
let financeHeaders: Record<string, string>;
let hrHeaders: Record<string, string>;
let hr2Headers: Record<string, string>;
let store1Headers: Record<string, string>;
let nv1Headers: Record<string, string>;

let hrUserId = '';
let hr2UserId = '';

beforeAll(async () => {
  t = await buildTestApp('tickets-routing-guard');
  const hrUser = t.db.users.find((u) => u.username === 'hr')!;
  hrUserId = hrUser.id;

  const pwHash = await hashSecret(DEMO_PASSWORD);
  const hr2 = await t.db.users.insert({
    username: 'hr_second', display_name: 'Chuyên viên Nhân sự 2', role: 'HR', branch_scope: 'ALL', phone: '', email: '',
    password_hash: pwHash, employee_id: '', status: 'ACTIVE', permissions_json: '[]', session_version: 1, failed_login_count: 0,
    locked_until: '', last_login_at: '', activated_by: 'test', activated_at: new Date().toISOString(), revoked_at: '', revoked_by: '', revoke_reason: '',
  }, 'test');
  hr2UserId = hr2.id;

  adminHeaders = await t.loginHeaders('admin');
  financeHeaders = await t.loginHeaders('finance');
  hrHeaders = await t.loginHeaders('hr');
  hr2Headers = await t.loginHeaders('hr_second');
  store1Headers = await t.loginHeaders('store1');
  nv1Headers = { cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
});

afterAll(async () => {
  await t.app.close();
});

describe('Quy tắc điều phối chuyển tiếp Phiếu hỗ trợ: Chỉ phiếu giao cho tôi mới được chuyển tiếp, phiếu tự tạo không được phép', () => {
  it('Người tạo phiếu (kể cả vai trò Backoffice như HR) không được phép điều chỉnh bộ phận xử lý / chuyển tiếp phiếu do mình tạo', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/tickets', headers: hrHeaders,
      payload: {
        category: 'PAYSLIP_INQUIRY', priority: 'HIGH', target_department: 'FINANCE',
        subject: 'Nhờ Kế toán kiểm tra bảng tổng hợp phụ cấp tháng 10',
        description: 'Nhờ bộ phận Kế toán đối chiếu lại khoản phụ cấp đổi ca của nhân sự CN01.',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().data;
    expect(created.isRequester).toBe(true);
    expect(created.isAssignedToMe).toBe(false);
    expect(created.canForward).toBe(false);

    // HR (người tạo) cố tình chuyển bộ phận sang STORE -> bị chặn 403
    const selfForwardRes = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${created.id}`, headers: hrHeaders,
      payload: { target_department: 'STORE' },
    });
    expect(selfForwardRes.statusCode).toBe(403);
    expect(selfForwardRes.json().success).toBe(false);

    // HR (người tạo) vẫn được cập nhật tiêu đề / nội dung khi không thay đổi bộ phận xử lý
    const editContentRes = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${created.id}`, headers: hrHeaders,
      payload: { subject: 'Nhờ Kế toán kiểm tra phụ cấp đổi ca T10 CN01' },
    });
    expect(editContentRes.statusCode).toBe(200);
    expect(editContentRes.json().data.target_department).toBe('FINANCE');

    // ADMIN xem phiếu đang giao cho FINANCE (không giao cho ADMIN) -> canForward = false & bị chặn 403 nếu cố chuyển tiếp
    const adminView = await t.app.inject({ method: 'GET', url: `/api/tickets/${created.id}`, headers: adminHeaders });
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json().data.canForward).toBe(false);

    const adminForward = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${created.id}`, headers: adminHeaders,
      payload: { target_department: 'STORE' },
    });
    expect(adminForward.statusCode).toBe(403);

    // FINANCE (bộ phận được giao xử lý) -> canForward = true và chuyển tiếp hợp lệ sang STORE
    const finView = await t.app.inject({ method: 'GET', url: `/api/tickets/${created.id}`, headers: financeHeaders });
    expect(finView.statusCode).toBe(200);
    expect(finView.json().data.isAssignedToMe).toBe(true);
    expect(finView.json().data.canForward).toBe(true);

    const finForward = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${created.id}`, headers: financeHeaders,
      payload: { target_department: 'STORE' },
    });
    expect(finForward.statusCode).toBe(200);
    expect(finForward.json().data.target_department).toBe('STORE');
    // Sau khi đã bàn giao sang STORE, FINANCE vẫn xem lại được phiếu nhưng không còn quyền chuyển tiếp nữa
    expect(finForward.json().data.canForward).toBe(false);

    const storeView = await t.app.inject({ method: 'GET', url: `/api/tickets/${created.id}`, headers: store1Headers });
    expect(storeView.statusCode).toBe(200);
    expect(storeView.json().data.canForward).toBe(true);
  });

  it('Khi phiếu chỉ định đích danh hr1 thì chỉ hr1 được phép chuyển tiếp, hr2 cùng phòng và nhân viên tạo phiếu đều không được phép', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/tickets', headers: nv1Headers,
      payload: {
        category: 'HR_POLICY', priority: 'NORMAL', target_department: 'HR', assignee_user_id: hrUserId,
        subject: 'Xin xác nhận ngày chuyển chính thức của nhân sự',
        description: 'Em đã hoàn thành đủ 12 ngày chu kỳ thử việc, nhờ chị HR xác nhận giúp em.',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const tck = createRes.json().data;

    // Nhân viên tạo phiếu không được đổi bộ phận
    const nvForward = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${tck.id}`, headers: nv1Headers,
      payload: { target_department: 'FINANCE' },
    });
    expect(nvForward.statusCode).toBe(403);

    // hr2 (không phải người được giao đích danh) không được tự ý chuyển tiếp phiếu của hr1
    const hr2View = await t.app.inject({ method: 'GET', url: `/api/tickets/${tck.id}`, headers: hr2Headers });
    expect(hr2View.statusCode).toBe(200);
    expect(hr2View.json().data.canForward).toBe(false);

    const hr2Forward = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${tck.id}`, headers: hr2Headers,
      payload: { assignee_user_id: hr2UserId },
    });
    expect(hr2Forward.statusCode).toBe(403);

    // hr1 (được giao đích danh) chuyển tiếp sang hr2 hợp lệ
    const hr1Forward = await t.app.inject({
      method: 'PUT', url: `/api/tickets/${tck.id}`, headers: hrHeaders,
      payload: { target_department: 'HR', assignee_user_id: hr2UserId },
    });
    expect(hr1Forward.statusCode).toBe(200);
    expect(hr1Forward.json().data.assignee_user_id).toBe(hr2UserId);
  });
});
