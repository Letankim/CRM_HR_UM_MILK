/**
 * Cấu hình bộ tiêu chí chấm điểm phỏng vấn theo 2 phân loại ứng viên:
 * - INEXPERIENCED: Ứng viên chưa có kinh nghiệm (ưu tiên thái độ cầu tiến, tác phong giao tiếp & khả năng tiếp thu).
 * - EXPERIENCED: Ứng viên đã có kinh nghiệm (ưu tiên tay nghề thực chiến, vận hành quầy & kỷ luật ca).
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
    summary: 'Dành cho ứng viên mới / chưa làm F&B: trọng số tập trung vào Thái độ cầu tiến (45%), Tác phong & Giao tiếp (35%), Khả năng tiếp thu (20%).',
    defaultComment: 'Thái độ tích cực, cầu tiến, khả năng tiếp thu tốt — phù hợp tiếp nhận đào tạo thử việc tại cửa hàng',
    criteria: {
      appearance: {
        label: 'Tác phong & Giao tiếp (35%)',
        weightPercent: 35,
        hint: 'Ngoại hình gọn gàng, lời nói rõ ràng, lịch sự và thân thiện khi giao tiếp',
      },
      attitude: {
        label: 'Thái độ & Tinh thần cầu tiến (45%)',
        weightPercent: 45,
        hint: 'Trung thực, chủ động học hỏi, sẵn sàng xoay ca và tuân thủ nội quy cửa hàng',
      },
      skill: {
        label: 'Khả năng tiếp thu & Xử lý tình huống (20%)',
        weightPercent: 20,
        hint: 'Phản xạ nhanh nhạy, tư duy xử lý tình huống dịch vụ cơ bản tại quầy',
      },
    },
  },
  EXPERIENCED: {
    track: 'EXPERIENCED',
    label: INTERVIEW_EXPERIENCE_TRACK_LABELS.EXPERIENCED,
    shortLabel: INTERVIEW_EXPERIENCE_TRACK_SHORT_LABELS.EXPERIENCED,
    summary: 'Dành cho ứng viên đã làm pha chế / thu ngân / dịch vụ: trọng số tập trung vào Nghiệp vụ thực chiến (45%), Thái độ & Kỷ luật ca (30%), Dịch vụ khách hàng (25%).',
    defaultComment: 'Đã có kinh nghiệm thực tế ngành F&B, nắm vững thao tác quầy và đáp ứng tốt khung ca tại cửa hàng',
    criteria: {
      appearance: {
        label: 'Tác phong & Dịch vụ khách hàng (25%)',
        weightPercent: 25,
        hint: 'Phong thái chuyên nghiệp, kỹ năng chào đón và xử lý phản hồi khách hàng',
      },
      attitude: {
        label: 'Thái độ & Cam kết kỷ luật ca (30%)',
        weightPercent: 30,
        hint: 'Tinh thần phối hợp đồng đội, cam kết gắn bó và kỷ luật giờ giấc ca kíp',
      },
      skill: {
        label: 'Kỹ năng nghiệp vụ thực chiến & Vận hành (45%)',
        weightPercent: 45,
        hint: 'Tay nghề pha chế / thu ngân thực tế, tốc độ ra món và kiểm soát vệ sinh quầy',
      },
    },
  },
};

export const INTERVIEW_EXPERIENCE_TRACK_OPTIONS = INTERVIEW_EXPERIENCE_TRACKS.map((value) => ({
  value,
  label: INTERVIEW_EXPERIENCE_TRACK_LABELS[value],
}));

/** Tính điểm tổng kết phỏng vấn theo đúng trọng số của phân loại Kinh nghiệm / Chưa có kinh nghiệm (thang 0–100, làm tròn 1 chữ số thập phân). */
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

/** Tự động gợi ý phân loại đánh giá dựa trên ghi chú kinh nghiệm trong hồ sơ ứng viên. */
export function inferCandidateExperienceTrack(experienceNote?: string | null): InterviewExperienceTrack {
  const raw = String(experienceNote ?? '').trim().toLowerCase();
  if (!raw) return 'INEXPERIENCED';
  if (/^(chưa|không|chua|khong|none|no\b|0\b|mới ra trường|sinh viên mới)/i.test(raw)) {
    return 'INEXPERIENCED';
  }
  if (raw.includes('chưa có kinh nghiệm') || raw.includes('không có kinh nghiệm') || raw.includes('chua co kinh nghiem')) {
    return 'INEXPERIENCED';
  }
  return 'EXPERIENCED';
}
