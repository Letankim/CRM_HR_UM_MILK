import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('Duyệt đổi ca có nút tick & tùy chỉnh Phụ cấp đổi ca đồng bộ Bảng lương (FLOW-02 + FIN-05)', () => {
  it('Mặc định 30.000đ khi tick, cho phép đổi mức tiền tùy chỉnh, bỏ tick = 0đ không cộng tiền, và khóa khi chốt lương', async () => {
    const { app, db, loginHeaders } = await buildTestApp('swp_pc');
    const hrHeaders = await loginHeaders('hr');
    const finHeaders = await loginHeaders('finance');

    // Lấy đơn đổi ca SWP-0001 đang ở trạng thái PEER_ACCEPTED trong dữ liệu seed (ngày 2026-10-26)
    const seededSwap = db.shiftSwaps.find((s) => s.status === 'PEER_ACCEPTED')!;
    expect(seededSwap).toBeDefined();
    const peerEmp = db.employees.get(seededSwap.peer_id)!;

    // Tạo kỳ lương tháng 10/2026 bên Kế toán
    const createPeriodRes = await app.inject({
      method: 'POST',
      url: '/api/admin/payroll/periods',
      headers: finHeaders,
      payload: { name: 'Kỳ lương Tháng 10/2026', from_date: '2026-10-01', to_date: '2026-10-31' },
    });
    expect(createPeriodRes.statusCode).toBe(201);
    const periodId = createPeriodRes.json().data.id as string;

    // 1. Kiểm tra validation tiếng Việt khi gửi số tiền âm
    const invalidNeg = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${seededSwap.id}/decide`,
      headers: hrHeaders,
      payload: { version: seededSwap.version, decision: 'APPROVED', allowance_eligible: true, allowance_amount_vnd: -5000 },
    });
    expect(invalidNeg.statusCode).toBe(400);
    expect(invalidNeg.json().success).toBe(false);

    // 2. Nhân sự duyệt đổi ca với mức tùy chỉnh 45.000đ (nút tick = true)
    const approveCustom = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${seededSwap.id}/decide`,
      headers: hrHeaders,
      payload: {
        version: seededSwap.version,
        decision: 'APPROVED',
        decision_reason: 'Hỗ trợ ca gấp, duyệt phụ cấp 45.000đ',
        allowance_eligible: true,
        allowance_amount_vnd: 45000,
      },
    });
    expect(approveCustom.statusCode).toBe(200);
    const approvedData = approveCustom.json().data;
    expect(approvedData.allowance_eligible).toBe(true);
    expect(approvedData.allowance_amount_vnd).toBe(45000);
    expect(approvedData.allowanceLabel).toBe('+45.000 đ');

    // Đánh dấu ca đã hoàn thành để bảng lương tính công ca này
    const swappedAssign = db.shiftAssignments.get(seededSwap.from_assignment_id)!;
    expect(swappedAssign.employee_id).toBe(peerEmp.id);
    await db.shiftAssignments.update(swappedAssign.id, swappedAssign.version, { status: 'COMPLETED' }, 'test');

    // Kiểm tra bảng lương bên Kế toán nhận đúng +45.000đ phụ cấp đổi ca
    const snapsCustomRes = await app.inject({
      method: 'GET',
      url: `/api/admin/payroll/periods/${periodId}/snapshots`,
      headers: finHeaders,
    });
    expect(snapsCustomRes.statusCode).toBe(200);
    const peerSnapCustom = (snapsCustomRes.json().data.snapshots as Record<string, unknown>[]).find((s) => s.employeeId === peerEmp.id)!;
    expect(peerSnapCustom.shiftSwapCount).toBe(1);
    expect(peerSnapCustom.paidSwapCount).toBe(1);
    expect(peerSnapCustom.shiftSwapAllowanceVnd).toBe(45000);
    const netWith45k = Number(peerSnapCustom.netVnd);
    const swapLog45k = (peerSnapCustom.shiftLogs as Record<string, unknown>[]).find((l) => l.assignmentId === swappedAssign.id)!;
    expect(swapLog45k.isSwapIn).toBe(true);
    expect(swapLog45k.swapAllowanceVnd).toBe(45000);

    // 3. Nhân sự bỏ tick phụ cấp đổi ca (allowance_eligible = false, dù gửi kèm 30000 vẫn phải tính = 0đ!)
    const latestSwap1 = db.shiftSwaps.get(seededSwap.id)!;
    const uncheckRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/shift-swaps/${seededSwap.id}/allowance`,
      headers: hrHeaders,
      payload: {
        version: latestSwap1.version,
        allowance_eligible: false,
        allowance_amount_vnd: 30000,
        decision_reason: 'Đổi ca tự nguyện cá nhân, không tính phụ cấp đổi ca',
      },
    });
    expect(uncheckRes.statusCode).toBe(200);
    expect(uncheckRes.json().data.allowance_eligible).toBe(false);
    expect(uncheckRes.json().data.allowance_amount_vnd).toBe(0);
    expect(uncheckRes.json().data.allowanceLabel).toBe('Không phụ cấp (0 đ)');

    // Kiểm tra ngay bên bảng lương: Phụ cấp đổi ca = 0đ, thực lĩnh giảm đúng 45.000đ, giờ công ca làm vẫn giữ nguyên!
    const snapsZeroRes = await app.inject({
      method: 'GET',
      url: `/api/admin/payroll/periods/${periodId}/snapshots`,
      headers: finHeaders,
    });
    const peerSnapZero = (snapsZeroRes.json().data.snapshots as Record<string, unknown>[]).find((s) => s.employeeId === peerEmp.id)!;
    expect(peerSnapZero.shiftSwapCount).toBe(1);
    expect(peerSnapZero.paidSwapCount).toBe(0);
    expect(peerSnapZero.shiftSwapAllowanceVnd).toBe(0);
    expect(Number(peerSnapZero.approvedHours)).toBe(Number(peerSnapCustom.approvedHours));
    expect(Number(peerSnapZero.netVnd)).toBe(netWith45k - 45000);
    expect((peerSnapZero.allowanceLines as { code: string }[]).some((l) => l.code === 'ALLOWANCE_SWAP')).toBe(false);
    const swapLogZero = (peerSnapZero.shiftLogs as Record<string, unknown>[]).find((l) => l.assignmentId === swappedAssign.id)!;
    expect(swapLogZero.isSwapIn).toBe(true);
    expect(swapLogZero.swapAllowanceVnd).toBe(0);

    // 4. Bật tick lại không truyền số tiền -> mặc định chuẩn 30.000đ
    const latestSwap2 = db.shiftSwaps.get(seededSwap.id)!;
    const recheckDefaultRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/shift-swaps/${seededSwap.id}/allowance`,
      headers: hrHeaders,
      payload: { version: latestSwap2.version, allowance_eligible: true },
    });
    expect(recheckDefaultRes.statusCode).toBe(200);
    expect(recheckDefaultRes.json().data.allowance_eligible).toBe(true);
    expect(recheckDefaultRes.json().data.allowance_amount_vnd).toBe(30000);

    const snaps30kRes = await app.inject({
      method: 'GET',
      url: `/api/admin/payroll/periods/${periodId}/snapshots`,
      headers: finHeaders,
    });
    const peerSnap30k = (snaps30kRes.json().data.snapshots as Record<string, unknown>[]).find((s) => s.employeeId === peerEmp.id)!;
    expect(peerSnap30k.shiftSwapAllowanceVnd).toBe(30000);
    expect(Number(peerSnap30k.netVnd)).toBe(netWith45k - 15000);

    // 5. Khi kỳ lương đã chốt (APPROVED / PUBLISHED / PAID), khóa không cho sửa phụ cấp đổi ca
    const curPeriod = db.payPeriods.get(periodId)!;
    await db.payPeriods.update(periodId, curPeriod.version, { status: 'APPROVED' }, 'finance');
    const latestSwap3 = db.shiftSwaps.get(seededSwap.id)!;
    const lockedRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/shift-swaps/${seededSwap.id}/allowance`,
      headers: hrHeaders,
      payload: { version: latestSwap3.version, allowance_eligible: false },
    });
    expect(lockedRes.statusCode).toBe(409);

    await app.close();
  });
});
