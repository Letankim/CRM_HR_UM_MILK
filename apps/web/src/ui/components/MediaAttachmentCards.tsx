'use client';

import { Button, Card, Descriptions, Flex, Space, Tag, Typography } from 'antd';
import {
  CloudServerOutlined, EditOutlined, ExportOutlined, EyeOutlined, FileImageOutlined,
  FilePdfOutlined, FileTextOutlined, LockOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { FancyboxImage, type FancyboxSlideItem } from './FancyboxPreview';

export interface MediaAssetItem {
  id: string; code?: string; version?: number; file_name: string; mime_type: string; mimeLabel?: string;
  size_bytes?: number; sizeFormatted?: string; category?: string; categoryLabel?: string;
  drive_file_id?: string; drive_url?: string; externalSourceUrl?: string; openUrl?: string; previewUrl?: string;
  storageSourceLabel?: string; isImage?: boolean; is_internal_only?: boolean;
  securityLabel?: string; creatorName?: string; created_at?: string;
}

export const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  BANNER: 'Banner truyền thông', SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện', POLICY_PDF: 'Văn bản chính sách (PDF)',
};
export const MEDIA_CATEGORY_OPTIONS = Object.entries(MEDIA_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

export const MEDIA_MIME_LABELS: Record<string, string> = {
  'image/png': 'Hình ảnh PNG', 'image/jpeg': 'Hình ảnh JPEG', 'image/jpg': 'Hình ảnh JPEG',
  'image/webp': 'Hình ảnh WebP', 'image/gif': 'Hình ảnh GIF', 'image/svg+xml': 'Hình ảnh Vector SVG',
  'application/pdf': 'Tài liệu PDF', 'video/mp4': 'Video MP4',
};

export function formatMediaBytes(bytes?: unknown): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} Bytes`;
}

export function normalizeClientMediaItem(raw: Record<string, unknown>): MediaAssetItem {
  const id = String(raw.id || '').trim();
  const ver = Number(raw.version || 1);
  const verSuffix = ver > 1 ? `?v=${ver}` : '';
  const mime = String(raw.mime_type || 'image/png');
  const rawDriveField = String(raw.drive_file_id || '').trim();
  const rawUrl = String(raw.openUrl || raw.drive_url || rawDriveField || '').trim();
  const isInternal = !rawDriveField && (!rawUrl || rawUrl.startsWith('drive://')) || rawDriveField.startsWith('drive://');
  const isImg = Boolean(raw.isImage ?? (mime.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(rawUrl) || rawUrl.startsWith('data:image/')));
  const proxyUrl = id ? `/api/mkt/media/files/${encodeURIComponent(id)}${verSuffix}` : '';
  const openUrl = rawUrl.startsWith('data:')
    ? rawUrl
    : id
      ? ((!isInternal || isImg) ? proxyUrl : '')
      : (rawUrl.startsWith('/api/mkt/media/files/') ? rawUrl : '');
  const previewUrl = isImg ? openUrl : '';
  const cat = String(raw.category || 'BANNER'), internalOnly = raw.is_internal_only !== false;
  const externalSourceUrl = String(raw.externalSourceUrl || (/^https?:\/\//i.test(rawDriveField) ? rawDriveField : ''));
  const storageSourceLabel = String(raw.storageSourceLabel || (isInternal ? 'Kho Media mẫu nội bộ' : 'Google Drive Hệ thống'));

  return {
    id, code: String(raw.code || 'MED'), version: ver, file_name: String(raw.file_name || 'Tệp đính kèm nội bộ'),
    mime_type: mime, mimeLabel: String(raw.mimeLabel || MEDIA_MIME_LABELS[mime] || 'Tệp tài liệu'),
    size_bytes: Number(raw.size_bytes || 0), sizeFormatted: String(raw.sizeFormatted || formatMediaBytes(raw.size_bytes)),
    category: cat, categoryLabel: String(raw.categoryLabel || MEDIA_CATEGORY_LABELS[cat] || 'Tài liệu nội bộ'),
    drive_url: openUrl, externalSourceUrl, openUrl, previewUrl, storageSourceLabel, isImage: isImg, is_internal_only: internalOnly,
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
  const gallerySlides: FancyboxSlideItem[] = useMemo(
    () => items.filter((m) => Boolean(m.isImage && m.previewUrl)).map((m) => ({
      src: m.previewUrl!,
      caption: `${m.code ? `[${m.code}] ` : ''}${m.file_name} (${m.categoryLabel} · ${m.sizeFormatted})`,
    })),
    [items],
  );
  if (items.length === 0) return null;

  return (
    <>
      <Card size="small" title={<span><PaperClipOutlined /> Tệp &amp; Media đính kèm ({items.length})</span>}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {items.map((m) => {
            const slideIdx = m.previewUrl ? Math.max(0, gallerySlides.findIndex((s) => s.src === m.previewUrl)) : 0;
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
                    {m.openUrl && <Button size="small" type="primary" ghost icon={<ExportOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">Mở / Tải tệp</Button>}
                  </Space>
                </Flex>
                {m.isImage && m.previewUrl && (
                  <div style={{ marginTop: 10, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                    <FancyboxImage
                      src={m.previewUrl}
                      alt={m.file_name}
                      caption={`${m.code ? `[${m.code}] ` : ''}${m.file_name} (${m.categoryLabel} · ${m.sizeFormatted})`}
                      gallerySlides={gallerySlides}
                      slideIndex={slideIdx}
                      height={220}
                      objectFit="contain"
                    />
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
  const m = item ? normalizeClientMediaItem(item as Record<string, unknown>) : null;

  return (
    <BaseDetailDrawer
      open={Boolean(m)} onClose={onClose}
      title={m ? `Chi tiết Tệp Media: ${m.file_name}` : 'Chi tiết Tệp Media'}
      extra={
        <>
          {m?.openUrl && <Button size="small" icon={<ExportOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">Mở / Tải tệp</Button>}
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
            <Descriptions.Item label="Nguồn lưu trữ & Truy cập">
              <Space size={8} wrap>
                <Tag color="geekblue" icon={<CloudServerOutlined />} style={{ margin: 0 }}>{m.storageSourceLabel}</Tag>
                {m.openUrl && <Typography.Link href={m.openUrl} target="_blank" rel="noopener noreferrer">Xem / Tải tệp qua Cổng bảo mật Hệ thống</Typography.Link>}
              </Space>
            </Descriptions.Item>
          </Descriptions>
          {m.isImage && m.previewUrl && (
            <Card size="small" title="Bản xem trước hình ảnh (Bấm để phóng to)">
              <FancyboxImage src={m.previewUrl} alt={m.file_name} caption={`${m.code ? `[${m.code}] ` : ''}${m.file_name}`} height={340} objectFit="contain" />
            </Card>
          )}
        </Space>
      )}
    </BaseDetailDrawer>
  );
}
