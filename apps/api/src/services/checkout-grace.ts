/**
 * Thời hạn tối đa được phép chấm công Ra ca sau giờ kết thúc ca (mặc định 3 giờ).
 * Giá trị được đồng bộ từ cấu hình vận hành (ATTENDANCE_CHECKOUT_MAX_LATE_HOURS) mỗi khi đọc / lưu cấu hình.
 * Module không phụ thuộc module khác để tránh vòng lặp import.
 */
let checkoutGraceMinutes = 180;

export function setCheckoutGraceMinutes(minutes: number): void {
  if (Number.isFinite(minutes) && minutes >= 0) checkoutGraceMinutes = Math.round(minutes);
}

export function getCheckoutGraceMinutes(): number {
  return checkoutGraceMinutes;
}

export function formatGraceLabel(minutes = checkoutGraceMinutes): string {
  return minutes % 60 === 0 ? `${minutes / 60} giờ` : `${minutes} phút`;
}
