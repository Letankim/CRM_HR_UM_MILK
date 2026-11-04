import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp } from '../test-utils/build-test-app.js';

/** Ngày hôm nay (luôn nằm trong tuần hiện tại → pass assertDispatchDateInRange). */
const TODAY = dayjs().format('YYYY-MM-DD');

describe('7.3 Điều phối khẩn cấp (HR Dispatch) & Phụ cấp +30.000đ', () => {
  it('HR/Store phát lệnh điều phối ca khẩn cấp lên bảng tin chi nhánh, nhân viên nhận ca được tự động cộng +30.000đ vào kỳ lương', async () => {
    const { app, db, login, loginHeaders } = await buildTestApp('hr_dsp');
    const hrHeaders = await loginHeaders('hr');
    const finHeaders = await loginHeaders('finance');

    // Lấy thông tin chi nhánh & khung ca từ ca seed
    const shift = db.shiftAssignments.find((a) => a.status === 'PUBLISHED')!;
    expect(shift).toBeDefined();
    const branchId = shift.branch_id, shiftCode = shift.shift_code;

    // 1. HR phát lệnh điều phối khẩn cấp HR_DISPATCH (dùng branch_id + work_date + shift_code, không dùng from_assignment_id)
    const dispatchRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_DISPATCH',
        branch_id: branchId,
        work_date: TODAY,
        shift_code: shiftCode,
        reason: 'Nhân viên ốm đột xuất, thiếu nhân sự cửa hàng cần điều phối khẩn cấp',
      },
    });
    expect(dispatchRes.statusCode).toBe(201);
    const dispatchData = dispatchRes.json().data;
    expect(dispatchData.kind).toBe('HR_DISPATCH');
    expect(dispatchData.swap_code).toMatch(/^DSP-\d+/);
    expect(dispatchData.allowance_eligible).toBe(true);
    expect(dispatchData.allowance_amount_vnd).toBe(30000);

    // 2. Kiểm tra bản tin chi nhánh tự động được đăng tải lên COMMS.ANNOUNCEMENTS
    const anc = db.announcements.find((a) => a.code === `ANC-DSP-${dispatchData.swap_code}`);
    expect(anc).toBeDefined();
    expect(anc!.priority).toBe('URGENT');
    expect(anc!.audience_scope).toBe('BRANCH');
    expect(anc!.status).toBe('SENT');
    expect(anc!.title).toContain('Điều phối khẩn cấp');
    expect(anc!.title).toContain('+30.000đ');

    // 3. Nhân viên thuộc chi nhánh xem danh sách bản tin nội bộ
    const nvUsers = db.users.filter((u) => u.role === 'CHINH_THUC');
    const receiverUser = nvUsers.find((u) => u.employee_id && u.employee_id !== shift.employee_id) || nvUsers[0]!;
    const empLogin = await login(receiverUser.phone || '0901000002', DEMO_PIN, 'employee');
    const receiverHeaders = { cookie: empLogin.cookie, 'x-umbm-client': 'web' };

    const commsRes = await app.inject({
      method: 'GET',
      url: '/api/announcements',
      headers: receiverHeaders,
    });
    expect(commsRes.statusCode).toBe(200);
    const commsData = commsRes.json().data;
    const foundInBulletin = commsData.announcements.find((a: { code: string }) => a.code === `ANC-DSP-${dispatchData.swap_code}`);
    expect(foundInBulletin).toBeDefined();
    expect(foundInBulletin.cta_link).toBe('/nv/doi-ca');

    // 3b. Trang Nhường / Đổi ca của nhân viên chi nhánh phải liệt kê lệnh điều phối đang mở để bấm Nhận ca
    const myAttRes = await app.inject({ method: 'GET', url: '/api/my-attendance', headers: receiverHeaders });
    expect(myAttRes.statusCode).toBe(200);
    const openDispatch = (myAttRes.json().data.swaps as { id: string; kind: string; status: string }[]).find((s) => s.id === dispatchData.id);
    expect(openDispatch).toBeDefined();
    expect(openDispatch!.kind).toBe('HR_DISPATCH');
    expect(openDispatch!.status).toBe('PENDING_PEER');

    // 3c. Một nhân viên bỏ qua lệnh không được làm hủy lệnh của cả chi nhánh
    const skipRes = await app.inject({ method: 'POST', url: `/api/admin/shift-swaps/${dispatchData.id}/peer-respond`, headers: receiverHeaders, payload: { version: dispatchData.version, accept: false, peer_note: 'Bận' } });
    expect(skipRes.statusCode).toBe(200);
    expect(db.shiftSwaps.get(dispatchData.id)!.status).toBe('PENDING_PEER');

    // 4. Tạo kỳ lương mở để tính lương
    const fromDate = dayjs(TODAY).startOf('month').format('YYYY-MM-DD');
    const toDate = dayjs(TODAY).endOf('month').format('YYYY-MM-DD');
    const periodRes = await app.inject({
      method: 'POST',
      url: '/api/admin/payroll/periods',
      headers: finHeaders,
      payload: { name: 'Kỳ lương Tháng Điều Phối', from_date: fromDate, to_date: toDate },
    });
    expect(periodRes.statusCode).toBe(201);
    const periodId = periodRes.json().data.id;

    // 4b. Kiểm tra nếu nhân viên ĐÃ CÓ ca trùng khung giờ ngày đó -> hệ thống chặn không cho nhận
    const receiverEmp = db.employees.find((e) => e.user_id === receiverUser.id || e.id === receiverUser.employee_id || e.employee_code === receiverUser.employee_id)!;
    const conflictingShift = await db.shiftAssignments.insert({
      branch_id: branchId, work_date: TODAY, shift_code: shiftCode,
      start_at: shift.start_at, end_at: shift.end_at, scheduled_hours: shift.scheduled_hours,
      employee_id: receiverEmp.id, employee_stage: receiverEmp.stage, status: 'PUBLISHED',
      schedule_week_id: shift.schedule_week_id, shift_template_id: shift.shift_template_id,
      day_type: 'WORK', note: 'Ca trùng giờ thử nghiệm', source: 'TEST',
      swapped_from_employee_id: '', replacement_for_employee_id: '', linked_assignment_id: '',
      published_at: '2026-10-01T00:00:00+07:00',
    }, 'test');

    const conflictClaimRes = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${dispatchData.id}/claim`,
      headers: receiverHeaders,
      payload: { version: dispatchData.version, accept: true, peer_note: 'Cố nhận khi đã có ca trùng' },
    });
    expect(conflictClaimRes.statusCode).toBe(400);
    expect(conflictClaimRes.json().message).toContain('trùng khung giờ');

    // Xóa ca trùng để tiếp tục nhận ca hợp lệ
    await db.shiftAssignments.softDelete(conflictingShift.id, conflictingShift.version, 'test');

    // 5. Nhân viên nhận ca làm thay khẩn cấp (Claim)
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${dispatchData.id}/claim`,
      headers: receiverHeaders,
      payload: { version: dispatchData.version, accept: true, peer_note: 'Tôi sẵn sàng nhận làm thay ca này' },
    });
    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json().message).toContain('+30.000đ');

    // Kiểm tra bản ghi swap cập nhật thành công
    const claimedSwap = db.shiftSwaps.get(dispatchData.id)!;
    expect(claimedSwap.status).toBe('APPROVED');
    expect(claimedSwap.allowance_eligible).toBe(true);
    expect(claimedSwap.allowance_amount_vnd).toBe(30000);

    // Kiểm tra CA GỐC vẫn thuộc nhân viên ban đầu (không bị thay thế)
    const originalShift = db.shiftAssignments.get(shift.id)!;
    expect(originalShift.employee_id).toBe(shift.employee_id);
    expect(originalShift.status).toBe('PUBLISHED');

    // Kiểm tra CA MỚI được tạo cho người nhận (điều phối = tăng thêm ca, không thay thế)
    const newShiftId = claimedSwap.to_assignment_id;
    expect(newShiftId).toBeTruthy();
    const newShift = db.shiftAssignments.get(newShiftId)!;
    expect(newShift).toBeDefined();
    expect(newShift.employee_id).toBe(receiverEmp.id);
    expect(newShift.work_date).toBe(TODAY);
    expect(newShift.shift_code).toBe(shiftCode);
    expect(newShift.source).toBe('HR_DISPATCH');
    expect(newShift.note).toContain('DSP-');

    // Đánh dấu ca mới đã hoàn thành để tính vào bảng lương
    await db.shiftAssignments.update(newShift.id, newShift.version, { status: 'COMPLETED' }, 'test');

    // Kiểm tra bản tin chi nhánh cập nhật trạng thái đã tiếp nhận
    const updatedAnc = db.announcements.get(anc!.id)!;
    expect(updatedAnc.summary).toContain('ĐÃ TIẾP NHẬN');

    // 6. Kiểm tra bảng lương tự động cập nhật phụ cấp +30.000đ
    const calcRes = await app.inject({
      method: 'POST',
      url: `/api/admin/payroll/periods/${periodId}/recalculate`,
      headers: finHeaders,
    });
    expect(calcRes.statusCode).toBe(200);

    const snapshotsRes = await app.inject({
      method: 'GET',
      url: `/api/admin/payroll/periods/${periodId}/snapshots`,
      headers: finHeaders,
    });
    expect(snapshotsRes.statusCode).toBe(200);
    const snapshots = snapshotsRes.json().data.snapshots as Array<Record<string, unknown>>;
    const receiverSnap = snapshots.find((s) => s.employeeId === receiverEmp.id);
    expect(receiverSnap).toBeDefined();
    expect(Number(receiverSnap!.shiftSwapAllowanceVnd)).toBeGreaterThanOrEqual(30000);
    expect(Number(receiverSnap!.shiftSwapCount)).toBeGreaterThanOrEqual(1);

    // 7. Kiểm tra hủy lệnh điều phối khẩn cấp -> bản tin tự động soft-delete
    const dispatch2 = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: { kind: 'HR_DISPATCH', branch_id: branchId, work_date: TODAY, shift_code: shiftCode, reason: 'Điều phối thử nghiệm hủy' },
    });
    const d2Data = dispatch2.json().data;
    const anc2 = db.announcements.find((a) => a.code === `ANC-DSP-${d2Data.swap_code}`);
    expect(anc2).toBeDefined();

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${d2Data.id}/cancel`,
      headers: hrHeaders,
      payload: {},
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(db.announcements.get(anc2!.id)).toBeUndefined();
    expect(db.announcements.all(true).find((a) => a.id === anc2!.id)?.is_deleted).toBe(true);

    // 8. Chặn lệnh điều phối ngày quá khứ
    const pastRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: { kind: 'HR_DISPATCH', branch_id: branchId, work_date: '2026-01-01', shift_code: shiftCode, reason: 'Quá khứ' },
    });
    expect(pastRes.statusCode).toBe(400);
    expect(pastRes.json().errors.details[0].message).toContain('ngày đã qua');
  });
});
