import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

function makeValidPngDataUrl(r: number, g: number, b: number): string {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const w = 12, h = 12, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * (1 + w * 4) + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const ADMIN_SIG = makeValidPngDataUrl(15, 23, 42);
const FINANCE_SIG = makeValidPngDataUrl(37, 99, 235);

let t: TestAppContext;
let adminH: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let hrH: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let finH: Awaited<ReturnType<TestAppContext['loginHeaders']>>;

beforeAll(async () => {
  t = await buildTestApp('q');
  adminH = await t.loginHeaders('admin');
  hrH = await t.loginHeaders('hr');
  finH = await t.loginHeaders('finance');
});

afterAll(async () => {
  await t.app.close();
});

describe('Phân quyền chặn Kế toán sắp lịch & Tải lên cấu hình Chữ ký số Kế toán', () => {
  it('1. Kế toán bị chặn hoàn toàn (403) khỏi mọi API Chốt lịch & Tự động sắp ca; chỉ HR thực hiện chốt lịch', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/schedule-planner/week', headers: finH })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/schedule-planner/probation', headers: finH })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: finH, payload: { week_start: '2026-11-09', branch_id: 'ALL' } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/probation/lock', headers: finH, payload: { employee_id: 'NV0001' } })).statusCode).toBe(403);

    const hrPreview = await t.app.inject({ method: 'GET', url: '/api/admin/schedule-planner/week?week_start=2026-11-09', headers: hrH });
    expect(hrPreview.statusCode).toBe(200);
    const hrLock = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedule-planner/week/lock',
      headers: hrH,
      payload: { week_start: '2026-11-09', branch_id: 'ALL', note: 'Biên bản chốt lịch tuần 09/11 đủ định biên' },
    });
    expect(hrLock.statusCode).toBe(200);
  });

  it('2. Chỉ Kế toán được tải lên & cấu hình Chữ ký Kế toán (09_PAYROLL_SIGNATURES/02_KE_TOAN); Quản trị và HR bị chặn 403', async () => {
    expect((await t.app.inject({
      method: 'PUT', url: '/api/admin/payroll/finance-signature', headers: adminH,
      payload: { signature_base64: FINANCE_SIG, signer_name: 'Admin thử ghi đè' },
    })).statusCode).toBe(403);

    expect((await t.app.inject({
      method: 'PUT', url: '/api/admin/payroll/finance-signature', headers: hrH,
      payload: { signature_base64: FINANCE_SIG, signer_name: 'HR thử ghi đè' },
    })).statusCode).toBe(403);

    const putRes = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/payroll/finance-signature',
      headers: finH,
      payload: { signature_base64: FINANCE_SIG, signer_name: 'Lê Thị Kế Toán Tiền Lương' },
    });
    expect(putRes.statusCode).toBe(200);
    const saved = putRes.json().data;
    expect(saved.driveFolder).toBe('09_PAYROLL_SIGNATURES/02_KE_TOAN');
    expect(saved.signerName).toBe('Lê Thị Kế Toán Tiền Lương');
    expect(saved.signatureUrl).toMatch(/^\/api\/payroll\/media\//);

    const getRes = await t.app.inject({ method: 'GET', url: '/api/admin/payroll/finance-signature', headers: finH });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.fileId).toBe(saved.fileId);
    expect((await t.app.inject({ method: 'GET', url: saved.signatureUrl, headers: finH })).statusCode).toBe(200);
  });

  it('3. Kế toán phát hành kỳ lương sử dụng ngay Chữ ký Kế toán đã tải lên mà không cần chọn lại file mỗi kỳ', async () => {
    await t.app.inject({
      method: 'PUT', url: '/api/admin/payroll/admin-signature', headers: adminH,
      payload: { signature_base64: ADMIN_SIG, signer_name: 'Ban Quản trị Ụm Bò Milk' },
    });
    const pRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: finH,
      payload: { period_code: 'KL-202611-FINSIG', name: 'Lương Tháng 11/2026', from_date: '2026-11-01', to_date: '2026-11-30' },
    });
    expect(pRes.statusCode).toBe(201);
    const periodId = pRes.json().data.id as string;

    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/submit-to-admin`, headers: finH, payload: {} })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/admin-approve`, headers: adminH, payload: {} })).statusCode).toBe(200);

    const pubRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/payroll/periods/${periodId}/finance-publish`,
      headers: finH,
      payload: { note: 'Phát hành bằng chữ ký Kế toán đã lưu trên hệ thống' },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().data.status).toBe('PUBLISHED');
    expect(pubRes.json().data.financeSignedBy).toBe('Lê Thị Kế Toán Tiền Lương');

    const slips = t.db.payslips.filter((p) => p.period_id === periodId);
    expect(slips.length).toBeGreaterThan(0);
    expect(slips.every((s) => Boolean(s.finance_signature_file_id) && Boolean(s.admin_signature_file_id))).toBe(true);
  });
});
