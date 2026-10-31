'use client';

import { useState, type ClipboardEvent, type DragEvent } from 'react';
import { App, Button, Flex, Space, Tag, Typography, Upload } from 'antd';
import { CameraOutlined, CheckCircleOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { EvidenceCameraModal } from './EvidenceCameraModal';
import { FancyboxImage } from './FancyboxPreview';

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
const MAX_RAW_BYTES = 15 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 6 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Không đọc được tệp ảnh')));
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    reader.readAsDataURL(file);
  });
}

/** Nén ảnh người dùng tải lên hoặc chụp thành JPEG data URL (cạnh dài tối đa `maxSize`px, chất lượng `quality`). */
export async function compressImageToJpegDataUrl(file: File, maxSize = 1024, quality = 0.76): Promise<string> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không giải mã được ảnh'));
      el.src = srcUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    if (file.type.startsWith('image/') && file.size <= MAX_FALLBACK_BYTES) {
      const raw = await readFileAsDataUrl(file);
      if (raw.startsWith('data:image/')) return raw;
    }
    throw err;
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

export interface EvidencePhotoUploadProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

/**
 * Ô tải ảnh từ máy tính / thư viện điện thoại hoặc chụp ảnh trực tiếp qua Camera làm minh chứng.
 * Không gắn `capture` lên nút Tải ảnh để người dùng luôn chọn được tệp hình ảnh có sẵn trên thiết bị.
 */
export function EvidencePhotoUpload({ value, onChange, disabled }: EvidencePhotoUploadProps) {
  const { message } = App.useApp();
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/') && !IMAGE_EXT_REGEX.test(file.name || '')) {
      message.error('Vui lòng chọn tệp hình ảnh hợp lệ (JPG, PNG, WEBP)');
      return;
    }
    if (file.size > MAX_RAW_BYTES) {
      message.error('Dung lượng ảnh quá lớn (tối đa 15MB), vui lòng chọn ảnh nhẹ hơn');
      return;
    }
    setProcessing(true);
    try {
      onChange?.(await compressImageToJpegDataUrl(file));
    } catch {
      message.error('Không xử lý được tệp ảnh, vui lòng chọn ảnh JPG, PNG hoặc WEBP khác');
    } finally {
      setProcessing(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || processing) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (disabled || processing) return;
    const item = Array.from(e.clipboardData?.items ?? []).find((x) => x.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      void handleFile(file);
    }
  };

  const uploadTrigger = (label: string, primary = false, small = false) => (
    <Upload
      accept="image/*,.jpg,.jpeg,.png,.webp"
      maxCount={1}
      showUploadList={false}
      disabled={disabled || processing}
      beforeUpload={(file) => {
        void handleFile(file);
        return false;
      }}
    >
      <Button size={small ? 'small' : 'middle'} type={primary ? 'primary' : 'default'} icon={<UploadOutlined />} loading={processing} disabled={disabled}>
        {label}
      </Button>
    </Upload>
  );

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
            <FancyboxImage src={value} alt="Ảnh minh chứng" caption="Ảnh minh chứng chấm công" height={84} />
          </div>
          <Space direction="vertical" size={6} style={{ flex: 1, minWidth: 180 }}>
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
              Đã đính kèm ảnh minh chứng
            </Tag>
            <Flex gap={6} wrap="wrap">
              {uploadTrigger('Tải ảnh khác từ máy', false, true)}
              <Button size="small" icon={<CameraOutlined />} disabled={disabled || processing} onClick={() => setCameraOpen(true)}>
                Chụp lại
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={disabled || processing} onClick={() => onChange?.('')}>
                Xóa ảnh
              </Button>
            </Flex>
          </Space>
        </Flex>
      ) : (
        <div
          tabIndex={0}
          onPaste={handlePaste}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled && !processing) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{
            border: `1px dashed ${dragging ? '#2563EB' : '#CBD5E1'}`,
            borderRadius: 4,
            background: dragging ? '#EFF6FF' : '#F8FAFC',
            padding: '10px 12px',
            transition: 'border-color 0.15s ease, background-color 0.15s ease',
          }}
        >
          <Flex gap={8} wrap="wrap" align="center">
            {uploadTrigger('Tải ảnh từ máy', true)}
            <Button icon={<CameraOutlined />} disabled={disabled || processing} onClick={() => setCameraOpen(true)}>
              Chụp ảnh trực tiếp
            </Button>
          </Flex>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
            Chọn ảnh có sẵn từ máy tính / thư viện điện thoại, kéo-thả tệp ảnh vào khung này hoặc mở Camera chụp trực tiếp.
          </Typography.Text>
        </div>
      )}
      <EvidenceCameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl) => onChange?.(dataUrl)}
        onFallbackFile={(file) => void handleFile(file)}
      />
    </>
  );
}
