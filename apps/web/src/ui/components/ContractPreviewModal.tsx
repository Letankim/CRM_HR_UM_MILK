'use client';

import { useEffect, useState } from 'react';
import { App, Button, Card, Descriptions, Modal, Space, Spin, Tag, Typography } from 'antd';
import { CloseOutlined, DownloadOutlined, ExportOutlined, FileImageOutlined, FilePdfOutlined, FileWordOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CONTRACT_TYPE_LABELS, type EmployeeContractItem } from '@umbm/shared';
import { api } from '@/lib/api';
import type { EmployeeRowItem } from './employee-table-columns';

export interface ContractDetailResponse {
  contract: (EmployeeContractItem & { contractTypeLabel?: string }) | null;
  actualMimeType?: string;
  dataUrl: string | null;
  fileUrl?: string;
  downloadUrl?: string;
  employee: EmployeeRowItem;
}

function fmtSizeKb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function dataUrlToBlob(dataUrl: string, fallbackMime = 'application/pdf'): { blob: Blob; mime: string } | null {
  try {
    const idx = dataUrl.indexOf(';base64,');
    if (idx < 0) return null;
    const b64 = dataUrl.slice(idx + 8).replace(/\s+/g, '');
    let mime = dataUrl.slice(5, idx).trim() || fallbackMime;
    if (b64.startsWith('iVBORw0KGgo')) mime = 'image/png';
    else if (b64.startsWith('/9j/')) mime = 'image/jpeg';
    else if (b64.startsWith('UklGR')) mime = 'image/webp';
    else if (b64.startsWith('R0lGOD')) mime = 'image/gif';
    else if (b64.startsWith('JVBERi0')) mime = 'application/pdf';
    const raw = window.atob(b64);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return { blob: new Blob([u8], { type: mime }), mime };
  } catch { return null; }
}

export function ensureFileExtensionForMime(rawFileName: string, mime: string): string {
  const baseName = (rawFileName || 'Hop_dong_lao_dong').trim(), m = mime.toLowerCase();
  const extMap: Array<[(t: string) => boolean, string, RegExp]> = [
    [(t) => t === 'image/png', '.png', /\.png$/i],
    [(t) => t === 'image/jpeg' || t === 'image/jpg', '.jpg', /\.(jpe?g)$/i],
    [(t) => t === 'image/webp', '.webp', /\.webp$/i],
    [(t) => t === 'application/pdf', '.pdf', /\.pdf$/i],
    [(t) => t.includes('wordprocessingml'), '.docx', /\.docx$/i],
    [(t) => t === 'application/msword', '.doc', /\.doc$/i],
  ];
  for (const [matchMime, targetExt, extRe] of extMap) {
    if (matchMime(m)) return extRe.test(baseName) ? baseName : `${baseName.replace(/\.[a-zA-Z0-9]{2,5}$/, '')}${targetExt}`;
  }
  return baseName;
}

export function triggerContractBlobDownload(dataUrl: string, rawFileName: string, fallbackMime = 'application/pdf'): string | null {
  const parsed = dataUrlToBlob(dataUrl, fallbackMime);
  if (!parsed) return null;
  const finalName = ensureFileExtensionForMime(rawFileName, parsed.mime);
  const dlUrl = URL.createObjectURL(parsed.blob);
  const a = document.createElement('a');
  a.style.display = 'none'; a.href = dlUrl; a.download = finalName;
  document.body.appendChild(a); a.click();
  window.setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(dlUrl); }, 60_000);
  return finalName;
}

export async function downloadEmployeeContractDirect(
  employee: EmployeeRowItem,
  contractItem: EmployeeContractItem | null,
  notify: { success: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  try {
    const targetId = contractItem?.id || 'electronic';
    const res = await api.get<ContractDetailResponse>(`/admin/employees/${employee.id}/contracts/${targetId}`);
    if (!res?.dataUrl) { notify.error('Không tìm thấy dữ liệu tệp hợp đồng để tải xuống'); return; }
    const rawName = res.contract?.fileName || contractItem?.fileName || `${employee.employeeCode}_Hop_dong_lao_dong.pdf`;
    const savedName = triggerContractBlobDownload(res.dataUrl, rawName, res.actualMimeType || res.contract?.mimeType || 'application/pdf');
    if (savedName) notify.success(`Đã tải về tệp hợp đồng: ${savedName}`);
    else notify.error('Không thể khởi tạo tệp tải xuống');
  } catch (err) {
    notify.error(err instanceof Error ? err.message : 'Tải hợp đồng thất bại');
  }
}

export function ContractPreviewModal({
  open, employee, contractItem = null, autoDownload = false, onClose,
}: {
  open: boolean; employee: EmployeeRowItem | null; contractItem?: EmployeeContractItem | null; autoDownload?: boolean; onClose: () => void;
}) {
  const { message } = App.useApp();
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const targetId = contractItem?.id || 'electronic';

  const detailQ = useQuery({
    queryKey: ['employee-contract-detail', employee?.id, targetId, contractItem?.fileName, contractItem?.uploadedAt],
    enabled: open && Boolean(employee?.id), retry: false, staleTime: 0,
    queryFn: () => api.get<ContractDetailResponse>(`/admin/employees/${employee!.id}/contracts/${targetId}`),
  });

  const activeContract = detailQ.data?.contract ?? contractItem;
  const dataUrl = detailQ.data?.dataUrl ?? null;
  const parsedPreview = dataUrl ? dataUrlToBlob(dataUrl, detailQ.data?.actualMimeType || activeContract?.mimeType || 'application/pdf') : null;
  const actualMime = (parsedPreview?.mime || detailQ.data?.actualMimeType || activeContract?.mimeType || 'application/pdf').toLowerCase();
  const rawFileName = activeContract?.fileName || `${employee?.employeeCode || 'NV'}_Hop_dong_lao_dong.pdf`;
  const fileName = ensureFileExtensionForMime(rawFileName, actualMime);
  const isImage = actualMime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
  const isWord = actualMime.includes('word') || /\.(doc|docx)$/i.test(fileName);

  useEffect(() => {
    if (!open || !dataUrl || isImage || isWord) { setPdfBlobUrl(null); return; }
    const parsed = dataUrlToBlob(dataUrl, actualMime);
    if (!parsed) { setPdfBlobUrl(null); return; }
    const url = URL.createObjectURL(parsed.blob);
    setPdfBlobUrl(url);
    return () => { window.setTimeout(() => URL.revokeObjectURL(url), 30_000); };
  }, [open, dataUrl, actualMime, isImage, isWord]);

  const handleDownloadFile = () => {
    if (!dataUrl) { message.warning('Đang tải tệp hợp đồng từ Google Drive, vui lòng đợi giây lát'); return; }
    const saved = triggerContractBlobDownload(dataUrl, rawFileName, actualMime);
    if (saved) message.success(`Đã tải về tệp hợp đồng: ${saved}`);
  };

  useEffect(() => {
    if (open && autoDownload && dataUrl) handleDownloadFile();
  }, [open, autoDownload, dataUrl]);

  const handleOpenNewTab = () => {
    if (!dataUrl) { message.warning('Đang tải tệp hợp đồng từ Google Drive, vui lòng đợi giây lát'); return; }
    const parsed = dataUrlToBlob(dataUrl, actualMime);
    if (!parsed) return;
    const tabUrl = URL.createObjectURL(parsed.blob);
    window.open(tabUrl, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(tabUrl), 300_000);
  };

  return (
    <Modal
      width="min(940px, 95vw)" style={{ top: 18 }} open={open && Boolean(employee)} destroyOnHidden onCancel={onClose}
      title="Chi tiết Văn bản Hợp đồng Lao động"
      footer={
        <Button icon={<CloseOutlined />} onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <Spin spinning={detailQ.isLoading} tip="Đang đồng bộ tệp hợp đồng từ Google Drive...">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '8px 12px' }}>
            <Space size={8} wrap>
              {isImage ? <FileImageOutlined style={{ color: '#2563EB', fontSize: 18 }} /> : <FilePdfOutlined style={{ color: '#2563EB', fontSize: 18 }} />}
              <Typography.Text strong style={{ color: '#1E3A8A' }}>Bạn có thể xem trực tiếp bên dưới, bấm &quot;Mở tab mới&quot; để phóng to hoặc bấm &quot;Tải về máy&quot;.</Typography.Text>
            </Space>
            <Space size={6} wrap>
              <Button size="small" icon={<ExportOutlined />} onClick={handleOpenNewTab} disabled={!dataUrl}>Mở tab mới</Button>
              <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile} disabled={!dataUrl}>Tải về máy</Button>
            </Space>
          </div>

          {activeContract && (
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="Nhân sự"><b>{employee?.fullName || '—'}</b> {employee?.employeeCode ? <Tag color="geekblue" style={{ marginLeft: 4 }}>{employee.employeeCode}</Tag> : null}</Descriptions.Item>
              <Descriptions.Item label="Loại hợp đồng"><Tag color={activeContract.contractType === 'OFFICIAL_CONTRACT' ? 'green' : 'gold'} style={{ margin: 0 }}>{CONTRACT_TYPE_LABELS[activeContract.contractType] || activeContract.contractType}</Tag></Descriptions.Item>
              <Descriptions.Item label="Thời gian tải lên">{activeContract.uploadedAt ? dayjs(activeContract.uploadedAt).format('HH:mm DD/MM/YYYY') : '—'}</Descriptions.Item>
              <Descriptions.Item label="Tên tệp & Dung lượng" span={3}><b>{fileName}</b> ({fmtSizeKb(activeContract.sizeBytes)})</Descriptions.Item>
            </Descriptions>
          )}

          {dataUrl && (
            isImage ? (
              <div style={{ textAlign: 'center', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 12 }}>
                <img src={dataUrl} alt={fileName} style={{ maxWidth: '100%', maxHeight: 540, objectFit: 'contain' }} />
              </div>
            ) : isWord ? (
              <Card size="small" style={{ textAlign: 'center', background: '#F8FAFC', padding: '24px 12px' }}>
                <Space direction="vertical" size={10}>
                  <FileWordOutlined style={{ fontSize: 40, color: '#2563EB' }} />
                  <Typography.Title level={5} style={{ margin: 0 }}>{fileName}</Typography.Title>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadFile}>Tải tệp Word về máy ({fileName})</Button>
                </Space>
              </Card>
            ) : (
              <iframe src={pdfBlobUrl || dataUrl} title={fileName} style={{ width: '100%', height: 540, border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF' }} />
            )
          )}
        </Space>
      </Spin>
    </Modal>
  );
}
