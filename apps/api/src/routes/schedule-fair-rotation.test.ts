import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysYmd, mondayOfWeek } from '@umbm/shared';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');

beforeAll(async () => { t = await buildTestApp('fair-rotation'); });
afterAll(async () => { await t.app.close(); });

async function createBranchOfficials(hr: Record<string, string>, branchId: string, prefix: string, shiftCodes: ('CA_SANG' | 'CA_CHIEU' | 'CA_TOI')[]) {
  const ids: string[] = [];
  for (const [idx, sc] of shiftCodes.entries()) {
    const phone = `09${prefix}${String(idx).padStart(2, '0')}88`;
    const res = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hr,
      payload: { full_name: `NV ${prefix} ${sc} #${idx + 1}`, phone_number: phone, branch_id: branchId, stage: 'OFFICIAL', employment_type: 'FULL_TIME', default_shift_code: sc, create_account: false },
    });
    expect(res.statusCode).toBe(201);
    ids.push(res.json().data.id as string);
  }
  return ids;
}

describe('Fair Shift Rotation — Xoay vòng công bằng xuyên tuần trong nội bộ từng nhóm Ca mặc định', () => {
  it('Nhóm 2 người Ca sáng: xoay vòng 4-3 rồi đảo 3-4 ở tuần kế tiếp (cả khi xem trước và sau khi chốt), tổng 2 tuần đều đúng 7 ca và đảo trực Chủ Nhật', async () => {
    const hr = await t.loginHeaders('hr');
    const branches = t.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code));
    const cn2 = branches[1]!;
    for (const e of t.db.employees.filter((x) => x.branch_id === cn2.id && x.stage === 'OFFICIAL')) {
      await t.db.employees.softDelete(e.id, e.version, 'test');
    }
    const [m1, m2] = await createBranchOfficials(hr, cn2.id, '2111', ['CA_SANG', 'CA_SANG', 'CA_CHIEU', 'CA_TOI']);
    const w1 = mondayOfWeek(day(90));
    const w2 = addDaysYmd(w1, 7);

    // 1. Xem trước liên tiếp 2 tuần trước khi chốt: tuần 1 [4,3] -> tuần 2 tự đảo [3,4]
    const pv1 = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${w1}&branch_id=${cn2.id}`, headers: hr })).json().data;
    const pv2BeforeLock = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${w2}&branch_id=${cn2.id}`, headers: hr })).json().data;
    const c1w1 = pv1.planned.filter((p: { employeeId: string }) => p.employeeId === m1).length;
    const c2w1 = pv1.planned.filter((p: { employeeId: string }) => p.employeeId === m2).length;
    const c1w2Pre = pv2BeforeLock.planned.filter((p: { employeeId: string }) => p.employeeId === m1).length;
    const c2w2Pre = pv2BeforeLock.planned.filter((p: { employeeId: string }) => p.employeeId === m2).length;
    expect([c1w1, c2w1].sort()).toEqual([3, 4]);
    expect(c1w1 + c1w2Pre).toBe(7);
    expect(c2w1 + c2w2Pre).toBe(7);

    // 2. Chốt tuần 1 và chốt tuần 2 -> xác nhận dữ liệu thực tế lưu DB tổng 2 tuần mỗi người đúng 7 ca sáng, đảo Chủ Nhật
    await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: w1, branch_id: cn2.id } });
    const pv2AfterLock = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${w2}&branch_id=${cn2.id}`, headers: hr })).json().data;
    const load1 = pv2AfterLock.employeeLoads.find((l: { employeeId: string }) => l.employeeId === m1);
    const load2 = pv2AfterLock.employeeLoads.find((l: { employeeId: string }) => l.employeeId === m2);
    expect(load1.groupSize).toBe(2);
    expect(load1.recent4WeeksShifts + load1.totalWeekShifts).toBe(7);
    expect(load2.recent4WeeksShifts + load2.totalWeekShifts).toBe(7);

    const sun1 = addDaysYmd(w1, 6), sun2 = addDaysYmd(w2, 6);
    await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: w2, branch_id: cn2.id } });
    const sun1Emp = t.db.shiftAssignments.find((a) => a.branch_id === cn2.id && a.work_date === sun1 && a.shift_code === 'CA_SANG')!.employee_id;
    const sun2Emp = t.db.shiftAssignments.find((a) => a.branch_id === cn2.id && a.work_date === sun2 && a.shift_code === 'CA_SANG')!.employee_id;
    expect(sun1Emp).not.toBe(sun2Emp);
  });

  it('Nhóm 3 người Ca sáng xoay vòng 3-2-2 (sau 3 tuần đều 7 ca) & Nhóm 4 người Ca sáng xoay vòng 2-2-2-1 (sau 4 tuần đều 7 ca, không bao giờ nhảy sang Ca chiều / Ca tối)', async () => {
    const hr = await t.loginHeaders('hr');
    const branches = t.db.branches.filter((b) => b.status === 'ACTIVE').sort((a, b) => a.code.localeCompare(b.code));
    const cn3 = branches[2]!, cn4 = branches[3]!;
    for (const b of [cn3, cn4]) {
      for (const e of t.db.employees.filter((x) => x.branch_id === b.id && x.stage === 'OFFICIAL')) {
        await t.db.employees.softDelete(e.id, e.version, 'test');
      }
    }

    // CN3: 3 nhân sự mặc định CA_SANG, 1 CA_CHIEU, 1 CA_TOI -> qua 3 tuần mỗi người CA_SANG đều đúng 7 ca
    const g3 = (await createBranchOfficials(hr, cn3.id, '3222', ['CA_SANG', 'CA_SANG', 'CA_SANG', 'CA_CHIEU', 'CA_TOI'])).slice(0, 3);
    const baseW = mondayOfWeek(day(120));
    const totals3 = new Map<string, number>(g3.map((id) => [id, 0]));
    for (let w = 0; w < 3; w++) {
      const ws = addDaysYmd(baseW, w * 7);
      const pv = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${ws}&branch_id=${cn3.id}`, headers: hr })).json().data;
      const weekDist = g3.map((id) => pv.planned.filter((p: { employeeId: string; shiftCode: string }) => p.employeeId === id && p.shiftCode === 'CA_SANG').length);
      expect([...weekDist].sort()).toEqual([2, 2, 3]);
      g3.forEach((id, i) => totals3.set(id, (totals3.get(id) ?? 0) + weekDist[i]!));
      await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: ws, branch_id: cn3.id } });
    }
    for (const id of g3) expect(totals3.get(id)).toBe(7);

    // CN4: 4 nhân sự mặc định CA_SANG, 0 nhân sự CA_CHIEU, 0 nhân sự CA_TOI -> CHỈ xoay vòng trong CA_SANG (2-2-2-1), tuyệt đối không bị điều sang CA_CHIEU/CA_TOI
    const g4 = await createBranchOfficials(hr, cn4.id, '4333', ['CA_SANG', 'CA_SANG', 'CA_SANG', 'CA_SANG']);
    const totals4 = new Map<string, number>(g4.map((id) => [id, 0]));
    for (let w = 0; w < 4; w++) {
      const ws = addDaysYmd(baseW, w * 7);
      const pv = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${ws}&branch_id=${cn4.id}`, headers: hr })).json().data;
      expect(pv.planned.every((p: { shiftCode: string }) => p.shiftCode === 'CA_SANG')).toBe(true);
      expect(pv.planned.length).toBe(7);
      expect(pv.issues.filter((i: { kind: string; shiftCode: string }) => i.kind === 'UNDERSTAFFED' && i.shiftCode !== 'CA_SANG').length).toBe(14);
      const weekDist = g4.map((id) => pv.planned.filter((p: { employeeId: string }) => p.employeeId === id).length);
      expect([...weekDist].sort()).toEqual([1, 2, 2, 2]);
      g4.forEach((id, i) => totals4.set(id, (totals4.get(id) ?? 0) + weekDist[i]!));
      await t.app.inject({ method: 'POST', url: '/api/admin/schedule-planner/week/lock', headers: hr, payload: { week_start: ws, branch_id: cn4.id } });
    }
    for (const id of g4) expect(totals4.get(id)).toBe(7);
  });
});
