'use client';

export interface ExportFilePayload {
  fileName: string;
  mimeType: string;
  base64: string;
  count?: number;
  fileNames?: string[];
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const RASTER_MKT_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp']);

export interface NormalizeImageOptions {
  preferJpeg?: boolean;
  quality?: number;
}

function loadImageFromBlob(file: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Tệp hình ảnh bị hỏng hoặc không đúng định dạng'));
    };
    el.src = objectUrl;
  });
}

function hasCanvasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(4, Math.floor(data.length / 4096) * 4);
    for (let i = 3; i < data.length; i += step) {
      if ((data[i] ?? 255) < 245) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function estimateBase64Bytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
  return Math.max(1, Math.round((b64Len * 3) / 4));
}

/**
 * Chuẩn hóa & nén thông minh ảnh chữ ký / Mã QR (PNG, JPG, WEBP):
 * - Giữ nguyên nền trong suốt (PNG) nếu là chữ ký tách nền;
 * - Tự động chuyển ảnh chụp giấy / Mã QR không trong suốt sang JPEG nhẹ (~25–45 KB thay vì 1.5 MB).
 */
export async function normalizeImageFileToPngDataUrl(
  file: File,
  maxDim = 560,
  opts?: NormalizeImageOptions,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG hoặc WEBP)');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Kích thước tệp ảnh vượt quá giới hạn tối đa 8MB');
  }

  const img = await loadImageFromBlob(file);
  const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 300) * ratio));
  const height = Math.max(1, Math.round((img.naturalHeight || 150) * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý khung ảnh');

  if (opts?.preferJpeg) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', opts?.quality ?? 0.84);
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  if (hasCanvasTransparency(ctx, width, height)) {
    return canvas.toDataURL('image/png');
  }
  const jpgCanvas = document.createElement('canvas');
  jpgCanvas.width = width;
  jpgCanvas.height = height;
  const jpgCtx = jpgCanvas.getContext('2d');
  if (!jpgCtx) return canvas.toDataURL('image/png');
  jpgCtx.fillStyle = '#FFFFFF';
  jpgCtx.fillRect(0, 0, width, height);
  jpgCtx.drawImage(canvas, 0, 0);
  return jpgCanvas.toDataURL('image/jpeg', opts?.quality ?? 0.85);
}

/** Đọc tệp Kho Media và tự động nén ảnh chụp lớn (>320 KB) về chuẩn Web sắc nét (<=1600px) để tải lên tức thì. */
export async function readAndOptimizeMktMediaFile(
  file: File,
  fallbackMime: string,
): Promise<{ dataUrl: string; mimeType: string; sizeBytes: number }> {
  const mime = (file.type && file.type !== 'application/octet-stream' ? file.type : fallbackMime).toLowerCase();
  if (RASTER_MKT_MIMES.has(mime) && file.size > 320 * 1024) {
    try {
      const img = await loadImageFromBlob(file);
      const ratio = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 800) * ratio));
      const h = Math.max(1, Math.round((img.naturalHeight || 600) * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const keepPng = mime === 'image/png' && hasCanvasTransparency(ctx, w, h);
        let outUrl: string;
        let outMime: string;
        if (keepPng) {
          outUrl = canvas.toDataURL('image/png');
          outMime = 'image/png';
        } else {
          const jc = document.createElement('canvas');
          jc.width = w;
          jc.height = h;
          const jctx = jc.getContext('2d')!;
          jctx.fillStyle = '#FFFFFF';
          jctx.fillRect(0, 0, w, h);
          jctx.drawImage(canvas, 0, 0);
          outUrl = jc.toDataURL('image/jpeg', 0.84);
          outMime = 'image/jpeg';
        }
        const outBytes = estimateBase64Bytes(outUrl);
        if (outBytes < file.size) {
          return { dataUrl: outUrl, mimeType: outMime, sizeBytes: outBytes };
        }
      }
    } catch {
      // Fallback sang đọc nguyên bản bên dưới
    }
  }
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' && reader.result ? resolve(reader.result) : reject(new Error('Không đọc được tệp')));
    reader.onerror = () => reject(new Error('Không đọc được tệp'));
    reader.readAsDataURL(file);
  });
  return { dataUrl: rawUrl, mimeType: file.type || fallbackMime, sizeBytes: file.size };
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
