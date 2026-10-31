/**
 * Bước 1 — Nhân sự: tạo Hồ sơ nhân sự + Tài khoản (liên kết 2 chiều employee.user_id <-> user.employee_id),
 * Hồ sơ lương cá nhân theo hiệu lực (có lịch sử điều chỉnh lương), Lịch sử chuyển chính thức và Giao bài kiểm tra thử việc.
 * Mỗi chi nhánh có cơ cấu ca trưởng / pha chế / thu ngân / phục vụ, trộn chính thức – thử việc – chờ kích hoạt.
 */
import { STAFF_GROUP_LABELS, SYSTEM_CONFIG } from '@umbm/shared';
import { newId } from '../../src/lib/time.js';
import type { BranchPlan, SeedCtx, StaffPlan } from './context.js';
import { genPerson, genTaxCode, hireDates } from './identity.js';
import { addDays, iso, minIso, sys, type Rec } from './kit.js';

const ROSTER_GROUPS = ['SHIFT_LEADER', 'BARISTA', 'CASHIER', 'SERVICE', 'BARISTA', 'CASHIER', 'SERVICE', 'BARISTA', 'SERVICE', 'CASHIER', 'BARISTA', 'SERVICE'] as const;
const FIXED_STAGE: Record<number, 'OFFICIAL' | 'PROBATION'> = { 0: 'OFFICIAL', 1: 'OFFICIAL', 2: 'PROBATION', 3: 'OFFICIAL', 4: 'OFFICIAL', 5: 'PROBATION' };
const HOURLY_RANGE: Record<string, [number, number]> = { SHIFT_LEADER: [31000, 34000], BARISTA: [26000, 29000], CASHIER: [25000, 27500], SERVICE: [23000, 25000] };

interface StaffFlags { manager?: boolean; pending?: boolean }

export function buildPeople(ctx: SeedCtx): void {
  for (const bp of ctx.branches) {
    if (!bp.storeUserId) addStaff(ctx, bp, 'STORE_MANAGER', 'OFFICIAL', { manager: true });
    for (let i = 0; i < ctx.opts.perBranch; i++) {
      const group = ROSTER_GROUPS[i % ROSTER_GROUPS.length]!;
      const pending = i === ctx.opts.perBranch - 1 && ctx.opts.perBranch >= 4;
      const stage = pending ? 'PROBATION' : FIXED_STAGE[i] ?? (ctx.rng.chance(0.6) ? 'OFFICIAL' : 'PROBATION');
      addStaff(ctx, bp, group, stage, { pending });
    }
  }
}

function nextEmployeeCode(ctx: SeedCtx): string {
  return ctx.pool.take('empcode', () => `NV${String(++ctx.counters.emp).padStart(4, '0')}`, 10_000);
}

function addStaff(ctx: SeedCtx, bp: BranchPlan, group: string, stage: 'OFFICIAL' | 'PROBATION', flags: StaffFlags): void {
  const { rng, pool, today, out } = ctx;
  const branch = bp.branch;
  const person = genPerson(rng, pool, flags.manager ? [1986, 1994] : group === 'SHIFT_LEADER' ? [1995, 2001] : [1999, 2006]);
  const cycle = SYSTEM_CONFIG.defaults.probationCycleDays;
  const dates = flags.pending ? { start: addDays(today, 1), end: addDays(today, cycle), officialFrom: '' } : hireDates(rng, today, stage, cycle);
  const code = nextEmployeeCode(ctx);
  const username = pool.take('username', () => (flags.manager ? `ql.${branch.code.toLowerCase()}` : `nv.${code.toLowerCase()}`));
  const onboardAt = minIso(iso(addDays(dates.start, -1), `${rng.int(9, 16)}:${String(rng.int(0, 59)).padStart(2, '0')}`), ctx.nowIso);
  const nonManagerCount = bp.staff.filter((x) => !x.isManager).length;
  const preferred = flags.manager ? bp.shifts[0]! : bp.shifts[nonManagerCount % bp.shifts.length]!;
  const label = STAFF_GROUP_LABELS[group] ?? group;
  const empId = newId();
  const userId = newId();

  const user: Rec = {
    ...sys(onboardAt, userId), username, phone: person.phone, display_name: person.fullName,
    password_hash: flags.manager ? ctx.pwHash : ctx.pinHash, role: flags.manager ? 'STORE' : stage === 'OFFICIAL' ? 'CHINH_THUC' : 'THU_VIEC',
    permissions_json: '[]', branch_scope: branch.id, employee_id: code, status: flags.pending ? 'PENDING_ACTIVATION' : 'ACTIVE',
    session_version: 1, failed_login_count: 0, locked_until: '',
    last_login_at: flags.pending ? '' : minIso(iso(addDays(today, -rng.int(0, 2)), `${rng.int(6, 21)}:${String(rng.int(0, 59)).padStart(2, '0')}`), ctx.nowIso),
    activated_by: flags.pending ? '' : ctx.adminUserId, activated_at: flags.pending ? '' : minIso(iso(addDays(dates.start, -1), '17:30'), ctx.nowIso),
    revoked_at: '', email: person.email, revoked_by: '', revoke_reason: '',
  };

  const rateType = flags.manager ? 'MONTHLY' : 'HOURLY';
  const [lo, hi] = HOURLY_RANGE[group] ?? [24000, 27000];
  const amount = flags.manager ? rng.step(9_500_000, 12_000_000, 500_000) : rng.step(lo, hi, 500);
  const emp: Rec = {
    ...sys(onboardAt, empId), employee_code: code, full_name: person.fullName, phone: person.phone, branch_id: branch.id,
    staff_group: group, stage, probation_start: dates.start, probation_end: dates.end, official_from: dates.officialFrom,
    status: 'ACTIVE', user_id: userId, candidate_id: '', email: person.email, date_of_birth: person.dob, gender: person.gender,
    citizen_id: person.citizenId, citizen_issue_date: person.citizenIssueDate, permanent_address: person.permanentAddress,
    current_address: person.currentAddress, emergency_contact_name: person.emergencyName, emergency_contact_phone: person.emergencyPhone,
    position_title: label, employment_type: stage === 'PROBATION' ? 'PROBATION' : flags.manager || group === 'SHIFT_LEADER' ? 'FULL_TIME' : 'PART_TIME',
    default_shift_code: preferred.code, probation_cycle_days: cycle, probation_work_days: SYSTEM_CONFIG.defaults.probationWorkDays,
    probation_off_days: SYSTEM_CONFIG.defaults.probationOffDays, resigned_at: '', resign_reason: '', bank_name: person.bankName,
    bank_account_number: person.bankAccount, bank_account_holder: person.bankHolder, tax_code: stage === 'OFFICIAL' ? genTaxCode(rng, pool) : '',
    base_hourly_rate_vnd: rateType === 'HOURLY' ? amount : 0, note: flags.pending ? 'Nhân sự mới tiếp nhận — chờ Quản trị viên kích hoạt tài khoản' : '',
  };

  out.users.push(user);
  out.employees.push(emp);
  addSalaryProfiles(ctx, emp, rateType, amount, group, flags, onboardAt);
  if (stage === 'OFFICIAL' && !flags.pending) addPromotionHistory(ctx, emp, preferred.code);
  if (stage === 'PROBATION' && !flags.pending && ctx.testId) addTestAssignment(ctx, emp);

  const plan: StaffPlan = {
    emp, user, branchId: branch.id, stage, officialFrom: dates.officialFrom, startDate: dates.start,
    weeklyOff: flags.manager ? 0 : rng.int(0, 6), preferredShift: preferred.code,
    workRatio: stage === 'PROBATION' ? 0.62 : 1, isManager: Boolean(flags.manager), pending: Boolean(flags.pending),
  };
  bp.staff.push(plan);
  if (flags.manager) { bp.storeUserId = userId; bp.storeUserName = person.fullName; }
}

function addSalaryProfiles(ctx: SeedCtx, emp: Rec, rateType: 'HOURLY' | 'MONTHLY', amount: number, group: string, flags: StaffFlags, createdAt: string): void {
  const { rng, today } = ctx;
  const base = {
    employee_id: emp.id, rate_type: rateType, approved_by: ctx.hrUserId, stage: emp.stage, staff_group: group,
    ot_multiplier: SYSTEM_CONFIG.defaults.overtimeMultiplier, night_shift_allowance_vnd: 0,
    attendance_bonus_vnd: flags.manager ? 0 : rng.pick([200_000, 300_000]), meal_allowance_per_shift_vnd: flags.manager ? 0 : rng.pick([15_000, 20_000]),
    transport_allowance_vnd: rng.chance(0.3) ? 150_000 : 0, responsibility_allowance_vnd: flags.manager ? 1_000_000 : group === 'SHIFT_LEADER' ? 500_000 : 0,
    other_allowance_vnd: 0, probation_percent: rng.pick([85, 85, 85, 80, 90]), standard_work_days: SYSTEM_CONFIG.defaults.standardWorkDaysPerMonth,
    standard_hours_per_day: SYSTEM_CONFIG.defaults.standardHoursPerDay, note: rateType === 'MONTHLY' ? 'Lương tháng cố định, quy đổi theo công chuẩn' : '',
  };
  const officialFrom = String(emp.official_from || '');
  const raiseDate = officialFrom ? addDays(officialFrom, rng.int(45, 120)) : '';
  const canRaise = Boolean(raiseDate) && raiseDate < addDays(today, -10) && rng.chance(0.45);
  if (!canRaise) {
    ctx.out.payRates.push({ ...sys(createdAt), ...base, amount_vnd: amount, effective_from: emp.probation_start, effective_to: '', approved_at: createdAt, status: 'ACTIVE', change_reason: 'Thiết lập lương ban đầu khi tiếp nhận nhân sự', previous_rate_id: '' });
    return;
  }
  const oldId = newId();
  const raisedAt = iso(addDays(raiseDate, -3), '10:15');
  ctx.out.payRates.push({
    ...sys(createdAt, oldId), ...base, version: 2, updated_at: raisedAt, amount_vnd: amount - (rateType === 'HOURLY' ? 2_000 : 1_000_000),
    effective_from: emp.probation_start, effective_to: addDays(raiseDate, -1), approved_at: createdAt, status: 'EXPIRED',
    change_reason: 'Thiết lập lương ban đầu khi tiếp nhận nhân sự', previous_rate_id: '',
  });
  ctx.out.payRates.push({
    ...sys(raisedAt), ...base, amount_vnd: amount, effective_from: raiseDate, effective_to: '', approved_at: raisedAt, status: 'ACTIVE',
    change_reason: 'Điều chỉnh tăng lương theo kết quả đánh giá hiệu suất', previous_rate_id: oldId,
  });
}

function addPromotionHistory(ctx: SeedCtx, emp: Rec, shiftCode: string): void {
  const { rng } = ctx;
  const score = rng.int(82, 98);
  ctx.out.employeeStageHistory.push({
    ...sys(iso(String(emp.official_from), '10:00')), employee_id: emp.id, from_stage: 'PROBATION', to_stage: 'OFFICIAL',
    effective_from: emp.official_from, decided_by: ctx.hrUserId, note: 'Hoàn thành chu kỳ thử việc 12 ngày',
    change_type: 'PROMOTE_OFFICIAL', from_branch_id: emp.branch_id, to_branch_id: emp.branch_id, from_shift_code: shiftCode, to_shift_code: shiftCode,
    probation_hours_completed: rng.int(7, 9) * 5, test_score_percent: score,
    evaluation_summary: `Đạt bài kiểm tra nghiệp vụ ${score}%, thái độ tốt, đảm bảo chuyên cần`, approved_by: ctx.hrUserName,
  });
}

function addTestAssignment(ctx: SeedCtx, emp: Rec): void {
  const openDate = addDays(String(emp.probation_start), 2);
  ctx.out.testAssignments.push({
    ...sys(minIso(iso(openDate, '08:00'), ctx.nowIso)), test_id: ctx.testId, employee_id: emp.id,
    open_at: minIso(iso(openDate, '08:00'), ctx.nowIso), close_at: iso(String(emp.probation_end), '22:00'), assigned_by: ctx.hrUserId,
    status: 'ASSIGNED', branch_id: emp.branch_id, max_attempts: ctx.testMaxAttempts, attempts_used: 0, best_score_percent: 0, passed: false,
    note: 'Bài kiểm tra nghiệp vụ bắt buộc trước khi xét chuyển chính thức',
  });
}
