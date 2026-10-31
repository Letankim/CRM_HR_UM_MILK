import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

function makeValidPngDataUrl(r: number, g: number, b: number): string {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const w = 16, h = 16, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) { const p = y * (1 + w * 4) + 1 + x * 4; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255; }
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const ADMIN_SIG_PNG = makeValidPngDataUrl(15, 23, 42), FINANCE_SIG_PNG = makeValidPngDataUrl(37, 99, 235);
const EMP_SIG_PNG = makeValidPngDataUrl(21, 128, 61), BANK_QR_PNG = makeValidPngDataUrl(0, 0, 0);

let t: TestAppContext, adminH: Awaited<ReturnType<TestAppContext['loginHeaders']>>, finH: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
let empH: { cookie: string; 'x-umbm-client': string }, periodId = '', nv2PayslipId = '', nv2SnapshotId = '';

beforeAll(async () => {
  t = await buildTestApp('q');
  adminH = await t.loginHeaders('admin');
  finH = await t.loginHeaders('finance');
  const empLogin = await t.login('0901000002', DEMO_PIN, 'employee');
  empH = { cookie: empLogin.cookie, 'x-umbm-client': 'web' };
});
afterAll(async () => { await t.app.close(); });

describe('Luồng 3 chữ ký lương (Kế toán -> Quản trị -> Kế toán -> Nhân viên), Mã QR Ngân hàng & Xuất PDF ZIP', () => {
  it('1. Nhân viên tải ảnh Mã QR Ngân hàng trong Profile (lưu 08_EMPLOYEE_BANK_QR)', async () => {
    const putRes = await t.app.inject({
      method: 'PUT', url: '/api/auth/profile', headers: empH,
      payload: { display_name: 'Đặng Văn Chính Thức', bank_name: 'Vietcombank', bank_account_number: '0071009998888', bank_account_holder: 'DANG VAN CHINH THUC', bank_qr_base64: BANK_QR_PNG },
    });
    expect(putRes.statusCode).toBe(200);
    const prof = putRes.json().data;
    expect(prof.bankQrDriveFolder).toBe('08_EMPLOYEE_BANK_QR');
    expect(prof.bankQrUrl).toMatch(/^\/api\/payroll\/media\//);
    const mediaRes = await t.app.inject({ method: 'GET', url: prof.bankQrUrl });
    expect(mediaRes.statusCode).toBe(200);
    expect(mediaRes.headers['content-type']).toContain('image/png');
  });

  it('2. Kế toán tạo kỳ lương & gửi trình Quản trị phê duyệt (DRAFT -> RECONCILE)', async () => {
    const createRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/periods', headers: finH,
      payload: { period_code: 'KL-202612-SIG', name: 'Lương Tháng 12/2026', from_date: '2026-12-01', to_date: '2026-12-31' },
    });
    expect(createRes.statusCode).toBe(201);
    periodId = createRes.json().data.id;
    const submitRes = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/submit-to-admin`, headers: finH, payload: { note: 'Kế toán đã rà soát xong' } });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().data.status).toBe('RECONCILE');
    expect(t.db.notifications.find((n) => n.entity_type === 'PAYROLL_SUBMIT_ADMIN' && n.entity_id === periodId)).toBeTruthy();
  });

  it('3. Quản trị cấu hình chữ ký hệ thống & ký duyệt bảng lương gửi lại về Kế toán (RECONCILE -> APPROVED)', async () => {
    const finTryApprove = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/admin-approve`, headers: finH, payload: {} });
    expect(finTryApprove.statusCode).toBe(403);

    const missingSigRes = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/admin-approve`, headers: adminH, payload: {} });
    expect(missingSigRes.statusCode).toBe(400);

    const cfgRes = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/payroll/admin-signature',
      headers: adminH,
      payload: { signature_base64: ADMIN_SIG_PNG, signer_name: 'Giám đốc Quản trị Ụm Bò Milk' },
    });
    expect(cfgRes.statusCode).toBe(200);
    expect(cfgRes.json().data.signatureUrl).toMatch(/^\/api\/payroll\/media\//);

    const approveRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/payroll/periods/${periodId}/admin-approve`,
      headers: adminH,
      payload: { note: 'Đã phê duyệt quỹ lương, chuyển Kế toán ký phát hành' },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.status).toBe('APPROVED');
    expect(approveRes.json().data.adminSignedBy).toBe('Giám đốc Quản trị Ụm Bò Milk');
    expect(t.db.notifications.find((n) => n.entity_type === 'PAYROLL_ADMIN_APPROVED' && n.entity_id === periodId)).toBeTruthy();
  });

  it('4. Kế toán tải chữ ký từ máy & phát hành xuống nhân viên; QR ngân hàng ẩn trước khi NV ký', async () => {
    const noSig = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/finance-publish`, headers: finH, payload: { signature_base64: '' } });
    expect(noSig.statusCode).toBe(400);

    const pubRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/payroll/periods/${periodId}/finance-publish`,
      headers: finH,
      payload: { signature_base64: FINANCE_SIG_PNG, signer_name: 'Lê Thị Kế Toán Trưởng' },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().data.status).toBe('PUBLISHED');
    expect(pubRes.json().data.financeSignedBy).toBe('Lê Thị Kế Toán Trưởng');

    const snapsRes = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/snapshots`, headers: adminH });
    expect(snapsRes.statusCode).toBe(200);
    const nv2 = snapsRes.json().data.snapshots.find((s: { employeeCode: string }) => s.employeeCode === 'NV0002');
    expect(nv2.hasEmployeeBankQr).toBe(true);
    expect(nv2.bankQrUrl).toBeNull();
    nv2SnapshotId = nv2.id;
  });

  it('5. Điều chỉnh Cộng thêm (+) và Khấu trừ (-) hoạt động chuẩn trước khi nhân viên ký', async () => {
    const meSlips = await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: empH });
    const mySlip = meSlips.json().data.find((p: { periodName: string }) => p.periodName === 'Lương Tháng 12/2026');
    expect(mySlip).toBeTruthy();
    expect(mySlip.adminSignatureUrl).toMatch(/^\/api\/payroll\/media\//);
    expect(mySlip.financeSignatureUrl).toMatch(/^\/api\/payroll\/media\//);
    nv2PayslipId = mySlip.id;
    const baseNet = mySlip.netVnd;

    const addRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv2SnapshotId}/revisions`, headers: finH,
      payload: { delta_vnd: 150000, reason: 'Cộng thêm phụ cấp hỗ trợ kiểm kê kho' },
    });
    expect(addRes.statusCode).toBe(201);

    const deductRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv2SnapshotId}/revisions`, headers: finH,
      payload: { delta_vnd: -50000, reason: 'Khấu trừ tạm ứng đồng phục' },
    });
    expect(deductRes.statusCode).toBe(201);
    expect(deductRes.json().data.netVnd).toBe(baseNet + 100000);
    nv2PayslipId = deductRes.json().data.id;
  });

  it('6. Nhân viên bị chặn upload ảnh, bắt buộc ký tay trực tiếp (DIRECT_CANVAS) -> Hiện Mã QR bên Quản trị', async () => {
    const uploadBlocked = await t.app.inject({
      method: 'POST', url: `/api/me/payslips/${nv2PayslipId}/sign`, headers: empH,
      payload: { signature_base64: EMP_SIG_PNG, signature_source: 'FILE_UPLOAD' },
    });
    expect(uploadBlocked.statusCode).toBe(400);

    const signRes = await t.app.inject({
      method: 'POST', url: `/api/me/payslips/${nv2PayslipId}/sign`, headers: empH,
      payload: { signature_base64: EMP_SIG_PNG, signature_source: 'DIRECT_CANVAS' },
    });
    expect(signRes.statusCode).toBe(200);
    expect(signRes.json().data.employeeConfirmedAt).toBeTruthy();
    expect(signRes.json().data.employeeSignatureUrl).toMatch(/^\/api\/payroll\/media\//);

    const lockedAdj = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv2SnapshotId}/revisions`, headers: finH,
      payload: { delta_vnd: 20000, reason: 'Thử sửa sau khi nhân viên đã ký' },
    });
    expect(lockedAdj.statusCode).toBe(409);

    const snapsAfter = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/snapshots`, headers: adminH });
    const nv2 = snapsAfter.json().data.snapshots.find((s: { employeeCode: string }) => s.employeeCode === 'NV0002');
    expect(nv2.bankQrUrl).toMatch(/^\/api\/payroll\/media\//);
    expect(nv2.employeeSignatureUrl).toMatch(/^\/api\/payroll\/media\//);
  });

  it('7. Đánh dấu Đã thanh toán từng phiếu lương & Xuất PDF đủ 3 chữ ký nén ZIP chuẩn tên file', async () => {
    const payRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/payslips/${nv2PayslipId}/pay`, headers: adminH,
      payload: { payment_reference: 'VCB-QR-202612-NV0002' },
    });
    expect(payRes.statusCode).toBe(200);
    expect(payRes.json().data.status).toBe('PAID');
    expect(t.db.payments.find((p) => p.payslip_id === nv2PayslipId)?.reference).toBe('VCB-QR-202612-NV0002');

    const tickZipRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${periodId}/export-pdf-zip`, headers: adminH,
      payload: { selected_ids: [nv2SnapshotId] },
    });
    expect(tickZipRes.statusCode).toBe(200);
    const tickData = tickZipRes.json().data;
    expect(tickData.count).toBe(1);
    const unzippedTick = await JSZip.loadAsync(Buffer.from(tickData.base64, 'base64'));
    const expectedName = 'KL-202612-SIG_NV0002_Đặng Văn Chính Thức.pdf';
    expect(Object.keys(unzippedTick.files)).toEqual([expectedName]);
    const pdfBytes = await unzippedTick.files[expectedName]!.async('nodebuffer');
    expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(8000);

    const allSnaps = t.db.payrollSnapshots.filter((s) => s.period_id === periodId);
    const bulkPayRes = await t.app.inject({
      method: 'POST', url: '/api/admin/payroll/payslips/bulk-pay', headers: finH,
      payload: { ids: allSnaps.map((s) => s.id), payment_reference: 'UNC-TONG-202612' },
    });
    expect(bulkPayRes.statusCode).toBe(200);
    expect(t.db.payPeriods.get(periodId)?.status).toBe('PAID');

    const allZipRes = await t.app.inject({
      method: 'POST', url: `/api/admin/payroll/periods/${periodId}/export-pdf-zip`, headers: finH,
      payload: { selected_ids: [] },
    });
    expect(allZipRes.statusCode).toBe(200);
    const allZip = await JSZip.loadAsync(Buffer.from(allZipRes.json().data.base64, 'base64'));
    expect(Object.keys(allZip.files).length).toBe(allSnaps.length);
  });
});
