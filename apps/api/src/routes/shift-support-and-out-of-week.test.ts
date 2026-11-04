import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('7.4 Hỗ trợ chi nhánh khác (HR Support) & Scheduler kiểm toán (audit-out-of-week)', () => {
  it('HR điều phối nhân viên sang tăng cường chi nhánh khác, hệ thống tự động tạo ca mới tại chi nhánh đích và hoàn trả khi hủy', async () => {
    const { app, db, loginHeaders } = await buildTestApp('hr_sup');
    const hrHeaders = await loginHeaders('hr');

    // Lấy 2 chi nhánh khác nhau
    const branches = db.branches.all();
    expect(branches.length).toBeGreaterThanOrEqual(2);
    const sourceBranch = branches[0]!;
    const targetBranch = branches[1]!;

    // Tìm một ca làm việc đang phát hành tại chi nhánh nguồn
    const shift = db.shiftAssignments.find((a) => a.branch_id === sourceBranch.id && a.status === 'PUBLISHED')!;
    expect(shift).toBeDefined();
    const originalEmpId = shift.employee_id;

    // 1. HR tạo phiếu điều động hỗ trợ liên chi nhánh (HR_SUPPORT)
    const supRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_SUPPORT',
        from_assignment_id: shift.id,
        target_branch_id: targetBranch.id,
        reason: 'Chi nhánh đích thiếu nhân sự, điều động tăng cường hỗ trợ',
      },
    });
    expect(supRes.statusCode).toBe(201);
    const supData = supRes.json().data;
    expect(supData.kind).toBe('HR_SUPPORT');
    expect(supData.swap_code).toMatch(/^SUP-\d+/);
    expect(supData.status).toBe('APPROVED');
    expect(supData.targetBranchName).toBe(targetBranch.name);

    // 2. Kiểm tra hệ thống tự động tạo ca làm việc mới tại chi nhánh đích
    const targetShift = db.shiftAssignments.get(supData.to_assignment_id);
    expect(targetShift).toBeDefined();
    expect(targetShift!.branch_id).toBe(targetBranch.id);
    expect(targetShift!.employee_id).toBe(originalEmpId);
    expect(targetShift!.work_date).toBe(shift.work_date);
    expect(targetShift!.shift_code).toBe(shift.shift_code);
    expect(targetShift!.status).toBe('PUBLISHED');
    expect(targetShift!.note).toContain(supData.swap_code);

    // 3. Kiểm tra ca gốc tại chi nhánh nguồn được chuyển trạng thái SWAPPED
    const updatedSourceShift = db.shiftAssignments.get(shift.id)!;
    expect(updatedSourceShift.status).toBe('SWAPPED');
    expect(updatedSourceShift.note).toContain(supData.swap_code);

    // 4. HR hủy phiếu điều động hỗ trợ, hệ thống hoàn trả ca gốc và hủy ca tại chi nhánh đích
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/admin/shift-swaps/${supData.id}/cancel`,
      headers: hrHeaders,
      payload: {},
    });
    expect(cancelRes.statusCode).toBe(200);

    // Ca tại chi nhánh đích bị soft delete
    const cancelledTargetShift = db.shiftAssignments.get(supData.to_assignment_id);
    expect(cancelledTargetShift).toBeUndefined(); // soft deleted

    // Ca gốc tại chi nhánh nguồn được phục hồi về PUBLISHED
    const restoredSourceShift = db.shiftAssignments.get(shift.id)!;
    expect(restoredSourceShift.status).toBe('PUBLISHED');
    expect(restoredSourceShift.branch_id).toBe(sourceBranch.id);
    expect(restoredSourceShift.employee_id).toBe(originalEmpId);

    // 5. Luồng chuẩn mới: Chọn Chi nhánh đích + Ngày + Khung ca + Nhân sự rảnh từ chi nhánh khác (không cần chọn ca cũ)
    const freeDate = '2026-11-28';
    const freeShiftCode = 'CA_TOI';
    const newSupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_SUPPORT',
        target_branch_id: targetBranch.id,
        work_date: freeDate,
        shift_code: freeShiftCode,
        requester_id: originalEmpId,
        reason: 'Điều động nhân sự đang rảnh sang thêm vào lịch chi nhánh đích',
      },
    });
    expect(newSupRes.statusCode).toBe(201);
    const newSupData = newSupRes.json().data;
    expect(newSupData.status).toBe('APPROVED');
    const createdSupportShift = db.shiftAssignments.get(newSupData.to_assignment_id)!;
    expect(createdSupportShift).toBeDefined();
    expect(createdSupportShift.branch_id).toBe(targetBranch.id);
    expect(createdSupportShift.work_date).toBe(freeDate);
    expect(createdSupportShift.shift_code).toBe(freeShiftCode);
    expect(createdSupportShift.employee_id).toBe(originalEmpId);
    expect(createdSupportShift.source).toBe('HR_SUPPORT');

    // 6. Nếu cố điều động nhân sự đã bận khung ca đó -> báo lỗi 400
    const conflictSupRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_SUPPORT',
        target_branch_id: targetBranch.id,
        work_date: freeDate,
        shift_code: freeShiftCode,
        requester_id: originalEmpId,
        reason: 'Cố điều động trùng ca',
      },
    });
    expect(conflictSupRes.statusCode).toBe(400);
    expect(conflictSupRes.json().message).toContain('vui lòng chọn nhân sự đang rảnh');
  });

  it('Scheduler tự động kiểm toán (audit-out-of-week): phát hiện phiếu sai tuần, tự động hủy và hoàn trả lịch về đúng người ban đầu', async () => {
    const { app, db, ctx, loginHeaders } = await buildTestApp('hr_audit_week');
    const hrHeaders = await loginHeaders('hr');

    // Lấy 2 nhân viên
    const employees = db.employees.all();
    expect(employees.length).toBeGreaterThanOrEqual(2);
    const emp1 = employees[0]!;
    const emp2 = employees[1]!;

    // Tạo 2 ca làm việc ở 2 TUẦN KHÁC NHAU:
    // Tuần 1: 2026-11-02 (Thứ Hai)
    // Tuần 2: 2026-11-10 (Thứ Ba tuần kế tiếp)
    const shift1 = await db.shiftAssignments.insert({
      branch_id: emp1.branch_id, work_date: '2026-11-02', shift_code: 'CA_SANG',
      start_at: '07:00', end_at: '12:00', scheduled_hours: 5,
      employee_id: emp1.id, employee_stage: 'OFFICIAL', status: 'PUBLISHED',
      schedule_week_id: 'W45-2026', shift_template_id: '', day_type: 'WORK',
      note: 'Ca tuần 1', source: 'MANUAL', swapped_from_employee_id: '',
      replacement_for_employee_id: '', linked_assignment_id: '', published_at: '2026-11-01T08:00:00Z',
    }, 'system');

    const shift2 = await db.shiftAssignments.insert({
      branch_id: emp2.branch_id, work_date: '2026-11-10', shift_code: 'CA_CHIEU',
      start_at: '12:30', end_at: '17:30', scheduled_hours: 5,
      employee_id: emp2.id, employee_stage: 'OFFICIAL', status: 'PUBLISHED',
      schedule_week_id: 'W46-2026', shift_template_id: '', day_type: 'WORK',
      note: 'Ca tuần 2', source: 'MANUAL', swapped_from_employee_id: '',
      replacement_for_employee_id: '', linked_assignment_id: '', published_at: '2026-11-01T08:00:00Z',
    }, 'system');

    // Giả lập phiếu đổi ca bị tạo sai khác tuần và đã lỡ APPROVED (lịch đã bị hoán đổi)
    await db.shiftAssignments.update(shift1.id, shift1.version, { employee_id: emp2.id, swapped_from_employee_id: emp1.id }, 'admin');
    await db.shiftAssignments.update(shift2.id, shift2.version, { employee_id: emp1.id, swapped_from_employee_id: emp2.id }, 'admin');

    const invalidSwap = await db.shiftSwaps.insert({
      swap_code: 'DCA-9999', kind: 'SWAP', requires_hr_approval: false,
      requester_id: emp1.id, peer_id: emp2.id,
      from_assignment_id: shift1.id, to_assignment_id: shift2.id,
      branch_id: emp1.branch_id, target_branch_id: '',
      from_work_date: '2026-11-02', from_shift_code: 'CA_SANG',
      to_work_date: '2026-11-10', to_shift_code: 'CA_CHIEU',
      reason: 'Đổi ca khác tuần do sơ suất', status: 'APPROVED',
      has_conflict: false, staffing_valid: true, requested_at: '2026-11-01T09:00:00Z',
      peer_responded_at: '2026-11-01T09:05:00Z', peer_note: '', decided_by: 'admin',
      decision_reason: 'Lỡ duyệt', decided_at: '2026-11-01T09:10:00Z',
      allowance_eligible: false, allowance_amount_vnd: 0,
    }, 'admin');

    // 1. Chạy API kiểm toán đổi ca lệch tuần: /api/admin/shift-swaps/audit-out-of-week
    const auditRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps/audit-out-of-week',
      headers: hrHeaders,
      payload: {},
    });
    expect(auditRes.statusCode).toBe(200);
    const auditData = auditRes.json().data;
    expect(auditData.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(auditData.cancelledIds).toContain(invalidSwap.id);
    expect(auditData.revertedCount).toBeGreaterThanOrEqual(1);

    // 2. Kiểm tra phiếu bị chuyển sang CANCELLED với lý do rõ ràng
    const swapAfter = db.shiftSwaps.get(invalidSwap.id)!;
    expect(swapAfter.status).toBe('CANCELLED');
    expect(swapAfter.decision_reason).toContain('Tự động hủy do 2 ca đổi không thuộc cùng 1 tuần làm việc');

    // 3. Kiểm tra hoàn trả lịch về đúng người ban đầu
    const restoredShift1 = db.shiftAssignments.get(shift1.id)!;
    expect(restoredShift1.employee_id).toBe(emp1.id);
    expect(restoredShift1.swapped_from_employee_id).toBe('');
    expect(restoredShift1.status).toBe('PUBLISHED');

    const restoredShift2 = db.shiftAssignments.get(shift2.id)!;
    expect(restoredShift2.employee_id).toBe(emp2.id);
    expect(restoredShift2.swapped_from_employee_id).toBe('');
    expect(restoredShift2.status).toBe('PUBLISHED');

    // 4. Kiểm tra cron scheduler nội bộ /api/internal/cron/:job
    const cronInternalRes = await app.inject({
      method: 'POST',
      url: '/api/internal/cron/audit-out-of-week',
      headers: { 'x-internal-token': ctx.env.INTERNAL_API_TOKEN },
    });
    expect(cronInternalRes.statusCode).toBe(200);
    expect(cronInternalRes.json().data).toBeDefined();

    const cronReconcileRes = await app.inject({
      method: 'POST',
      url: '/api/internal/cron/reconcile',
      headers: { 'x-internal-token': ctx.env.INTERNAL_API_TOKEN },
    });
    expect(cronReconcileRes.statusCode).toBe(200);
    expect(cronReconcileRes.json().data.outOfWeekAudit).toBeDefined();
  });
});
