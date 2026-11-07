import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluatePreScreenScores14, normalizePhone, PRE_SCREEN_CRITERIA_14 } from '@umbm/shared';

/** Danh sách 26 cột chuẩn từ Google Form tuyển dụng `FROM_NHAN_VIEN`. */
export const GOOGLE_FORM_26_COLUMNS = [
  'timestamp', 'email', 'full_name', 'gender', 'birth_year', 'education', 'school_or_major',
  'hometown', 'current_address', 'citizen_id', 'phone', 'position', 'employment_type',
  'shift_pref', 'branch_pref', 'can_rotate_branch', 'experience_note', 'fnb_skills',
  'incident_answer', 'commitment_months', 'expected_salary', 'start_date_available',
  'facebook_link', 'source_channel', 'uniform_gps_consent', 'self_intro',
] as const;

export interface ParsedCandidateFormRow {
  source_row: string; timestamp: string; email: string; full_name: string; gender: string;
  birth_year: string; education: string; school_or_major: string; hometown: string;
  current_address: string; citizen_id: string; phone: string; raw_phone: string;
  position: string; staff_group: string; employment_type: string; shift_pref: string;
  raw_shift: string; branch_pref: string; raw_branch: string; can_rotate_branch: string;
  experience_note: string; fnb_skills: string; incident_answer: string; commitment_months: string;
  expected_salary: string; start_date_available: string; facebook_link: string;
  source_channel: string; uniform_gps_consent: string; self_intro: string;
  ai_score_14: number; ai_qualified: boolean; red_flag_reason: string;
  criteria_scores: Record<string, number>;
}

const KEY_ALIASES: Record<string, string[]> = {
  timestamp: ['timestamp', 'dấu thời gian', 'dau thoi gian', 'thời gian gửi'],
  email: ['email', 'địa chỉ email', 'dia chi email'],
  full_name: ['full_name', 'name', 'tên bạn là?', 'ten ban la', 'họ và tên', 'ho va ten'],
  gender: ['gender', 'giới tính của bạn?', 'gioi tinh', 'giới tính'],
  birth_year: ['birth_year', 'date_of_birth', 'năm sinh của bạn?', 'nam sinh', 'năm sinh'],
  education: ['education', 'trình độ học vấn', 'trinh do hoc van', 'học vấn'],
  school_or_major: ['school_or_major', 'school', 'trường đang theo học', 'chuyên ngành'],
  hometown: ['hometown', 'permanent_address', 'quê quán theo cccd?', 'que quan', 'quê quán'],
  current_address: ['current_address', 'nơi ở hiện tại', 'địa chỉ hiện tại'],
  citizen_id: ['citizen_id', 'cccd', 'số cccd', 'cmnd'],
  phone: ['phone', 'phone_number', 'zalo_phone', 'số điện thoại của bạn (số zalo để liên hệ)', 'số điện thoại', 'so dien thoai'],
  position: ['position', 'applied_position', 'vị trí ứng tuyển', 'vi tri ung tuyen'],
  employment_type: ['employment_type', 'hình thức làm việc', 'fulltime/parttime'],
  shift_pref: ['shift_pref', 'em có thể làm ca nào?', 'em co the lam ca nao', 'ca đăng ký', 'ca làm việc'],
  branch_pref: ['branch_pref', 'applied_branch_id', 'branch_id', 'chi nhánh em muốn ứng tuyển (cố định)?', 'chi nhánh em muốn ứng tuyển', 'chi nhanh'],
  can_rotate_branch: ['can_rotate_branch', 'hỗ trợ xoay ca chi nhánh khác', 'xoay chi nhánh'],
  experience_note: ['experience_note', 'experience', 'kinh nghiệm làm việc?', 'kinh nghiem lam viec', 'kinh nghiệm'],
  fnb_skills: ['fnb_skills', 'kỹ năng pha chế', 'ky nang pha che'],
  incident_answer: ['incident_answer', 'situational_answer', 'nếu như ngày mai em có việc đột xuất trùng lịch ca trực', 'việc đột xuất trùng lịch', 'việc đột xuất trùng với lịch ca trực'],
  commitment_months: ['commitment_months', 'commitment', 'gắn bó tối thiểu bao lâu', 'cam kết thời gian'],
  expected_salary: ['expected_salary', 'mức lương mong muốn'],
  start_date_available: ['start_date_available', 'ngày có thể bắt đầu'],
  facebook_link: ['facebook_link', 'facebook', 'gửi link facebook cá nhân của bạn vào đây nhé!', 'link facebook'],
  source_channel: ['source_channel', 'bạn biết tin ứng tuyển qua hình thức nào?', 'nguồn tuyển dụng', 'hình thức nào'],
  uniform_gps_consent: ['uniform_gps_consent', 'đồng phục áo hồng', 'điểm danh gps'],
  self_intro: ['self_intro', 'hr_note', 'giới thiệu ngắn gọn', 'ghi chú'],
};

function pickField(raw: Record<string, unknown>, field: string): string {
  const aliases = KEY_ALIASES[field] ?? [field];
  const entries = Object.entries(raw);
  for (const alias of aliases) {
    const lowerAlias = alias.toLowerCase();
    const found = entries.find(([k]) => {
      const lk = k.trim().toLowerCase();
      return lk === lowerAlias || (lowerAlias.length >= 6 && lk.includes(lowerAlias));
    });
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') {
      return String(found[1]).trim();
    }
  }
  return '';
}

function normalizeShiftCode(raw: string): string {
  const s = raw.toUpperCase();
  if (s.includes('CA_CHIEU') || /CHIỀU|CHIEU|12:00|12H/i.test(raw)) return 'CA_CHIEU';
  if (s.includes('CA_TOI') || /TỐI|TOI|18:00|17:00|18H/i.test(raw)) return 'CA_TOI';
  return 'CA_SANG';
}

function normalizeStaffGroup(raw: string): string {
  const s = raw.toUpperCase();
  if (s.includes('CASHIER') || /THU NGÂN|THU NGAN/i.test(raw)) return 'CASHIER';
  if (s.includes('SERVICE') || /PHỤC VỤ|PHUC VU/i.test(raw)) return 'SERVICE';
  if (s.includes('OFFICE') || /VĂN PHÒNG|NHÂN SỰ|KẾ TOÁN|MARKETING|HR|FINANCE|MKT/i.test(raw)) return 'OFFICE';
  return 'BARISTA';
}

export function resolveBranchFromText(raw: string, branches: { id: string; code: string; name: string; address?: string }[] = []): string {
  const val = raw.trim();
  if (!val) return branches[0]?.id ?? '';
  const direct = branches.find((b) => b.id === val || b.code.toUpperCase() === val.toUpperCase());
  if (direct) return direct.id;
  const codeMatch =
    /VẠN KIẾP|VAN KIEP|BÌNH THẠNH|BINH THANH|CN0?1/i.test(val) ? 'CN01'
    : /TÔ HIẾN THÀNH|TO HIEN THANH|QUẬN 10|Q\.?10|CN0?2/i.test(val) ? 'CN02'
    : /HOÀNG DIỆU|HOANG DIEU|THỦ ĐỨC|THU DUC|CN0?3/i.test(val) ? 'CN03'
    : /TÔN ĐẢN|TON DAN|QUẬN 4|Q\.?4|CN0?4/i.test(val) ? 'CN04'
    : /CỦ CHI|CU CHI|XƯỞNG|XUONG/i.test(val) ? 'XUONG_SX'
    : /ĐẶNG THAI MAI|DANG THAI MAI|PHÚ NHUẬN|PHU NHUAN|VĂN PHÒNG|VAN PHONG/i.test(val) ? 'VAN_PHONG' : '';
  return codeMatch ? (branches.find((b) => b.code.toUpperCase() === codeMatch)?.id ?? codeMatch) : (branches[0]?.id ?? val);
}

const SOUTH_WEST_REGEX = /hồ chí minh|tp\.?\s*hcm|sài gòn|sai gon|bình dương|đồng nai|bà rịa|vũng tàu|tây ninh|bình phước|long an|tiền giang|bến tre|vĩnh long|trà vinh|đồng tháp|an giang|kiên giang|cần thơ|hậu giang|sóc trăng|bạc liêu|cà mau|miền nam|miền tây|mien nam|mien tay/i;

/** Chấm tự động 9 tiêu chí sơ loại (thang 14 điểm, đạt >= 8 điểm) và kiểm tra cờ LOẠI trực tiếp. */
export function scoreCandidateForm14(
  row: Record<string, unknown>,
  branches: { id: string; code: string; name: string; address?: string }[] = [],
  currentYear = 2026,
): ParsedCandidateFormRow {
  const fullName = pickField(row, 'full_name');
  const rawPhone = pickField(row, 'phone'), normalizedPhone = normalizePhone(rawPhone) ?? rawPhone.replace(/\D/g, '');
  const rawShift = pickField(row, 'shift_pref'), rawBranch = pickField(row, 'branch_pref');
  const birthYearStr = pickField(row, 'birth_year'), birthYearMatch = birthYearStr.match(/(19\d{2}|20\d{2})/);
  const birthYearNum = birthYearMatch ? Number(birthYearMatch[1]) : 0, age = birthYearNum > 0 ? currentYear - birthYearNum : 22;
  const experienceNote = pickField(row, 'experience_note'), fnbSkills = pickField(row, 'fnb_skills');
  const incidentAnswer = pickField(row, 'incident_answer'), education = pickField(row, 'education');
  const commitment = pickField(row, 'commitment_months'), fbLink = pickField(row, 'facebook_link');
  const hometown = pickField(row, 'hometown'), citizenId = pickField(row, 'citizen_id'), currentAddress = pickField(row, 'current_address');
  const sourceChannel = pickField(row, 'source_channel') || 'GOOGLE_FORM';
  const rawPos = pickField(row, 'position') || 'Pha chế';

  let baseRedFlag = '';
  if (birthYearNum > 0 && (age < 18 || age > 45)) baseRedFlag = `Vi phạm độ tuổi quy định (sinh năm ${birthYearNum} — ${age} tuổi, yêu cầu 18–45 tuổi)`;
  const c1Name = fullName.trim().split(/\s+/).filter(Boolean).length >= 2 ? 1 : 0;
  const c2Birth = birthYearNum === 0 ? 1 : (birthYearNum <= 2004 && age <= 45 ? 2 : birthYearNum >= 2005 && birthYearNum <= 2008 ? 1 : 0);
  const c3Hometown = SOUTH_WEST_REGEX.test(hometown) || (!hometown && /^0[789]/.test(citizenId)) ? 1 : 0;
  const c4Phone = normalizePhone(rawPhone) ? 1 : 0;
  const c5Edu = /không đi học|chỉ đi làm|đã nghỉ học|đã tốt nghiệp|thpt|12\/12/i.test(education) ? 2 : (education || commitment ? 1 : 0);
  const expCombined = `${experienceNote} ${fnbSkills}`.trim();
  const c6Exp = /pha chế|thu ngân|phục vụ|trà sữa|cà phê|f&b|barista|nhà hàng|quán/i.test(expCombined) ? 2
    : expCombined && !/^(không|chưa|không có kinh nghiệm|chưa có kinh nghiệm|0|none)$/i.test(expCombined) ? 1 : 0;
  const c7Source = /bạn bè|ban be|người quen|nguoi quen|giới thiệu|gioi thieu/i.test(sourceChannel) ? -1 : 1;
  const isFromFormRow = Object.keys(row).some((k) => k.includes('?') || k.toLowerCase().includes('đột xuất'));
  const isIncidentReject = /tự ý nghỉ|bỏ ca|nghỉ luôn|không cần báo|im lặng nghỉ|cứ nghỉ|kệ quản lý|^bỏ trống$/i.test(incidentAnswer) || (isFromFormRow && !incidentAnswer && Object.keys(row).length >= 3);
  const c8Incident = isIncidentReject ? -1 : (incidentAnswer.trim().length >= 3 ? 2 : 0);
  const isFbReject = /drama|châm biếm|cham biem|tiêu cực|tieu cuc/i.test(fbLink);
  const isRealFb = /facebook\.com\/[a-zA-Z0-9._-]+|fb\.com\/[a-zA-Z0-9._-]+/i.test(fbLink) && !/link ảo|link ao/i.test(fbLink);
  const c9Fb = isFbReject ? -1 : (isRealFb ? 2 : 1);

  const autoScores: Record<string, number> = {
    full_name_valid: c1Name, age_valid: c2Birth, hometown_cccd: c3Hometown, zalo_phone: c4Phone,
    education_commitment: c5Edu, fnb_experience: c6Exp, source_channel_score: c7Source,
    incident_handling: c8Incident, facebook_link: c9Fb,
  };
  const manualScores = (typeof row.criteria_scores === 'object' && row.criteria_scores !== null ? row.criteria_scores : {}) as Record<string, unknown>;
  const criteria_scores: Record<string, number> = { ...autoScores };
  for (const c of PRE_SCREEN_CRITERIA_14) {
    if (manualScores[c.key] !== undefined && manualScores[c.key] !== null && !Number.isNaN(Number(manualScores[c.key]))) {
      criteria_scores[c.key] = Number(manualScores[c.key]);
    }
  }
  const eval14 = evaluatePreScreenScores14(criteria_scores, baseRedFlag);

  return {
    source_row: String(row.source_row ?? `GF-${Date.now()}`), timestamp: pickField(row, 'timestamp'),
    email: pickField(row, 'email'), full_name: fullName || 'Ứng viên Google Form',
    gender: pickField(row, 'gender') || 'Khác', birth_year: birthYearMatch ? birthYearMatch[1]! : (birthYearStr || '2003'),
    education, school_or_major: pickField(row, 'school_or_major'), hometown, current_address: currentAddress,
    citizen_id: citizenId, phone: normalizedPhone, raw_phone: rawPhone, position: rawPos,
    staff_group: normalizeStaffGroup(String(row.staff_group ?? rawPos)),
    employment_type: pickField(row, 'employment_type') || 'PART_TIME',
    shift_pref: normalizeShiftCode(rawShift || 'CA_SANG'), raw_shift: rawShift,
    branch_pref: resolveBranchFromText(rawBranch, branches), raw_branch: rawBranch,
    can_rotate_branch: pickField(row, 'can_rotate_branch'), experience_note: experienceNote || fnbSkills,
    fnb_skills: fnbSkills, incident_answer: incidentAnswer, commitment_months: commitment,
    expected_salary: pickField(row, 'expected_salary'), start_date_available: pickField(row, 'start_date_available'),
    facebook_link: fbLink, source_channel: sourceChannel,
    uniform_gps_consent: pickField(row, 'uniform_gps_consent'), self_intro: pickField(row, 'self_intro'),
    ai_score_14: eval14.totalScore14, ai_qualified: eval14.qualified, red_flag_reason: eval14.redFlagReason, criteria_scores,
  };
}

const RSVP_SECRET = process.env.JWT_SECRET || 'umbm-hr-rsvp-jwt-secret-v51';

export function createRsvpToken(payload: { interviewId: string; candidateId?: string }, ttlDays = 7): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const headerB64 = Buffer.from('{"t":"J"}').toString('base64url');
  const bodyB64 = Buffer.from(JSON.stringify({ i: payload.interviewId || payload.candidateId || '', e: exp })).toString('base64url');
  const sig = createHmac('sha256', RSVP_SECRET).update(`${headerB64}.${bodyB64}`).digest('base64url').slice(0, 16);
  return `${headerB64}.${bodyB64}.${sig}`;
}

export function verifyRsvpToken(token: string): { valid: boolean; interviewId?: string; candidateId?: string; expired?: boolean } {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [headerB64, bodyB64, sig] = parts as [string, string, string];
  const fullSig = createHmac('sha256', RSVP_SECRET).update(`${headerB64}.${bodyB64}`).digest('base64url');
  if (sig !== fullSig && sig !== fullSig.slice(0, 16)) return { valid: false };
  try {
    const data = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as { interviewId?: string; i?: string; candidateId?: string; c?: string; exp?: number; e?: number };
    const exp = data.exp ?? data.e;
    if (exp && Math.floor(Date.now() / 1000) > exp) return { valid: false, expired: true };
    const id = data.interviewId ?? data.i;
    return { valid: true, interviewId: id, candidateId: data.candidateId ?? data.c ?? id };
  } catch { return { valid: false }; }
}

export function sendZaloInterviewInvite(params: { phone: string; candidateName: string; branchName: string; startAt: string; meetLink: string; rsvpUrl: string }) {
  const sessionPath = resolve(process.cwd(), process.env.ZALO_SESSION_FILE || '.zalo-session.json');
  const hasSession = existsSync(sessionPath);
  const sessionMeta = hasSession ? (() => { try { return JSON.parse(readFileSync(sessionPath, 'utf8')); } catch { return {}; } })() : {};
  const message = `Chào ${params.candidateName}, Hệ thống Nhân sự Ụm Bò Milk trân trọng mời bạn tham gia phỏng vấn tại ${params.branchName} vào lúc ${params.startAt}. Link Google Meet: ${params.meetLink} — Vui lòng xác nhận tham gia hoặc xin dời lịch tại: ${params.rsvpUrl}`;
  return {
    sent: true, mode: hasSession ? 'ZALO_PERSONAL_SESSION' : 'SIMULATED_ZALO_BOT',
    sessionActive: Boolean(hasSession && sessionMeta), phone: params.phone, friendRequestSent: true,
    message, meetLink: params.meetLink, rsvpUrl: params.rsvpUrl, sentAt: new Date().toISOString(),
  };
}
