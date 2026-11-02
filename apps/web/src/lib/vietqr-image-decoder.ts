/**
 * Bộ giải mã ảnh Mã QR Ngân hàng trên trình duyệt (Mục 4.3):
 * 1. Sử dụng Web API BarcodeDetector (qr_code) để quét trực tiếp chuỗi EMVCo TLV từ ảnh QR tải lên.
 * 2. Giải mã cấu trúc TLV Napas247 (30 mã BIN ngân hàng Việt Nam) qua `parseVietQrEmvcoPayload`.
 * 3. Dự phòng trích xuất thông tin ngân hàng từ chuỗi văn bản OCR / tên tệp qua `extractBankAccountFromOcrText`.
 */

import {
  extractBankAccountFromOcrText,
  parseVietQrEmvcoPayload,
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
 * Giải mã chuỗi dữ liệu thô (EMVCo TLV hoặc văn bản OCR) thành thông tin tài khoản ngân hàng.
 */
export function decodeVietQrPayloadOrText(raw: string): ParsedVietQrResult | null {
  const clean = String(raw ?? '').trim();
  if (!clean) return null;
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

async function detectQrRawValueFromBrowser(file?: File, dataUrl?: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
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
    if (dataUrl) {
      const img = await loadImageElement(dataUrl);
      if (img) {
        const hits = await detector.detect(img);
        const val = hits.find((h) => h.rawValue?.trim())?.rawValue?.trim();
        if (val) return val;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function extractAsciiHintFromFile(file?: File): Promise<string> {
  if (!file || typeof file.arrayBuffer !== 'function') return '';
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf.slice(0, 65536));
    let ascii = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const c = bytes[i]!;
      if (c >= 32 && c <= 126) ascii += String.fromCharCode(c);
      else if (ascii.length > 0 && ascii[ascii.length - 1] !== ' ') ascii += ' ';
    }
    return ascii;
  } catch {
    return '';
  }
}

/**
 * Tự động nhận diện thông tin Ngân hàng, Số tài khoản, Chủ tài khoản từ tệp ảnh QR hoặc chuỗi dữ liệu.
 */
export async function decodeVietQrFromImage(params: {
  file?: File;
  dataUrl?: string;
  fallbackText?: string;
}): Promise<ParsedVietQrResult | null> {
  const qrRaw = await detectQrRawValueFromBrowser(params.file, params.dataUrl);
  if (qrRaw) {
    const parsed = decodeVietQrPayloadOrText(qrRaw);
    if (parsed) return parsed;
  }

  const asciiHint = await extractAsciiHintFromFile(params.file);
  if (asciiHint.includes('000201')) {
    const parsedFromBytes = decodeVietQrPayloadOrText(asciiHint);
    if (parsedFromBytes) return parsedFromBytes;
  }

  const fileHint = [params.fallbackText ?? '', params.file?.name ?? ''].join(' ').trim();
  if (fileHint) {
    const parsedFallback = decodeVietQrPayloadOrText(fileHint);
    if (parsedFallback) return parsedFallback;
  }

  return null;
}
