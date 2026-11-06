/**
 * Bộ giải mã ảnh Mã QR Ngân hàng trên trình duyệt (Mục 4.3):
 * 1. Vẽ ảnh lên Canvas HTML5 và quét ma trận điểm ảnh bằng `jsqr` (hoạt động trên 100% trình duyệt).
 * 2. Kết hợp Web API `BarcodeDetector` (nếu trình duyệt hỗ trợ).
 * 3. Giải mã cấu trúc TLV Napas247 (30 mã BIN ngân hàng Việt Nam) qua `parseVietQrEmvcoPayload`.
 */

import jsQR from 'jsqr';
import {
  extractBankAccountFromOcrText,
  parseVietQrEmvcoPayload,
  parseVietQrUrlPayload,
  type ParsedVietQrResult,
} from '@umbm/shared';

interface BarcodeDetectionItem {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectionItem[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

/**
 * Giải mã chuỗi dữ liệu thô (EMVCo TLV, URL VietQR hoặc văn bản OCR) thành thông tin tài khoản ngân hàng.
 */
export function decodeVietQrPayloadOrText(raw: string): ParsedVietQrResult | null {
  const clean = String(raw ?? '').trim();
  if (!clean) return null;
  const fromUrl = parseVietQrUrlPayload(clean);
  if (fromUrl) return fromUrl;
  const emvMatch = clean.match(/(000201[\dA-Za-z\s._\-/]{20,})/);
  if (emvMatch?.[1]) {
    const parsedEmv = parseVietQrEmvcoPayload(emvMatch[1].trim());
    if (parsedEmv) return parsedEmv;
  }
  return parseVietQrEmvcoPayload(clean) ?? extractBankAccountFromOcrText(clean);
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined' || !dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function scanQrWithJsQrAtScale(img: HTMLImageElement, maxSide: number): string | null {
  if (typeof document === 'undefined') return null;
  const naturalW = img.naturalWidth || img.width || 0;
  const naturalH = img.naturalHeight || img.height || 0;
  if (naturalW <= 0 || naturalH <= 0) return null;

  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
  return code?.data?.trim() || null;
}

async function detectQrRawValueFromImage(file?: File, dataUrl?: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  // 1. Quét bằng jsQR trên Canvas ở nhiều độ phân giải để bắt chính xác cả ảnh chụp màn hình dài lẫn ảnh QR cắt sát
  if (dataUrl) {
    const img = await loadImageElement(dataUrl);
    if (img) {
      for (const maxSide of [1200, 800, 1600, 500]) {
        const hit = scanQrWithJsQrAtScale(img, maxSide);
        if (hit) return hit;
      }
    }
  }

  // 2. Dự phòng bằng BarcodeDetector gốc của trình duyệt nếu có
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const detector = new Detector({ formats: ['qr_code'] });
    if (file && typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try {
        const hits = await detector.detect(bitmap);
        const val = hits.find((h) => h.rawValue?.trim())?.rawValue?.trim();
        if (val) return val;
      } finally {
        bitmap.close?.();
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Tự động nhận diện thông tin Ngân hàng, Số tài khoản, Chủ tài khoản từ tệp ảnh QR.
 * Pipeline: (1) jsQR đọc mã QR → (2) parse EMVCo TLV / URL VietQR.
 * Nếu mã QR không chứa tên chủ tài khoản (phổ biến với QR cá nhân VN), để trống để người dùng tự nhập.
 */
export async function decodeVietQrFromImage(params: {
  file?: File;
  dataUrl?: string;
}): Promise<ParsedVietQrResult | null> {
  const qrRaw = await detectQrRawValueFromImage(params.file, params.dataUrl);
  if (qrRaw) {
    return decodeVietQrPayloadOrText(qrRaw);
  }
  // Thử parse từ tên file (trường hợp file có tên chứa thông tin ngân hàng)
  const fileName = params.file?.name ?? '';
  if (fileName) {
    return decodeVietQrPayloadOrText(fileName);
  }
  return null;
}
