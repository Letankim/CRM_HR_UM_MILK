/**
 * Bộ nhận diện đồng phục Áo hồng thương hiệu Ụm Bò Milk bằng hệ màu HSV trên Canvas HTML5 (Mục 8.2).
 * Ngưỡng đạt chuẩn đối với Nhân viên chính thức: >= 10% diện tích khung hình.
 */

export const PINK_UNIFORM_THRESHOLD_PERCENT = 10;

export interface PinkUniformAnalysisResult {
  pinkRatioPercent: number;
  passed: boolean;
  samplePixels: number;
}

/**
 * Chuyển đổi giá trị màu RGB (0..255) sang không gian màu HSV (Hue: 0..360, Saturation: 0..1, Value: 0..1).
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

/**
 * Kiểm tra 1 điểm ảnh (R, G, B) có thuộc dải màu hồng thương hiệu Ụm Bò Milk hay không:
 * - Hue: [285°..360°] hoặc [0°..12°]
 * - Saturation >= 0.18
 * - Value >= 0.25
 */
export function isBrandPinkPixel(r: number, g: number, b: number): boolean {
  const { h, s, v } = rgbToHsv(r, g, b);
  const hueInPinkBand = (h >= 285 && h <= 360) || (h >= 0 && h <= 12);
  return hueInPinkBand && s >= 0.18 && v >= 0.25;
}

/**
 * Phân tích tỷ lệ màu áo hồng đồng phục từ chuỗi ảnh Data URL (JPEG/PNG) chụp từ Camera.
 * Thu gọn về kích thước lấy mẫu 160x160 để xử lý tức thì trên trình duyệt di động.
 */
export function analyzePinkUniformFromDataUrl(dataUrl: string): Promise<PinkUniformAnalysisResult> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !dataUrl) {
    return Promise.resolve({ pinkRatioPercent: 0, passed: false, samplePixels: 0 });
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const sampleSize = 160;
        const canvas = document.createElement('canvas');
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ pinkRatioPercent: 0, passed: false, samplePixels: 0 });
          return;
        }
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const totalPixels = sampleSize * sampleSize;
        let pinkCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const a = data[i + 3] ?? 255;
          if (a >= 128 && isBrandPinkPixel(r, g, b)) {
            pinkCount += 1;
          }
        }

        const pinkRatioPercent = Math.round((pinkCount / totalPixels) * 1000) / 10;
        resolve({
          pinkRatioPercent,
          passed: pinkRatioPercent >= PINK_UNIFORM_THRESHOLD_PERCENT,
          samplePixels: totalPixels,
        });
      } catch {
        resolve({ pinkRatioPercent: 0, passed: false, samplePixels: 0 });
      }
    };
    img.onerror = () => {
      resolve({ pinkRatioPercent: 0, passed: false, samplePixels: 0 });
    };
    img.src = dataUrl;
  });
}
