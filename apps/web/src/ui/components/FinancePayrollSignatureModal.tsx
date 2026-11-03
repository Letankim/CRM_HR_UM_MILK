'use client';

import { Alert, App, Button, Col, Flex, Input, Modal, Row, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';

export interface FinanceSignatureConfigData {
  fileId: string;
  signatureUrl: string | null;
  signerName: string;
  updatedAt: string | null;
  driveFolder: string;
}

export function FinancePayrollSignaturePanel({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const me = useMe().data?.user;
  const isFinance = me?.role === 'FINANCE';
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [signerName, setSignerName] = useState('');
  const [draftBase64, setDraftBase64] = useState('');

  const q = useQuery({
    queryKey: ['payroll-finance-signature'],
    queryFn: () => api.get<FinanceSignatureConfigData>('/admin/payroll/finance-signature'),
    retry: false,
  });

  useEffect(() => {
    if (q.data) setSignerName(q.data.signerName || me?.displayName || '');
  }, [q.data, me?.displayName]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.put<FinanceSignatureConfigData>('/admin/payroll/finance-signature', {
        signature_base64: draftBase64,
        signer_name: signerName.trim() || me?.displayName || 'Kế toán tiền lương',
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['payroll-finance-signature'], saved);
      setDraftBase64('');
      message.success('Đã tải lên và lưu hình ảnh chữ ký số Kế toán trên hệ thống & Google Drive');
      onSaved?.();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu chữ ký Kế toán thất bại'),
  });

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const sigDataUrl = await normalizeImageFileToPngDataUrl(file, 1500, { maxShortEdge: 1000, passthroughMaxBytes: 500 * 1024, quality: 0.92 });
      setDraftBase64(sigDataUrl);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh chữ ký Kế toán');
    }
  };

  const previewSrc = draftBase64 || q.data?.signatureUrl || null;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Chữ ký Kế toán được đóng tự động vào ô Kế toán trên toàn bộ Phiếu lương PDF khi Kế toán ký phát hành bảng lương xuống nhân viên (sau khi Ban Quản trị đã ký phê duyệt)."
      />
      <Row gutter={[16, 12]} align="middle">
        <Col xs={24} md={10}>
          <div style={{ border: '1px dashed #CBD5E1', borderRadius: 4, background: '#FFFFFF', height: 124, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            {previewSrc ? (
              <img src={previewSrc} alt="Chữ ký Kế toán" style={{ maxHeight: 106, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa tải lên ảnh chữ ký Kế toán</Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} md={14}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Họ tên Kế toán hiển thị dưới chữ ký Phiếu lương</div>
              <Input disabled={!isFinance} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="VD: Lê Thị Kế Toán" />
            </div>
            <Flex justify="space-between" align="center" wrap gap={8}>
              <Space size={6} wrap>
                {q.data?.fileId ? (
                  <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
                    Đã lưu chữ ký{q.data.updatedAt ? ` (${dayjs(q.data.updatedAt).format('HH:mm DD/MM/YYYY')})` : ''}
                  </Tag>
                ) : (
                  <Tag color="gold" style={{ margin: 0 }}>Chưa tải chữ ký mẫu</Tag>
                )}
                {draftBase64 && <Tag color="blue" style={{ margin: 0 }}>Đã chọn ảnh mới — Nhấn Lưu để áp dụng</Tag>}
              </Space>
              <Button size="small" icon={<ReloadOutlined />} loading={q.isFetching} onClick={() => void q.refetch()}>Làm mới</Button>
            </Flex>
            {isFinance && (
              <>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void handlePickFile(e)} />
                <Flex gap={8} align="center" wrap>
                  <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                    {previewSrc ? 'Đổi chữ ký' : 'Tải chữ ký'}
                  </Button>
                  <Button type="primary" icon={<SaveOutlined />} disabled={!draftBase64} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    Lưu chữ ký Kế toán
                  </Button>
                </Flex>
              </>
            )}
          </Space>
        </Col>
      </Row>
    </Space>
  );
}

export function FinanceSignatureToolbarButton({ size }: { size?: 'small' | 'middle' }) {
  const me = useMe().data?.user;
  const [open, setOpen] = useState(false);
  const isFinance = me?.role === 'FINANCE';

  const q = useQuery({
    queryKey: ['payroll-finance-signature'],
    queryFn: () => api.get<FinanceSignatureConfigData>('/admin/payroll/finance-signature'),
    enabled: isFinance,
    retry: false,
  });

  if (!isFinance) return null;
  const hasSig = Boolean(q.data?.fileId);

  return (
    <>
      <Button
        size={size}
        type={hasSig ? 'default' : 'primary'}
        ghost={!hasSig}
        icon={hasSig ? <SafetyCertificateOutlined style={{ color: '#16A34A' }} /> : <UploadOutlined />}
        onClick={() => setOpen(true)}
      >
        {hasSig ? 'Chữ ký Kế toán (Đã tải lên)' : 'Tải chữ ký Kế toán'}
      </Button>
      <Modal
        open={open}
        width={680}
        destroyOnHidden
        title="Tải Lên & Cấu Hình Chữ Ký Số Kế Toán (Ký Phát Hành Phiếu Lương)"
        onCancel={() => setOpen(false)}
        footer={<Flex justify="flex-end"><Button icon={<CloseOutlined />} onClick={() => setOpen(false)}>Đóng</Button></Flex>}
      >
        <FinancePayrollSignaturePanel onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}
