/**
 * Bảng tiêu chí chấm điểm sơ loại hồ sơ ứng viên (9 câu hỏi — Thang 14 điểm).
 * Chuẩn hóa theo bảng tiêu chí tuyển dụng Ụm Bò Milk:
 * - MAXIMUM: 14 điểm
 * - Đạt sơ loại: >= 8 điểm (không vi phạm câu LOẠI)
 * - Không đạt / Loại: dưới 8 điểm hoặc rơi vào phương án LOẠI ở câu 7, 8, 9
 */

export interface PreScreenOptionDef {
  key: string;
  label: string;
  points: number;
  isReject?: boolean;
  rejectReason?: string;
}

export interface PreScreenCriterionDef {
  stt: number;
  key: string;
  question: string;
  shortLabel: string;
  maxPoints: number;
  options: readonly PreScreenOptionDef[];
}

export const PRE_SCREEN_MAX_SCORE_14 = 14;
export const PRE_SCREEN_PASS_THRESHOLD_14 = 8;

export const PRE_SCREEN_CRITERIA_14: readonly PreScreenCriterionDef[] = [
  {
    stt: 1,
    key: 'full_name_valid',
    question: 'Tên Bạn là?',
    shortLabel: '1. Họ và tên đầy đủ',
    maxPoints: 1,
    options: [
      { key: 'full', label: 'Ghi đủ họ và tên', points: 1 },
      { key: 'missing', label: 'Chưa ghi đủ họ và tên', points: 0 },
    ],
  },
  {
    stt: 2,
    key: 'age_valid',
    question: 'Năm Sinh của bạn?',
    shortLabel: '2. Năm sinh (2000–2008)',
    maxPoints: 2,
    options: [
      { key: '2000_2004', label: '2004–2000', points: 2 },
      { key: '2005_2008', label: '2008–2004', points: 1 },
      { key: 'gt_2008', label: '>2008', points: 0 },
    ],
  },
  {
    stt: 3,
    key: 'hometown_cccd',
    question: 'Quê Quán theo CCCD?',
    shortLabel: '3. Quê quán theo CCCD',
    maxPoints: 1,
    options: [
      { key: 'south_west', label: 'Ưu tiên miền Nam, miền Tây', points: 1 },
      { key: 'north_central', label: 'Miền Bắc, miền Trung', points: 0 },
    ],
  },
  {
    stt: 4,
    key: 'zalo_phone',
    question: 'Số điện thoại của bạn (Số Zalo để liên hệ)',
    shortLabel: '4. Số điện thoại Zalo',
    maxPoints: 1,
    options: [
      { key: 'has_phone', label: 'Có số điện thoại', points: 1 },
      { key: 'no_phone', label: 'Chưa có số điện thoại hợp lệ', points: 0 },
    ],
  },
  {
    stt: 5,
    key: 'education_commitment',
    question: 'Trình độ học vấn',
    shortLabel: '5. Trình độ học vấn',
    maxPoints: 2,
    options: [
      { key: 'work_only', label: 'Không đi học chỉ đi làm', points: 2 },
      { key: 'uni_college', label: 'Đại học / Cao đẳng', points: 1 },
      { key: 'other_edu', label: 'Chưa rõ trình độ học vấn', points: 0 },
    ],
  },
  {
    stt: 6,
    key: 'fnb_experience',
    question: 'Kinh nghiệm làm việc?',
    shortLabel: '6. Kinh nghiệm làm việc',
    maxPoints: 2,
    options: [
      { key: 'fnb_exp', label: 'Kinh nghiệm từng làm F&B', points: 2 },
      { key: 'other_exp', label: 'Kinh nghiệm khác ngoài F&B', points: 1 },
      { key: 'no_exp', label: 'Không có kinh nghiệm', points: 0 },
    ],
  },
  {
    stt: 7,
    key: 'source_channel_score',
    question: 'Bạn biết tin ứng tuyển qua hình thức nào?',
    shortLabel: '7. Nguồn biết tin ứng tuyển',
    maxPoints: 1,
    options: [
      { key: 'social_media', label: 'Facebook / Instagram / Tiktok', points: 1 },
      {
        key: 'referral_reject',
        label: 'Bạn bè người quen giới thiệu',
        points: -1,
        isReject: true,
        rejectReason: 'Loại trực tiếp (Câu 7): Biết tin qua bạn bè / người quen giới thiệu',
      },
    ],
  },
  {
    stt: 8,
    key: 'incident_handling',
    question: 'Nếu như ngày mai em có việc đột xuất trùng với lịch ca trực của em, thì hướng xử lý như nào?',
    shortLabel: '8. Xử lý việc đột xuất trùng ca',
    maxPoints: 2,
    options: [
      { key: 'has_solution', label: 'Đưa ra được hướng xử lý', points: 2 },
      {
        key: 'blank_reject',
        label: 'Bỏ trống (hoặc tự ý nghỉ ca)',
        points: -1,
        isReject: true,
        rejectReason: 'Loại trực tiếp (Câu 8): Bỏ trống hoặc tự ý nghỉ khi có việc đột xuất trùng lịch ca trực',
      },
    ],
  },
  {
    stt: 9,
    key: 'facebook_link',
    question: 'Gửi link Facebook cá nhân của bạn vào đây nhé!',
    shortLabel: '9. Link Facebook cá nhân',
    maxPoints: 2,
    options: [
      { key: 'real_fb', label: 'Có gửi link Facebook Thật', points: 2 },
      { key: 'no_or_virtual_fb', label: 'Không gửi link Facebook, hoặc gửi link ảo', points: 1 },
      {
        key: 'drama_fb_reject',
        label: 'Nếu FB Drama, có bạn bè hay châm biếm, hay share những tiêu cực',
        points: -1,
        isReject: true,
        rejectReason: 'Loại trực tiếp (Câu 9): Facebook cá nhân có Drama, châm biếm hoặc chia sẻ nội dung tiêu cực',
      },
    ],
  },
] as const;

export function evaluatePreScreenScores14(
  scores: Record<string, number>,
  customRedFlagReason = '',
) {
  let totalScore14 = 0;
  const rejectReasons: string[] = [];
  if (customRedFlagReason.trim()) {
    rejectReasons.push(customRedFlagReason.trim());
  }
  for (const c of PRE_SCREEN_CRITERIA_14) {
    const rawVal = Number(scores[c.key] ?? 0);
    if (rawVal < 0) {
      const rejectOpt = c.options.find((o) => o.isReject);
      rejectReasons.push(rejectOpt?.rejectReason || `Loại trực tiếp tại câu ${c.stt}: ${c.question}`);
    } else {
      totalScore14 += Math.max(0, Math.min(c.maxPoints, rawVal));
    }
  }
  totalScore14 = Math.max(0, Math.min(PRE_SCREEN_MAX_SCORE_14, totalScore14));
  const redFlagReason = Array.from(new Set(rejectReasons)).join('; ');
  const qualified = !redFlagReason && totalScore14 >= PRE_SCREEN_PASS_THRESHOLD_14;
  return {
    totalScore14,
    maxScore14: PRE_SCREEN_MAX_SCORE_14,
    passThreshold14: PRE_SCREEN_PASS_THRESHOLD_14,
    qualified,
    redFlagReason,
  };
}
