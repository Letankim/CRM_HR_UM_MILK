'use client';

import { App, Button, Flex, Space } from 'antd';
import { DeleteOutlined, QrcodeOutlined, UploadOutlined } from '@ant-design/icons';
import { useRef } from 'react';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';

export function ProfileBankQrUploader({
  currentQrUrl,
  draftQrBase64,
  removeQr,
  onChangeDraft,
  onToggleRemove,
}: {
  currentQrUrl?: string | null;
  draftQrBase64: string;
  removeQr: boolean;
  onChangeDraft: (base64: string) => void;
  onToggleRemove: (remove: boolean) => void;
}) {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const png = await normalizeImageFileToPngDataUrl(file, 900);
      onToggleRemove(false);
      onChangeDraft(png);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh Mã QR');
    }
  };

  const previewUrl = removeQr ? null : draftQrBase64 || currentQrUrl || null;

  return (
    <Flex align="center" gap={12} wrap>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => void handlePickFile(e)}
      />
      <div
        onClick={() => fileRef.current?.click()}
        style={{
          width: 92,
          height: 92,
          border: '1px dashed #CBD5E1',
          borderRadius: 4,
          background: '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Mã QR ngân hàng" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <QrcodeOutlined style={{ fontSize: 26, color: '#94A3B8' }} />
        )}
      </div>
      <Space size={8} wrap>
        <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
          {previewUrl ? 'Đổi ảnh QR' : 'Tải ảnh QR'}
        </Button>
        {previewUrl && (
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              onChangeDraft('');
              onToggleRemove(true);
            }}
          >
            Xóa
          </Button>
        )}
      </Space>
    </Flex>
  );
}
