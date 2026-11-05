import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { buildTestApp } from '../test-utils/build-test-app.js';
import { sweepExpiredShiftSwaps } from '../services/shift-swap-sweep.service.js';

describe('Quét và tự động chuyển trạng thái ca khẩn cấp / đổi ca quá hạn (sweepExpiredShiftSwaps)', () => {
  it('tự động chuyển trạng thái từ PENDING_PEER sang EXPIRED khi ca làm việc đã kết thúc trong quá khứ', async () => {
    const { app, db, loginHeaders } = await buildTestApp('swap_sweep');
    const hrHeaders = await loginHeaders('hr');

    const branch = db.branches.all()[0]!;
    const pastDate = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
    const futureDate = dayjs().add(2, 'day').format('YYYY-MM-DD');

    // 1. Tạo 1 ca khẩn cấp đã kết thúc (ngày trong quá khứ)
    const pastSwap = await db.shiftSwaps.insert({
      swap_code: 'DSP-TEST-PAST', kind: 'HR_DISPATCH', requires_hr_approval: false,
      branch_id: branch.id, target_branch_id: '',
      from_work_date: pastDate, from_shift_code: 'CA_SANG',
      to_work_date: pastDate, to_shift_code: 'CA_SANG',
      status: 'PENDING_PEER', reason: 'Ca điều phối khẩn cấp ngày hôm trước',
      requester_id: '', peer_id: '', from_assignment_id: '', to_assignment_id: '',
      has_conflict: false, staffing_valid: true, requested_at: '2026-11-01T09:00:00Z',
      peer_responded_at: '', peer_note: '', decided_by: '',
      decision_reason: '', decided_at: '', allowance_eligible: true, allowance_amount_vnd: 30000,
    }, 'test');

    // 2. Tạo 1 ca khẩn cấp tương lai (chưa quá hạn)
    const futureSwap = await db.shiftSwaps.insert({
      swap_code: 'DSP-TEST-FUTURE', kind: 'HR_DISPATCH', requires_hr_approval: false,
      branch_id: branch.id, target_branch_id: '',
      from_work_date: futureDate, from_shift_code: 'CA_SANG',
      to_work_date: futureDate, to_shift_code: 'CA_SANG',
      status: 'PENDING_PEER', reason: 'Ca điều phối khẩn cấp ngày tới',
      requester_id: '', peer_id: '', from_assignment_id: '', to_assignment_id: '',
      has_conflict: false, staffing_valid: true, requested_at: '2026-11-01T09:00:00Z',
      peer_responded_at: '', peer_note: '', decided_by: '',
      decision_reason: '', decided_at: '', allowance_eligible: true, allowance_amount_vnd: 30000,
    }, 'test');

    // 3. Thực hiện quét
    const res = await sweepExpiredShiftSwaps({ db, realtime: () => null } as any, 'system-test');
    expect(res.expiredCount).toBeGreaterThanOrEqual(1);
    expect(res.expiredIds).toContain(pastSwap.id);
    expect(res.expiredIds).not.toContain(futureSwap.id);

    // 4. Kiểm tra trạng thái đã chuyển sang EXPIRED
    const updatedPast = db.shiftSwaps.get(pastSwap.id)!;
    expect(updatedPast.status).toBe('EXPIRED');
    expect(updatedPast.decision_reason).toContain('Tự động đóng do ca làm việc đã quá hạn');

    // 5. Ca tương lai vẫn giữ PENDING_PEER
    const updatedFuture = db.shiftSwaps.get(futureSwap.id)!;
    expect(updatedFuture.status).toBe('PENDING_PEER');

    // 6. Gọi GET /api/admin/shift-swaps trả về đúng trạng thái EXPIRED
    const listRes = await app.inject({ method: 'GET', url: '/api/admin/shift-swaps', headers: hrHeaders });
    expect(listRes.statusCode).toBe(200);
    const item = listRes.json().data.find((s: any) => s.id === pastSwap.id);
    expect(item).toBeDefined();
    expect(item.status).toBe('EXPIRED');
    expect(item.statusLabel).toBe('Đã quá hạn');
  });
});
