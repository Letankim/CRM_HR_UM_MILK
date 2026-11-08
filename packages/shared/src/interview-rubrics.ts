/**
 * Cấu hình bộ tiêu chí chấm điểm phỏng vấn chuẩn Ụm Bò Milk (Thang 13 điểm):
 * 1) Ứng viên ĐÃ CÓ KINH NGHIỆM (EXPERIENCED / STORE — 9 câu hỏi, tối đa 13 điểm).
 * 2) Ứng viên CHƯA CÓ KINH NGHIỆM (INEXPERIENCED / OFFICE — 7 câu hỏi, tối đa 13 điểm).
 * 3) Ngưỡng xét duyệt: MAXIMUM 13 · PASS >= 12 · CÂN NHẮC ĐẬU 10, 11 · FAIL < 10 hoặc dính LOẠI.
 */

export const INTERVIEW_EXPERIENCE_TRACKS = ['INEXPERIENCED', 'EXPERIENCED'] as const;
export type InterviewExperienceTrack = (typeof INTERVIEW_EXPERIENCE_TRACKS)[number];

export const INTERVIEW_EXPERIENCE_TRACK_LABELS: Record<InterviewExperienceTrack, string> = {
  INEXPERIENCED: 'Ứng viên chưa có kinh nghiệm (7 câu — 13đ)',
  EXPERIENCED: 'Ứng viên đã có kinh nghiệm (9 câu — 13đ)',
};

export const INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS: Record<InterviewExperienceTrack, string> = {
  INEXPERIENCED: 'Chưa có kinh nghiệm',
  EXPERIENCED: 'Đã có kinh nghiệm',
};

export interface InterviewCriterionDef { label: string; weightPercent: number; hint: string }
export interface InterviewRubricDef {
  track: InterviewExperienceTrack; label: string; shortLabel: string; summary: string; defaultComment: string;
  criteria: { appearance: InterviewCriterionDef; attitude: InterviewCriterionDef; skill: InterviewCriterionDef };
}

export const INTERVIEW_RUBRICS: Record<InterviewExperienceTrack, InterviewRubricDef> = {
  INEXPERIENCED: {
    track: 'INEXPERIENCED', label: INTERVIEW_EXPERIENCE_TRACK_LABELS.INEXPERIENCED, shortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS.INEXPERIENCED,
    summary: 'Bộ 7 câu hỏi đánh giá Nhận thức bản thân, Thái độ xử lý tình huống, Ngoại hình & Tư vấn bán hàng (Thang 13 điểm).',
    defaultComment: 'Thái độ tích cực, cầu tiến, khả năng xử lý tình huống tốt — phù hợp tiếp nhận đào tạo thử việc',
    criteria: {
      appearance: { label: 'Ngoại hình & Tác phong (35%)', weightPercent: 35, hint: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng, giọng nói dễ nghe nhẹ nhàng' },
      attitude: { label: 'Thái độ & Tự nhận thức (45%)', weightPercent: 45, hint: 'Khiêm tốn, trung thực nhìn nhận điểm yếu và xử lý tình huống tích cực không đổ lỗi' },
      skill: { label: 'Tư duy Up-sale & Xử lý tình huống (20%)', weightPercent: 20, hint: 'Tư vấn khách mua từ 1 chai lên 5 chai và xử lý khéo léo khi hết vị sữa' },
    },
  },
  EXPERIENCED: {
    track: 'EXPERIENCED', label: INTERVIEW_EXPERIENCE_TRACK_LABELS.EXPERIENCED, shortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS.EXPERIENCED,
    summary: 'Bộ 9 câu hỏi đánh giá Kinh nghiệm thực tế, Thái độ nghề nghiệp, Tính cách hướng ngoại & Kỹ năng tư vấn (Thang 13 điểm).',
    defaultComment: 'Đã có kinh nghiệm thực tế, nắm rõ quy trình làm việc, thái độ tích cực và tư vấn bán hàng tốt',
    criteria: {
      appearance: { label: 'Ngoại hình, Tác phong & Tính cách (25%)', weightPercent: 25, hint: 'Mặt hiền hậu, vui vẻ, giọng nói dễ nghe, tính cách hướng ngoại năng động' },
      attitude: { label: 'Thái độ nghề nghiệp & Lý do nghỉ việc (30%)', weightPercent: 30, hint: 'Trung thực về quy trình cũ, lý do nghỉ việc tích cực không phê phán công ty cũ' },
      skill: { label: 'Quy trình thực chiến & Kỹ năng Up-sale (45%)', weightPercent: 45, hint: 'Trả lời rành mạch quy trình làm việc, xử lý tình huống khó xử và tư vấn Up-sale' },
    },
  },
};

export const INTERVIEW_EXPERIENCE_TRACK_OPTIONS = INTERVIEW_EXPERIENCE_TRACKS.map((value) => ({ value, label: INTERVIEW_EXPERIENCE_TRACK_LABELS[value] }));

export function computeInterviewWeightedScore(track: InterviewExperienceTrack, appearanceScore: number, attitudeScore: number, skillScore: number): number {
  const rubric = INTERVIEW_RUBRICS[track] ?? INTERVIEW_RUBRICS.INEXPERIENCED;
  const a = Number(appearanceScore) || 0, b = Number(attitudeScore) || 0, c = Number(skillScore) || 0;
  return Math.round(((a * rubric.criteria.appearance.weightPercent + b * rubric.criteria.attitude.weightPercent + c * rubric.criteria.skill.weightPercent) / 100) * 10) / 10;
}

export function inferCandidateExperienceTrack(experienceNote?: string | null): InterviewExperienceTrack {
  const raw = String(experienceNote ?? '').trim().toLowerCase();
  if (!raw || /^(chưa|không|chua|khong|none|no\b|0\b|mới ra trường|sinh viên mới)/i.test(raw)) return 'INEXPERIENCED';
  if (raw.includes('chưa có kinh nghiệm') || raw.includes('không có kinh nghiệm') || raw.includes('chua co kinh nghiem')) return 'INEXPERIENCED';
  return 'EXPERIENCED';
}

export const INTERVIEW_RUBRIC_BLOCKS = ['STORE', 'OFFICE'] as const;
export type InterviewRubricBlock = (typeof INTERVIEW_RUBRIC_BLOCKS)[number];

export const INTERVIEW_RUBRIC_BLOCK_LABELS: Record<InterviewRubricBlock, string> = {
  STORE: 'Đã có kinh nghiệm (9 câu hỏi — Thang 13 điểm)',
  OFFICE: 'Chưa có kinh nghiệm (7 câu hỏi — Thang 13 điểm)',
};

export interface Rubric13Option { label: string; points: number; isReject?: boolean; rejectLabel?: string }
export interface Rubric13Criterion {
  stt: number; key: string; label: string; question: string; conditionNote?: string;
  maxPoints: number; category: 'appearance' | 'attitude' | 'skill'; options: readonly Rubric13Option[];
}

export const STORE_RUBRIC_CRITERIA_13: readonly Rubric13Criterion[] = [
  { stt: 1, key: 's1_punctuality', label: '1. Kinh nghiệm & Quy trình làm việc cũ', maxPoints: 2, category: 'skill',
    question: 'Anh thấy em đã có kinh nghiệm làm việc tại... Vị trí em làm việc cụ thể, quy trình làm việc tại thương hiệu đó.',
    options: [{ label: 'Không trả lời được, Không trung thực', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Chỉ trả lời qua loa được 1 công việc', points: 1 }, { label: 'Trả lời rành mạch các bước đã từng làm', points: 2 }] },
  { stt: 2, key: 's2_grooming', label: '2. Lý do nghỉ việc tại công ty cũ', maxPoints: 2, category: 'attitude',
    question: 'Lý do vì sao Em nghỉ việc?',
    options: [{ label: 'Trả lời tiêu cực, phê phán công ty cũ', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', points: 1 }, { label: 'Trả lời theo hướng tích cực, không đổ lỗi', points: 2 }] },
  { stt: 3, key: 's3_voice_smile', label: '3. Giải quyết tình huống khó xử ở công ty cũ', maxPoints: 1, category: 'attitude',
    question: 'Chia sẻ tình huống em đã từng khó xử ở công ty cũ và cách giải quyết',
    options: [{ label: 'Không trả lời được / Trả lời sơ sài', points: 0 }, { label: 'Trả lời rành mạch', points: 1 }] },
  { stt: 4, key: 's4_shift_commitment', label: '4. Hoạt động CLB / Sự kiện (Nếu là Sinh viên)', maxPoints: 2, category: 'attitude', conditionNote: 'NẾU ỨNG VIÊN LÀ SINH VIÊN',
    question: 'Bạn có hay tham gia sự kiện tình nguyện, văn nghệ hay câu lạc bộ ở trường không?',
    options: [{ label: 'Không tham gia, hoặc có tham gia nhưng ít nói, thái độ rụt rè', points: 0 }, { label: 'Ưu tiên các bạn hướng ngoại, Có tham gia', points: 2 }] },
  { stt: 5, key: 's5_honesty_discipline', label: '5. Sở thích cá nhân (Nếu không bằng cấp đi làm)', maxPoints: 1, category: 'attitude', conditionNote: 'NẾU ỨNG VIÊN LÀ KHÔNG BẰNG CẤP ĐI LÀM',
    question: 'Bạn có sở thích gì? (Như đi cà phê cùng bạn hay đọc sách)',
    options: [
      { label: 'Thích hoạt động độc lập, yên tĩnh, nội tâm (đọc sách, viết lách, nghe nhạc, chơi game, chạy bộ, bơi lội, vẽ, nấu ăn, làm bánh...)', points: -1, isReject: true, rejectLabel: 'LOẠI THẲNG' },
      { label: 'Sở thích hướng ngoại — thích nơi đông người, vận động (đi TTTM, cà phê, chơi thể thao đồng đội: cầu lông, đá banh, bóng chuyền...)', points: 1 },
    ] },
  { stt: 6, key: 's6_teamwork', label: '6. Ngoại hình, Tác phong', maxPoints: 2, category: 'appearance',
    question: 'Ngoại hình, Tác phong',
    options: [{ label: 'Mặt căng, không chào hỏi', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng (1đ) HOẶC Giọng nói dễ nghe nhẹ nhàng (1đ)', points: 1 }, { label: 'Đạt cả 2: Mặt hiền hậu, vui vẻ, tóc tai gọn gàng (1đ) + Giọng nói dễ nghe nhẹ nhàng (1đ)', points: 2 }] },
  { stt: 7, key: 's7_fnb_operation', label: '7. Kỹ năng Up-sale từ 1 chai lên 5 chai', maxPoints: 1, category: 'skill',
    question: 'Nếu khách mua 1 chai làm cách nào Up sale khách lên được 5 chai?',
    options: [{ label: 'Không trả lời được / Trả lời sơ sài', points: 0 }, { label: 'Trả lời chi tiết, cụ thể rõ ràng', points: 1 }] },
  { stt: 8, key: 's8_hygiene_safety', label: '8. Tư vấn khách đổi vị khi hết hàng', maxPoints: 2, category: 'skill',
    question: 'Nếu Vị sữa hôm đó hết hàng, em sẽ tư vấn như thế nào để khách mua vị sữa khác?',
    options: [{ label: 'Không trả lời được', points: 0 }, { label: 'Trả lời chi tiết, cụ thể rõ ràng', points: 2 }] },
  { stt: 9, key: 's9_incident_handling', label: '9. Thắc mắc về công việc', maxPoints: 1, category: 'attitude',
    question: 'Em có câu thắc mắc gì về công việc không?',
    options: [{ label: 'Không hỏi gì hết', points: 0 }, { label: 'Có hỏi', points: 1 }] },
] as const;

export const OFFICE_RUBRIC_CRITERIA_13: readonly Rubric13Criterion[] = [
  { stt: 1, key: 'o1_professionalism', label: '1. Tự nhận xét điểm mạnh & điểm yếu', maxPoints: 2, category: 'attitude',
    question: 'Em hãy tự nhận xét về chính bản thân em có điểm mạnh và điểm yếu gì?',
    options: [{ label: 'Chỉ trả lời qua loa hoặc chỉ kể điểm yếu 1–2 câu và nói điểm mạnh quá nhiều (không khiêm tốn, chưa nhận biết thiếu sót, thiếu trung thực)', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Chỉ trả lời qua loa', points: 1 }, { label: 'Trả lời rành mạch, có chia sẻ nhiều điểm yếu và cách khắc phục những điểm yếu đó tốt hơn', points: 2 }] },
  { stt: 2, key: 'o2_communication', label: '2. Xử lý khi bị bạn copy bài & bị thầy/cô hiểu lầm', maxPoints: 2, category: 'attitude',
    question: 'Khi trường có tổ chức 1 cuộc thi sáng tạo bắt buộc các bạn phải tham gia, có 1 bạn copy bài em và nộp trước cho thầy/cô, em là người nộp sau, khi có kết quả thầy/cô mặc định em là người copy và em bị mất 1 cột điểm đó làm em rớt môn. Em sẽ làm gì khi mình bị đổ oan?',
    options: [{ label: 'Trả lời tiêu cực, phê phán thầy/cô, người copy', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', points: 1 }, { label: 'Trả lời theo hướng tích cực, không đổ lỗi', points: 2 }] },
  { stt: 3, key: 'o3_responsibility', label: '3. Giải quyết tình huống bất đồng quan điểm', maxPoints: 2, category: 'attitude',
    question: 'Em hãy chia sẻ tình huống mà em đã từng khó xử / bất đồng quan điểm với bạn bè / thầy cô và cách giải quyết của em?',
    options: [{ label: 'Không trả lời được', points: 0 }, { label: 'Trả lời sơ sài', points: 1 }, { label: 'Trả lời rành mạch', points: 2 }] },
  { stt: 4, key: 'o4_longterm_fit', label: '4. Ngoại hình, Tác phong', maxPoints: 2, category: 'appearance',
    question: 'Ngoại hình, Tác phong',
    options: [{ label: 'Mặt căng, không chào hỏi', points: -1, isReject: true, rejectLabel: 'LOẠI' }, { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng (1đ) HOẶC Giọng nói dễ nghe nhẹ nhàng (1đ)', points: 1 }, { label: 'Đạt cả 2: Mặt hiền hậu, vui vẻ, tóc tai gọn gàng (1đ) + Giọng nói dễ nghe nhẹ nhàng (1đ)', points: 2 }] },
  { stt: 5, key: 'o5_domain_expertise', label: '5. Kỹ năng Up-sale từ 1 chai lên 5 chai', maxPoints: 2, category: 'skill',
    question: 'Nếu khách mua 1 chai làm cách nào Up sale khách lên được 5 chai?',
    options: [{ label: 'Không trả lời được', points: 0 }, { label: 'Trả lời sơ sài', points: 1 }, { label: 'Trả lời chi tiết, cụ thể rõ ràng', points: 2 }] },
  { stt: 6, key: 'o6_digital_tools', label: '6. Tư vấn khách đổi vị khi hết hàng', maxPoints: 2, category: 'skill',
    question: 'Nếu Vị sữa hôm đó hết hàng, em sẽ tư vấn như thế nào để khách mua vị khác?',
    options: [{ label: 'Không trả lời được', points: 0 }, { label: 'Trả lời sơ sài', points: 1 }, { label: 'Trả lời chi tiết, cụ thể rõ ràng', points: 2 }] },
  { stt: 7, key: 'o7_problem_solving', label: '7. Thắc mắc về công việc', maxPoints: 1, category: 'attitude',
    question: 'Em có câu thắc mắc gì về công việc không?',
    options: [{ label: 'Không hỏi gì hết', points: 0 }, { label: 'Có hỏi', points: 1 }] },
] as const;

export const INTERVIEW_RED_FLAGS = [
  { key: 'RF_ATTITUDE', label: 'Mặt căng, không chào hỏi hoặc thiếu trung thực khi trả lời phỏng vấn' },
  { key: 'RF_BLAME_NEGATIVE', label: 'Trả lời tiêu cực, đổ lỗi, phê phán công ty cũ hoặc thầy cô / đồng nghiệp' },
  { key: 'RF_INTROVERT_MISMATCH', label: 'Sở thích khép kín nội tâm hoặc thiếu khiêm tốn (thuộc diện LOẠI THẲNG)' },
] as const;

export const INTERVIEW_RUBRIC_13_MAX = 13;
export const INTERVIEW_RUBRIC_13_PASS_THRESHOLD = 12;
export const INTERVIEW_RUBRIC_13_CONSIDER_THRESHOLD = 10;

export function evaluateInterviewRubric13(block: InterviewRubricBlock, scores: Record<string, number>, redFlags: string[] = []) {
  const criteria = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  let totalScore13 = 0, hasQuestionReject = false;
  for (const c of criteria) {
    const raw = Number(scores[c.key] ?? 0);
    if (raw < 0) hasQuestionReject = true;
    else totalScore13 += Math.max(0, Math.min(Math.max(c.maxPoints, 2), raw));
  }
  totalScore13 = Math.min(INTERVIEW_RUBRIC_13_MAX, Math.round(totalScore13 * 10) / 10);
  const hasRedFlag = redFlags.length > 0 || hasQuestionReject;
  const passed = !hasRedFlag && totalScore13 >= INTERVIEW_RUBRIC_13_PASS_THRESHOLD;
  const isConsider = !hasRedFlag && totalScore13 >= INTERVIEW_RUBRIC_13_CONSIDER_THRESHOLD && totalScore13 < INTERVIEW_RUBRIC_13_PASS_THRESHOLD;
  const isPerfect13 = !hasRedFlag && totalScore13 >= INTERVIEW_RUBRIC_13_MAX;
  const normalizedScore100 = Math.round((totalScore13 / INTERVIEW_RUBRIC_13_MAX) * 1000) / 10;
  return {
    block, totalScore13, maxScore13: INTERVIEW_RUBRIC_13_MAX, passThreshold13: INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
    considerThreshold13: INTERVIEW_RUBRIC_13_CONSIDER_THRESHOLD, hasRedFlag, passed, isConsider, isPerfect13,
    autoDecision: (passed ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
    recommendedDecision: (hasRedFlag ? 'FAIL' : passed ? 'PASS' : isConsider ? 'HOLD' : 'FAIL') as 'PASS' | 'HOLD' | 'FAIL',
    normalizedScore100,
  };
}
