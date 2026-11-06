/**
 * Đọc chữ trên ảnh mã QR ngân hàng (OCR tiếng Việt chạy trên trình duyệt bằng tesseract.js)
 * để lấy Tên chủ tài khoản — vì mã QR cá nhân của app ngân hàng thường không chứa tên trong mã,
 * tên chỉ được in thành chữ trên ảnh.
 */
import { cleanAccountHolder, extractHolderFromText } from '@umbm/shared';

/** Tiền xử lý ảnh: phóng to + chuyển xám để OCR đọc chính xác hơn. */
async function preprocess(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = dataUrl;
  });
  if (!img) return dataUrl;
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const scale = Math.min(2.5, Math.max(1, 1600 / Math.max(w0, h0)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Tìm dòng tên in hoa nằm sau/ trước số tài khoản (bố cục phổ biến của ảnh QR ngân hàng). */
function pickHolderNearAccount(text: string, accountNumber?: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const acc = String(accountNumber ?? '').replace(/\D/g, '');
  const idx = acc ? lines.findIndex((l) => l.replace(/\D/g, '').includes(acc)) : -1;
  const candidates = idx >= 0 ? [lines[idx - 1], lines[idx + 1], lines[idx - 2], lines[idx + 2]] : [];
  for (const c of candidates) {
    if (!c) continue;
    const letters = c.replace(/[^A-Za-zÀ-ỹĐđ\s]/g, '').trim();
    if (letters.split(/\s+/).length >= 2 && letters === letters.toUpperCase()) {
      const name = cleanAccountHolder(letters);
      if (name && !/NG[AÂ]N\s*H[AÀ]NG|BANK|NAPAS|VIETQR|SCAN\s*TO\s*PAY|MA\s*QR|MÃ\s*QR|QUET\s*MA|QUÉT\s*MÃ|CHUYEN\s*KHOAN|CHUYỂN\s*KHOẢN|CA\s*NHAN|CÁ\s*NHÂN|THANH\s*TOAN|THANH\s*TOÁN|CHI\s*NHANH|CHI\s*NHÁNH|PAYMENT|TRANSFER|PERSONAL|DOWNLOAD|SHARE/i.test(name)) return name;
    }
  }
  return '';
}

/** Trả về Tên chủ tài khoản đọc được từ ảnh, hoặc chuỗi rỗng nếu không đọc được. */
export async function ocrBankAccountHolder(dataUrl: string, accountNumber?: string): Promise<string> {
  if (typeof window === 'undefined' || !dataUrl) return '';
  try {
    const text = await ocrRawText(dataUrl);
    if (!text) return '';
    return extractHolderFromText(text) || pickHolderNearAccount(text, accountNumber);
  } catch {
    return '';
  }
}

/** Trả về toàn bộ văn bản OCR đọc được từ ảnh (dùng cho trường hợp không tìm thấy QR). */
export async function ocrRawText(dataUrl: string): Promise<string> {
  if (typeof window === 'undefined' || !dataUrl) return '';
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['vie', 'eng']);
    try {
      const { data } = await worker.recognize(await preprocess(dataUrl));
      return String(data.text || '');
    } finally {
      await worker.terminate();
    }
  } catch {
    return '';
  }
}
