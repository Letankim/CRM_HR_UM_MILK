import { describe, expect, it } from 'vitest';
import { zEmployee, zPayRate, type Employee, type PayRate } from '@umbm/shared';
import { computeEmployeePayroll, type WorkEntry } from './payroll-calculator.js';

const sys = { id: 'SYS_TEST_00', created_at: '2026-10-01T00:00:00.000Z', created_by: 'test', updated_at: '2026-10-01T00:00:00.000Z', updated_by: '', version: 1, is_deleted: false };
const emp = (over: Partial<Employee>): Employee =>
  zEmployee.parse({ ...sys, id: 'EMP_TEST_01', employee_code: 'NV9001', full_name: 'Nhân sự kiểm thử', stage: 'PROBATION', ...over });
const rate = (over: Partial<PayRate>): PayRate =>
  zPayRate.parse({ ...sys, id: 'RATE_TEST_1', employee_id: 'EMP_TEST_01', rate_type: 'HOURLY', amount_vnd: 28000, probation_percent: 85, effective_from: '2026-10-01', ...over });
const work = (date: string, hours = 5, extra: Partial<WorkEntry> = {}): WorkEntry => ({ assignmentId: date, date, hours, otHours: 0, isSwap: false, ...extra });
const run = (e: Employee, profiles: PayRate[], entries: WorkEntry[], absentCount = 0) =>
  computeEmployeePayroll({ emp: e, profiles, entries, items: [], absentCount, periodToDate: '2026-10-31', swapAllowanceVnd: 30000 });

describe('Bộ tính lương theo Hồ sơ lương cá nhân (FIN-05)', () => {
  it('Thử việc theo giờ hưởng đúng % lương chính thức của riêng nhân sự', () => {
    const r = run(emp({}), [rate({ meal_allowance_per_shift_vnd: 15000 })], [work('2026-10-10'), work('2026-10-11')]);
    expect(r.probationRateVnd).toBe(23800);
    expect(r.probationPay).toBe(238000);
    expect(r.officialPay).toBe(0);
    expect(r.mealVnd).toBe(30000);
  });

  it('Chuyển chính thức giữa kỳ: tách giờ thử việc và giờ chính thức theo ngày hiệu lực', () => {
    const r = run(emp({ official_from: '2026-10-15' }), [rate({})], [work('2026-10-10'), work('2026-10-20')]);
    expect(r.probationPay).toBe(5 * 23800);
    expect(r.officialPay).toBe(5 * 28000);
    expect(r.baseSalary).toBe(259000);
  });

  it('Lương tháng chia theo ngày công thực tế / công chuẩn, thử việc nhân % riêng', () => {
    const monthly = rate({ rate_type: 'MONTHLY', amount_vnd: 7_500_000, standard_work_days: 26 });
    const official = run(emp({ stage: 'OFFICIAL' }), [monthly], [work('2026-10-10'), work('2026-10-11')]);
    expect(official.officialPay).toBe(Math.round((7_500_000 / 26) * 2));
    const probation = run(emp({}), [monthly], [work('2026-10-10'), work('2026-10-10', 3), work('2026-10-11')]);
    expect(probation.workedDays).toBe(2);
    expect(probation.probationPay).toBe(Math.round(((7_500_000 * 0.85) / 26) * 2));
  });

  it('Điều chỉnh lương có hiệu lực giữa kỳ áp dụng đúng đơn giá theo từng ngày', () => {
    const a = rate({ id: 'RATE_TEST_A', amount_vnd: 28000, effective_to: '2026-10-14', status: 'EXPIRED' });
    const b = rate({ id: 'RATE_TEST_B', amount_vnd: 32000, effective_from: '2026-10-15' });
    const r = run(emp({ stage: 'OFFICIAL' }), [b, a], [work('2026-10-10'), work('2026-10-20')]);
    expect(r.officialPay).toBe(5 * 28000 + 5 * 32000);
    expect(r.segments).toHaveLength(2);
  });

  it('Tăng ca, phụ cấp đổi ca và thưởng chuyên cần chỉ khi không vắng mặt', () => {
    const p = rate({ amount_vnd: 30000, attendance_bonus_vnd: 300000, ot_multiplier: 1.5 });
    const ok = run(emp({ stage: 'OFFICIAL' }), [p], [work('2026-10-10', 5, { isSwap: true }), work('2026-10-11', 0, { otHours: 2 })]);
    expect(ok.otPay).toBe(90000);
    expect(ok.swapPay).toBe(30000);
    expect(ok.attendanceBonus).toBe(300000);
    const absent = run(emp({ stage: 'OFFICIAL' }), [p], [work('2026-10-10')], 1);
    expect(absent.attendanceBonus).toBe(0);
  });

  it('Thiết lập lương ban đầu giữa kỳ tự bao phủ cả các ca đầu kỳ, nhưng hồ sơ trống hoặc đã hết hạn được đánh dấu đối soát', () => {
    const initialMidMonth = run(emp({}), [rate({ effective_from: '2026-10-29' })], [work('2026-10-10'), work('2026-10-20')]);
    expect(initialMidMonth.missingProfileShifts).toBe(0);
    expect(initialMidMonth.probationHours).toBe(10);
    expect(initialMidMonth.primaryProfile?.id).toBe('RATE_TEST_1');

    const noShiftWithScheduledProfile = run(emp({}), [rate({ effective_from: '2026-11-01' })], []);
    expect(noShiftWithScheduledProfile.primaryProfile?.id).toBe('RATE_TEST_1');

    const expiredOnly = run(emp({}), [rate({ effective_from: '2026-10-01', effective_to: '2026-10-14', status: 'EXPIRED' })], [work('2026-10-10'), work('2026-10-20')]);
    expect(expiredOnly.missingProfileShifts).toBe(1);
    expect(expiredOnly.probationHours).toBe(5);

    const noProfile = run(emp({}), [], [work('2026-10-10')]);
    expect(noProfile.missingProfileShifts).toBe(1);
    expect(noProfile.primaryProfile).toBeUndefined();
  });
});
