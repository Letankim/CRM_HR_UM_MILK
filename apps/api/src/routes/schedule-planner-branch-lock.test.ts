import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mondayOfWeek } from '@umbm/shared';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');

beforeAll(async () => { t = await buildTestApp('planner-branch-lock'); });
afterAll(async () => { await t.app.close(); });

describe('Schedule Planner — Xem trước Lưới Lịch Tuần theo chi nhánh & Chế độ chỉ xem khi đã chốt', () => {
  it('Chốt riêng từng chi nhánh: chi nhánh đã chốt trả về existingShifts chỉ xem (planned = []), chi nhánh khác vẫn chưa chốt và chốt ALL không sinh trùng ca cũ', async () => {
    const hr = await t.loginHeaders('hr');
    const branches = t.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code));
    expect(branches.length).toBeGreaterThanOrEqual(2);
    const cn1 = branches[0]!, cn2 = branches[1]!;
    const weekStart = mondayOfWeek(day(75));

    // Đảm bảo cả CN1 và CN2 đều có đủ nhân sự chính thức để xếp ca tuần
    for (const [idx, br] of [cn1, cn2].entries()) {
      for (const [sIdx, sc] of (['CA_SANG', 'CA_CHIEU', 'CA_TOI'] as const).entries()) {
        const phone = `091822${idx}${sIdx}99`;
        const res = await t.app.inject({
          method: 'POST', url: '/api/admin/employees', headers: hr,
          payload: { full_name: `NV Chính Thức ${br.code} ${sc}`, phone_number: phone, branch_id: br.id, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: sc, create_account: false },
        });
        expect(res.statusCode).toBe(201);
      }
    }

    // 1. Xem trước chi nhánh 1 trước khi chốt
    const pv1Before = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${cn1.id}`, headers: hr })).json().data;
    expect(pv1Before.isLocked).toBe(false);
    expect(pv1Before.planned.length).toBe(21);
    expect(pv1Before.branchStatuses.some((s: { branchId: string; isLocked: boolean }) => s.branchId === cn1.id && !s.isLocked)).toBe(true);

    // 2. Chốt lịch riêng cho CN1
    const lock1 = (await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: cn1.id } })).json().data;
    expect(lock1.createdCount).toBe(21);
    expect(lock1.alreadyLocked).toBeUndefined();

    // 3. Gọi lại GET trên CN1 đã chốt -> trả về dữ liệu cũ existingShifts (21 ca), planned = [], isLocked = true
    const pv1After = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${cn1.id}`, headers: hr })).json().data;
    expect(pv1After.isLocked).toBe(true);
    expect(pv1After.planned).toEqual([]);
    expect(pv1After.issues).toEqual([]);
    expect(pv1After.existingShifts.length).toBe(21);
    expect(pv1After.summary.existingCount).toBe(21);

    // 4. Bấm chốt lại lần nữa trên CN1 đã chốt -> không sinh thêm bất kỳ ca nào (alreadyLocked = true)
    const lock1Again = (await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: cn1.id } })).json().data;
    expect(lock1Again.alreadyLocked).toBe(true);
    expect(lock1Again.createdCount).toBe(0);

    // 5. Trong khi đó CN2 vẫn chưa chốt lịch (isLocked = false, planned = 21 ca)
    const pv2 = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${cn2.id}`, headers: hr })).json().data;
    expect(pv2.isLocked).toBe(false);
    expect(pv2.planned.length).toBe(21);

    // 6. Xem ALL: isLocked = false (vì CN2.. chưa chốt), giữ nguyên 21 existingShifts của CN1
    const pvAllBefore = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=ALL`, headers: hr })).json().data;
    expect(pvAllBefore.isLocked).toBe(false);
    expect(pvAllBefore.existingShifts.filter((s: { branchId: string }) => s.branchId === cn1.id).length).toBe(21);
    expect(pvAllBefore.planned.some((p: { branchId: string }) => p.branchId === cn1.id)).toBe(false);

    // 7. Chốt ALL -> chỉ sinh lịch cho các chi nhánh chưa chốt, không đụng vào 21 ca cũ của CN1
    const lockAll = (await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: weekStart, branch_id: 'ALL' } })).json().data;
    expect(lockAll.createdCount).toBeGreaterThanOrEqual(21);
    const pv1Final = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${cn1.id}`, headers: hr })).json().data;
    expect(pv1Final.existingShifts.length).toBe(21);
    const pvAllAfter = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=ALL`, headers: hr })).json().data;
    expect(pvAllAfter.isLocked).toBe(true);
    expect(pvAllAfter.planned).toEqual([]);
  });
});
