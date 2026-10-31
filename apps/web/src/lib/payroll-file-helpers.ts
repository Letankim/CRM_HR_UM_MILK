'use client';

export interface ExportFilePayload {
  fileName: string;
  mimeType: string;
  base64: string;
  count?: number;
  fileNames?: string[];
}

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/**
 * Chuẩn hóa mọi tệp ảnh người dùng chọn (PNG, JPG, WEBP) thành chuỗi data:image/png;base64
 * giữ nguyên nền trong suốt (cho chữ ký) và thu gọn kích thước tối đa maxDim px.
 */
export async function normalizeImageFileToPngDataUrl(file: File, maxDim = 900): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn tệp hình ảnh hợp lệ (PNG hoặc JPG)');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Kích thước tệp ảnh vượt quá giới hạn tối đa 6MB');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh từ thiết bị'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Tệp hình ảnh bị hỏng hoặc không đúng định dạng'));
    el.src = rawDataUrl;
  });

  const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 300) * ratio));
  const height = Math.max(1, Math.round((img.naturalHeight || 150) * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý khung ảnh');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/** Giải mã chuỗi Base64 thành tệp nhị phân chuẩn xác 100% và kích hoạt tải xuống trình duyệt */
export function downloadBase64File(base64: string, fileName: string, mimeType: string): void {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
