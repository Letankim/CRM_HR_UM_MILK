'use client';

import { App, Button, Flex, Form, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, QrcodeOutlined, UploadOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import type { ParsedVietQrResult } from '@umbm/shared';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';
import { decodeVietQrFromImage } from '@/lib/vietqr-image-decoder';

export function ProfileBankQrUploader({
  currentQrUrl,
  draftQrBase64,
  removeQr,
  onChangeDraft,
  onToggleRemove,
  onDecoded,
}: {
  currentQrUrl?: string | null;
  draftQrBase64: string;
  removeQr: boolean;
  onChangeDraft: (base64: string) => void;
  onToggleRemove: (remove: boolean) => void;
  onDecoded?: (decoded: ParsedVietQrResult) => void;
}) {
  const { message } = App.useApp();
  const form = Form.useFormInstance();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [decodedInfo, setDecodedInfo] = useState<ParsedVietQrResult | null>(null);

  const applyDecodedToForm = (decoded: ParsedVietQrResult) => {
    setDecodedInfo(decoded);
    form?.setFieldsValue({
      ...(decoded.bankName ? { bank_name: decoded.bankName } : {}),
      ...(decoded.accountNumber ? { bank_account_number: decoded.accountNumber } : {}),
      ...(decoded.accountHolder ? { bank_account_holder: decoded.accountHolder } : {}),
    });
    onDecoded?.(decoded);
    message.success('Đã tự động nhận diện thông tin ngân hàng từ mã VietQR');
  };

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDecoding(true);
    try {
      const qrDataUrl = await normalizeImageFileToPngDataUrl(file, 2400, {
        preferJpeg: true,
        maxShortEdge: 1280,
        passthroughMaxBytes: 750 * 1024,
        quality: 0.91,
      });
      onToggleRemove(false);
      onChangeDraft(qrDataUrl);
      const decoded = await decodeVietQrFromImage({ file, dataUrl: qrDataUrl });
      if (decoded) {
        applyDecodedToForm(decoded);
      } else {
        setDecodedInfo(null);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh Mã QR');
    } finally {
      setDecoding(false);
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
      <Space direction="vertical" size={6}>
        <Space size={8} wrap>
          <Button icon={<UploadOutlined />} loading={decoding} onClick={() => fileRef.current?.click()}>
            {previewUrl ? 'Đổi ảnh QR' : 'Tải ảnh QR (Tự nhận diện VietQR)'}
          </Button>
          {previewUrl && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                onChangeDraft('');
                setDecodedInfo(null);
                onToggleRemove(true);
              }}
            >
              Xóa
            </Button>
          )}
        </Space>
        {decodedInfo ? (
          <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
            Đã giải mã EMVCo VietQR: {decodedInfo.bankName} · {decodedInfo.accountNumber}
            {decodedInfo.accountHolder ? ` (${decodedInfo.accountHolder})` : ''}
          </Tag>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Tải ảnh mã VietQR Napas247 để hệ thống tự động điền Tên ngân hàng, Số tài khoản và Chủ tài khoản.
          </Typography.Text>
        )}
      </Space>
    </Flex>
  );
}
