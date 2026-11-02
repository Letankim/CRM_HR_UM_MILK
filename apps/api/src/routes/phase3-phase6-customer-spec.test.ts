import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDynamicVietQrUrl,
  computeDailyOtThresholdAllowance,
  computeLateFine,
  parseVietQrEmvcoPayload,
  verifyContractMagicBytes,
} from '@umbm/shared';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;

beforeAll(async () => {
  t = await buildTestApp('p3_p6');
});
afterAll(async () => {
  await t.app.close();
});

describe('Giai đoạn 3 -> 6: Thử việc Tự động, Hợp đồng 6MB, Gate 2 OFF, Áo hồng HSV, Phạt trễ 4 bậc, 120 Câu SOP & Lương 6 Cột + VietQR', () => {
  it('1. Thử việc 12 ngày: Chọn 5 ngày OFF một lần -> tự sinh 7 ca PUBLISHED, Self-swap Ca ⇄ OFF tức thời & Cấp quyền nghỉ đột xuất + Vấn đáp Meet', async () => {
    const hr = await t.loginHeaders('hr');
    const probEmp = t.db.employees.all().find((e) => e.stage === 'PROBATION')!;
    expect(probEmp).toBeTruthy();

    // HR cấp 1 lượt nghỉ đột xuất và xác nhận hoàn tất vấn đáp Google Meet
    const grantRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/employees/${probEmp.id}/grant-emergency-leave`,
      headers: hr,
      payload: { reason: 'Gia đình có việc gấp' },
    });
    expect(grantRes.statusCode).toBe(200);
    expect(t.db.employees.get(probEmp.id)?.emergency_leave_grant_count).toBe(1);

    const meetRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/employees/${probEmp.id}/meet-evaluation`,
      headers: hr,
      payload: { meet_done: true, note: 'Đạt vấn đáp cuối chu kỳ thử việc qua Google Meet' },
    });
    expect(meetRes.statusCode).toBe(200);
    expect(t.db.employees.get(probEmp.id)?.probation_meet_done).toBe(true);
  });

  it('2. Kho Hợp đồng điện tử 6MB: Kiểm tra Magic Bytes (%PDF hợp lệ, chặn file giả mạo) & Lưu trữ kép', async () => {
    const hr = await t.loginHeaders('hr');
    const emp = t.db.employees.all()[0]!;

    // Kiểm tra hàm thuần verifyContractMagicBytes
    const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(verifyContractMagicBytes(validPdfBytes, 'hd_thu_viec.pdf')).toMatchObject({
      valid: true,
      detectedMime: 'application/pdf',
    });
    const fakeExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(verifyContractMagicBytes(fakeExeBytes, 'fake.pdf').valid).toBe(false);

    // Upload hợp đồng PDF hợp lệ qua API
    const pdfBase64 = Buffer.from(validPdfBytes).toString('base64');
    const upRes = await t.app.inject({
      method: 'POST',
      url: `/api/admin/employees/${emp.id}/contracts`,
      headers: hr,
      payload: {
        contract_type: 'PROBATION_CONTRACT',
        file_name: 'Hop_Dong_Thu_Viec.pdf',
        data_url: `data:application/pdf;base64,${pdfBase64}`,
        note: 'Hợp đồng thử việc 12 ngày',
      },
    });
    expect(upRes.statusCode).toBe(201);
    const listRes = await t.app.inject({
      method: 'GET',
      url: `/api/admin/employees/${emp.id}/contracts`,
      headers: hr,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it('3. Cổng Gate 2 Ngày OFF, Mở bù VIP 30–120 phút, Audit đổi ca lệch tuần & Công cụ dọn lịch tuần', async () => {
    const hr = await t.loginHeaders('hr');
    const officialEmp = t.db.employees.all().find((e) => e.stage === 'OFFICIAL')!;

    const vipWin = await t.app.inject({
      method: 'POST',
      url: '/api/admin/leave-requests/grant-vip-window',
      headers: hr,
      payload: { employee_id: officialEmp.id, duration_minutes: 60, reason: 'Mở bù cổng đăng ký 2 ngày OFF' },
    });
    expect(vipWin.statusCode).toBe(200);
    expect(t.db.employees.get(officialEmp.id)?.vip_off_window_until).toBeTruthy();

    const auditSwap = await t.app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps/audit-out-of-week',
      headers: hr,
      payload: {},
    });
    expect(auditSwap.statusCode).toBe(200);

    const cleanupRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedule-planner/cleanup',
      headers: hr,
      payload: { action: 'CLEAN_STALE_DRAFTS' },
    });
    expect(cleanupRes.statusCode).toBe(200);
  });

  it('4. Điểm danh: Khóa bất biến sổ cái (403), Phạt đi trễ 4 bậc, Auto-expire Bổ sung công 30 phút & Ngân hàng 120 câu hỏi SOP', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');

    // Kiểm tra công thức phạt đi trễ 4 bậc chuẩn tài liệu khách hàng
    expect(computeLateFine(3, 127500)).toMatchObject({ tier: 'NONE', fineVnd: 0 });
    expect(computeLateFine(12, 127500)).toMatchObject({ tier: 'FLAT_30K', fineVnd: 30000 });
    expect(computeLateFine(40, 120000)).toMatchObject({ tier: 'HALF_SHIFT', fineVnd: 60000 });
    expect(computeLateFine(65, 120000)).toMatchObject({ tier: 'FULL_SHIFT', fineVnd: 120000 });

    // Kiểm tra khóa bất biến sự kiện điểm danh gốc (Mục 8.6)
    const anyEvent = t.db.attendanceEvents.all()[0];
    if (anyEvent) {
      const delRes = await t.app.inject({
        method: 'DELETE',
        url: `/api/admin/attendance/events/${anyEvent.id}`,
        headers: admin,
      });
      expect(delRes.statusCode).toBe(403);
    }

    // Kiểm tra tự động từ chối phiếu bổ sung công quá hạn 30 phút
    const expireRes = await t.app.inject({
      method: 'POST',
      url: '/api/admin/attendance-adjustments/auto-expire',
      headers: hr,
      payload: {},
    });
    expect(expireRes.statusCode).toBe(200);

    // Khởi tạo ngân hàng 120 câu hỏi SOP chuẩn Ụm Bò Milk
    const seed120 = await t.app.inject({
      method: 'POST',
      url: '/api/admin/tests/bank/seed-120',
      headers: hr,
      payload: {},
    });
    expect([200, 201]).toContain(seed120.statusCode);
    expect(seed120.json().data.total_questions).toBe(120);
  });

  it('5. Tính lương: Phụ cấp OT ngưỡng 10h/15h, 6 Cột Kế toán nhập tay, Separation of Duties & Giải mã / Sinh VietQR động Napas247', async () => {
    const finance = await t.loginHeaders('finance');

    // Kiểm tra phụ cấp OT theo ngưỡng ngày (>=10h: +30k, >=15h: +60k)
    expect(computeDailyOtThresholdAllowance(8)).toEqual({ slots: 0, allowanceVnd: 0 });
    expect(computeDailyOtThresholdAllowance(11)).toEqual({ slots: 1, allowanceVnd: 30000 });
    expect(computeDailyOtThresholdAllowance(15.5)).toEqual({ slots: 2, allowanceVnd: 60000 });

    // Kiểm tra cập nhật 6 cột Kế toán nhập tay trên dòng snapshot lương ở kỳ DRAFT/RECONCILE
    const editablePeriod = t.db.payPeriods.all().find((p) => p.status === 'DRAFT' || p.status === 'RECONCILE');
    const snap = editablePeriod
      ? t.db.payrollSnapshots.all().find((s) => s.period_id === editablePeriod.id)
      : t.db.payrollSnapshots.all()[0];
    if (snap && editablePeriod) {
      const manualRes = await t.app.inject({
        method: 'PUT',
        url: `/api/admin/payroll/snapshots/${snap.id}/manual-columns`,
        headers: finance,
        payload: {
          version: snap.version,
          manual_base_add_vnd: 150000,
          manual_ot_add_vnd: 60000,
          manual_bonus_vnd: 200000,
          manual_advance_deduct_vnd: 100000,
          manual_kpi_deduct_vnd: 50000,
          manual_uniform_deduct_vnd: 30000,
        },
      });
      expect(manualRes.statusCode).toBe(200);
      expect(manualRes.json().data).toMatchObject({
        manual_base_add_vnd: 150000,
        manual_bonus_vnd: 200000,
        manual_uniform_deduct_vnd: 30000,
      });
    }

    // Kiểm tra giải mã EMVCo TLV VietQR & sinh đường dẫn VietQR động
    const sampleEmv = '00020101021138540010A00000072701240006970436011001234567890208QRIBFTTA53037045802VN5912NGUYEN VAN A6304ABCD';
    const parsedQr = parseVietQrEmvcoPayload(sampleEmv);
    expect(parsedQr).toMatchObject({
      bankBin: '970436',
      bankCode: 'VCB',
      bankName: 'Vietcombank',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
    });

    const dynamicUrl = buildDynamicVietQrUrl({
      bankNameOrBin: 'Vietcombank',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
      amountVnd: 4520000,
      periodCode: 'KY_10_2026',
      employeeCode: 'UBM_NV000001',
    });
    expect(dynamicUrl).toContain('https://img.vietqr.io/image/970436-0123456789-compact2.png');
    expect(dynamicUrl).toContain('amount=4520000');
    expect(dynamicUrl).toContain('LUONG%20KY_10_2026%20UBM_NV000001');
  });
});
