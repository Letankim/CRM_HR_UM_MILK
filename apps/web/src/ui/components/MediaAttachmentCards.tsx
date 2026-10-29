'use client';

import { Button, Card, Descriptions, Flex, Image, Space, Tag, Typography } from 'antd';
import {
  EditOutlined, ExportOutlined, EyeOutlined, FileImageOutlined,
  FilePdfOutlined, FileTextOutlined, LockOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { BaseDetailDrawer } from './BaseDetailDrawer';

export interface MediaAssetItem {
  id: string; code?: string; file_name: string; mime_type: string; mimeLabel?: string;
  size_bytes?: number; sizeFormatted?: string; category?: string; categoryLabel?: string;
  drive_file_id?: string; drive_url?: string; openUrl?: string; previewUrl?: string;
  isImage?: boolean; is_internal_only?: boolean; securityLabel?: string; creatorName?: string; created_at?: string;
}

export const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  BANNER: 'Banner truyền thông', SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện', POLICY_PDF: 'Văn bản chính sách (PDF)',
};
export const MEDIA_CATEGORY_OPTIONS = Object.entries(MEDIA_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

export const MEDIA_MIME_LABELS: Record<string, string> = {
  'image/png': 'Hình ảnh PNG', 'image/jpeg': 'Hình ảnh JPEG', 'image/jpg': 'Hình ảnh JPEG',
  'image/webp': 'Hình ảnh WebP', 'image/gif': 'Hình ảnh GIF', 'application/pdf': 'Tài liệu PDF', 'video/mp4': 'Video MP4',
};

export function formatMediaBytes(bytes?: unknown): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} Bytes`;
}

export function normalizeClientMediaItem(raw: Record<string, unknown>): MediaAssetItem {
  const mime = String(raw.mime_type || 'image/png');
  const rawUrl = String(raw.openUrl || raw.drive_url || raw.drive_file_id || '').trim();
  const isInternal = !rawUrl || rawUrl.startsWith('drive://');
  const driveMatch = rawUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i) ?? rawUrl.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?[^#]*id=([a-zA-Z0-9_-]+)/i);
  const isImg = Boolean(raw.isImage ?? (mime.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(rawUrl)));
  const openUrl = isInternal ? '' : (rawUrl.startsWith('http') || rawUrl.startsWith('/') || rawUrl.startsWith('data:') ? rawUrl : '');
  const previewUrl = String(raw.previewUrl || (driveMatch?.[1] && isImg ? `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1200` : (isImg ? openUrl : '')));
  const cat = String(raw.category || 'BANNER'), internalOnly = raw.is_internal_only !== false;

  return {
    id: String(raw.id || ''), code: String(raw.code || 'MED'), file_name: String(raw.file_name || 'Tệp đính kèm nội bộ'),
    mime_type: mime, mimeLabel: String(raw.mimeLabel || MEDIA_MIME_LABELS[mime] || 'Tệp tài liệu'),
    size_bytes: Number(raw.size_bytes || 0), sizeFormatted: String(raw.sizeFormatted || formatMediaBytes(raw.size_bytes)),
    category: cat, categoryLabel: String(raw.categoryLabel || MEDIA_CATEGORY_LABELS[cat] || 'Tài liệu nội bộ'),
    drive_url: isInternal ? '' : rawUrl, openUrl, previewUrl, isImage: isImg, is_internal_only: internalOnly,
    securityLabel: String(raw.securityLabel || (internalOnly ? 'Chỉ lưu hành nội bộ' : 'Công khai có kiểm soát')),
    creatorName: String(raw.creatorName || 'Truyền thông MKT'), created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

export function parseRawMediaIds(raw: unknown): string[] {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str || str === '[]') return [];
  return str.replace(/[\[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function useResolvedMediaAttachments(record: Record<string, unknown> | null | undefined, explicitPool?: Record<string, unknown>[]): MediaAssetItem[] {
  const qc = useQueryClient();
  return useMemo(() => {
    if (!record) return [];
    if (Array.isArray(record.mediaAttachments) && record.mediaAttachments.length > 0) {
      return (record.mediaAttachments as Record<string, unknown>[]).map(normalizeClientMediaItem);
    }
    const ids = parseRawMediaIds(record.media_ids);
    if (ids.length === 0) return [];
    const mktCache = qc.getQueryData<{ mediaAssets?: Record<string, unknown>[] }>(['mkt-comms']);
    const nvCache = qc.getQueryData<{ mediaAssets?: Record<string, unknown>[] }>(['nv-comms']);
    const pool = [...(explicitPool ?? []), ...(mktCache?.mediaAssets ?? []), ...(nvCache?.mediaAssets ?? [])];
    return ids.flatMap((id) => {
      const found = pool.find((m) => String(m.id) === id || String(m.code) === id || String(m.file_name) === id);
      return found ? [normalizeClientMediaItem(found)] : [];
    });
  }, [record, explicitPool, qc]);
}

function renderMediaIcon(m: MediaAssetItem, fontSize = 18) {
  if (m.mime_type === 'application/pdf') return <FilePdfOutlined style={{ fontSize, color: '#DC2626' }} />;
  if (m.isImage) return <FileImageOutlined style={{ fontSize, color: '#2563EB' }} />;
  return <FileTextOutlined style={{ fontSize, color: '#0284C7' }} />;
}

export function MediaAttachmentSection({ items }: { items: MediaAssetItem[] }) {
  const [viewing, setViewing] = useState<MediaAssetItem | null>(null);
  const [brokenIds, setBrokenIds] = useState<Record<string, boolean>>({});
  if (items.length === 0) return null;

  return (
    <>
      <Card size="small" title={<span><PaperClipOutlined /> Tệp &amp; Media đính kèm ({items.length})</span>}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {items.map((m) => {
            const canPreviewImg = Boolean(m.isImage && m.previewUrl && !brokenIds[m.id]);
            return (
              <div key={m.id} style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', background: '#F8FAFC' }}>
                <Flex justify="space-between" align="flex-start" wrap gap={10}>
                  <Space align="start" size={10}>
                    <div style={{ width: 38, height: 38, borderRadius: 4, border: '1px solid #E2E8F0', background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
                      {renderMediaIcon(m, 18)}
                    </div>
                    <div>
                      <Space size={6} wrap>
                        <Typography.Link strong onClick={() => setViewing(m)}>{m.file_name}</Typography.Link>
                        {m.code && <Tag color="geekblue" style={{ margin: 0 }}>{m.code}</Tag>}
                        <Tag color="blue" style={{ margin: 0 }}>{m.categoryLabel}</Tag>
                      </Space>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
                        {m.mimeLabel} · Dung lượng: <span className="num">{m.sizeFormatted}</span> · {m.securityLabel} · Tải lên bởi: {m.creatorName}
                      </div>
                    </div>
                  </Space>
                  <Space size={6} wrap>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => setViewing(m)}>Thông tin tệp</Button>
                    {m.openUrl && <Button size="small" type="primary" ghost icon={<ExportOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">Mở tệp gốc</Button>}
                  </Space>
                </Flex>
                {canPreviewImg && (
                  <div style={{ marginTop: 10, padding: 8, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4 }}>
                    <Image src={m.previewUrl} alt={m.file_name} style={{ maxHeight: 240, maxWidth: '100%', objectFit: 'contain', borderRadius: 2 }} onError={() => setBrokenIds((p) => ({ ...p, [m.id]: true }))} />
                  </div>
                )}
              </div>
            );
          })}
        </Space>
      </Card>
      <MediaAssetDetailDrawer item={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

export function MediaAssetDetailDrawer({
  item, onClose, onEdit,
}: {
  item: MediaAssetItem | Record<string, unknown> | null; onClose: () => void; onEdit?: (raw: Record<string, unknown>) => void;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const m = item ? normalizeClientMediaItem(item as Record<string, unknown>) : null;

  return (
    <BaseDetailDrawer
      open={Boolean(m)} onClose={() => { setImgBroken(false); onClose(); }}
      title={m ? `Chi tiết Tệp Media: ${m.file_name}` : 'Chi tiết Tệp Media'}
      extra={
        <>
          {m?.openUrl && <Button size="small" icon={<ExportOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">Mở liên kết gốc</Button>}
          {item && onEdit && <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const r = item as Record<string, unknown>; onClose(); onEdit(r); }}>Cập nhật tệp</Button>}
        </>
      }
    >
      {m && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={1}>
            <Descriptions.Item label="Mã định danh tệp"><Tag color="geekblue">{m.code || 'MED'}</Tag></Descriptions.Item>
            <Descriptions.Item label="Tên tệp / Tài liệu"><strong>{m.file_name}</strong></Descriptions.Item>
            <Descriptions.Item label="Phân loại nội dung"><Tag color="blue">{m.categoryLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Định dạng & Dung lượng"><Space size={6}><Tag color="cyan">{m.mimeLabel}</Tag><span className="num" style={{ fontWeight: 600 }}>{m.sizeFormatted}</span></Space></Descriptions.Item>
            <Descriptions.Item label="Phạm vi bảo mật"><Tag color={m.is_internal_only ? 'green' : 'orange'} icon={<LockOutlined />}>{m.securityLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Người tải lên & Thời gian">{m.creatorName}{m.created_at ? ` · ${dayjs(m.created_at).format('HH:mm DD/MM/YYYY')}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Đường dẫn lưu trữ">
              {m.openUrl ? <Typography.Link href={m.openUrl} target="_blank" rel="noopener noreferrer">{m.openUrl}</Typography.Link> : <span style={{ color: '#64748B' }}>Lưu trữ trong Kho Media nội bộ</span>}
            </Descriptions.Item>
          </Descriptions>
          {m.isImage && m.previewUrl && !imgBroken && (
            <Card size="small" title="Bản xem trước hình ảnh">
              <div style={{ textAlign: 'center', padding: 8 }}>
                <Image src={m.previewUrl} alt={m.file_name} style={{ maxHeight: 420, maxWidth: '100%', objectFit: 'contain' }} onError={() => setImgBroken(true)} />
              </div>
            </Card>
          )}
        </Space>
      )}
    </BaseDetailDrawer>
  );
}
