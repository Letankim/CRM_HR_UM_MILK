'use client';

import { Alert, Button, Descriptions, Modal, Space, Spin, Tag } from 'antd';
import { CloseOutlined, DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_TYPE_LABELS, type EmployeeContractItem } from '@umbm/shared';
import { api } from '@/lib/api';
import type { EmployeeRowItem } from './employee-table-columns';

interface ContractDetailResponse {
  contract: (EmployeeContractItem & { contractTypeLabel?: string }) | null;
  dataUrl: string | null;
  employee: EmployeeRowItem;
}

export function ContractPreviewModal({
  open,
  employee,
  contractItem = null,
  onClose,
}: {
  open: boolean;
  employee: EmployeeRowItem | null;
  contractItem?: EmployeeContractItem | null;
  onClose: () => void;
}) {
  const detailQ = useQuery({
    queryKey: ['employee-contract-detail', employee?.id, contractItem?.id],
    enabled: open && Boolean(employee?.id && contractItem?.id),
    retry: false,
    queryFn: () => api.get<ContractDetailResponse>(`/admin/employees/${employee!.id}/contracts/${contractItem!.id}`),
  });

  const activeContract = detailQ.data?.contract ?? contractItem;
  const dataUrl = detailQ.data?.dataUrl ?? null;

  const handleDownloadFile = () => {
    if (!dataUrl || !activeContract) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = activeContract.fileName || `${employee?.employeeCode || 'NV'}_hop_dong.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Modal
      width="min(920px, 95vw)"
      style={{ top: 20 }}
      open={open && Boolean(activeContract)}
      destroyOnHidden
      onCancel={onClose}
      title={
        activeContract
          ? `Xem Hợp đồng Đã tải lên: ${activeContract.fileName}${employee ? ` — ${employee.fullName} (${employee.employeeCode})` : ''}`
          : 'Xem Hợp đồng Lao động'
      }
      footer={
        <Space wrap>
          {activeContract && dataUrl && (
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile}>
              Tải xuống tệp hợp đồng ({activeContract.fileName})
            </Button>
          )}
          <Button icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      <Spin spinning={detailQ.isLoading} tip="Đang tải tệp hợp đồng...">
        {activeContract && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Loại hợp đồng">
                <Tag color={activeContract.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} style={{ margin: 0 }}>
                  {CONTRACT_TYPE_LABELS[activeContract.contractType] || activeContract.contractType}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Tên tệp hợp đồng"><b>{activeContract.fileName}</b></Descriptions.Item>
              <Descriptions.Item label="Thời gian tải lên">
                {activeContract.uploadedAt ? dayjs(activeContract.uploadedAt).format('HH:mm DD/MM/YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Số hợp đồng / Ghi chú">{activeContract.note || '—'}</Descriptions.Item>
            </Descriptions>

            {dataUrl ? (
              activeContract.mimeType?.startsWith('image/') ? (
                <div style={{ textAlign: 'center', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 12 }}>
                  <img src={dataUrl} alt={activeContract.fileName} style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain' }} />
                </div>
              ) : (
                <iframe
                  src={dataUrl}
                  title={activeContract.fileName}
                  style={{ width: '100%', height: 520, border: '1px solid #E5E7EB', borderRadius: 4 }}
                />
              )
            ) : !detailQ.isLoading ? (
              <Alert
                type="info"
                showIcon
                icon={<FilePdfOutlined />}
                message={`Tệp hợp đồng "${activeContract.fileName}" đã được ghi nhận trong hồ sơ nhân sự. Nếu tệp gốc chưa có bản lưu cục bộ trên máy chủ hiện tại, HR có thể tải lại tệp PDF/Ảnh để xem trực tiếp tại đây.`}
              />
            ) : null}
          </Space>
        )}
      </Spin>
    </Modal>
  );
}
