import {
  addDaysYmd, formatUbmEmployeeCode, normalizePhone, parseEmployeeCodeSeq,
  SYSTEM_CONFIG, type Candidate, type Employee, type Interview, type User,
} from '@umbm/shared';
import { hashSecret } from '../auth/password.js';
import type { AppContext } from '../context.js';
import { DEMO_PIN } from '../data/memory-seed.js';
import { dayjs, nowIso } from '../lib/time.js';
import { resolveStaffGroupLabel } from '../routes/employee-mapper.js';
import { scoreCandidateForm14, type ParsedCandidateFormRow } from './candidate-form-scorer.js';

export interface OnboardingResult {
  alreadyOnboarded: boolean;
  employee_id: string;
  employee_code: string;
  user_id: string;
  username: string;
  user_status: 'ACTIVE';
  temporary_pin: string;
  probation_cycle_days: number;
  probation_work_days: number;
  probation_off_days: number;
  probation_start: string;
  probation_end: string;
}

export function parseCandidateFormPayload(
  cand: Candidate,
  branches: { id: string; code: string; name: string; address?: string }[] = [],
): ParsedCandidateFormRow {
  let rawStored: Record<string, unknown> = {};
  if (cand.form_payload_json && cand.form_payload_json.trim().startsWith('{')) {
    try { rawStored = JSON.parse(cand.form_payload_json) as Record<string, unknown>; } catch { rawStored = {}; }
  }
  const mergedInput: Record<string, unknown> = {
    ...rawStored,
    source_row: cand.source_row || rawStored.source_row || '',
    full_name: cand.full_name || rawStored.full_name || '',
    phone: cand.phone || rawStored.phone || '',
    email: cand.email || rawStored.email || '',
    gender: cand.gender || rawStored.gender || '',
    birth_year: cand.birth_year || rawStored.birth_year || '',
    position: cand.position || rawStored.position || '',
    staff_group: cand.staff_group || rawStored.staff_group || 'BARISTA',
    shift_pref: cand.shift_pref || rawStored.shift_pref || 'CA_SANG',
    branch_pref: cand.branch_pref || rawStored.branch_pref || '',
    experience_note: cand.experience_note || rawStored.experience_note || '',
    source_channel: cand.source_channel || rawStored.source_channel || 'GOOGLE_FORM',
    self_intro: String(rawStored.self_intro ?? cand.hr_note ?? ''),
  };
  const scored = scoreCandidateForm14(mergedInput, branches);
  return {
    ...scored,
    full_name: cand.full_name || scored.full_name,
    phone: cand.phone || scored.phone,
    email: cand.email || scored.email,
    gender: cand.gender || scored.gender,
    birth_year: cand.birth_year || scored.birth_year,
    branch_pref: cand.branch_pref || scored.branch_pref,
    shift_pref: cand.shift_pref || scored.shift_pref,
    staff_group: cand.staff_group || scored.staff_group,
    position: cand.position || scored.position,
    experience_note: cand.experience_note || scored.experience_note,
    source_channel: cand.source_channel || scored.source_channel,
    ai_score_14: cand.ai_score_14 > 0 ? cand.ai_score_14 : scored.ai_score_14,
    ai_qualified: cand.ai_score_14 > 0 ? cand.ai_qualified : scored.ai_qualified,
    red_flag_reason: cand.red_flag_reason || scored.red_flag_reason,
  };
}

export function buildCandidateFormUpdate(
  input: Record<string, unknown>,
  existing: Candidate | null,
  branches: { id: string; code: string; name: string; address?: string }[] = [],
) {
  const prevPayload = existing ? parseCandidateFormPayload(existing, branches) : ({} as Partial<ParsedCandidateFormRow>);
  const nestedPayload = (typeof input.form_payload === 'object' && input.form_payload !== null ? input.form_payload : {}) as Record<string, unknown>;
  const combined: Record<string, unknown> = {
    ...prevPayload,
    ...nestedPayload,
    ...input,
    full_name: input.full_name ?? existing?.full_name ?? prevPayload.full_name ?? '',
    phone: input.phone ?? existing?.phone ?? prevPayload.phone ?? '',
    email: input.email ?? existing?.email ?? prevPayload.email ?? '',
    gender: input.gender ?? existing?.gender ?? prevPayload.gender ?? 'Khác',
    birth_year: input.birth_year ?? existing?.birth_year ?? prevPayload.birth_year ?? '2004',
    branch_pref: input.applied_branch_id ?? input.branch_pref ?? existing?.branch_pref ?? prevPayload.branch_pref ?? '',
    shift_pref: input.shift_pref ?? existing?.shift_pref ?? prevPayload.shift_pref ?? 'CA_SANG',
    staff_group: input.applied_position ?? input.staff_group ?? existing?.staff_group ?? prevPayload.staff_group ?? 'BARISTA',
    position: input.position ?? existing?.position ?? prevPayload.position ?? '',
    experience_note: input.experience_note ?? existing?.experience_note ?? prevPayload.experience_note ?? '',
    source_channel: input.source_channel ?? existing?.source_channel ?? prevPayload.source_channel ?? 'DIRECT',
    expected_salary: input.expected_salary ?? (input.expected_salary_vnd ? String(input.expected_salary_vnd) : prevPayload.expected_salary ?? ''),
  };
  const scored = scoreCandidateForm14(combined, branches);
  return {
    scored,
    ai_score_14: scored.ai_score_14,
    ai_qualified: scored.ai_qualified,
    red_flag_reason: scored.red_flag_reason,
    form_payload_json: JSON.stringify(scored),
  };
}

/**
 * Mục 2.5: Khi HR duyệt tuyển dụng ứng viên ĐẠT (PASS >= 12/13 điểm):
 * 1. Sinh mã nhân viên duy nhất dạng UBM_NV000001.
 * 2. Tạo bản ghi nhân sự trên NHAN_VIEN_MASTER (EMPLOYEES).
 * 3. Tạo tài khoản đăng nhập trên TAI_KHOAN_NHAN_VIEN (USERS) với trạng thái ACTIVE.
 * 4. Cấp mã PIN 6 số tạm thời và kích hoạt quy chế thử việc 12 ngày (7 công + 5 OFF).
 */
export async function autoOnboardPassedCandidate(
  ctx: AppContext,
  params: { candidate: Candidate; interview: Interview; actorId: string; customPin?: string },
): Promise<OnboardingResult> {
  const { candidate, interview, actorId } = params;
  const validPhone = normalizePhone(candidate.phone) ?? candidate.phone;
  const tempPin = params.customPin && /^\d{6}$/.test(params.customPin) ? params.customPin : DEMO_PIN;
  const probationStart = dayjs().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const probationEnd = addDaysYmd(probationStart, SYSTEM_CONFIG.defaults.probationCycleDays - 1);

  const existingEmp = ctx.db.employees.find(
    (e) => e.candidate_id === candidate.id || Boolean(validPhone && normalizePhone(e.phone) === validPhone),
  );
  if (existingEmp) {
    const linkedUser = (existingEmp.user_id ? ctx.db.users.get(existingEmp.user_id) : undefined)
      ?? ctx.db.users.find((u) => u.employee_id === existingEmp.employee_code || u.phone === validPhone);
    if (linkedUser && linkedUser.status !== 'ACTIVE') {
      await ctx.db.users.update(linkedUser.id, linkedUser.version, { status: 'ACTIVE', activated_by: actorId, activated_at: nowIso() }, actorId);
    }
    return {
      alreadyOnboarded: true, employee_id: existingEmp.id, employee_code: existingEmp.employee_code,
      user_id: linkedUser?.id ?? existingEmp.user_id ?? '', username: linkedUser?.username ?? `nv.${existingEmp.employee_code.toLowerCase()}`,
      user_status: 'ACTIVE', temporary_pin: tempPin,
      probation_cycle_days: existingEmp.probation_cycle_days || SYSTEM_CONFIG.defaults.probationCycleDays,
      probation_work_days: existingEmp.probation_work_days || SYSTEM_CONFIG.defaults.probationWorkDays,
      probation_off_days: existingEmp.probation_off_days || SYSTEM_CONFIG.defaults.probationOffDays,
      probation_start: existingEmp.probation_start || probationStart, probation_end: existingEmp.probation_end || probationEnd,
    };
  }

  const maxSeq = ctx.db.employees.all(true).reduce((m, e) => Math.max(m, parseEmployeeCodeSeq(e.employee_code)), 0);
  const employeeCode = formatUbmEmployeeCode(maxSeq + 1);
  const branchId = interview.branch_id || candidate.branch_pref || ctx.db.branches.all()[0]?.id || 'br_cn01';
  const staffGroup = candidate.staff_group || (interview.rubric_block === 'OFFICE' ? 'OFFICE' : 'BARISTA');
  const positionTitle = candidate.position || resolveStaffGroupLabel(ctx, staffGroup);
  const formPayload = parseCandidateFormPayload(candidate, ctx.db.branches.all());
  const pinHash = await hashSecret(tempPin);
  const baseUsername = `nv.${employeeCode.toLowerCase()}`;
  const username = ctx.db.users.find((u) => u.username === baseUsername) ? `${baseUsername}.${Date.now().toString().slice(-3)}` : baseUsername;

  const existingUserByPhone = validPhone ? ctx.db.users.find((u) => normalizePhone(u.phone) === validPhone) : undefined;
  let userRecord: User;
  if (existingUserByPhone) {
    userRecord = await ctx.db.users.update(existingUserByPhone.id, existingUserByPhone.version, {
      status: 'ACTIVE', employee_id: employeeCode, branch_scope: branchId,
      activated_by: actorId, activated_at: nowIso(),
    }, actorId);
  } else {
    userRecord = await ctx.db.users.insert({
      username, phone: validPhone, display_name: candidate.full_name, password_hash: pinHash,
      role: 'THU_VIEC', permissions_json: '[]', branch_scope: branchId, employee_id: employeeCode,
      status: 'ACTIVE', session_version: 1, failed_login_count: 0, locked_until: '', last_login_at: '',
      activated_by: actorId, activated_at: nowIso(), revoked_at: '', email: candidate.email || '',
      revoked_by: '', revoke_reason: '', must_change_pin: true, pin_changed_at: '',
    }, actorId);
  }

  const birthYear = (candidate.birth_year || formPayload.birth_year || '').match(/(19\d{2}|20\d{2})/)?.[1] || '';
  const empRecord: Employee = await ctx.db.employees.insert({
    employee_code: employeeCode, full_name: candidate.full_name, phone: validPhone,
    email: candidate.email || formPayload.email || '', date_of_birth: birthYear ? `${birthYear}-01-01` : '',
    gender: candidate.gender || formPayload.gender || '', citizen_id: formPayload.citizen_id || '',
    citizen_issue_date: '', permanent_address: formPayload.hometown || '', current_address: formPayload.current_address || '',
    emergency_contact_name: '', emergency_contact_phone: '', branch_id: branchId, staff_group: staffGroup,
    stage: 'PROBATION', probation_start: probationStart, probation_end: probationEnd, official_from: '',
    status: 'ACTIVE', user_id: userRecord.id, candidate_id: candidate.id, position_title: positionTitle,
    employment_type: 'PROBATION', default_shift_code: candidate.shift_pref || 'CA_SANG',
    probation_cycle_days: SYSTEM_CONFIG.defaults.probationCycleDays,
    probation_work_days: SYSTEM_CONFIG.defaults.probationWorkDays,
    probation_off_days: SYSTEM_CONFIG.defaults.probationOffDays,
    tax_code: '', bank_name: '', bank_account_number: '', bank_account_holder: '',
    note: `Khởi tạo tự động từ Phỏng vấn Đạt (${interview.score_13 || 13}/13 điểm)`,
  }, actorId);

  const isOffice = staffGroup === 'OFFICE' || interview.rubric_block === 'OFFICE';
  await ctx.db.payRates.insert({
    employee_id: empRecord.id, rate_type: isOffice ? 'MONTHLY' : 'HOURLY', amount_vnd: isOffice ? 7000000 : 25000,
    effective_from: probationStart, effective_to: '', approved_by: actorId, approved_at: nowIso(),
    stage: 'PROBATION', staff_group: staffGroup, ot_multiplier: 1.5, night_shift_allowance_vnd: 0,
    attendance_bonus_vnd: 0, meal_allowance_per_shift_vnd: 0, transport_allowance_vnd: 0,
    responsibility_allowance_vnd: 0, other_allowance_vnd: 0,
    probation_percent: SYSTEM_CONFIG.defaults.probationSalaryPercent,
    standard_work_days: 26, standard_hours_per_day: 8, status: 'ACTIVE',
    change_reason: 'Hồ sơ lương khởi tạo tự động khi Đạt phỏng vấn', previous_rate_id: '', note: '',
  }, actorId);

  await ctx.db.employeeStageHistory.insert({
    employee_id: empRecord.id, from_stage: 'PROBATION', to_stage: 'PROBATION', effective_from: probationStart,
    decided_by: actorId, note: `Tuyển dụng Đạt phỏng vấn (${employeeCode}) — kích hoạt chu kỳ thử việc 12 ngày`,
    change_type: 'ONBOARD_PROBATION', from_branch_id: branchId, to_branch_id: branchId,
    from_shift_code: empRecord.default_shift_code, to_shift_code: empRecord.default_shift_code,
    probation_hours_completed: 0, test_score_percent: 0, evaluation_summary: interview.comment || 'Đạt phỏng vấn Rubric 13 điểm', approved_by: actorId,
  }, actorId);

  return {
    alreadyOnboarded: false, employee_id: empRecord.id, employee_code: employeeCode,
    user_id: userRecord.id, username: userRecord.username, user_status: 'ACTIVE', temporary_pin: tempPin,
    probation_cycle_days: SYSTEM_CONFIG.defaults.probationCycleDays,
    probation_work_days: SYSTEM_CONFIG.defaults.probationWorkDays,
    probation_off_days: SYSTEM_CONFIG.defaults.probationOffDays,
    probation_start: probationStart, probation_end: probationEnd,
  };
}
