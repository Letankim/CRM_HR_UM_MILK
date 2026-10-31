import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { registerSmtpRelayOrigin } from '../services/smtp-sender.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

function makePng(r: number, g: number, b: number): string {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(8 * (1 + 8 * 4));
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const p = y * 33 + 1 + x * 4; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255; }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const SIG_PNG = makePng(20, 60, 140);
const ADMIN_MAIL = 'admin.umbm.real@gmail.com';
const FIN_MAIL = 'ketoan.umbm.real@gmail.com';
const HR_MAIL = 'hr.umbm.real@gmail.com';
const MKT_MAIL = 'mkt.umbm.real@gmail.com';
const NV1_MAIL = 'nv1.probation.real@gmail.com';
const NV2_MAIL = 'nv2.official.real@gmail.com';

let t: TestAppContext;
let adminH: Record<string, string>, finH: Record<string, string>, hrH: Record<string, string>, storeH: Record<string, string>, mktH: Record<string, string>;
let nv1H: Record<string, string>, nv2H: Record<string, string>;

beforeAll(async () => {
  t = await buildTestApp('role_iso');
  t.ctx.env.API_PUBLIC_ORIGIN = 'https://umbm-api.onrender.com';
  registerSmtpRelayOrigin('https://crm-hr-um-milk.vercel.app');
  t.email.attachDatabase(t.db);
  for (const [uname, mail] of [['admin', ADMIN_MAIL], ['finance', FIN_MAIL], ['hr', HR_MAIL], ['mkt', MKT_MAIL]] as const) {
    const u = t.db.users.find((x) => x.username === uname)!;
    await t.db.users.update(u.id, u.version, { email: mail }, 'test');
  }
  const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
  const emp2 = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
  await t.db.employees.update(emp1.id, emp1.version, { email: NV1_MAIL }, 'test');
  await t.db.employees.update(emp2.id, emp2.version, { email: NV2_MAIL }, 'test');

  adminH = await t.loginHeaders('admin');
  finH = await t.loginHeaders('finance');
  hrH = await t.loginHeaders('hr');
  storeH = await t.loginHeaders('store1');
  mktH = await t.loginHeaders('mkt');
  nv1H = { cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
  nv2H = { cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie, 'x-umbm-client': 'web' };
});

afterAll(async () => { await t.app.close(); });

async function listNotifs(headers: Record<string, string>) {
  const res = await t.app.inject({ method: 'GET', url: '/api/notifications?per_page=100', headers });
  expect(res.statusCode).toBe(200);
  return res.json().data as Array<{ id: string; entity_type: string; entity_id: string; title: string; link: string }>;
}

describe('Cô lập tuyệt đối Vai trò nhận Thông báo Chuông, Realtime & Email trên toàn hệ thống', () => {
  it('1. Nhân viên ký phiếu lương CHỈ thông báo & gửi Email cho Kế toán (FINANCE) — tuyệt đối không thông báo cho Nhân viên hay Quản trị/HR/CH/MKT', async () => {
    await t.app.inject({ method: 'PUT', url: '/api/admin/payroll/admin-signature', headers: adminH, payload: { signature_base64: SIG_PNG, signer_name: 'Ban Quản trị Ụm Bò Milk' } });
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: finH,
      payload: { period_code: 'KL-202611-ISO', name: 'Kỳ lương T11/2026', from_date: '2026-11-01', to_date: '2026-11-30' },
    });
    expect(createRes.statusCode).toBe(201);
    const periodId = createRes.json().data.id as string;

    // Bước 1: Kế toán trình Quản trị -> CHỈ ADMIN nhận thông báo + email (URL trỏ đúng Web, không trỏ API)
    const beforeStep1 = new Set(t.email.recent(100).map((m) => m.id));
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/submit-to-admin`, headers: finH, payload: {} })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    const step1Mails = t.email.recent(100).filter((m) => !beforeStep1.has(m.id));
    expect(step1Mails.map((m) => m.to)).toEqual([ADMIN_MAIL]);
    expect(step1Mails[0]!.html).toContain('https://crm-hr-um-milk.vercel.app/admin/payroll');
    expect(step1Mails[0]!.html).not.toContain('https://umbm-api.onrender.com');
    expect((await listNotifs(adminH)).some((n) => n.entity_type === 'PAYROLL_SUBMIT_ADMIN' && n.entity_id === periodId)).toBe(true);
    for (const h of [finH, hrH, storeH, mktH, nv1H, nv2H]) {
      expect((await listNotifs(h)).some((n) => n.entity_type === 'PAYROLL_SUBMIT_ADMIN')).toBe(false);
    }

    // Bước 2: Quản trị ký duyệt -> CHỈ FINANCE nhận thông báo + email; ADMIN không tự thấy thông báo gửi cho FINANCE và PAYROLL_SUBMIT_ADMIN tự dọn sạch
    const beforeStep2 = new Set(t.email.recent(100).map((m) => m.id));
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/admin-approve`, headers: adminH, payload: {} })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    expect(t.email.recent(100).filter((m) => !beforeStep2.has(m.id)).map((m) => m.to)).toEqual([FIN_MAIL]);
    expect((await listNotifs(finH)).some((n) => n.entity_type === 'PAYROLL_ADMIN_APPROVED' && n.entity_id === periodId)).toBe(true);
    for (const h of [adminH, hrH, storeH, mktH, nv1H, nv2H]) {
      const items = await listNotifs(h);
      expect(items.some((n) => n.entity_type === 'PAYROLL_ADMIN_APPROVED' || n.entity_type === 'PAYROLL_SUBMIT_ADMIN')).toBe(false);
    }

    // Bước 3: Kế toán ký phát hành -> Mỗi nhân viên chỉ thấy đúng phiếu lương của mình; PAYROLL_ADMIN_APPROVED tự dọn sạch
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/finance-publish`, headers: finH, payload: { signature_base64: SIG_PNG } })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    expect((await listNotifs(finH)).some((n) => n.entity_type === 'PAYROLL_ADMIN_APPROVED')).toBe(false);

    const nv2Slip = (await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv2H })).json().data.find((p: { periodId: string }) => p.periodId === periodId)!;
    expect(nv2Slip).toBeTruthy();

    // Giả lập NV0002 từng gửi thắc mắc và Kế toán đã phản hồi (IN_PROGRESS), sau đó NV0002 đồng ý ký phiếu lương
    const dispRes = await t.app.inject({ method: 'POST', url: `/api/me/payslips/${nv2Slip.id}/dispute`, headers: nv2H, payload: { reason: 'Kiểm tra lại phụ cấp ca tối', target_department: 'FINANCE' } });
    expect(dispRes.statusCode).toBe(200);
    const tckId = dispRes.json().data.linkedTicket.id as string;
    expect((await t.app.inject({ method: 'POST', url: `/api/tickets/${tckId}/reply`, headers: finH, payload: { content: 'Kế toán đã đối chiếu đủ phụ cấp cho bạn' } })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);

    // Chụp danh sách thông báo & email TRƯỚC khi NV0002 ký tên
    const beforeSignMails = new Set(t.email.recent(200).map((m) => m.id));
    const beforeNv1Notifs = new Set((await listNotifs(nv1H)).map((n) => n.id));
    const beforeNv2Notifs = new Set((await listNotifs(nv2H)).map((n) => n.id));
    const beforeAdminNotifs = new Set((await listNotifs(adminH)).map((n) => n.id));
    const beforeHrNotifs = new Set((await listNotifs(hrH)).map((n) => n.id));
    const beforeStoreNotifs = new Set((await listNotifs(storeH)).map((n) => n.id));
    const beforeMktNotifs = new Set((await listNotifs(mktH)).map((n) => n.id));

    // Bước 4: NV0002 ký trực tiếp trên phiếu lương
    const signRes = await t.app.inject({
      method: 'POST', url: `/api/me/payslips/${nv2Slip.id}/sign`, headers: nv2H,
      payload: { signature_base64: SIG_PNG, signature_source: 'DIRECT_CANVAS' },
    });
    expect(signRes.statusCode).toBe(200);

    // Kể cả khi các nhân viên tải lại GET /api/me/payslips ngay sau đó, tuyệt đối KHÔNG phát lặp thông báo/email
    expect((await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv1H })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nv2H })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);

    // KIỂM CHỨNG: CHỈ FINANCE nhận thông báo chuông & email; NV0002, NV0001, ADMIN, HR, STORE, MKT nhận ĐÚNG 0 thông báo mới và 0 email!
    const finNotifsAfterSign = await listNotifs(finH);
    expect(finNotifsAfterSign.some((n) => n.entity_type === 'PAYSLIP_CONFIRMED_FINANCE' && n.entity_id === nv2Slip.id)).toBe(true);
    expect((await listNotifs(nv2H)).filter((n) => !beforeNv2Notifs.has(n.id))).toHaveLength(0);
    expect((await listNotifs(nv1H)).filter((n) => !beforeNv1Notifs.has(n.id))).toHaveLength(0);
    expect((await listNotifs(adminH)).filter((n) => !beforeAdminNotifs.has(n.id))).toHaveLength(0);
    expect((await listNotifs(hrH)).filter((n) => !beforeHrNotifs.has(n.id))).toHaveLength(0);
    expect((await listNotifs(storeH)).filter((n) => !beforeStoreNotifs.has(n.id))).toHaveLength(0);
    expect((await listNotifs(mktH)).filter((n) => !beforeMktNotifs.has(n.id))).toHaveLength(0);

    const signMails = t.email.recent(200).filter((m) => !beforeSignMails.has(m.id));
    expect(signMails.map((m) => m.to)).toEqual([FIN_MAIL]);

    // Bước 5: Kế toán đánh dấu Đã thanh toán cho NV0002 -> NV0002 nhận ĐÚNG 1 thông báo PAID duy nhất (không trùng 2 dòng) + Email xác nhận thanh toán; NV0001 không bị nhận nhầm
    const beforePayMails = new Set(t.email.recent(200).map((m) => m.id));
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/payslips/${nv2Slip.id}/pay`, headers: finH, payload: { payment_reference: 'QR-T11-NV0002' } })).statusCode).toBe(200);
    await t.email.processQueueBatch(10);
    const nv2PaidNotifs = (await listNotifs(nv2H)).filter((n) => n.entity_id === `${nv2Slip.id}_PAID` || n.entity_type === 'PAYSLIP_PAID');
    expect(nv2PaidNotifs).toHaveLength(1);
    expect((await listNotifs(nv1H)).some((n) => n.entity_id.endsWith('_PAID'))).toBe(false);
    const payMails = t.email.recent(200).filter((m) => !beforePayMails.has(m.id));
    expect(payMails.some((m) => m.to === NV2_MAIL && m.referenceCode.includes('PAID'))).toBe(true);
    expect(payMails.some((m) => m.to === NV1_MAIL)).toBe(false);
  });

  it('2. Thông báo thủ công theo Vai trò, Bản tin MKT phân nhóm, Giao đề thi, Chuyển Chính thức & Từ chối đổi ca chỉ gửi đúng đối tượng', async () => {
    // 2.1. ADMIN gửi thông báo thủ công cho riêng vai trò FINANCE -> ADMIN, HR, STORE, MKT, NV không ai thấy
    const manualRes = await t.app.inject({
      method: 'POST', url: '/api/notifications', headers: adminH,
      payload: { title: 'Nhắc đối soát chứng từ thuế tháng 11', body: 'Chỉ gửi riêng phòng Kế toán xử lý.', category: 'PAYROLL', severity: 'WARNING', target_scope: 'ROLE', recipient_roles: ['FINANCE'] },
    });
    expect(manualRes.statusCode).toBe(201);
    const manualId = manualRes.json().data.id as string;
    expect((await listNotifs(finH)).some((n) => n.id === manualId)).toBe(true);
    for (const h of [adminH, hrH, storeH, mktH, nv1H, nv2H]) {
      expect((await listNotifs(h)).some((n) => n.id === manualId)).toBe(false);
    }

    // 2.2. MKT phát bản tin riêng cho nhóm Nhân viên thử việc (PROBATION) -> Chỉ NV0001 nhận; ADMIN, MKT, FINANCE, NV0002 (Chính thức) không bị làm phiền
    const ancRes = await t.app.inject({
      method: 'POST', url: '/api/mkt/announcements', headers: mktH,
      payload: { title: 'Hướng dẫn sổ tay dành riêng cho Nhân viên Thử việc', summary: 'Chỉ áp dụng nhóm thử việc', body_md: '<p>Sổ tay thử việc</p>', status: 'SENT', audience_scope: 'STAGE', audience_target: 'PROBATION' },
    });
    expect(ancRes.statusCode).toBe(201);
    const ancId = ancRes.json().data.id as string;
    expect((await listNotifs(nv1H)).some((n) => n.entity_type === 'ANNOUNCEMENTS' && n.entity_id === ancId)).toBe(true);
    for (const h of [adminH, finH, hrH, storeH, mktH, nv2H]) {
      expect((await listNotifs(h)).some((n) => n.entity_type === 'ANNOUNCEMENTS' && n.entity_id === ancId)).toBe(false);
    }

    // 2.3. HR giao bài kiểm tra & duyệt chuyển Chính thức cho NV0001 -> NV0001 nhận đủ Chuông + Email; NV0002 không nhận
    const emp1 = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const emp2 = t.db.employees.find((e) => e.employee_code === 'NV0002')!;
    await t.app.inject({ method: 'GET', url: '/api/admin/tests/bank', headers: hrH });
    const testId = t.db.testBank.all()[0]!.id;
    const asgRes = await t.app.inject({ method: 'POST', url: '/api/admin/tests/assignments', headers: hrH, payload: { test_id: testId, employee_id: emp1.id } });
    expect(asgRes.statusCode).toBe(201);
    expect((await listNotifs(nv1H)).some((n) => n.entity_type === 'TEST_ASSIGNED_USER')).toBe(true);
    expect((await listNotifs(nv2H)).some((n) => n.entity_type === 'TEST_ASSIGNED_USER')).toBe(false);

    const promRes = await t.app.inject({ method: 'POST', url: `/api/admin/employees/${emp1.id}/promote-official`, headers: hrH, payload: { version: emp1.version } });
    expect(promRes.statusCode).toBe(200);
    expect((await listNotifs(nv1H)).some((n) => n.entity_type === 'PROMOTED_OFFICIAL_USER')).toBe(true);
    expect((await listNotifs(nv2H)).some((n) => n.entity_type === 'PROMOTED_OFFICIAL_USER')).toBe(false);

    // 2.4. Đồng nghiệp TỪ CHỐI nhận ca (PEER_DECLINED) -> Chỉ người gửi (NV0001) nhận thông báo; HR & Cửa hàng không bị nhận thông báo rác
    const workDate = dayjs().add(45, 'day').format('YYYY-MM-DD');
    const shfRes = await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hrH, payload: { employee_id: emp1.id, work_date: workDate, shift_code: 'CA_SANG', status: 'PUBLISHED' } });
    expect(shfRes.statusCode).toBe(201);
    const swRes = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nv1H, payload: { kind: 'GIVE', requester_id: emp1.id, peer_id: emp2.id, from_assignment_id: shfRes.json().data.id, reason: 'Bận lịch học đột xuất' } });
    expect(swRes.statusCode).toBe(201);
    const sw = swRes.json().data;
    const decRes = await t.app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${sw.id}/peer-respond`, headers: nv2H, payload: { version: sw.version, accept: false, peer_note: 'Mình trùng lịch khác' } });
    expect(decRes.statusCode).toBe(200);
    expect((await listNotifs(nv1H)).some((n) => n.entity_id === `${sw.id}_PEER_DECLINED`)).toBe(true);
    for (const h of [nv2H, hrH, storeH, adminH, finH]) {
      expect((await listNotifs(h)).some((n) => n.entity_id.includes(sw.id) && n.entity_id.includes('PEER_DECLINED'))).toBe(false);
    }
  });
});
