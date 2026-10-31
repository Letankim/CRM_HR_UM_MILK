'use client';

import { App, Button, Col, Flex, Row, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, FolderOpenOutlined, QrcodeOutlined, UploadOutlined } from '@ant-design/icons';
import { useRef } from 'react';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';

export function ProfileBankQrUploader({
  currentQrUrl,
  driveFolder,
  draftQrBase64,
  removeQr,
  onChangeDraft,
  onToggleRemove,
}: {
  currentQrUrl?: string | null;
  driveFolder?: string;
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
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh Mã QR Ngân hàng');
    }
  };

  const previewUrl = removeQr ? null : draftQrBase64 || currentQrUrl || null;

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: 12, marginTop: 4 }}>
      <Row gutter={[12, 10]} align="middle">
        <Col xs={24} sm={7}>
          <div style={{ border: '1px dashed #CBD5E1', borderRadius: 4, background: '#FFFFFF', height: 116, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6 }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Mã QR Ngân hàng" style={{ maxHeight: 102, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
                <QrcodeOutlined /> Chưa tải ảnh QR
              </Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} sm={17}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Flex justify="space-between" align="center" wrap gap={6}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                <QrcodeOutlined /> Ảnh Mã QR Ngân hàng nhận lương cá nhân
              </Typography.Text>
              {previewUrl ? (
                <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
                  {draftQrBase64 ? 'Đã chọn ảnh QR mới' : 'Đã lưu trên Drive'}
                </Tag>
              ) : (
                <Tag style={{ margin: 0 }}>Chưa có ảnh QR</Tag>
              )}
            </Flex>
            <div style={{ fontSize: 12, color: '#64748B' }}>
              Ảnh Mã QR được lưu tổng hợp vào thư mục Google Drive{' '}
              <Tag icon={<FolderOpenOutlined />} color="blue" style={{ margin: 0 }}>
                {driveFolder || '08_EMPLOYEE_BANK_QR'}
              </Tag>{' '}
              và tự động hiển thị trên Bảng lương Quản trị / Kế toán ngay sau khi bạn ký xác nhận phiếu lương.
            </div>
            <Space size={8} wrap>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void handlePickFile(e)} />
              <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                {previewUrl ? 'Đổi ảnh Mã QR Ngân hàng' : 'Tải ảnh Mã QR Ngân hàng lên'}
              </Button>
              {previewUrl && (
                <Button
                  size="small" danger icon={<DeleteOutlined />}
                  onClick={() => {
                    onChangeDraft('');
                    onToggleRemove(true);
                  }}
                >
                  Xóa ảnh QR
                </Button>
              )}
            </Space>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
