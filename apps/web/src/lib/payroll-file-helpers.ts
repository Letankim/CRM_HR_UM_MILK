'use client';

export interface ExportFilePayload {
  fileName: string;
  mimeType: string;
  base64: string;
  count?: number;
  fileNames?: string[];
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const RASTER_MKT_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp']);
const PDF_SAFE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

export interface NormalizeImageOptions {
  preferJpeg?: boolean;
  quality?: number;
  maxShortEdge?: number;
  passthroughMaxBytes?: number;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' && reader.result ? resolve(reader.result) : reject(new Error('Không đọc được tệp')));
    reader.onerror = () => reject(new Error('Không đọc được tệp'));
    reader.readAsDataURL(blob);
  });
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

/**
 * Tính kích thước thu phóng thông minh theo cả cạnh ngắn và cạnh dài:
 * - Ảnh chụp màn hình điện thoại dọc (VD 1170x2532) giữ nguyên bề ngang ~1100px để chữ nhỏ và Mã QR không bao giờ bị nhòe;
 * - Ảnh chụp Camera độ phân giải siêu lớn (VD 4032x3024, 5-10MB) thu gọn hợp lý về chuẩn Full-HD sắc nét (~200-300KB).
 */
export function computeCrispDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxShortEdge: number,
  maxLongEdge: number,
): { width: number; height: number; scale: number } {
  const w0 = Math.max(1, naturalWidth || 800);
  const h0 = Math.max(1, naturalHeight || 600);
  const shortEdge = Math.min(w0, h0);
  const longEdge = Math.max(w0, h0);
  const scale = Math.min(1, maxShortEdge / shortEdge, maxLongEdge / longEdge);
  return {
    width: Math.max(1, Math.round(w0 * scale)),
    height: Math.max(1, Math.round(h0 * scale)),
    scale,
  };
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

function createHighQualityCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý khung ảnh');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/**
 * Chuẩn hóa & nén cân bằng độ nét cao cho Chữ ký / Mã QR Ngân hàng:
 * - Tệp PNG/JPG vốn đã nhẹ (<= passthroughMaxBytes) và kích thước hợp lý được giữ nguyên bản gốc 100% không suy hao;
 * - Tệp ảnh lớn hoặc WEBP được thu phóng khử răng cưa chất lượng cao, giữ chữ nhỏ & QR sắc nét nhưng dung lượng chỉ ~120-260KB.
 */
export async function normalizeImageFileToPngDataUrl(
  file: File,
  maxLongEdge = 1400,
  opts?: NormalizeImageOptions,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG hoặc WEBP)');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Kích thước tệp ảnh vượt quá giới hạn tối đa 12MB');
  }

  const mime = file.type.toLowerCase();
  const img = await loadImageFromBlob(file);
  const maxShortEdge = opts?.maxShortEdge ?? Math.min(1000, maxLongEdge);
  const passthroughLimit = opts?.passthroughMaxBytes ?? 500 * 1024;
  const origLong = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);

  if (PDF_SAFE_MIMES.has(mime) && file.size <= passthroughLimit && origLong <= Math.max(maxLongEdge, 2400)) {
    return readBlobAsDataUrl(file);
  }

  const { width, height } = computeCrispDimensions(img.naturalWidth, img.naturalHeight, maxShortEdge, maxLongEdge);
  const quality = opts?.quality ?? 0.91;

  if (opts?.preferJpeg) {
    const { canvas, ctx } = createHighQualityCanvas(width, height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const jpegUrl = canvas.toDataURL('image/jpeg', quality);
    if (PDF_SAFE_MIMES.has(mime) && file.size <= 950 * 1024 && estimateBase64Bytes(jpegUrl) >= file.size * 0.92) {
      return readBlobAsDataUrl(file);
    }
    return jpegUrl;
  }

  const { canvas, ctx } = createHighQualityCanvas(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  if (hasCanvasTransparency(ctx, width, height)) {
    return canvas.toDataURL('image/png');
  }
  const { canvas: jpgCanvas, ctx: jpgCtx } = createHighQualityCanvas(width, height);
  jpgCtx.fillStyle = '#FFFFFF';
  jpgCtx.fillRect(0, 0, width, height);
  jpgCtx.drawImage(canvas, 0, 0);
  return jpgCanvas.toDataURL('image/jpeg', quality);
}

/** Đọc tệp Kho Media: giữ nguyên gốc 100% cho ảnh <= 1.1MB; chỉ nén thông minh chuẩn 2K QHD+ (quality 0.90) với ảnh máy ảnh quá nặng. */
export async function readAndOptimizeMktMediaFile(
  file: File,
  fallbackMime: string,
): Promise<{ dataUrl: string; mimeType: string; sizeBytes: number }> {
  const mime = (file.type && file.type !== 'application/octet-stream' ? file.type : fallbackMime).toLowerCase();
  if (RASTER_MKT_MIMES.has(mime) && file.size > 1100 * 1024) {
    try {
      const img = await loadImageFromBlob(file);
      const { width: w, height: h } = computeCrispDimensions(img.naturalWidth, img.naturalHeight, 1600, 2880);
      const { canvas, ctx } = createHighQualityCanvas(w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const keepPng = mime === 'image/png' && hasCanvasTransparency(ctx, w, h);
      let outUrl: string;
      let outMime: string;
      if (keepPng) {
        outUrl = canvas.toDataURL('image/png');
        outMime = 'image/png';
      } else {
        const { canvas: jc, ctx: jctx } = createHighQualityCanvas(w, h);
        jctx.fillStyle = '#FFFFFF';
        jctx.fillRect(0, 0, w, h);
        jctx.drawImage(canvas, 0, 0);
        outUrl = jc.toDataURL('image/jpeg', 0.9);
        outMime = 'image/jpeg';
      }
      const outBytes = estimateBase64Bytes(outUrl);
      if (outBytes < file.size * 0.82) {
        return { dataUrl: outUrl, mimeType: outMime, sizeBytes: outBytes };
      }
    } catch {
      // Fallback sang đọc nguyên bản bên dưới
    }
  }
  const rawUrl = await readBlobAsDataUrl(file);
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
