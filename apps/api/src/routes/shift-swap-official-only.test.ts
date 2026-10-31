import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mondayOfWeek } from '@umbm/shared';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs } from '../lib/time.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

describe('Đổi ca & Nhường ca — Chỉ áp dụng cho Nhân viên Chính thức tại cửa hàng', () => {
  let t: TestAppContext;
  const web = { 'x-umbm-client': 'web' };
  const day = (n: number) => dayjs().add(n, 'day').format('YYYY-MM-DD');

  beforeAll(async () => { t = await buildTestApp('swp_official_only'); });
  afterAll(async () => { await t.app.close(); });

  it('Loại hoàn toàn NV Thử việc, tài khoản chưa kích hoạt, Quản trị, HR, Kế toán, Truyền thông, Quản lý CH khỏi branchPeers và chặn cả SWAP lẫn GIVE', async () => {
    const admin = await t.loginHeaders('admin');
    const hr = await t.loginHeaders('hr');
    const store1 = await t.loginHeaders('store1');
    const finance = await t.loginHeaders('finance');
    const mkt = await t.loginHeaders('mkt');

    // Gọi /api/my-attendance bằng toàn bộ tài khoản quản trị/văn phòng/quản lý CH để hệ thống tự sinh hồ sơ cá nhân NV0004..NV0008 (giống thực tế trên production)
    for (const h of [admin, hr, store1, finance, mkt]) {
      const res = await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: h });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.canSwapShift).toBe(false);
    }

    const probEmp = t.db.employees.find((e) => e.employee_code === 'NV0001')!;
    const offEmpA = t.db.employees.find((e) => e.employee_code === 'NV0002')!;

    // Tạo thêm 1 Nhân viên Chính thức hợp lệ cùng chi nhánh (NV chính thức B)
    const createOffB = await t.app.inject({
      method: 'POST', url: '/api/admin/employees', headers: hr,
      payload: {
        full_name: 'Nguyễn Văn Chính Thức B', phone_number: '0918777666',
        branch_id: offEmpA.branch_id, stage: 'OFFICIAL', staff_group: 'BARISTA',
        employment_type: 'FULL_TIME', create_account: true, initial_pin: DEMO_PIN,
      },
    });
    expect(createOffB.statusCode).toBe(201);
    const offEmpBId = createOffB.json().data.id as string;
    const offEmpBCode = createOffB.json().data.employeeCode as string;
    const offUserB = t.db.users.find((u) => u.phone === '0918777666')!;
    await t.app.inject({ method: 'POST', url: '/api/admin/accounts/bulk-action', headers: admin, payload: { action: 'ACTIVATE', items: [{ id: offUserB.id, version: offUserB.version }] } });

    const nvProb = { ...web, cookie: (await t.login('0901000001', DEMO_PIN, 'employee')).cookie };
    const nvOffA = { ...web, cookie: (await t.login('0901000002', DEMO_PIN, 'employee')).cookie };

    // 1. Nhân viên thử việc: canSwapShift = false
    const probMyAtt = (await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: nvProb })).json().data;
    expect(probMyAtt.canSwapShift).toBe(false);

    // 2. Nhân viên chính thức A: canSwapShift = true và branchPeers CHỈ chứa duy nhất NV chính thức B (không có NV0001 Thử việc, NV0003 Mới, Admin, HR, Kế toán, Truyền thông, Quản lý CH)
    const offAMyAtt = (await t.app.inject({ method: 'GET', url: '/api/my-attendance', headers: nvOffA })).json().data;
    expect(offAMyAtt.canSwapShift).toBe(true);
    const peerCodes = (offAMyAtt.branchPeers as { employeeCode: string }[]).map((p) => p.employeeCode);
    expect(peerCodes).toEqual([offEmpBCode]);

    // 3. API danh sách nhân sự (/api/admin/employees) trả đúng cờ canSwapShift
    const empList = (await t.app.inject({ method: 'GET', url: '/api/admin/employees?per_page=100', headers: hr })).json().data as { employeeCode: string; canSwapShift: boolean }[];
    expect(empList.find((e) => e.employeeCode === 'NV0001')?.canSwapShift).toBe(false);
    expect(empList.find((e) => e.employeeCode === 'NV0003')?.canSwapShift).toBe(false);
    expect(empList.find((e) => e.employeeCode === 'NV0002')?.canSwapShift).toBe(true);
    expect(empList.find((e) => e.employeeCode === offEmpBCode)?.canSwapShift).toBe(true);
    for (const bo of empList.filter((e) => !['NV0001', 'NV0002', 'NV0003', offEmpBCode].includes(e.employeeCode))) {
      expect(bo.canSwapShift).toBe(false);
    }

    // 4. Sắp lịch tuần tự động (planOfficialWeek) cũng không xếp nhầm các hồ sơ tài khoản quản trị/văn phòng/quản lý CH
    const weekStart = mondayOfWeek(day(25));
    const planPreview = (await t.app.inject({ method: 'GET', url: `/api/admin/schedule-planner/week?week_start=${weekStart}&branch_id=${offEmpA.branch_id}`, headers: hr })).json().data;
    const plannedCodes = new Set((planPreview.planned as { employeeCode: string }[]).map((p) => p.employeeCode));
    for (const code of plannedCodes) expect(['NV0002', offEmpBCode]).toContain(code);

    // 5. Kiểm tra chặn chặt ở Backend cho cả GIVE và SWAP đối với Thử việc và Quản trị/Quản lý CH
    const probShift = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: probEmp.id, work_date: day(15), shift_code: 'CA_SANG', status: 'PUBLISHED' } })).json().data;
    const offShift = (await t.app.inject({ method: 'POST', url: '/api/admin/schedules', headers: hr, payload: { employee_id: offEmpA.id, work_date: day(16), shift_code: 'CA_CHIEU', status: 'PUBLISHED' } })).json().data;

    // 5a. NV Thử việc không được nhường ca (GIVE) hoặc đổi ca (SWAP) cho NV Chính thức
    const probGive = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvProb, payload: { kind: 'GIVE', requester_id: probEmp.id, peer_id: offEmpA.id, from_assignment_id: probShift.id, reason: 'Thử việc xin nhường ca' } });
    expect(probGive.statusCode).toBe(400);
    expect(probGive.json().errors.details[0].field).toBe('requester_id');

    const probSwap = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvProb, payload: { kind: 'SWAP', requester_id: probEmp.id, peer_id: offEmpA.id, from_assignment_id: probShift.id, to_assignment_id: offShift.id, reason: 'Thử việc xin đổi ca' } });
    expect(probSwap.statusCode).toBe(400);
    expect(probSwap.json().errors.details[0].field).toBe('requester_id');

    // 5b. NV Chính thức không được nhường ca (GIVE) hoặc đổi ca (SWAP) cho NV Thử việc
    const giveToProb = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvOffA, payload: { kind: 'GIVE', requester_id: offEmpA.id, peer_id: probEmp.id, from_assignment_id: offShift.id, reason: 'Nhường ca cho thử việc' } });
    expect(giveToProb.statusCode).toBe(400);
    expect(giveToProb.json().errors.details[0].field).toBe('peer_id');

    // 5c. NV Chính thức không được nhường ca cho hồ sơ Quản lý CH / HR / Admin
    const storeMgrProfile = t.db.employees.find((e) => e.position_title === 'Quản lý cửa hàng')!;
    const giveToMgr = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvOffA, payload: { kind: 'GIVE', requester_id: offEmpA.id, peer_id: storeMgrProfile.id, from_assignment_id: offShift.id, reason: 'Nhường ca cho quản lý CH' } });
    expect(giveToMgr.statusCode).toBe(400);
    expect(giveToMgr.json().errors.details[0].field).toBe('peer_id');

    // 5d. NV Chính thức A nhường ca cho NV Chính thức B cùng chi nhánh -> thành công 201
    const giveToOfficial = await t.app.inject({ method: 'POST', url: '/api/admin/shift-swaps', headers: nvOffA, payload: { kind: 'GIVE', requester_id: offEmpA.id, peer_id: offEmpBId, from_assignment_id: offShift.id, reason: 'Nhường ca cho đồng nghiệp chính thức' } });
    expect(giveToOfficial.statusCode).toBe(201);
  });
});
