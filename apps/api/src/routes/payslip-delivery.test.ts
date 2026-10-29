import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { isSyntheticDemoEmail } from '../services/email.service.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let fin: Awaited<ReturnType<TestAppContext['loginHeaders']>>;

beforeAll(async () => {
  t = await buildTestApp('p');
  t.email.attachDatabase(t.db);
  fin = await t.loginHeaders('finance');
});

afterAll(async () => {
  await t.app.close();
});

describe('Phát hành phiếu lương, hiển thị Cổng Nhân viên & Gửi Email / Chuông thông báo', () => {
  it('Phát hành kỳ lương nhiều nhân sự gửi Email thật (không rơi vào @umbomilk.vn), tạo thông báo chuông và hiển thị cho cả NV lẫn vai trò nội bộ', async () => {
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const emp2 = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    await t.db.employees.update(emp1.id, emp1.version, { email: 'vothithuviec.real@gmail.com' }, 'test');

    // Gỡ liên kết user_id / employee_id của NV0002 để kiểm thử tự động nhận diện qua SĐT (kể cả mất số 0 đầu trên Sheets)
    const user2 = t.db.users.find((u) => u.username === 'nv.chinhthuc')!;
    await t.db.employees.update(emp2.id, emp2.version, { user_id: '', phone: '901000002' }, 'test');
    await t.db.users.update(user2.id, user2.version, { employee_id: '' }, 'test');

    // Tạo hồ sơ nhân sự + lương cá nhân cho Quản lý Cửa hàng (STORE) để kiểm thử vai trò nội bộ xem phiếu lương
    const storeHeaders = await t.loginHeaders('store1');
    const storeMeAtt = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: storeHeaders });
    expect(storeMeAtt.statusCode).toBe(200);
    const storeEmpId = storeMeAtt.json().data.profile.employeeId as string;
    const setStoreSalary = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/salary-profiles', headers: fin,
      payload: { employee_id: storeEmpId, rate_type: 'MONTHLY', amount_vnd: 9_000_000, effective_from: '2026-10-01' },
    });
    expect(setStoreSalary.statusCode).toBe(201);

    // Khởi tạo & chuyển kỳ lương DRAFT -> RECONCILE -> APPROVED -> PUBLISHED
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: fin,
      payload: { name: 'Kỳ lương T10/2026', from_date: '2026-10-01', to_date: '2026-10-31' },
    });
    expect(createRes.statusCode).toBe(201);
    let period = createRes.json().data;

    for (const target of ['RECONCILE', 'APPROVED', 'PUBLISHED'] as const) {
      const tr = await t.app.inject({
        method: 'POST', url: `/api/admin/payroll/periods/${period.id}/transition`, headers: fin,
        payload: { version: period.version, target_status: target },
      });
      expect(tr.statusCode).toBe(200);
      period = tr.json().data;
    }

    await t.email.processQueueBatch(10);
    const payslipMails = t.email.recent(50).filter((m) => m.template === 'PAYSLIP_PUBLISHED');
    expect(payslipMails.length).toBeGreaterThanOrEqual(2);
    expect(payslipMails.every((m) => !isSyntheticDemoEmail(m.to))).toBe(true);
    expect(payslipMails.some((m) => m.to === 'vothithuviec.real@gmail.com')).toBe(true);
    expect(payslipMails.some((m) => m.to === '3do.service.veo@gmail.com')).toBe(true);

    // 1. Nhân viên Thử việc xem phiếu lương & thấy thông báo chuông
    const nv1Login = await t.login('0901000001', DEMO_PIN, 'employee');
    const nv1Headers = { cookie: nv1Login.cookie, 'x-umbm-client': 'web' };
    const nv1Slips = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv1Headers });
    expect(nv1Slips.statusCode).toBe(200);
    expect(nv1Slips.json().data.length).toBe(1);
    expect(nv1Slips.json().data[0].employeeCode).toBe('NV0001');

    const nv1Notifs = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=20', headers: nv1Headers });
    expect(nv1Notifs.statusCode).toBe(200);
    expect(nv1Notifs.json().data.some((n: { category: string; link: string }) => n.category === 'PAYROLL' && n.link === '/nv/phieu-luong')).toBe(true);

    // 2. Nhân viên Chính thức liên kết qua SĐT (không có user_id/employee_id) vẫn thấy đúng phiếu lương & xác nhận được
    const nv2Login = await t.login('0901000002', DEMO_PIN, 'employee');
    const nv2Headers = { cookie: nv2Login.cookie, 'x-umbm-client': 'web' };
    const nv2Slips = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv2Headers });
    expect(nv2Slips.statusCode).toBe(200);
    expect(nv2Slips.json().data.length).toBe(1);
    expect(nv2Slips.json().data[0].employeeCode).toBe('NV0002');
    const confirmRes = await t.app.inject({ method: 'POST', url: `/api/me/payslips/${nv2Slips.json().data[0].id}/confirm`, headers: nv2Headers });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().data.employeeConfirmedAt).toBeTruthy();

    // 3. Quản lý Cửa hàng (STORE - không có quyền self.payslip cũ) xem được phiếu lương cá nhân bình thường (không bị 403)
    const storeSlips = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: storeHeaders });
    expect(storeSlips.statusCode).toBe(200);
    expect(storeSlips.json().data.length).toBe(1);
  });

  it('Tự động phục hồi (Auto-heal) phiếu lương & gửi lại Email thật cho kỳ đã PUBLISHED từ trước nhưng thiếu PAYSLIPS hoặc chỉ có log @umbomilk.vn', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: fin,
      payload: { name: 'Kỳ lương T09/2026', from_date: '2026-09-01', to_date: '2026-09-30' },
    });
    expect(createRes.statusCode).toBe(201);
    const period = createRes.json().data;

    // Giả lập kỳ lương trên Google Sheets đã ở trạng thái PUBLISHED nhưng chưa có dòng PAYSLIPS và chỉ có log email ảo @umbomilk.vn cũ
    await t.db.payPeriods.update(period.id, period.version, { status: 'PUBLISHED', published_by: 'finance' }, 'test');
    await t.db.deliveryLogs.insert({
      announcement_id: `PAYSLIP_PUBLISHED:PL-${period.period_code}-NV0001`,
      recipient_user_id: 'nv0001@umbomilk.vn', channel: 'EMAIL', status: 'SENT',
      attempts: 1, last_error: '', branch_id: 'ALL', sent_at: new Date().toISOString(), delivered_at: new Date().toISOString(), read_at: '', ack_at: '',
    }, 'test');

    expect(t.db.payslips.filter((p) => p.period_id === period.id).length).toBe(0);

    const nv1Login = await t.login('0901000001', DEMO_PIN, 'employee');
    const nv1Headers = { cookie: nv1Login.cookie, 'x-umbm-client': 'web' };
    const nv1Slips = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv1Headers });
    expect(nv1Slips.statusCode).toBe(200);
    const t09Slip = nv1Slips.json().data.find((p: { periodId: string }) => p.periodId === period.id);
    expect(t09Slip).toBeTruthy();

    await t.email.processQueueBatch(10);
    const healedMails = t.email.recent(50).filter((m) => m.template === 'PAYSLIP_PUBLISHED' && `${m.referenceCode} ${m.subject}`.includes(period.period_code));
    expect(healedMails.length).toBeGreaterThanOrEqual(1);
    expect(healedMails.every((m) => !isSyntheticDemoEmail(m.to))).toBe(true);
  });

  it('Khi Đã phát hành: NV đã xác nhận bị khóa gửi thắc mắc & hiển thị ngay bên Kế toán; chỉ điều chỉnh được NV chưa xác nhận', async () => {
    const periodsRes = await t.app.inject({ method: 'GET', url: '/api/admin/payroll/periods', headers: fin });
    const pubPeriod = periodsRes.json().data.find((p: { name: string }) => p.name === 'Kỳ lương T10/2026');
    expect(pubPeriod).toMatchObject({ status: 'PUBLISHED', confirmed_count: 1 });

    // NV0002 đã xác nhận ở bước trên -> bị chặn gửi thắc mắc cả qua /dispute lẫn tạo ticket đính kèm phiếu lương
    const nv2Login = await t.login('0901000002', DEMO_PIN, 'employee');
    const nv2Headers = { cookie: nv2Login.cookie, 'x-umbm-client': 'web' };
    const nv2Slip = (await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv2Headers })).json().data[0];
    const blockedDispute = await t.app.inject({
      method: 'POST', url: `/api/me/payslips/${nv2Slip.id}/dispute`, headers: nv2Headers,
      payload: { reason: 'Thử gửi thắc mắc sau khi đã xác nhận', target_department: 'FINANCE' },
    });
    expect(blockedDispute.statusCode).toBe(409);
    const blockedTicket = await t.app.inject({
      method: 'POST', url: '/api/tickets', headers: nv2Headers,
      payload: { category: 'PAYSLIP_INQUIRY', target_department: 'FINANCE', subject: 'Thắc mắc phiếu lương', description: 'Đã xác nhận nhưng vẫn tạo phiếu', related_entity_id: nv2Slip.id },
    });
    expect(blockedTicket.statusCode).toBe(409);

    // Bên Kế toán thấy rõ trạng thái xác nhận + chuông thông báo + lọc theo trạng thái xác nhận
    const snapsRes = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${pubPeriod.id}/snapshots?page=1&per_page=20`, headers: fin });
    expect(snapsRes.statusCode).toBe(200);
    const snaps = snapsRes.json().data as { id: string; employeeCode: string; confirmationStatus: string; confirmationLabel: string; employeeConfirmedAt: string | null; canAdjust: boolean; netVnd: number }[];
    const nv2Snap = snaps.find((s) => s.employeeCode === 'NV0002')!;
    const nv1Snap = snaps.find((s) => s.employeeCode === 'NV0001')!;
    expect(nv2Snap).toMatchObject({ confirmationStatus: 'CONFIRMED', confirmationLabel: 'Đã xác nhận', canAdjust: false });
    expect(nv2Snap.employeeConfirmedAt).toBeTruthy();
    expect(nv1Snap).toMatchObject({ confirmationStatus: 'PENDING', canAdjust: true });
    expect(snapsRes.json().meta.filters.summary.confirmedCount).toBe(1);

    const onlyConfirmed = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${pubPeriod.id}/snapshots?confirm_status=CONFIRMED`, headers: fin });
    expect(onlyConfirmed.json().data.snapshots.map((s: { employeeCode: string }) => s.employeeCode)).toEqual(['NV0002']);

    const finNotifs = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=30', headers: fin });
    expect(finNotifs.json().data.some((n: { title: string }) => n.title.includes('Nhân sự đã xác nhận phiếu lương') && n.title.includes('NV0002'))).toBe(true);

    // Kế toán điều chỉnh NV0002 (đã xác nhận) -> bị chặn 409; điều chỉnh NV0001 (chưa xác nhận) -> thành công 201
    const lockConfirmedAdj = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv2Snap.id}/revisions`, headers: fin,
      payload: { delta_vnd: 50000, reason: 'Thử điều chỉnh nhân sự đã xác nhận' },
    });
    expect(lockConfirmedAdj.statusCode).toBe(409);

    const allowUnconfirmedAdj = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv1Snap.id}/revisions`, headers: fin,
      payload: { delta_vnd: 45000, reason: 'Bổ sung phụ cấp cho nhân sự chưa xác nhận' },
    });
    expect(allowUnconfirmedAdj.statusCode).toBe(201);
    expect(allowUnconfirmedAdj.json().data.netVnd).toBe(nv1Snap.netVnd + 45000);
  });

  it('Chuyển PUBLISHED -> PAID khóa toàn bộ 100% (không ai điều chỉnh hay thắc mắc được nữa), đồng bộ PAID & nút Gửi lại Email', async () => {
    const periodsRes = await t.app.inject({ method: 'GET', url: '/api/admin/payroll/periods', headers: fin });
    const pubPeriod = periodsRes.json().data.find((p: { name: string }) => p.name === 'Kỳ lương T10/2026');
    expect(pubPeriod).toBeTruthy();

    const paidRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${pubPeriod.id}/transition`, headers: fin,
      payload: { version: pubPeriod.version, target_status: 'PAID', note: 'UNC-202610-99' },
    });
    expect(paidRes.statusCode).toBe(200);
    expect(paidRes.json().data.status).toBe('PAID');
    expect(paidRes.json().data.paid_by_name).toBe('Lê Thị Kế Toán');

    const slipsAfterPaid = t.db.payslips.filter((p) => p.period_id === pubPeriod.id && p.status !== 'REVISED');
    expect(slipsAfterPaid.every((p) => p.status === 'PAID')).toBe(true);

    // Sau khi PAID: kể cả nhân sự chưa bấm xác nhận (NV0001) cũng bị khóa điều chỉnh & khóa gửi thắc mắc 100%
    const nv1ActiveSlip = slipsAfterPaid.find((p) => p.employee_code === 'NV0001')!;
    const blockedPaidAdj = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv1ActiveSlip.id}/revisions`, headers: fin,
      payload: { delta_vnd: 30000, reason: 'Thử điều chỉnh sau khi đã thanh toán' },
    });
    expect(blockedPaidAdj.statusCode).toBe(409);

    const nv1Login = await t.login('0901000001', DEMO_PIN, 'employee');
    const nv1Headers = { cookie: nv1Login.cookie, 'x-umbm-client': 'web' };
    const blockedPaidDispute = await t.app.inject({
      method: 'POST', url: `/api/me/payslips/${nv1ActiveSlip.id}/dispute`, headers: nv1Headers,
      payload: { reason: 'Thử thắc mắc sau khi kỳ lương đã chi trả' },
    });
    expect(blockedPaidDispute.statusCode).toBe(409);

    const resendRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${pubPeriod.id}/notify-payslips`, headers: fin,
    });
    expect(resendRes.statusCode).toBe(200);
    expect(resendRes.json().data.count).toBeGreaterThanOrEqual(3);
  });
});
