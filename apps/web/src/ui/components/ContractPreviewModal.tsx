'use client';

import { useEffect, useMemo, useRef } from 'react';
import { App, Button, Card, Descriptions, Modal, Space, Spin, Tag, Typography } from 'antd';
import {
  CloseOutlined,
  DownloadOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_TYPE_LABELS, type EmployeeContractItem } from '@umbm/shared';
import { api } from '@/lib/api';
import type { EmployeeRowItem } from './employee-table-columns';

interface ContractDetailResponse {
  contract: (EmployeeContractItem & { contractTypeLabel?: string }) | null;
  dataUrl: string | null;
  fileUrl?: string;
  downloadUrl?: string;
  employee: EmployeeRowItem;
}

function fmtSizeKb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dataUrlToBlob(dataUrl: string, fallbackMime = 'application/pdf'): Blob | null {
  try {
    const parts = dataUrl.split(';base64,');
    if (parts.length < 2) return null;
    const mime = parts[0]?.replace('data:', '') || fallbackMime;
    const raw = window.atob(parts[1] || '');
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return new Blob([u8], { type: mime });
  } catch {
    return null;
  }
}

export function ContractPreviewModal({
  open,
  employee,
  contractItem = null,
  autoDownload = false,
  onClose,
}: {
  open: boolean;
  employee: EmployeeRowItem | null;
  contractItem?: EmployeeContractItem | null;
  autoDownload?: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const autoDownloadedRef = useRef<string | null>(null);
  const targetId = contractItem?.id || 'electronic';

  const detailQ = useQuery({
    queryKey: ['employee-contract-detail', employee?.id, targetId],
    enabled: open && Boolean(employee?.id),
    retry: false,
    queryFn: () => api.get<ContractDetailResponse>(`/admin/employees/${employee!.id}/contracts/${targetId}`),
  });

  const activeContract = detailQ.data?.contract ?? contractItem;
  const dataUrl = detailQ.data?.dataUrl ?? null;
  const mimeType = activeContract?.mimeType || 'application/pdf';
  const fileName = activeContract?.fileName || `${employee?.employeeCode || 'NV'}_Hop_dong_lao_dong.pdf`;

  const blobUrl = useMemo(() => {
    if (!dataUrl || typeof window === 'undefined') return null;
    const blob = dataUrlToBlob(dataUrl, mimeType);
    return blob ? URL.createObjectURL(blob) : null;
  }, [dataUrl, mimeType]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const handleDownloadFile = () => {
    const href = blobUrl || dataUrl || detailQ.data?.downloadUrl;
    if (!href) {
      message.warning('Đang chuẩn bị tệp hợp đồng, vui lòng thử lại sau giây lát');
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    message.success(`Đang tải về tệp hợp đồng: ${fileName}`);
  };

  const handleOpenNewTab = () => {
    const href = blobUrl || detailQ.data?.fileUrl || dataUrl;
    if (!href) {
      message.warning('Đang chuẩn bị tệp hợp đồng, vui lòng thử lại sau giây lát');
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (!open) {
      autoDownloadedRef.current = null;
      return;
    }
    if (autoDownload && (blobUrl || dataUrl) && autoDownloadedRef.current !== targetId) {
      autoDownloadedRef.current = targetId;
      handleDownloadFile();
    }
  }, [open, autoDownload, blobUrl, dataUrl, targetId]);

  const isImage = mimeType.startsWith('image/');
  const isWord = mimeType.includes('word') || /\.(doc|docx)$/i.test(fileName);

  return (
    <Modal
      width="min(940px, 95vw)"
      style={{ top: 18 }}
      open={open && Boolean(employee)}
      destroyOnHidden
      onCancel={onClose}
      title={
        <span>
          Xem &amp; Tải về Hợp đồng Lao động: <b>{fileName}</b>
          {employee ? ` — ${employee.fullName} (${employee.employeeCode})` : ''}
        </span>
      }
      footer={
        <Space wrap>
          <Button icon={<ExportOutlined />} onClick={handleOpenNewTab} disabled={detailQ.isLoading}>
            Mở xem trong tab mới
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile} disabled={detailQ.isLoading}>
            Tải hợp đồng về máy ({fileName})
          </Button>
          <Button icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      <Spin spinning={detailQ.isLoading} tip="Đang tải tệp hợp đồng lao động...">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '8px 12px' }}>
            <Space size={8} wrap>
              <FilePdfOutlined style={{ color: '#2563EB', fontSize: 18 }} />
              <Typography.Text strong style={{ color: '#1E3A8A' }}>
                Bạn có thể xem trực tiếp bên dưới, bấm &quot;Mở tab mới&quot; để phóng to toàn màn hình hoặc &quot;Tải về máy&quot;.
              </Typography.Text>
            </Space>
            <Space size={6} wrap>
              <Button size="small" icon={<ExportOutlined />} onClick={handleOpenNewTab}>
                Mở tab mới
              </Button>
              <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile}>
                Tải về máy
              </Button>
            </Space>
          </div>

          {activeContract && (
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="Loại hợp đồng">
                <Tag color={activeContract.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} style={{ margin: 0 }}>
                  {CONTRACT_TYPE_LABELS[activeContract.contractType] || activeContract.contractType}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Tên tệp & Dung lượng">
                <b>{activeContract.fileName}</b> ({fmtSizeKb(activeContract.sizeBytes)})
              </Descriptions.Item>
              <Descriptions.Item label="Thời gian tải lên">
                {activeContract.uploadedAt ? dayjs(activeContract.uploadedAt).format('HH:mm DD/MM/YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Số hợp đồng / Ghi chú" span={3}>
                {activeContract.note || 'Văn bản hợp đồng lao động đã lưu trong hồ sơ nhân sự'}
              </Descriptions.Item>
            </Descriptions>
          )}

          {(blobUrl || dataUrl) && (
            isImage ? (
              <div style={{ textAlign: 'center', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 12 }}>
                <img src={blobUrl || dataUrl || ''} alt={fileName} style={{ maxWidth: '100%', maxHeight: 540, objectFit: 'contain' }} />
              </div>
            ) : isWord ? (
              <Card size="small" style={{ textAlign: 'center', background: '#F8FAFC', padding: '24px 12px' }}>
                <Space direction="vertical" size={10}>
                  <FileWordOutlined style={{ fontSize: 40, color: '#2563EB' }} />
                  <Typography.Title level={5} style={{ margin: 0 }}>{fileName}</Typography.Title>
                  <Typography.Text type="secondary">
                    Tệp định dạng Microsoft Word (.doc/.docx). Vui lòng bấm nút bên dưới để tải tệp về máy và mở xem đầy đủ.
                  </Typography.Text>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile}>
                    Tải tệp Word về máy ({fileName})
                  </Button>
                </Space>
              </Card>
            ) : (
              <iframe
                src={blobUrl || dataUrl || ''}
                title={fileName}
                style={{ width: '100%', height: 540, border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF' }}
              />
            )
          )}
        </Space>
      </Spin>
    </Modal>
  );
}
