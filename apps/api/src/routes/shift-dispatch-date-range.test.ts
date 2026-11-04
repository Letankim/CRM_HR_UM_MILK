import { describe, expect, it } from 'vitest';
import { isShiftTimePassed, validateDispatchDateRange } from '@umbm/shared';
import { buildTestApp } from '../test-utils/build-test-app.js';
import { APP_TZ, dayjs, todayLocal } from '../lib/time.js';

describe('Rà soát ngày điều phối khẩn cấp & hỗ trợ liên chi nhánh', () => {
  it('validateDispatchDateRange kiểm tra chính xác các mốc: quá khứ, tuần hiện tại, tuần kế tiếp từ Thứ 6', () => {
    const wednesday = '2026-11-04';
    expect(validateDispatchDateRange('2026-11-03', wednesday)).toEqual({
      valid: false,
      message: 'Không được phép tạo lệnh điều phối cho ngày đã qua',
    });
    expect(validateDispatchDateRange('2026-11-04', wednesday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-06', wednesday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-08', wednesday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-09', wednesday)).toEqual({
      valid: false,
      message: 'Chỉ được phép tạo lệnh điều phối cho tuần kế tiếp khi hôm nay là Thứ 6, Thứ 7 hoặc Chủ nhật',
    });
    expect(validateDispatchDateRange('2026-11-20', wednesday)).toEqual({
      valid: false,
      message: 'Chỉ được phép tạo lệnh điều phối cho tuần hiện tại hoặc tuần kế tiếp (mở từ Thứ 6)',
    });

    const friday = '2026-11-06';
    expect(validateDispatchDateRange('2026-11-09', friday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-15', friday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-16', friday).valid).toBe(false);

    const saturday = '2026-11-07', sunday = '2026-11-08';
    expect(validateDispatchDateRange('2026-11-10', saturday).valid).toBe(true);
    expect(validateDispatchDateRange('2026-11-11', sunday).valid).toBe(true);
  });

  it('isShiftTimePassed kiểm tra chính xác ca đã kết thúc trong ngày', () => {
    const today = '2026-11-04';
    // Ca sáng 07:00-12:00 khi hiện tại là 13:00 -> đã qua giờ
    expect(isShiftTimePassed(today, '12:00', today, '13:00')).toBe(true);
    // Ca sáng 07:00-12:00 khi hiện tại là 11:30 -> chưa qua
    expect(isShiftTimePassed(today, '12:00', today, '11:30')).toBe(false);
    // Ca chiều 12:00-17:00 khi hiện tại là 13:00 -> chưa qua (đang diễn ra)
    expect(isShiftTimePassed(today, '17:00', today, '13:00')).toBe(false);
    // Ca tối 17:00-22:30 khi hiện tại là 23:00 -> đã qua
    expect(isShiftTimePassed(today, '22:30', today, '23:00')).toBe(true);
    // Ngày trong quá khứ -> luôn là đã qua
    expect(isShiftTimePassed('2026-11-03', '12:00', today, '08:00')).toBe(true);
    // Ngày trong tương lai -> chưa qua
    expect(isShiftTimePassed('2026-11-05', '12:00', today, '23:59')).toBe(false);
  });

  it('API POST /api/admin/shift-swaps từ chối khi ngày hoặc khung ca đã qua giờ', async () => {
    const { app, db, loginHeaders } = await buildTestApp('date_range_test');
    const hrHeaders = await loginHeaders('hr');
    const branch1 = db.branches.all()[0]!, branch2 = db.branches.all()[1]!;
    const today = todayLocal();

    // 1. Cố tạo lệnh điều phối ngày quá khứ
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

    // 2. Thêm ca mẫu có end_time là 00:01 (đã kết thúc so với mọi giờ trong ngày)
    await db.shiftTemplates.insert({
      shift_group: 'STORE',
      code: 'CA_EXPIRED',
      name: 'Ca đã hết hạn',
      start_time: '00:00',
      end_time: '00:01',
      standard_hours: 1,
      break_minutes: 0,
      effective_from: '2026-01-01',
      effective_to: '',
      is_overnight: false,
      status: 'ACTIVE',
    }, 'system');

    // Nếu giờ hiện tại >= 00:01 thì ca này chắc chắn đã hết hạn
    const nowHm = dayjs().tz(APP_TZ).format('HH:mm');
    if (nowHm >= '00:01') {
      const expiredRes = await app.inject({
        method: 'POST',
        url: '/api/admin/shift-swaps',
        headers: hrHeaders,
        payload: {
          kind: 'HR_DISPATCH',
          branch_id: branch1.id,
          work_date: today,
          shift_code: 'CA_EXPIRED',
          reason: 'Ca đã qua giờ',
        },
      });
      expect(expiredRes.statusCode).toBe(400);
      expect(expiredRes.json().errors.details[0].message).toContain('đã kết thúc');
    }

    // 3. Cố tạo hỗ trợ liên chi nhánh ngày cách xa 3 tuần
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
