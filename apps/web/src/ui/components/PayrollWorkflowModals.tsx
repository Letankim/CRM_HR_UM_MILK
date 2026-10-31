'use client';

import { Alert, App, Button, Col, Descriptions, Flex, Input, Modal, Row, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseOutlined, SafetyCertificateOutlined, SendOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { normalizeImageFileToPngDataUrl } from '@/lib/payroll-file-helpers';
import type { AdminSignatureConfigData } from './AdminPayrollSignatureCard';
import { fmtVnd, type PayPeriodRow } from './payroll-types';

export function AdminApprovePeriodModal({ open, period, onClose, onSuccess }: { open: boolean; period: PayPeriodRow; onClose: () => void; onSuccess: () => void }) {
  const qc = useQueryClient(), me = useMe().data?.user, { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [signerName, setSignerName] = useState(''), [note, setNote] = useState(''), [customSigBase64, setCustomSigBase64] = useState('');

  const sigCfgQ = useQuery({ queryKey: ['payroll-admin-signature'], queryFn: () => api.get<AdminSignatureConfigData>('/admin/payroll/admin-signature'), enabled: open });

  useEffect(() => {
    if (open) { setCustomSigBase64(''); setNote(''); setSignerName(sigCfgQ.data?.signerName || me?.displayName || 'Ban Quản trị Ụm Bò Milk'); }
  }, [open, sigCfgQ.data?.signerName, me?.displayName]);

  const approveMut = useMutation({
    mutationFn: () => api.post(`/admin/payroll/periods/${period.id}/admin-approve`, { signature_base64: customSigBase64 || undefined, signer_name: signerName.trim(), note: note.trim() }),
    onSuccess: () => {
      message.success(`Ban Quản trị đã ký phê duyệt kỳ lương "${period.name}" và gửi phiếu về Kế toán`);
      void qc.invalidateQueries({ queryKey: ['payroll-admin-signature'] });
      onSuccess(); onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Ký phê duyệt bảng lương thất bại'),
  });

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setCustomSigBase64(await normalizeImageFileToPngDataUrl(file, 900));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh chữ ký');
    }
  };

  const previewUrl = customSigBase64 || sigCfgQ.data?.signatureUrl || null;

  return (
    <Modal
      width={640}
      open={open}
      title={`Ban Quản Trị Phê Duyệt & Ký Chữ Ký Số — ${period.name}`}
      onCancel={onClose}
      onOk={() => approveMut.mutate()}
      okText="Ký chữ ký Quản trị & Gửi về Kế toán"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SafetyCertificateOutlined />, disabled: !previewUrl }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={approveMut.isPending}
      destroyOnHidden
    >
      <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Mã kỳ lương"><strong>{period.period_code}</strong></Descriptions.Item>
        <Descriptions.Item label="Nhân sự">{period.total_employees} nhân sự</Descriptions.Item>
        <Descriptions.Item label="Tổng thu nhập"><span className="num">{fmtVnd(period.total_gross_vnd)}</span></Descriptions.Item>
        <Descriptions.Item label="Tổng thực lĩnh"><strong className="num" style={{ color: '#15803D' }}>{fmtVnd(period.total_net_vnd)}</strong></Descriptions.Item>
      </Descriptions>
      {!previewUrl && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="Hệ thống chưa có ảnh chữ ký Ban Quản trị. Vui lòng tải ảnh chữ ký lên bên dưới (ảnh này sẽ được lưu làm chữ ký cấu hình hệ thống trên Google Drive)."
        />
      )}
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={11}>
          <div style={{ border: '1px dashed #CBD5E1', borderRadius: 4, background: '#F8FAFC', height: 112, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Chữ ký Quản trị" style={{ maxHeight: 96, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa có ảnh chữ ký</Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} sm={13}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#64748B' }}>Người đại diện Ban Quản trị ký duyệt</div>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Họ tên Quản trị viên ký duyệt" />
            <Flex justify="space-between" align="center" wrap gap={6}>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void handlePickFile(e)} />
              <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                {previewUrl ? 'Đổi ảnh chữ ký Quản trị' : 'Tải ảnh chữ ký Quản trị lên'}
              </Button>
              {sigCfgQ.data?.fileId && !customSigBase64 && <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Lấy từ Cấu hình HT</Tag>}
            </Flex>
          </Space>
        </Col>
      </Row>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Ghi chú phê duyệt gửi về Kế toán (không bắt buộc)</div>
      <Input placeholder="VD: Đã kiểm tra và đồng ý duyệt quỹ lương, chuyển Kế toán ký phát hành..." value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

export function FinancePublishPeriodModal({
  open,
  period,
  onClose,
  onSuccess,
}: {
  open: boolean;
  period: PayPeriodRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const me = useMe().data?.user;
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [signerName, setSignerName] = useState('');
  const [sigBase64, setSigBase64] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setSigBase64('');
      setNote('');
      setSignerName(me?.displayName || 'Kế toán tiền lương');
    }
  }, [open, me?.displayName]);

  const publishMut = useMutation({
    mutationFn: () =>
      api.post(`/admin/payroll/periods/${period.id}/finance-publish`, {
        signature_base64: sigBase64,
        signer_name: signerName.trim(),
        note: note.trim(),
      }),
    onSuccess: () => {
      message.success(`Kế toán đã ký và phát hành phiếu lương kỳ "${period.name}" xuống toàn bộ nhân viên`);
      onSuccess();
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Ký phát hành phiếu lương thất bại'),
  });

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setSigBase64(await normalizeImageFileToPngDataUrl(file, 900));
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh chữ ký Kế toán');
    }
  };

  return (
    <Modal
      width={640}
      open={open}
      title={`Kế Toán Ký Chữ Ký & Phát Hành Phiếu Lương — ${period.name}`}
      onCancel={onClose}
      onOk={() => publishMut.mutate()}
      okText="Ký chữ ký Kế toán & Phát hành xuống Nhân viên"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SendOutlined />, disabled: !sigBase64 }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={publishMut.isPending}
      destroyOnHidden
    >
      <Alert
        type="success" showIcon style={{ marginBottom: 12 }}
        message={`Ban Quản trị (${period.adminSignedBy || 'Quản trị hệ thống'}) đã ký phê duyệt kỳ lương này. Để phát hành phiếu xuống nhân viên, Kế toán bắt buộc tải ảnh chữ ký của mình từ máy tính lên bên dưới.`}
      />
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={11}>
          <div style={{ border: '1px dashed #CBD5E1', borderRadius: 4, background: '#F8FAFC', height: 112, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            {sigBase64 ? (
              <img src={sigBase64} alt="Chữ ký Kế toán" style={{ maxHeight: 96, maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa tải ảnh chữ ký Kế toán</Typography.Text>
            )}
          </div>
        </Col>
        <Col xs={24} sm={13}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 12, color: '#64748B' }}>Họ tên Kế toán ký phát hành phiếu lương</div>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Nhập họ tên Kế toán" />
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void handlePickFile(e)} />
            <Button type={sigBase64 ? 'default' : 'primary'} ghost={!sigBase64} icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
              {sigBase64 ? 'Chọn lại ảnh chữ ký Kế toán từ máy' : 'Tải ảnh chữ ký Kế toán từ máy lên (*)'}
            </Button>
          </Space>
        </Col>
      </Row>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Ghi chú phát hành phiếu lương (không bắt buộc)</div>
      <Input placeholder="VD: Đề nghị toàn bộ nhân sự kiểm tra và ký trực tiếp xác nhận phiếu lương..." value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
