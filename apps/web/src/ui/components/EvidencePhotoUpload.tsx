'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Button, Space, Typography, Upload } from 'antd';
import { CameraOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { FancyboxImage } from './FancyboxPreview';

/** Nén ảnh người dùng chọn thành JPEG data URL (cạnh dài tối đa `maxSize`px, chất lượng `quality`). */
export async function compressImageToJpegDataUrl(file: File, maxSize = 1280, quality = 0.8): Promise<string> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được ảnh'));
      el.src = srcUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh');
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
}

/** Ô tải / chụp Ảnh minh chứng (1 ảnh) dùng trong Form; giá trị là JPEG data URL đã nén. */
export function EvidencePhotoUpload({ value, onChange, disabled }: EvidencePhotoUploadProps) {
  const { message } = App.useApp();
  const [processing, setProcessing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = wrapRef.current?.querySelector('input[type="file"]');
    if (input) input.setAttribute('capture', 'environment');
  }, [value]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { message.error('Vui lòng chọn tệp hình ảnh làm minh chứng'); return; }
    setProcessing(true);
    try {
      onChange?.(await compressImageToJpegDataUrl(file));
    } catch {
      message.error('Không xử lý được ảnh minh chứng, vui lòng chụp lại');
    } finally {
      setProcessing(false);
    }
  };

  const picker = (label: string, icon: ReactNode, type: 'primary' | 'default' = 'default') => (
    <Upload accept="image/*" maxCount={1} showUploadList={false} disabled={disabled || processing} beforeUpload={(file) => { void handleFile(file); return false; }}>
      <Button size="small" type={type} icon={icon} loading={processing} disabled={disabled}>{label}</Button>
    </Upload>
  );

  return (
    <div ref={wrapRef}>
      {value ? (
        <Space align="start" size={12} wrap>
          <div style={{ width: 120, border: '1px solid #E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
            <FancyboxImage src={value} alt="Ảnh minh chứng" caption="Ảnh minh chứng lỗi chấm công" height={90} />
          </div>
          <Space direction="vertical" size={6}>
            {picker('Chụp / chọn lại ảnh', <ReloadOutlined />)}
            <Button size="small" danger icon={<DeleteOutlined />} disabled={disabled} onClick={() => onChange?.('')}>Xóa ảnh</Button>
          </Space>
        </Space>
      ) : (
        <Space direction="vertical" size={4}>
          {picker('Chụp / chọn ảnh minh chứng', <CameraOutlined />, 'primary')}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Ảnh được nén tự động (tối đa 1280px) trước khi gửi.</Typography.Text>
        </Space>
      )}
    </div>
  );
}
