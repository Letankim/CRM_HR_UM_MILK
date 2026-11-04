'use client';

export interface CompressedAvatarResult {
  dataUrl: string;
  width: number;
  height: number;
  approxBytes: number;
}

export interface CompressAvatarOptions {
  maxDimension?: number;
  quality?: number;
}

function loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Tệp hình ảnh không hợp lệ hoặc không mở được'));
    };
    el.src = objectUrl;
  });
}

/**
 * Nén và cắt vuông ảnh đại diện phía client (1:1 center-crop):
 * - Tự động căn giữa khuôn mặt / bố cục ảnh.
 * - Chuẩn hóa kích thước tối đa 400x400 px.
 * - Giảm dung lượng từ vài MB xuống còn ~40-80KB chuẩn JPEG mà vẫn giữ nét.
 */
export async function compressAvatarFile(
  file: File | Blob,
  options: CompressAvatarOptions = {},
): Promise<CompressedAvatarResult> {
  const maxDim = options.maxDimension ?? 400;
  const quality = options.quality ?? 0.88;

  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn tệp định dạng hình ảnh (JPG, PNG, WEBP)');
  }

  const img = await loadImageFromFile(file);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) {
    throw new Error('Không đọc được kích thước hình ảnh');
  }

  // Cắt khung vuông 1:1 từ tâm
  const minSide = Math.min(nw, nh);
  const sx = Math.floor((nw - minSide) / 2);
  const sy = Math.floor((nh - minSide) / 2);
  const targetDim = Math.min(minSide, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = targetDim;
  canvas.height = targetDim;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý hình ảnh');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetDim, targetDim);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const headLen = dataUrl.indexOf(',') + 1;
  const base64Len = dataUrl.length - headLen;
  const approxBytes = Math.floor((base64Len * 3) / 4);

  return {
    dataUrl,
    width: targetDim,
    height: targetDim,
    approxBytes,
  };
}
