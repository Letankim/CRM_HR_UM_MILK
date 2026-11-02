/**
 * Cấu hình bộ tiêu chí chấm điểm phỏng vấn chuyên biệt:
 * 1) Theo phân loại kinh nghiệm (INEXPERIENCED / EXPERIENCED) trên thang 100 điểm.
 * 2) Theo Khối nghiệp vụ chuẩn Tài liệu Khách hàng (Mục 2.4):
 *    - Khối Cửa hàng (STORE — 9 tiêu chí, tối đa 13 điểm, đạt >= 12/13).
 *    - Khối Văn phòng (OFFICE — 7 tiêu chí, tối đa 13 điểm, đạt >= 12/13).
 *    - Cờ Loại trực tiếp (Red Flag) -> Tự động REJECTED.
 *    - Đạt tuyệt đối 13/13 -> Kích hoạt hiệu ứng Pháo hoa chúc mừng trên Canvas 2D.
 */

export const INTERVIEW_EXPERIENCE_TRACKS = ['INEXPERIENCED', 'EXPERIENCED'] as const;
export type InterviewExperienceTrack = (typeof INTERVIEW_EXPERIENCE_TRACKS)[number];

export const INTERVIEW_EXPERIENCE_TRACK_LABELS: Record<InterviewExperienceTrack, string> = {
  INEXPERIENCED: 'Ứng viên chưa có kinh nghiệm',
  EXPERIENCED: 'Ứng viên đã có kinh nghiệm',
};

export const INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS: Record<InterviewExperienceTrack, string> = {
  INEXPERIENCED: 'Chưa có kinh nghiệm',
  EXPERIENCED: 'Đã có kinh nghiệm',
};

export interface InterviewCriterionDef {
  label: string;
  weightPercent: number;
  hint: string;
}

export interface InterviewRubricDef {
  track: InterviewExperienceTrack;
  label: string;
  shortLabel: string;
  summary: string;
  defaultComment: string;
  criteria: {
    appearance: InterviewCriterionDef;
    attitude: InterviewCriterionDef;
    skill: InterviewCriterionDef;
  };
}

export const INTERVIEW_RUBRICS: Record<InterviewExperienceTrack, InterviewRubricDef> = {
  INEXPERIENCED: {
    track: 'INEXPERIENCED',
    label: INTERVIEW_EXPERIENCE_TRACK_LABELS.INEXPERIENCED,
    shortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS.INEXPERIENCED,
    summary: 'Ưu tiên Thái độ cầu tiến (45%), Tác phong & Giao tiếp (35%), Khả năng tiếp thu (20%).',
    defaultComment: 'Thái độ tích cực, cầu tiến, khả năng tiếp thu tốt — phù hợp tiếp nhận đào tạo thử việc tại cửa hàng',
    criteria: {
      appearance: { label: 'Tác phong & Giao tiếp (35%)', weightPercent: 35, hint: 'Ngoại hình gọn gàng, lời nói rõ ràng, lịch sự và thân thiện' },
      attitude: { label: 'Thái độ & Tinh thần cầu tiến (45%)', weightPercent: 45, hint: 'Trung thực, chủ động học hỏi, sẵn sàng xoay ca và tuân thủ nội quy' },
      skill: { label: 'Khả năng tiếp thu & Xử lý tình huống (20%)', weightPercent: 20, hint: 'Phản xạ nhanh nhạy, tư duy xử lý tình huống dịch vụ cơ bản tại quầy' },
    },
  },
  EXPERIENCED: {
    track: 'EXPERIENCED',
    label: INTERVIEW_EXPERIENCE_TRACK_LABELS.EXPERIENCED,
    shortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS.EXPERIENCED,
    summary: 'Ưu tiên Nghiệp vụ thực chiến (45%), Thái độ & Kỷ luật ca (30%), Dịch vụ khách hàng (25%).',
    defaultComment: 'Đã có kinh nghiệm thực tế ngành F&B, nắm vững thao tác quầy và đáp ứng tốt khung ca tại cửa hàng',
    criteria: {
      appearance: { label: 'Tác phong & Dịch vụ khách hàng (25%)', weightPercent: 25, hint: 'Phong thái chuyên nghiệp, kỹ năng chào đón và xử lý phản hồi khách hàng' },
      attitude: { label: 'Thái độ & Cam kết kỷ luật ca (30%)', weightPercent: 30, hint: 'Tinh thần phối hợp đồng đội, cam kết gắn bó và kỷ luật giờ giấc ca kíp' },
      skill: { label: 'Kỹ năng nghiệp vụ thực chiến & Vận hành (45%)', weightPercent: 45, hint: 'Tay nghề pha chế / thu ngân thực tế, tốc độ ra món và kiểm soát vệ sinh quầy' },
    },
  },
};

export const INTERVIEW_EXPERIENCE_TRACK_OPTIONS = INTERVIEW_EXPERIENCE_TRACKS.map((value) => ({
  value,
  label: INTERVIEW_EXPERIENCE_TRACK_LABELS[value],
}));

export function computeInterviewWeightedScore(
  track: InterviewExperienceTrack,
  appearanceScore: number,
  attitudeScore: number,
  skillScore: number,
): number {
  const rubric = INTERVIEW_RUBRICS[track] ?? INTERVIEW_RUBRICS.INEXPERIENCED;
  const a = Number(appearanceScore) || 0;
  const b = Number(attitudeScore) || 0;
  const c = Number(skillScore) || 0;
  const weighted =
    (a * rubric.criteria.appearance.weightPercent +
      b * rubric.criteria.attitude.weightPercent +
      c * rubric.criteria.skill.weightPercent) /
    100;
  return Math.round(weighted * 10) / 10;
}

export function inferCandidateExperienceTrack(experienceNote?: string | null): InterviewExperienceTrack {
  const raw = String(experienceNote ?? '').trim().toLowerCase();
  if (!raw) return 'INEXPERIENCED';
  if (/^(chưa|không|chua|khong|none|no\b|0\b|mới ra trường|sinh viên mới)/i.test(raw)) return 'INEXPERIENCED';
  if (raw.includes('chưa có kinh nghiệm') || raw.includes('không có kinh nghiệm') || raw.includes('chua co kinh nghiem')) {
    return 'INEXPERIENCED';
  }
  return 'EXPERIENCED';
}

/* -------------------------------------------------------------------------- */
/* Bộ Rubric 13 Điểm theo Khối Cửa Hàng (9 tiêu chí) & Văn Phòng (7 tiêu chí) */
/* -------------------------------------------------------------------------- */

export const INTERVIEW_RUBRIC_BLOCKS = ['STORE', 'OFFICE'] as const;
export type InterviewRubricBlock = (typeof INTERVIEW_RUBRIC_BLOCKS)[number];

export const INTERVIEW_RUBRIC_BLOCK_LABELS: Record<InterviewRubricBlock, string> = {
  STORE: 'Khối Cửa hàng (9 tiêu chí — Thang 13 điểm)',
  OFFICE: 'Khối Văn phòng (7 tiêu chí — Thang 13 điểm)',
};

export interface Rubric13Criterion {
  key: string;
  label: string;
  maxPoints: number;
  category: 'appearance' | 'attitude' | 'skill';
}

export const STORE_RUBRIC_CRITERIA_13: readonly Rubric13Criterion[] = [
  { key: 's1_punctuality', label: '1. Đúng giờ & Tác phong tham gia phỏng vấn', maxPoints: 2, category: 'appearance' },
  { key: 's2_grooming', label: '2. Ngoại hình gọn gàng, sạch sẽ phù hợp ngành F&B', maxPoints: 1, category: 'appearance' },
  { key: 's3_voice_smile', label: '3. Giọng nói rõ ràng, nụ cười & năng lượng phục vụ', maxPoints: 2, category: 'appearance' },
  { key: 's4_shift_commitment', label: '4. Cam kết khung ca cố định & xoay ca linh hoạt', maxPoints: 2, category: 'attitude' },
  { key: 's5_honesty_discipline', label: '5. Tính trung thực & tuân thủ nội quy điểm danh/đồng phục', maxPoints: 2, category: 'attitude' },
  { key: 's6_teamwork', label: '6. Tinh thần hỗ trợ đồng đội khi ca đông khách', maxPoints: 1, category: 'attitude' },
  { key: 's7_fnb_operation', label: '7. Thao tác quầy / Pha chế / Thu ngân cơ bản', maxPoints: 1, category: 'skill' },
  { key: 's8_hygiene_safety', label: '8. Ý thức vệ sinh an toàn thực phẩm & bảo quản nguyên liệu', maxPoints: 1, category: 'skill' },
  { key: 's9_incident_handling', label: '9. Xử lý tình huống việc đột xuất trùng lịch trực / khách phàn nàn', maxPoints: 1, category: 'skill' },
] as const;

export const OFFICE_RUBRIC_CRITERIA_13: readonly Rubric13Criterion[] = [
  { key: 'o1_professionalism', label: '1. Tác phong chuyên nghiệp & Đúng giờ phỏng vấn', maxPoints: 2, category: 'appearance' },
  { key: 'o2_communication', label: '2. Kỹ năng trình bày, giao tiếp & phối hợp liên phòng ban', maxPoints: 2, category: 'appearance' },
  { key: 'o3_responsibility', label: '3. Tinh thần trách nhiệm, bảo mật dữ liệu & kỷ luật', maxPoints: 2, category: 'attitude' },
  { key: 'o4_longterm_fit', label: '4. Định hướng gắn bó lâu dài & phù hợp văn hóa Ụm Bò Milk', maxPoints: 2, category: 'attitude' },
  { key: 'o5_domain_expertise', label: '5. Kiến thức chuyên môn nghiệp vụ (HR / Kế toán / MKT / Vận hành)', maxPoints: 2, category: 'skill' },
  { key: 'o6_digital_tools', label: '6. Thành thạo công cụ số, Google Sheets & hệ thống quản trị', maxPoints: 2, category: 'skill' },
  { key: 'o7_problem_solving', label: '7. Tư duy giải quyết vấn đề & xử lý áp lực công việc', maxPoints: 1, category: 'skill' },
] as const;

export const INTERVIEW_RED_FLAGS = [
  { key: 'RF_ATTITUDE', label: 'Thái độ thiếu tôn trọng, gian dối thông tin hồ sơ' },
  { key: 'RF_SHIFT_CONFLICT', label: 'Không đáp ứng được ca cố định tối thiểu hoặc từ chối quy định xoay ca' },
  { key: 'RF_UNIFORM_POLICY', label: 'Từ chối mặc đồng phục áo hồng / đeo bảng tên hoặc quy định điểm danh GPS' },
] as const;

export const INTERVIEW_RUBRIC_13_MAX = 13;
export const INTERVIEW_RUBRIC_13_PASS_THRESHOLD = 12;

export function evaluateInterviewRubric13(
  block: InterviewRubricBlock,
  scores: Record<string, number>,
  redFlags: string[] = [],
) {
  const criteria = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  let totalScore13 = 0;
  for (const c of criteria) {
    const val = Math.max(0, Math.min(c.maxPoints, Number(scores[c.key]) || 0));
    totalScore13 += val;
  }
  totalScore13 = Math.round(totalScore13 * 10) / 10;
  const hasRedFlag = redFlags.length > 0;
  const passed = !hasRedFlag && totalScore13 >= INTERVIEW_RUBRIC_13_PASS_THRESHOLD;
  const isPerfect13 = !hasRedFlag && totalScore13 >= INTERVIEW_RUBRIC_13_MAX;
  const normalizedScore100 = Math.round((totalScore13 / INTERVIEW_RUBRIC_13_MAX) * 1000) / 10;
  return {
    block,
    totalScore13,
    maxScore13: INTERVIEW_RUBRIC_13_MAX,
    passThreshold13: INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
    hasRedFlag,
    passed,
    isPerfect13,
    autoDecision: (passed ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
    normalizedScore100,
  };
}
