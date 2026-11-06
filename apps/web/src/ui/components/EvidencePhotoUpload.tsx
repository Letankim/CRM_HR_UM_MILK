'use client';

import { useState } from 'react';
import { Button, Flex, Space, Tag, Typography } from 'antd';
import { CameraOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { computeCrispDimensions } from '@/lib/payroll-file-helpers';
import { EvidenceCameraModal } from './EvidenceCameraModal';
import { FancyboxImage } from './FancyboxPreview';

const DIRECT_PASSTHROUGH_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

/** Nén ảnh thông minh giữ độ nét cao: giữ nguyên bản gốc nếu ảnh <= 750KB, hoặc thu phóng khử răng cưa chuẩn Full-HD+ (quality 0.90). */
export async function compressImageToJpegDataUrl(file: File, maxSize = 2400, quality = 0.9): Promise<string> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không giải mã được tệp ảnh, vui lòng chọn ảnh JPG, PNG hoặc WEBP chuẩn'));
      el.src = srcUrl;
    });
    const mime = (file.type || '').toLowerCase();
    const origLong = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    if (DIRECT_PASSTHROUGH_MIMES.has(mime) && file.size <= 750 * 1024 && origLong <= Math.max(maxSize, 2600)) {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => (typeof reader.result === 'string' && reader.result ? resolve(reader.result) : reject(new Error('Không đọc được tệp ảnh')));
        reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
        reader.readAsDataURL(file);
      });
    }
    const { width: w, height: h } = computeCrispDimensions(img.naturalWidth, img.naturalHeight, Math.min(1280, maxSize), maxSize);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

export interface EvidencePhotoUploadProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  watermarkTitle?: string;
}

/**
 * Ô chụp ảnh minh chứng trực tiếp qua Camera (không cho phép tải ảnh có sẵn từ máy tính / thư viện).
 * Tự động đóng dấu thời gian chụp và tọa độ GPS trực tiếp lên ảnh giống như điểm danh Vào/Ra ca.
 */
export function EvidencePhotoUpload({ value, onChange, disabled, watermarkTitle }: EvidencePhotoUploadProps) {
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <>
      {value ? (
        <Flex
          align="center"
          gap={12}
          wrap="wrap"
          style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: 10 }}
        >
          <div style={{ width: 112, border: '1px solid #CBD5E1', borderRadius: 4, overflow: 'hidden', background: '#FFFFFF', flexShrink: 0 }}>
            <FancyboxImage src={value} alt="Ảnh minh chứng Camera" caption="Ảnh chụp minh chứng trực tiếp (đã đóng dấu thời gian & tọa độ GPS)" height={84} />
          </div>
          <Space direction="vertical" size={6} style={{ flex: 1, minWidth: 180 }}>
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
              Đã chụp ảnh minh chứng trực tiếp
            </Tag>
            <Flex gap={6} wrap="wrap">
              <Button size="small" type="primary" ghost icon={<CameraOutlined />} disabled={disabled} onClick={() => setCameraOpen(true)}>
                Chụp lại ảnh trực tiếp
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={disabled} onClick={() => onChange?.('')}>
                Xóa ảnh
              </Button>
            </Flex>
          </Space>
        </Flex>
      ) : (
        <div
          style={{
            border: '1px dashed #CBD5E1',
            borderRadius: 4,
            background: '#F8FAFC',
            padding: '10px 12px',
          }}
        >
          <Flex gap={8} wrap="wrap" align="center">
            <Button type="primary" icon={<CameraOutlined />} disabled={disabled} onClick={() => setCameraOpen(true)}>
              Chụp ảnh trực tiếp
            </Button>
          </Flex>
        </div>
      )}
      <EvidenceCameraModal
        open={cameraOpen}
        watermarkTitle={watermarkTitle}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl) => onChange?.(dataUrl)}
      />
    </>
  );
}
