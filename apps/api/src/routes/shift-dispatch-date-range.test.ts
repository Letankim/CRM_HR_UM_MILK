import { describe, expect, it } from 'vitest';
import { validateDispatchDateRange } from '@umbm/shared';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('Rà soát ngày điều phối khẩn cấp & hỗ trợ liên chi nhánh', () => {
  it('validateDispatchDateRange kiểm tra chính xác các mốc: quá khứ, tuần hiện tại, tuần kế tiếp từ Thứ 6', () => {
    // 1. Ngày tạo là Thứ 4 (2026-11-04)
    const wednesday = '2026-11-04';
    // Ngày quá khứ -> từ chối
    expect(validateDispatchDateRange('2026-11-03', wednesday)).toEqual({
      valid: false,
      message: 'Không được phép tạo lệnh điều phối cho ngày đã qua',
    });
    // Trong tuần hiện tại (Thứ 4 -> Chủ nhật 2026-11-08) -> chấp nhận
    expect(validateDispatchDateRange('2026-11-04', wednesday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-06', wednesday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-08', wednesday).valid).toBe(true);
    // Tuần kế tiếp (2026-11-09) khi tạo vào Thứ 4 -> từ chối vì chưa tới T6/T7/CN
    expect(validateDispatchDateRange('2026-11-09', wednesday)).toEqual({
      valid: false,
      message: 'Chỉ được phép tạo lệnh điều phối cho tuần kế tiếp khi hôm nay là Thứ 6, Thứ 7 hoặc Chủ nhật',
    });
    // Tuần sau nữa -> từ chối
    expect(validateDispatchDateRange('2026-11-20', wednesday)).toEqual({
      valid: false,
      message: 'Chỉ được phép tạo lệnh điều phối cho tuần hiện tại hoặc tuần kế tiếp (mở từ Thứ 6)',
    });

    // 2. Ngày tạo là Thứ 6 (2026-11-06) -> cách tuần kế tiếp 3 ngày
    const friday = '2026-11-06';
    expect(validateDispatchDateRange('2026-11-09', friday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-15', friday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-16', friday).valid).toBe(false);

    // 3. Ngày tạo là Thứ 7 (2026-11-07) & Chủ nhật (2026-11-08) -> cho phép tuần kế tiếp
    const saturday = '2026-11-07', sunday = '2026-11-08';
    expect(validateDispatchDateRange('2026-11-10', saturday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-11', sunday).valid).toBe(true);
  });

  it('API POST /api/admin/shift-swaps từ chối khi ngày điều phối / hỗ trợ không hợp lệ theo quy tắc', async () => {
    const { app, db, loginHeaders } = await buildTestApp('date_range_test');
    const hrHeaders = await loginHeaders('hr');
    const branches = db.branches.all();
    const branch1 = branches[0]!, branch2 = branches[1]!;

    // Cố tạo lệnh điều phối ngày quá khứ
    const pastRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_DISPATCH',
        branch_id: branch1.id,
        work_date: '2026-01-01',
        shift_code: 'CA_SANG',
        reason: 'Quá khứ',
      },
    });
    expect(pastRes.statusCode).toBe(400);
    expect(pastRes.json().errors.details[0].message).toContain('ngày đã qua');

    // Cố tạo hỗ trợ liên chi nhánh ngày cách xa 3 tuần
    const futureRes = await app.inject({
      method: 'POST',
      url: '/api/admin/shift-swaps',
      headers: hrHeaders,
      payload: {
        kind: 'HR_SUPPORT',
        target_branch_id: branch2.id,
        work_date: '2026-12-30',
        shift_code: 'CA_SANG',
        requester_id: db.employees.all()[0]!.id,
        reason: 'Quá xa',
      },
    });
    expect(futureRes.statusCode).toBe(400);
    expect(futureRes.json().errors.details[0].message).toContain('tuần hiện tại hoặc tuần kế tiếp');
  });
});
