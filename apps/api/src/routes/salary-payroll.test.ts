import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PIN } from '../data/memory-seed.js';
import { buildTestApp, type TestAppContext } from '../test-utils/build-test-app.js';

let t: TestAppContext;
let fin: Awaited<ReturnType<TestAppContext['loginHeaders']>>;
const empByCode = (code: string) => t.db.employees.find((e) => e.employee_code === code)!;

beforeAll(async () => {
  t = await buildTestApp('s');
  fin = await t.loginHeaders('finance');
});
afterAll(async () => {
  await t.app.close();
});

describe('Hồ sơ lương CÁ NHÂN theo từng nhân sự (FIN-05, AI-TAB-42)', () => {
  it('Danh sách hồ sơ lương trả mức riêng từng người kèm lương thử việc theo %', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/payroll/salary-profiles?per_page=50', headers: fin });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((r: { employeeCode: string }) => r.employeeCode === 'NV0001');
    expect(row.profile.amountVnd).toBe(28000);
    expect(row.profile.probationPercent).toBe(85);
    expect(row.profile.probationAmountVnd).toBe(23800);
    expect(res.json().meta.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it('Phân quyền: HR không được sửa lương, MKT không được xem lương', async () => {
    const hr = await t.loginHeaders('hr');
    const mkt = await t.loginHeaders('mkt');
    const denied = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/salary-profiles', headers: hr, payload: { employee_id: empByCode('NV0002').id, rate_type: 'HOURLY', amount_vnd: 31000 } });
    expect(denied.statusCode).toBe(403);
    const mktRes = await t.app.inject({ method: 'GET', url: '/api/admin/payroll/salary-profiles', headers: mkt });
    expect(mktRes.statusCode).toBe(403);
  });

  it('Validation: sai đơn vị lương và ngày hiệu lực trước mức hiện hành bị từ chối theo từng trường', async () => {
    const id = empByCode('NV0002').id;
    const wrongUnit = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/salary-profiles', headers: fin, payload: { employee_id: id, rate_type: 'HOURLY', amount_vnd: 8_000_000, effective_from: '2026-12-01' } });
    expect(wrongUnit.statusCode).toBe(400);
    expect(wrongUnit.json().errors.details[0]).toMatchObject({ field: 'amount_vnd', code: 'OUT_OF_RANGE', rejected_value: 8_000_000 });
    const early = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/salary-profiles', headers: fin, payload: { employee_id: id, rate_type: 'HOURLY', amount_vnd: 32000, effective_from: '2026-07-01' } });
    expect(early.statusCode).toBe(400);
    expect(early.json().errors.details[0].field).toBe('effective_from');
  });

  it('Điều chỉnh lương tạo mức mới có hiệu lực và đóng mức cũ (không ghi đè lịch sử)', async () => {
    const id = empByCode('NV0002').id;
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/salary-profiles', headers: fin, payload: { employee_id: id, rate_type: 'HOURLY', amount_vnd: 32000, effective_from: '2026-11-01', change_reason: 'Tăng lương định kỳ' } });
    expect(res.statusCode).toBe(201);
    const history = await t.app.inject({ method: 'GET', url: `/api/admin/employees/${id}/salary-profiles`, headers: fin });
    const rows = history.json().data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amountVnd: 32000, effectiveFrom: '2026-11-01' });
    expect(rows[1]).toMatchObject({ amountVnd: 30000, effectiveTo: '2026-10-31' });
  });

  it('Tiếp nhận nhân sự mới kèm hồ sơ lương tháng ban đầu', async () => {
    const hr = await t.loginHeaders('hr');
    const branchId = empByCode('NV0001').branch_id;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers: hr,
      payload: { full_name: 'Lý Văn Lương Tháng', phone_number: '0901000099', branch_id: branchId, probation_start: '2026-10-01', salary: { rate_type: 'MONTHLY', amount_vnd: 9_000_000, probation_percent: 90 } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ salaryRateType: 'MONTHLY', salaryOfficialAmountVnd: 9_000_000, salaryProbationPercent: 90, salaryEffectiveAmountVnd: 8_100_000 });
  });
});

describe('Kỳ lương 5 bước, Snapshot, Phiếu lương & Điều chỉnh (AI-INFRA-10, FIN-04..09)', () => {
  let periodId = '';
  let period: { id: string; version: number; status: string };

  it('Tạo kỳ lương tự tính theo hồ sơ lương cá nhân và công đã phát hành', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/periods', headers: fin, payload: { name: 'Kỳ lương tháng 10/2026', from_date: '2026-10-01', to_date: '2026-10-31' } });
    expect(res.statusCode).toBe(201);
    period = res.json().data;
    periodId = period.id;
    const snaps = (await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/snapshots`, headers: fin })).json().data.snapshots;
    const nv1 = snaps.find((s: { employeeCode: string }) => s.employeeCode === 'NV0001');
    expect(nv1).toMatchObject({ probationHours: 5, probationRateVnd: 23800, probationPayVnd: 119000, mealAllowanceVnd: 15000, attendanceBonusVnd: 300000, netVnd: 434000 });
    const nv2 = snaps.find((s: { employeeCode: string }) => s.employeeCode === 'NV0002');
    expect(nv2).toMatchObject({ officialHours: 5, officialPayVnd: 150000, netVnd: 465000 });
    const overlap = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/periods', headers: fin, payload: { name: 'Kỳ trùng', from_date: '2026-10-15', to_date: '2026-11-15' } });
    expect(overlap.statusCode).toBe(400);
  });

  it('Đối soát ca thiếu Vào/Ra tính toàn bộ ca chưa hoàn thành trong kỳ (kể cả ngày cuối kỳ 31/10) và tự động cập nhật ngay khi HR xóa ca', async () => {
    const hr = await t.loginHeaders('hr');
    const nv1 = empByCode('NV0001');
    const createdShift = await t.app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: hr,
      payload: { employee_id: nv1.id, branch_id: nv1.branch_id, work_date: '2026-10-31', shift_code: 'CA_CHIEU', status: 'PUBLISHED', day_type: 'WORK', scheduled_hours: 5 },
    });
    expect(createdShift.statusCode).toBe(201);
    const shiftId = createdShift.json().data.id;

    const snapsBefore = (await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/snapshots`, headers: fin })).json().data.snapshots;
    const nv1Before = snapsBefore.find((s: { employeeCode: string }) => s.employeeCode === 'NV0001');
    expect(nv1Before.missingCheckoutCount).toBe(2);
    expect(nv1Before.missingShifts).toHaveLength(2);
    expect(nv1Before.missingShifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-10-31', shiftCode: 'CA_CHIEU', issueType: 'ABSENT' }),
        expect.objectContaining({ date: '2026-10-24', shiftCode: 'CA_SANG', issueType: 'MISSING_CHECKOUT', pendingAdjustmentCode: 'ADJ-0001' }),
      ]),
    );

    const delRes = await t.app.inject({ method: 'DELETE', url: `/api/admin/schedules/${shiftId}`, headers: hr, payload: { version: 1 } });
    expect(delRes.statusCode).toBe(200);

    const snapsAfter = (await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/snapshots`, headers: fin })).json().data.snapshots;
    const nv1After = snapsAfter.find((s: { employeeCode: string }) => s.employeeCode === 'NV0001');
    expect(nv1After.missingCheckoutCount).toBe(1);
    expect(nv1After.missingShifts).toHaveLength(1);
    expect(nv1After.missingShifts[0]).toMatchObject({ date: '2026-10-24', shiftCode: 'CA_SANG', issueType: 'MISSING_CHECKOUT' });
  });

  it('Máy trạng thái chặn nhảy bước và khóa khoản mục sau khi phê duyệt', async () => {
    const jump = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/transition`, headers: fin, payload: { version: period.version, target_status: 'PUBLISHED' } });
    expect(jump.statusCode).toBe(400);
    expect(jump.json().errors.details[0].field).toBe('target_status');
    const nv1 = empByCode('NV0001');
    const item = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/items', headers: fin, payload: { period_id: periodId, employee_id: nv1.id, item_type: 'BONUS_KPI', title: 'Thưởng KPI tháng 10', quantity: 1, unit_amount_vnd: 200000 } });
    expect(item.statusCode).toBe(201);
    for (const target of ['RECONCILE', 'APPROVED']) {
      const latest = t.db.payPeriods.get(periodId)!;
      const tr = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/transition`, headers: fin, payload: { version: latest.version, target_status: target } });
      expect(tr.statusCode).toBe(200);
    }
    const locked = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/items', headers: fin, payload: { period_id: periodId, employee_id: nv1.id, item_type: 'BONUS_KPI', title: 'Thưởng sau duyệt', unit_amount_vnd: 100000 } });
    expect(locked.statusCode).toBe(409);
    const profileId = t.db.payRates.find((r) => r.employee_id === nv1.id)!;
    const editLocked = await t.app.inject({ method: 'PUT', url: `/api/admin/payroll/salary-profiles/${profileId.id}`, headers: fin, payload: { version: profileId.version, amount_vnd: 29000 } });
    expect(editLocked.statusCode).toBe(409);
  });

  it('Phát hành sinh phiếu lương; nhân viên chỉ xem phiếu của chính mình', async () => {
    const latest = t.db.payPeriods.get(periodId)!;
    const pub = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/transition`, headers: fin, payload: { version: latest.version, target_status: 'PUBLISHED' } });
    expect(pub.statusCode).toBe(200);
    const slips = (await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${periodId}/payslips`, headers: fin })).json().data;
    expect(slips.length).toBe(t.db.payrollSnapshots.filter((s) => s.period_id === periodId).length);

    const { cookie } = await t.login('0901000001', DEMO_PIN, 'employee');
    const nvHeaders = { cookie, 'x-umbm-client': 'web' };
    const mine = (await t.app.inject({ method: 'GET', url: '/api/me/payslips', headers: nvHeaders })).json().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ employeeCode: 'NV0001', netVnd: 634000 });
    const other = slips.find((s: { employeeCode: string }) => s.employeeCode === 'NV0002');
    const forbidden = await t.app.inject({ method: 'GET', url: `/api/me/payslips/${other.id}`, headers: nvHeaders });
    expect(forbidden.statusCode).toBe(403);
  });

  it('Sai lệch sau phát hành tạo phiếu điều chỉnh mới, giữ nguyên phiếu gốc, rồi thanh toán', async () => {
    const original = t.db.payslips.find((p) => p.period_id === periodId && p.employee_code === 'NV0002')!;
    const rev = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/payslips/${original.id}/revisions`, headers: fin, payload: { version: original.version, delta_vnd: 50000, reason: 'Bổ sung giờ công bị sót' } });
    expect(rev.statusCode).toBe(201);
    expect(rev.json().data).toMatchObject({ revision: 2, netVnd: original.net_vnd + 50000 });
    expect(t.db.payslips.get(original.id)!).toMatchObject({ status: 'REVISED', net_vnd: original.net_vnd });
    const latest = t.db.payPeriods.get(periodId)!;
    const paid = await t.app.inject({ method: 'POST', url: `/api/admin/payroll/periods/${periodId}/transition`, headers: fin, payload: { version: latest.version, target_status: 'PAID' } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().data.status).toBe('PAID');
  });

  it('Điều chỉnh trực tiếp từ Snapshot trên Bảng lương khi kỳ đang DRAFT / RECONCILE không bị lỗi 404 và lưu lịch sử đầy đủ', async () => {
    const novRes = await t.app.inject({ method: 'POST', url: '/api/admin/payroll/periods', headers: fin, payload: { name: 'Kỳ lương tháng 11/2026', from_date: '2026-11-01', to_date: '2026-11-30' } });
    expect(novRes.statusCode).toBe(201);
    const novId = novRes.json().data.id;
    const snaps = (await t.app.inject({ method: 'GET', url: `/api/admin/payroll/periods/${novId}/snapshots`, headers: fin })).json().data.snapshots;
    const nv2Snap = snaps.find((s: { employeeCode: string }) => s.employeeCode === 'NV0002');
    const beforeNet = nv2Snap.netVnd;

    const adjAdd = await t.app.inject({
      method: 'POST',
      url: `/api/admin/payroll/payslips/${nv2Snap.id}/revisions`,
      headers: fin,
      payload: { delta_vnd: 150000, reason: 'Thưởng hỗ trợ tăng cường chi nhánh' },
    });
    expect(adjAdd.statusCode).toBe(201);
    expect(adjAdd.json().data).toMatchObject({ netVnd: beforeNet + 150000, revision: 1 });

    const adjDed = await t.app.inject({
      method: 'POST',
      url: `/api/admin/payroll/payslips/${nv2Snap.id}/revisions`,
      headers: fin,
      payload: { delta_vnd: -50000, reason: 'Khấu trừ tạm ứng đồng phục' },
    });
    expect(adjDed.statusCode).toBe(201);
    expect(adjDed.json().data).toMatchObject({ netVnd: beforeNet + 100000, revision: 2 });

    const revs = await t.app.inject({ method: 'GET', url: `/api/admin/payroll/payslips/${nv2Snap.id}/revisions`, headers: fin });
    expect(revs.statusCode).toBe(200);
    expect(revs.json().data).toHaveLength(2);
  });
});
