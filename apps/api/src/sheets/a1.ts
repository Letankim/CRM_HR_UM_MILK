/** Chuyển số thứ tự cột (1-based) thành ký hiệu cột A1: 1 -> A, 27 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Lấy số dòng từ range trả về bởi API, ví dụ "USERS!A12:W12" -> 12. */
export function rowFromRange(range: string): number {
  const match = /![A-Z]+(\d+)/.exec(range);
  if (!match?.[1]) throw new Error(`Không đọc được số dòng từ range: ${range}`);
  return Number(match[1]);
}

/**
 * Mọi giá trị được ghi dưới dạng chuỗi (valueInputOption=RAW) để Sheets không tự
 * đổi định dạng: số điện thoại +84..., ngày giờ ISO, số tiền đều được giữ nguyên.
 */
export function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
