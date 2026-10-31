'use client';

import { Alert, App, Button, Card, Col, Flex, Input, Row, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, FolderOpenOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';

export interface AdminSignatureConfigData {
  fileId: string;
  signatureUrl: string | null;
  signerName: string;
  updatedAt: string | null;
  driveFolder: string;
}

export function AdminPayrollSignatureCard() {
  const qc = useQueryClient();
  const me = useMe().data?.user;
  const isAdmin = me?.role === 'ADMIN';
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [signerName, setSignerName] = useState('');
  const [draftBase64, setDraftBase64] = useState('');

  const q = useQuery({
    queryKey: ['payroll-admin-signature'],
    queryFn: () => api.get<AdminSignatureConfigData>('/admin/payroll/admin-signature'),
    retry: false,
  });

  useEffect(() => {
    if (q.data) {
      setSignerName(q.data.signerName || me?.displayName || '');
    }
  }, [q.data, me?.displayName]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.put<AdminSignatureConfigData>('/admin/payroll/admin-signature', {
        signature_base64: draftBase64,
        signer_name: signerName.trim() || me?.displayName || 'Ban Quản trị',
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['payroll-admin-signature'], saved);
      setDraftBase64('');
      message.success('Đã lưu hình ảnh chữ ký số Ban Quản trị lên hệ thống & Google Drive');
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu chữ ký Ban Quản trị thất bại'),
  });

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const pngDataUrl = await normalizeImageFileToPngDataUrl(file, 900);
      setDraftBase64(pngDataUrl);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh chữ ký');
    }
  };

  const previewSrc = draftBase64 || q.data?.signatureUrl || null;

  return (
    <Card
      size="small"
      title={<span><SafetyCertificateOutlined /> Cấu hình Chữ ký số Ban Quản trị (Duyệt Bảng lương &amp; Xuất PDF)</span>}
      extra={<Button size="small" icon={<ReloadOutlined />} loading={q.isFetching} onClick={() => void q.refetch()}>Làm mới</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Chữ ký Ban Quản trị được sử dụng khi Quản trị viên phê duyệt bảng lương do Kế toán gửi trình và tự động in lên toàn bộ Phiếu lương PDF."
        description={<span>Thư mục lưu trữ Google Drive: <Tag icon={<FolderOpenOutlined />} color="blue" style={{ margin: 0 }}>{q.data?.driveFolder || '09_PAYROLL_SIGNATURES/01_QUAN_TRI'}</Tag></span>}
      />
      <Row gutter={[16, 12]} align="middle">
        <Col xs={24} md={10}>
          <div style={{ border: '1px dashed #CBD5E1', borderRadius: 4, background: '#FFFFFF', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            {previewSrc ? (
              <img src={previewSrc} alt="Chữ ký Ban Quản trị" style={{ maxHeight: 102, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa tải lên ảnh chữ ký Ban Quản trị</Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} md={14}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Họ tên &amp; chức danh người đại diện ký Ban Quản trị</div>
              <Input disabled={!isAdmin} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="VD: Quản trị hệ thống Ụm Bò Milk" />
            </div>
            <Flex justify="space-between" align="center" wrap gap={8}>
              <Space size={8} wrap>
                {q.data?.fileId ? (
                  <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
                    Đã cấu hình{q.data.updatedAt ? ` (${dayjs(q.data.updatedAt).format('HH:mm DD/MM/YYYY')})` : ''}
                  </Tag>
                ) : (
                  <Tag color="gold" style={{ margin: 0 }}>Chưa cấu hình chữ ký mẫu</Tag>
                )}
                {draftBase64 && <Tag color="blue" style={{ margin: 0 }}>Đã chọn ảnh mới — Nhấn Lưu để áp dụng</Tag>}
              </Space>
              {isAdmin && (
                <Space size={8}>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void handlePickFile(e)} />
                  <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>Tải ảnh chữ ký từ máy</Button>
                  <Button type="primary" icon={<SaveOutlined />} disabled={!draftBase64} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    Lưu chữ ký Quản trị
                  </Button>
                </Space>
              )}
            </Flex>
          </Space>
        </Col>
      </Row>
    </Card>
  );
}
