/**
 * Các hằng số & hàm thuần theo Tài liệu Đặc tả Nghiệp vụ Khách hàng (13 Phân hệ Ụm Bò Milk):
 * - Phạt đi trễ 4 bậc (NONE, FLAT_30K, HALF_SHIFT, FULL_SHIFT)
 * - Phụ cấp OT theo ngưỡng tổng giờ làm trong ngày (>=10h: +30.000đ, >=15h: +60.000đ)
 * - Kiểm tra Magic Bytes cho Kho Hợp đồng Lao động điện tử (tối đa 6MB)
 * - Chuẩn hóa Mã nhân viên (UBM_NV000001) & Phân loại mức độ thông báo
 */

export const LATE_FINE_TIERS = ['NONE', 'FLAT_30K', 'HALF_SHIFT', 'FULL_SHIFT'] as const;
export type LateFineTier = (typeof LATE_FINE_TIERS)[number];

export const LATE_FINE_TIER_LABELS: Record<LateFineTier, string> = {
  NONE: 'Không phạt (dưới 5 phút)',
  FLAT_30K: 'Phạt 30.000đ (trễ 5 - 29 phút)',
  HALF_SHIFT: 'Phạt 50% lương ca (trễ 30 - 59 phút)',
  FULL_SHIFT: 'Phạt 100% lương ca (trễ từ 60 phút)',
};

export interface LateFineCalculation {
  tier: LateFineTier;
  fineVnd: number;
  label: string;
}

/**
 * Tính mức phạt đi trễ theo 4 bậc (Mục 8.5):
 * - Trễ < 5 phút: 0đ (NONE)
 * - Trễ 5 - 29 phút: 30.000đ (FLAT_30K)
 * - Trễ 30 - 59 phút: 50% tiền lương ca (HALF_SHIFT)
 * - Trễ >= 60 phút: 100% tiền lương ca (FULL_SHIFT)
 */
export function computeLateFine(lateMinutes: number, shiftPayVnd: number): LateFineCalculation {
  const mins = Math.max(0, Math.floor(Number(lateMinutes) || 0));
  const safeShiftPay = Math.max(0, Math.round(Number(shiftPayVnd) || 0));
  if (mins < 5) {
    return { tier: 'NONE', fineVnd: 0, label: LATE_FINE_TIER_LABELS.NONE };
  }
  if (mins <= 29) {
    return { tier: 'FLAT_30K', fineVnd: 30000, label: LATE_FINE_TIER_LABELS.FLAT_30K };
  }
  if (mins <= 59) {
    return { tier: 'HALF_SHIFT', fineVnd: Math.round(safeShiftPay * 0.5), label: LATE_FINE_TIER_LABELS.HALF_SHIFT };
  }
  return { tier: 'FULL_SHIFT', fineVnd: safeShiftPay, label: LATE_FINE_TIER_LABELS.FULL_SHIFT };
}

/**
 * Tính phụ cấp OT theo ngưỡng tổng giờ làm thực tế trong ngày (Mục 11.3):
 * - Tổng giờ ngày >= 15 giờ: 2 suất = 60.000đ
 * - Tổng giờ ngày >= 10 giờ: 1 suất = 30.000đ
 * - Dưới 10 giờ: 0đ
 */
export function computeDailyOtThresholdAllowance(
  dailyHours: number,
  slotAmountVnd = 30000,
): { slots: number; allowanceVnd: number } {
  const h = Number(dailyHours) || 0;
  if (h >= 15) return { slots: 2, allowanceVnd: slotAmountVnd * 2 };
  if (h >= 10) return { slots: 1, allowanceVnd: slotAmountVnd };
  return { slots: 0, allowanceVnd: 0 };
}

export const NOTIFICATION_PRIORITY_TYPES = ['SUCCESS', 'ACTION_REQUIRED', 'URGENT', 'SYSTEM'] as const;
export type NotificationPriorityType = (typeof NOTIFICATION_PRIORITY_TYPES)[number];

export const NOTIFICATION_PRIORITY_LABELS: Record<NotificationPriorityType, string> = {
  SUCCESS: 'Hoàn tất thành công',
  ACTION_REQUIRED: 'Cần xử lý / Phê duyệt',
  URGENT: 'Khẩn cấp / Điều phối nóng',
  SYSTEM: 'Thông báo hệ thống',
};

export const CONTRACT_TYPES = ['PROBATION_CONTRACT', 'OFFICIAL_CONTRACT'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  PROBATION_CONTRACT: 'Hợp đồng Thử việc',
  OFFICIAL_CONTRACT: 'Hợp đồng Lao động Chính thức',
};

export const CONTRACT_MAX_SIZE_BYTES = 6 * 1024 * 1024;

export interface EmployeeContractItem {
  id: string;
  contractType: ContractType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId: string;
  localBackupPath: string;
  uploadedBy: string;
  uploadedAt: string;
  note?: string;
}

/**
 * Kiểm tra chữ ký số đầu tệp (Magic Bytes) chống giả mạo định dạng cho Hợp đồng điện tử (Mục 4.2).
 * Hỗ trợ: PDF (%PDF), JPEG (FF D8 FF), PNG (89 50 4E 47), WEBP (RIFF....WEBP), DOCX (50 4B 03 04), DOC (D0 CF 11 E0).
 */
export function verifyContractMagicBytes(
  bytes: Uint8Array,
  fileName = '',
): { valid: boolean; detectedMime: string; message: string } {
  if (!bytes || bytes.length < 4) {
    return { valid: false, detectedMime: '', message: 'Tệp tải lên rỗng hoặc không hợp lệ' };
  }
  if (bytes.length > CONTRACT_MAX_SIZE_BYTES) {
    return { valid: false, detectedMime: '', message: 'Dung lượng tệp hợp đồng vượt quá giới hạn 6MB' };
  }
  const b0 = bytes[0]!;
  const b1 = bytes[1]!;
  const b2 = bytes[2]!;
  const b3 = bytes[3]!;

  // PDF: 25 50 44 46 (%PDF)
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) {
    return { valid: true, detectedMime: 'application/pdf', message: 'Tệp PDF hợp lệ' };
  }
  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return { valid: true, detectedMime: 'image/jpeg', message: 'Ảnh JPEG hợp lệ' };
  }
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
    return { valid: true, detectedMime: 'image/png', message: 'Ảnh PNG hợp lệ' };
  }
  // WEBP: RIFF (52 49 46 46) ... WEBP (57 45 42 50 at 8..11)
  if (
    bytes.length >= 12 &&
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { valid: true, detectedMime: 'image/webp', message: 'Ảnh WEBP hợp lệ' };
  }
  // DOCX (PK ZIP): 50 4B 03 04
  if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) {
    return {
      valid: true,
      detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      message: 'Tài liệu Word DOCX hợp lệ',
    };
  }
  // DOC (OLE2 Compound Document): D0 CF 11 E0
  if (b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0) {
    return { valid: true, detectedMime: 'application/msword', message: 'Tài liệu Word DOC hợp lệ' };
  }
  return {
    valid: false,
    detectedMime: '',
    message: `Tệp "${fileName || 'tải lên'}" không đúng chữ ký định dạng chuẩn (chỉ chấp nhận PDF, JPG, PNG, WEBP, DOC, DOCX)`,
  };
}

/** Sinh mã nhân sự chuẩn UBM_NV000001 (Mục 2.5) và đọc số thứ tự từ cả mã cũ NV0001 lẫn mã mới UBM_NV000001. */
export function formatUbmEmployeeCode(seq: number): string {
  return `UBM_NV${String(Math.max(1, Math.floor(seq))).padStart(6, '0')}`;
}

export function parseEmployeeCodeSeq(code: string): number {
  const m = String(code ?? '').match(/(\d+)$/);
  return m ? Number(m[1]) || 0 : 0;
}

/**
 * Kiểm tra nhân sự có thuộc Khối văn phòng hay không:
 * - staff_group là BACKOFFICE hoặc OFFICE
 * - ca mặc định là HANH_CHINH
 * - vai trò hệ thống là HR, FINANCE, MKT, ADMIN
 * - chức danh chứa Văn phòng / Kế toán / Marketing / Hành chính / Nhân sự
 */
export function isOfficeEmployeeSpec(emp?: {
  staff_group?: string;
  default_shift_code?: string;
  position_title?: string;
  branch_id?: string;
} | null, role?: string): boolean {
  if (!emp && !role) return false;
  const staffGroup = String(emp?.staff_group || '').toUpperCase();
  if (staffGroup === 'BACKOFFICE' || staffGroup === 'OFFICE') return true;
  if (emp?.default_shift_code === 'HANH_CHINH') return true;
  const r = String(role || '').toUpperCase();
  if (['HR', 'FINANCE', 'MKT', 'ADMIN'].includes(r)) return true;
  const title = String(emp?.position_title || '').toUpperCase();
  if (title.includes('VĂN PHÒNG') || title.includes('VAN PHONG') || title.includes('HÀNH CHÍNH') || title.includes('HANH CHINH') || title.includes('KẾ TOÁN') || title.includes('KE TOAN') || title.includes('MARKETING') || title.includes('NHÂN SỰ') || title.includes('NHAN SU')) return true;
  return false;
}
