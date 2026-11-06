'use client';

import { App, Button, Flex, Form, Space, Spin, Tag, Typography } from 'antd';
import { CheckCircleOutlined, InfoCircleOutlined, QrcodeOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import type { ParsedVietQrResult } from '@umbm/shared';
import { decodeVietQrFromImage } from '@/lib/vietqr-image-decoder';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh Mã QR'));
    reader.readAsDataURL(file);
  });
}

export function ProfileBankQrUploader({
  onDecoded,
}: {
  onDecoded?: (decoded: ParsedVietQrResult) => void;
}) {
  const { message } = App.useApp();
  const form = Form.useFormInstance();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [decodedInfo, setDecodedInfo] = useState<ParsedVietQrResult | null>(null);

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDecoding(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const decoded = await decodeVietQrFromImage({ file, dataUrl });
      if (decoded) {
        setDecodedInfo(decoded);
        // Chỉ điền các trường thực sự có dữ liệu — không bịa tên chủ tài khoản
        form?.setFieldsValue({
          ...(decoded.bankName ? { bank_name: decoded.bankName } : {}),
          ...(decoded.accountNumber ? { bank_account_number: decoded.accountNumber } : {}),
          ...(decoded.accountHolder ? { bank_account_holder: decoded.accountHolder } : {}),
        });
        onDecoded?.(decoded);
        const hasHolder = !!decoded.accountHolder;
        message.success(
          hasHolder
            ? 'Đã tự động nhận diện thông tin tài khoản ngân hàng từ mã QR'
            : 'Đã nhận diện Ngân hàng và Số tài khoản. Vui lòng nhập Chủ tài khoản thủ công.',
        );
      } else {
        setDecodedInfo(null);
        message.warning('Không nhận diện được mã VietQR trong ảnh, vui lòng nhập thủ công');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh Mã QR');
    } finally {
      setDecoding(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="space-between"
      gap={12}
      wrap
      style={{
        padding: '8px 12px',
        background: '#F8FAFC',
        border: '1px dashed #CBD5E1',
        borderRadius: 4,
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => void handlePickFile(e)}
      />
      <Space size={8} wrap>
        <Button icon={<QrcodeOutlined />} loading={decoding} onClick={() => fileRef.current?.click()}>
          Tải ảnh QR để tự nhận diện
        </Button>
        {decoding ? (
          <Space size={6}>
            <Spin size="small" />
            <Typography.Text style={{ fontSize: 12, color: '#2563EB' }}>
              Đang quét mã QR...
            </Typography.Text>
          </Space>
        ) : decodedInfo ? (
          <Space size={4} direction="vertical">
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
              Đã nhận diện: {decodedInfo.bankName} · {decodedInfo.accountNumber}
            </Tag>
            {!decodedInfo.accountHolder && (
              <Typography.Text type="warning" style={{ fontSize: 11 }}>
                <InfoCircleOutlined /> Mã QR không chứa tên chủ TK — vui lòng nhập thủ công
              </Typography.Text>
            )}
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Tự động điền Ngân hàng và Số tài khoản. Chủ tài khoản cần nhập thủ công.
          </Typography.Text>
        )}
      </Space>
    </Flex>
  );
}
