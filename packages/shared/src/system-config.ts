/**
 * Cấu hình biến hệ thống tập trung (System Configuration & Branding).
 * Mọi giá trị đều cho phép ghi đè qua biến môi trường (.env) ở cả Backend và Frontend (NEXT_PUBLIC_*).
 */

function getEnvMap(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

function readEnv(keys: string[], fallback: string): string {
  const env = getEnvMap();
  if (!env) return fallback;
  for (const key of keys) {
    const val = env[key];
    if (val && val.trim().length > 0) return val.trim();
  }
  return fallback;
}

function readEnvNumber(keys: string[], fallback: number): number {
  const raw = readEnv(keys, String(fallback));
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

export const SYSTEM_CONFIG = {
  /** Định danh nền tảng phần mềm nhân sự (AHr — sản phẩm thuộc Auto stack) */
  productName: readEnv(['NEXT_PUBLIC_APP_PRODUCT_NAME', 'APP_PRODUCT_NAME'], 'AHr'),
  /** Tên thương hiệu / doanh nghiệp vận hành hiển thị trên Báo cáo & Email */
  brandName: readEnv(['NEXT_PUBLIC_APP_BRAND_NAME', 'APP_BRAND_NAME'], 'ỤM BÒ MILK'),
  /** Tên đầy đủ của hệ thống */
  systemTitle: readEnv(
    ['NEXT_PUBLIC_APP_SYSTEM_TITLE', 'APP_SYSTEM_TITLE'],
    'AHr — Hệ thống Quản trị Nhân sự',
  ),
  /** Phụ đề dưới logo Sidebar */
  brandSubtitle: readEnv(['NEXT_PUBLIC_APP_BRAND_SUBTITLE', 'APP_BRAND_SUBTITLE'], 'HỆ THỐNG NHÂN SỰ'),
  /** Ký hiệu viết tắt trên biểu tượng Logo (2-3 ký tự) */
  brandShortCode: readEnv(['NEXT_PUBLIC_APP_SHORT_CODE', 'APP_SHORT_CODE'], 'AHr'),
  /** Tiền tố tiêu đề Email doanh nghiệp (có thể đổi trong .env: APP_EMAIL_SUBJECT_PREFIX) */
  emailSubjectPrefix: readEnv(
    ['NEXT_PUBLIC_APP_EMAIL_SUBJECT_PREFIX', 'APP_EMAIL_SUBJECT_PREFIX'],
    '[Ụm Bò Milk HR]',
  ),
  /** Tên miền email nội bộ mặc định của doanh nghiệp */
  companyDomain: readEnv(['NEXT_PUBLIC_APP_COMPANY_DOMAIN', 'APP_COMPANY_DOMAIN'], 'umbomilk.vn'),
  /** Đơn vị phát triển / vận hành kỹ thuật */
  vendorName: readEnv(['NEXT_PUBLIC_APP_VENDOR_NAME', 'APP_VENDOR_NAME'], 'Auto Stack'),
  /** Phiên bản hệ thống hiển thị ở chân Sidebar và Health-check */
  version: readEnv(['NEXT_PUBLIC_APP_VERSION', 'APP_VERSION'], 'v5.1.0'),
  /** Múi giờ chuẩn của toàn chuỗi cửa hàng */
  timezone: readEnv(['NEXT_PUBLIC_APP_TIMEZONE', 'APP_TIMEZONE'], 'Asia/Ho_Chi_Minh'),
  /** Tham số mặc định chu kỳ thử việc (có thể cấu hình lại trong bảng POLICIES) */
  defaults: {
    probationCycleDays: readEnvNumber(['APP_PROBATION_CYCLE_DAYS'], 12),
    probationWorkDays: readEnvNumber(['APP_PROBATION_WORK_DAYS'], 7),
    probationOffDays: readEnvNumber(['APP_PROBATION_OFF_DAYS'], 5),
    shiftSwapAllowanceVnd: readEnvNumber(['APP_SHIFT_SWAP_ALLOWANCE_VND'], 30000),
    /** % lương chính thức áp dụng mặc định cho giai đoạn thử việc (cấu hình riêng từng nhân sự) */
    probationSalaryPercent: readEnvNumber(['APP_PROBATION_SALARY_PERCENT'], 85),
    /** Số ngày công chuẩn / tháng dùng để quy đổi lương tháng theo ngày công thực tế */
    standardWorkDaysPerMonth: readEnvNumber(['APP_STANDARD_WORK_DAYS'], 26),
    /** Số giờ chuẩn / ngày dùng để quy đổi đơn giá giờ tăng ca (OT) cho lương tháng */
    standardHoursPerDay: readEnvNumber(['APP_STANDARD_HOURS_PER_DAY'], 8),
    /** Hệ số tăng ca mặc định */
    overtimeMultiplier: readEnvNumber(['APP_OT_MULTIPLIER'], 1.5),
    gpsRadiusMeters: readEnvNumber(['APP_GPS_DEFAULT_RADIUS_M'], 300),
    gpsFactoryRadiusMeters: readEnvNumber(['APP_GPS_FACTORY_RADIUS_M'], 500),
    gpsMaxAccuracyMeters: readEnvNumber(['APP_GPS_DEFAULT_MAX_ACCURACY_M'], 150),
    /** Đơn giá lương theo giờ chuẩn (Thử việc: 21.000đ/h, Chính thức: 25.500đ/h) */
    probationHourlyRateVnd: readEnvNumber(['APP_PROBATION_HOURLY_RATE_VND'], 21000),
    officialHourlyRateVnd: readEnvNumber(['APP_OFFICIAL_HOURLY_RATE_VND'], 25500),
    /** Ngưỡng giờ làm việc trong ngày để hưởng phụ cấp OT định mức (+30.000đ ở mốc 10h, +60.000đ ở mốc 15h) */
    otDailyThreshold1Hours: readEnvNumber(['APP_OT_DAILY_THRESHOLD_1_H'], 10),
    otDailyThreshold2Hours: readEnvNumber(['APP_OT_DAILY_THRESHOLD_2_H'], 15),
    otAllowancePerSlotVnd: readEnvNumber(['APP_OT_ALLOWANCE_SLOT_VND'], 30000),
    /** Cửa thời gian điểm danh & Kiểm tra đồng phục */
    checkInOpenBeforeMinutes: readEnvNumber(['APP_CHECKIN_OPEN_BEFORE_MINUTES'], 30),
    checkInAutoAbsentAfterHours: readEnvNumber(['APP_CHECKIN_AUTO_ABSENT_HOURS'], 3),
    pinkUniformMinRatioPercent: readEnvNumber(['APP_PINK_UNIFORM_MIN_RATIO_PERCENT'], 10),
    /** Quy tắc Bổ sung công & Gamification điểm tích lũy */
    adjustmentWindowStartHm: readEnv(['APP_ADJUSTMENT_WINDOW_START_HM'], '08:00'),
    adjustmentWindowEndHm: readEnv(['APP_ADJUSTMENT_WINDOW_END_HM'], '21:00'),
    adjustmentWeeklyMaxCount: readEnvNumber(['APP_ADJUSTMENT_WEEKLY_MAX_COUNT'], 1),
    adjustmentCreditPerValidShift: readEnvNumber(['APP_ADJUSTMENT_CREDIT_PER_SHIFT'], 2),
    adjustmentFullShiftCreditCost: readEnvNumber(['APP_ADJUSTMENT_FULL_SHIFT_COST'], 5),
    adjustmentAutoRejectTtlMinutes: readEnvNumber(['APP_ADJUSTMENT_AUTO_REJECT_TTL_MIN'], 30),
    /** Cấu hình Phòng thi trắc nghiệm định kỳ (120 câu ngân hàng / 25 câu mỗi đề / 480 giây / >= 8.0 điểm) */
    testDurationSeconds: readEnvNumber(['APP_TEST_DURATION_SECONDS'], 480),
    testQuestionsPerExam: readEnvNumber(['APP_TEST_QUESTIONS_PER_EXAM'], 25),
    testPassScore10: readEnvNumber(['APP_TEST_PASS_SCORE_10'], 8),
  },
} as const;
