'use client';

import { Button, Card, Descriptions, Flex, Space, Tag, Typography } from 'antd';
import {
  CloudServerOutlined, DownloadOutlined, EditOutlined, ExportOutlined, EyeOutlined,
  FileExcelOutlined, FileImageOutlined, FilePdfOutlined, FilePptOutlined,
  FileTextOutlined, FileWordOutlined, FileZipOutlined, LockOutlined, PaperClipOutlined, PlaySquareOutlined,
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
  EVENT_PHOTO: 'Hình ảnh sự kiện', POLICY_PDF: 'Văn bản chính sách',
  ARCHIVE_PACKAGE: 'Gói tệp nén / Tư liệu (ZIP/RAR)',
  OFFICE_SHEET: 'Biểu mẫu Word / Excel / Trình chiếu',
  VIDEO_AUDIO: 'Video / Âm thanh đào tạo',
};
export const MEDIA_CATEGORY_OPTIONS = Object.entries(MEDIA_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

const CLIENT_EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip', tgz: 'application/gzip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', json: 'application/json', md: 'text/markdown',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
};

export const MEDIA_MIME_LABELS: Record<string, string> = {
  'image/png': 'Hình ảnh PNG', 'image/jpeg': 'Hình ảnh JPEG', 'image/jpg': 'Hình ảnh JPEG',
  'image/webp': 'Hình ảnh WebP', 'image/gif': 'Hình ảnh GIF', 'image/svg+xml': 'Hình ảnh Vector SVG', 'image/bmp': 'Hình ảnh BMP',
  'application/pdf': 'Tài liệu PDF', 'application/zip': 'Tệp nén ZIP', 'application/x-zip-compressed': 'Tệp nén ZIP', 'multipart/x-zip': 'Tệp nén ZIP',
  'application/vnd.rar': 'Tệp nén RAR', 'application/x-rar-compressed': 'Tệp nén RAR', 'application/x-7z-compressed': 'Tệp nén 7-Zip', 'application/gzip': 'Tệp nén GZIP',
  'application/msword': 'Tài liệu Word (DOC)', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Tài liệu Word (DOCX)',
  'application/vnd.ms-excel': 'Bảng tính Excel (XLS)', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Bảng tính Excel (XLSX)', 'text/csv': 'Bảng dữ liệu CSV',
  'application/vnd.ms-powerpoint': 'Trình chiếu PowerPoint (PPT)', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Trình chiếu PowerPoint (PPTX)',
  'text/plain': 'Tệp văn bản (TXT)', 'application/json': 'Dữ liệu JSON', 'text/markdown': 'Tài liệu Markdown',
  'video/mp4': 'Video MP4', 'video/webm': 'Video WebM', 'video/quicktime': 'Video MOV', 'audio/mpeg': 'Âm thanh MP3', 'audio/wav': 'Âm thanh WAV',
  'application/octet-stream': 'Tệp dữ liệu đính kèm',
};

export function guessClientMimeByExt(fileName = ''): string {
  const m = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?.*)?$/);
  return (m?.[1] && CLIENT_EXT_MIME[m[1]]) ? CLIENT_EXT_MIME[m[1]]! : 'application/octet-stream';
}

export function resolveMediaMimeLabel(mimeType?: string, fileName = ''): string {
  const clean = String(mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream' && MEDIA_MIME_LABELS[clean]) return MEDIA_MIME_LABELS[clean]!;
  const byExt = guessClientMimeByExt(fileName);
  if (byExt !== 'application/octet-stream' && MEDIA_MIME_LABELS[byExt]) return MEDIA_MIME_LABELS[byExt]!;
  const extMatch = String(fileName || '').trim().match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch?.[1]) return `Tệp đính kèm (${extMatch[1].toUpperCase()})`;
  return MEDIA_MIME_LABELS[clean] ?? 'Tệp dữ liệu đính kèm';
}

export function inferCategoryForMime(mimeType: string, fileName = ''): string {
  const m = (mimeType && mimeType !== 'application/octet-stream' ? mimeType : guessClientMimeByExt(fileName)).toLowerCase();
  if (m.includes('zip') || m.includes('rar') || m.includes('7z') || m.includes('gzip')) return 'ARCHIVE_PACKAGE';
  if (m.includes('word') || m.includes('excel') || m.includes('spreadsheet') || m.includes('powerpoint') || m.includes('presentation') || m === 'text/csv') return 'OFFICE_SHEET';
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'VIDEO_AUDIO';
  if (m === 'application/pdf' || m.startsWith('text/')) return 'SOP_DOC';
  return 'BANNER';
}

export function formatMediaBytes(bytes?: unknown): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} Bytes`;
}

export function renderMediaIcon(mimeType?: string, fileName = '', fontSize = 18) {
  const m = (mimeType && mimeType !== 'application/octet-stream' ? mimeType : guessClientMimeByExt(fileName)).toLowerCase();
  if (m === 'application/pdf') return <FilePdfOutlined style={{ fontSize, color: '#DC2626' }} />;
  if (m.includes('zip') || m.includes('rar') || m.includes('7z') || m.includes('gzip')) return <FileZipOutlined style={{ fontSize, color: '#D97706' }} />;
  if (m.includes('excel') || m.includes('spreadsheet') || m === 'text/csv') return <FileExcelOutlined style={{ fontSize, color: '#16A34A' }} />;
  if (m.includes('word')) return <FileWordOutlined style={{ fontSize, color: '#2563EB' }} />;
  if (m.includes('powerpoint') || m.includes('presentation')) return <FilePptOutlined style={{ fontSize, color: '#EA580C' }} />;
  if (m.startsWith('video/') || m.startsWith('audio/')) return <PlaySquareOutlined style={{ fontSize, color: '#7C3AED' }} />;
  if (m.startsWith('image/')) return <FileImageOutlined style={{ fontSize, color: '#2563EB' }} />;
  return <FileTextOutlined style={{ fontSize, color: '#0284C7' }} />;
}

export function normalizeClientMediaItem(raw: Record<string, unknown>): MediaAssetItem {
  const id = String(raw.id || '').trim(), ver = Number(raw.version || 1), verSuffix = ver > 1 ? `?v=${ver}` : '';
  const fileName = String(raw.file_name || 'Tệp đính kèm nội bộ');
  const rawMime = String(raw.mime_type || '').trim();
  const mime = (!rawMime || rawMime === 'application/octet-stream') ? guessClientMimeByExt(fileName) : rawMime;
  const rawDriveField = String(raw.drive_file_id || '').trim();
  const rawUrl = String(raw.openUrl || raw.drive_url || rawDriveField || '').trim();
  const isInternal = (!rawDriveField && (!rawUrl || rawUrl.startsWith('drive://'))) || rawDriveField.startsWith('drive://');
  const isImg = Boolean(raw.isImage ?? (mime.toLowerCase().startsWith('image/') || rawUrl.startsWith('data:image/')));
  const proxyUrl = id ? `/api/mkt/media/files/${encodeURIComponent(id)}${verSuffix}` : '';
  const openUrl = rawUrl.startsWith('data:') ? rawUrl : id ? ((!isInternal || isImg) ? proxyUrl : '') : (rawUrl.startsWith('/api/mkt/media/files/') ? rawUrl : '');
  const previewUrl = isImg ? openUrl : '';
  const cat = String(raw.category || 'BANNER'), internalOnly = raw.is_internal_only !== false;

  return {
    id, code: String(raw.code || 'MED'), version: ver, file_name: fileName,
    mime_type: mime, mimeLabel: resolveMediaMimeLabel(mime, fileName),
    size_bytes: Number(raw.size_bytes || 0), sizeFormatted: String(raw.sizeFormatted || formatMediaBytes(raw.size_bytes)),
    category: cat, categoryLabel: String(raw.categoryLabel || MEDIA_CATEGORY_LABELS[cat] || 'Tài liệu nội bộ'),
    drive_url: openUrl, externalSourceUrl: String(raw.externalSourceUrl || (/^https?:\/\//i.test(rawDriveField) ? rawDriveField : '')),
    openUrl, previewUrl, storageSourceLabel: String(raw.storageSourceLabel || (isInternal ? 'Kho Media mẫu nội bộ' : 'Google Drive Hệ thống')),
    isImage: isImg, is_internal_only: internalOnly,
    securityLabel: String(raw.securityLabel || (internalOnly ? 'Chỉ lưu hành nội bộ' : 'Công khai có kiểm soát')),
    creatorName: String(raw.creatorName || 'Truyền thông MKT'), created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

export function parseRawMediaIds(raw: unknown): string[] {
  if (!raw) return [];
  const str = String(raw).trim();
  return (!str || str === '[]') ? [] : str.replace(/[\[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function useResolvedMediaAttachments(record: Record<string, unknown> | null | undefined, explicitPool?: Record<string, unknown>[]): MediaAssetItem[] {
  const qc = useQueryClient();
  return useMemo(() => {
    if (!record) return [];
    if (Array.isArray(record.mediaAttachments) && record.mediaAttachments.length > 0) return (record.mediaAttachments as Record<string, unknown>[]).map(normalizeClientMediaItem);
    const ids = parseRawMediaIds(record.media_ids);
    if (ids.length === 0) return [];
    const mktCache = qc.getQueryData<{ mediaAssets?: Record<string, unknown>[] }>(['mkt-comms']);
    const nvCache = qc.getQueryData<{ mediaAssets?: Record<string, unknown>[] }>(['nv-comms']);
    const pool = [...(explicitPool ?? []), ...(mktCache?.mediaAssets ?? []), ...(nvCache?.mediaAssets ?? [])];
    return ids.flatMap((id) => { const found = pool.find((m) => String(m.id) === id || String(m.code) === id || String(m.file_name) === id); return found ? [normalizeClientMediaItem(found)] : []; });
  }, [record, explicitPool, qc]);
}

export function MediaAttachmentSection({ items }: { items: MediaAssetItem[] }) {
  const [viewing, setViewing] = useState<MediaAssetItem | null>(null);
  const gallerySlides: FancyboxSlideItem[] = useMemo(() => items.filter((m) => Boolean(m.isImage && m.previewUrl)).map((m) => ({ src: m.previewUrl!, caption: `${m.code ? `[${m.code}] ` : ''}${m.file_name} (${m.categoryLabel} · ${m.sizeFormatted})` })), [items]);
  if (items.length === 0) return null;

  return (
    <>
      <Card size="small" title={<span><PaperClipOutlined /> Tệp &amp; Media đính kèm ({items.length})</span>}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {items.map((m) => {
            const slideIdx = m.previewUrl ? Math.max(0, gallerySlides.findIndex((s) => s.src === m.previewUrl)) : 0;
            const isInline = m.isImage || m.mime_type === 'application/pdf' || m.mime_type.startsWith('video/');
            return (
              <div key={m.id} style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', background: '#F8FAFC' }}>
                <Flex justify="space-between" align="flex-start" wrap gap={10}>
                  <Space align="start" size={10}>
                    <div style={{ width: 38, height: 38, borderRadius: 4, border: '1px solid #E2E8F0', background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>{renderMediaIcon(m.mime_type, m.file_name, 18)}</div>
                    <div>
                      <Space size={6} wrap><Typography.Link strong onClick={() => setViewing(m)}>{m.file_name}</Typography.Link>{m.code && <Tag color="geekblue" style={{ margin: 0 }}>{m.code}</Tag>}<Tag color="blue" style={{ margin: 0 }}>{m.categoryLabel}</Tag></Space>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{m.mimeLabel} · Dung lượng: <span className="num">{m.sizeFormatted}</span> · {m.securityLabel} · Tải lên bởi: {m.creatorName}</div>
                    </div>
                  </Space>
                  <Space size={6} wrap>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => setViewing(m)}>Thông tin tệp</Button>
                    {m.openUrl && <Button size="small" type="primary" ghost icon={isInline ? <ExportOutlined /> : <DownloadOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">{m.isImage ? 'Mở xem ảnh' : isInline ? 'Mở / Tải tệp' : 'Tải tệp xuống'}</Button>}
                  </Space>
                </Flex>
                {m.isImage && m.previewUrl && (
                  <div style={{ marginTop: 10, borderRadius: 4, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                    <FancyboxImage src={m.previewUrl} alt={m.file_name} caption={`${m.code ? `[${m.code}] ` : ''}${m.file_name} (${m.categoryLabel} · ${m.sizeFormatted})`} gallerySlides={gallerySlides} slideIndex={slideIdx} height={220} objectFit="contain" />
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

export function MediaAssetDetailDrawer({ item, onClose, onEdit }: { item: MediaAssetItem | Record<string, unknown> | null; onClose: () => void; onEdit?: (raw: Record<string, unknown>) => void }) {
  const m = item ? normalizeClientMediaItem(item as Record<string, unknown>) : null;
  const isInline = Boolean(m && (m.isImage || m.mime_type === 'application/pdf' || m.mime_type.startsWith('video/')));

  return (
    <BaseDetailDrawer
      open={Boolean(m)} onClose={onClose} title={m ? `Chi tiết Tệp Media: ${m.file_name}` : 'Chi tiết Tệp Media'}
      extra={<>{m?.openUrl && <Button size="small" icon={isInline ? <ExportOutlined /> : <DownloadOutlined />} href={m.openUrl} target="_blank" rel="noopener noreferrer">{isInline ? 'Mở / Tải tệp' : 'Tải tệp xuống'}</Button>}{item && onEdit && <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { const r = item as Record<string, unknown>; onClose(); onEdit(r); }}>Cập nhật tệp</Button>}</>}
    >
      {m && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={1}>
            <Descriptions.Item label="Mã định danh tệp"><Tag color="geekblue">{m.code || 'MED'}</Tag></Descriptions.Item>
            <Descriptions.Item label="Tên tệp / Tài liệu"><Space size={8}>{renderMediaIcon(m.mime_type, m.file_name, 16)}<strong>{m.file_name}</strong></Space></Descriptions.Item>
            <Descriptions.Item label="Phân loại nội dung"><Tag color="blue">{m.categoryLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Định dạng & Dung lượng"><Space size={6}><Tag color="cyan">{m.mimeLabel}</Tag><span className="num" style={{ fontWeight: 600 }}>{m.sizeFormatted}</span></Space></Descriptions.Item>
            <Descriptions.Item label="Phạm vi bảo mật"><Tag color={m.is_internal_only ? 'green' : 'orange'} icon={<LockOutlined />}>{m.securityLabel}</Tag></Descriptions.Item>
            <Descriptions.Item label="Người tải lên & Thời gian">{m.creatorName}{m.created_at ? ` · ${dayjs(m.created_at).format('HH:mm DD/MM/YYYY')}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Nguồn lưu trữ & Truy cập"><Space size={8} wrap><Tag color="geekblue" icon={<CloudServerOutlined />} style={{ margin: 0 }}>{m.storageSourceLabel}</Tag>{m.openUrl && <Typography.Link href={m.openUrl} target="_blank" rel="noopener noreferrer">{isInline ? 'Mở / Tải tệp' : 'Tải tệp xuống'}</Typography.Link>}</Space></Descriptions.Item>
          </Descriptions>
          {m.isImage && m.previewUrl && <Card size="small" title="Bản xem trước hình ảnh (Bấm để phóng to)"><FancyboxImage src={m.previewUrl} alt={m.file_name} caption={`${m.code ? `[${m.code}] ` : ''}${m.file_name}`} height={340} objectFit="contain" /></Card>}
        </Space>
      )}
    </BaseDetailDrawer>
  );
}
