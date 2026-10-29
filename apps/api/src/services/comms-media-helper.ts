import type { MediaAsset } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { extractGoogleDriveFileId, guessMimeByExtension } from './mkt-media-storage.service.js';

export const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  BANNER: 'Banner truyền thông',
  SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện',
  POLICY_PDF: 'Văn bản chính sách',
  ARCHIVE_PACKAGE: 'Gói tệp nén / Tư liệu (ZIP/RAR)',
  OFFICE_SHEET: 'Biểu mẫu Word / Excel / Trình chiếu',
  VIDEO_AUDIO: 'Video / Âm thanh đào tạo',
};

export const MEDIA_MIME_LABELS: Record<string, string> = {
  'image/png': 'Hình ảnh PNG',
  'image/jpeg': 'Hình ảnh JPEG',
  'image/jpg': 'Hình ảnh JPEG',
  'image/webp': 'Hình ảnh WebP',
  'image/gif': 'Hình ảnh GIF',
  'image/svg+xml': 'Hình ảnh Vector SVG',
  'image/bmp': 'Hình ảnh BMP',
  'application/pdf': 'Tài liệu PDF',
  'application/zip': 'Tệp nén ZIP',
  'application/x-zip-compressed': 'Tệp nén ZIP',
  'multipart/x-zip': 'Tệp nén ZIP',
  'application/vnd.rar': 'Tệp nén RAR',
  'application/x-rar-compressed': 'Tệp nén RAR',
  'application/x-7z-compressed': 'Tệp nén 7-Zip',
  'application/gzip': 'Tệp nén GZIP',
  'application/msword': 'Tài liệu Word (DOC)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Tài liệu Word (DOCX)',
  'application/vnd.ms-excel': 'Bảng tính Excel (XLS)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Bảng tính Excel (XLSX)',
  'text/csv': 'Bảng dữ liệu CSV',
  'application/vnd.ms-powerpoint': 'Trình chiếu PowerPoint (PPT)',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Trình chiếu PowerPoint (PPTX)',
  'text/plain': 'Tệp văn bản (TXT)',
  'application/json': 'Dữ liệu JSON',
  'text/markdown': 'Tài liệu Markdown',
  'video/mp4': 'Video MP4',
  'video/webm': 'Video WebM',
  'video/quicktime': 'Video MOV',
  'audio/mpeg': 'Âm thanh MP3',
  'audio/wav': 'Âm thanh WAV',
  'application/octet-stream': 'Tệp dữ liệu đính kèm',
};

export function resolveMediaMimeLabel(mimeType: string, fileName = ''): string {
  const cleanMime = String(mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (cleanMime && cleanMime !== 'application/octet-stream' && MEDIA_MIME_LABELS[cleanMime]) {
    return MEDIA_MIME_LABELS[cleanMime]!;
  }
  const byExt = guessMimeByExtension(fileName);
  if (byExt !== 'application/octet-stream' && MEDIA_MIME_LABELS[byExt]) {
    return MEDIA_MIME_LABELS[byExt]!;
  }
  const extMatch = String(fileName || '').trim().match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch?.[1]) return `Tệp đính kèm (${extMatch[1].toUpperCase()})`;
  return MEDIA_MIME_LABELS[cleanMime] ?? 'Tệp dữ liệu đính kèm';
}

export interface EnrichedMediaAsset extends MediaAsset {
  drive_url: string;
  externalSourceUrl: string;
  openUrl: string;
  previewUrl: string;
  isImage: boolean;
  mimeLabel: string;
  categoryLabel: string;
  sizeFormatted: string;
  securityLabel: string;
  storageSourceLabel: string;
  creatorName: string;
  isMine: boolean;
  canEdit: boolean;
}

export function formatMediaSize(bytes: number): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} Bytes`;
}

export function parseMediaIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter((x) => Boolean(x && x !== '[]'));
  }
  const str = String(raw).trim();
  if (!str || str === '[]') return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    } catch { /* fallback CSV */ }
  }
  return str.replace(/[\[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function normalizeMediaUrls(
  rawDriveField: string,
  mimeType: string,
  mediaId?: string,
  version?: number,
): {
  openUrl: string;
  previewUrl: string;
  isImage: boolean;
} {
  const raw = String(rawDriveField || '').trim();
  const mime = String(mimeType || '').split(';')[0]!.trim().toLowerCase();
  const isImageByExt = !mime && (/\.(png|jpe?g|webp|gif|svg|bmp)(\?.*)?$/i.test(raw) || raw.startsWith('data:image/'));
  const isImage = mime.startsWith('image/') || isImageByExt;
  const isInternalPlaceholder = !raw || raw.startsWith('drive://');

  if (mediaId) {
    if (isInternalPlaceholder && !isImage) {
      return { openUrl: '', previewUrl: '', isImage: false };
    }
    const verSuffix = version && version > 1 ? `?v=${version}` : '';
    const proxyUrl = `/api/mkt/media/files/${encodeURIComponent(mediaId)}${verSuffix}`;
    return { openUrl: proxyUrl, previewUrl: isImage ? proxyUrl : '', isImage };
  }

  if (isInternalPlaceholder) return { openUrl: '', previewUrl: '', isImage };

  const driveId = extractGoogleDriveFileId(raw);
  if (driveId) {
    const proxyUrl = `/api/mkt/media/files/${encodeURIComponent(driveId)}`;
    return { openUrl: proxyUrl, previewUrl: isImage ? proxyUrl : '', isImage };
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('/')) {
    return { openUrl: raw, previewUrl: isImage ? raw : '', isImage };
  }

  return { openUrl: '', previewUrl: '', isImage };
}

export function enrichMediaAsset(
  ctx: AppContext,
  m: MediaAsset,
  u?: { id: string; role: string; username: string; display_name?: string },
  canModify?: (user: { id: string; role: string; username: string; display_name?: string }, rec: { created_by: string; uploaded_by?: string }) => boolean,
): EnrichedMediaAsset {
  const rawDrive = String(m.drive_file_id || '').trim();
  const effectiveMime = (!m.mime_type || m.mime_type === 'application/octet-stream')
    ? guessMimeByExtension(m.file_name)
    : m.mime_type;
  const { openUrl, previewUrl, isImage } = normalizeMediaUrls(rawDrive, effectiveMime, m.id, m.version);
  const driveId = extractGoogleDriveFileId(rawDrive);
  const storageSourceLabel = !rawDrive || rawDrive.startsWith('drive://')
    ? 'Kho Media mẫu nội bộ'
    : driveId || rawDrive.startsWith('local_')
      ? 'Google Drive Hệ thống'
      : 'Kho Media Hệ thống';
  const externalSourceUrl = /^https?:\/\//i.test(rawDrive) ? rawDrive : '';
  const creator = ctx.db.users.get(m.uploaded_by || m.created_by);

  return {
    ...m,
    mime_type: effectiveMime,
    code: m.code || 'MED',
    drive_url: openUrl,
    externalSourceUrl,
    openUrl,
    previewUrl,
    isImage,
    mimeLabel: resolveMediaMimeLabel(effectiveMime, m.file_name),
    categoryLabel: MEDIA_CATEGORY_LABELS[m.category] ?? 'Tài liệu nội bộ',
    sizeFormatted: formatMediaSize(m.size_bytes),
    securityLabel: m.is_internal_only ? 'Chỉ lưu hành nội bộ' : 'Công khai có kiểm soát',
    storageSourceLabel,
    creatorName: creator?.display_name || 'Truyền thông MKT',
    isMine: Boolean(u && (m.created_by === u.id || m.uploaded_by === u.id)),
    canEdit: Boolean(u && (canModify ? canModify(u, m) : (u.role === 'ADMIN' || m.created_by === u.id || m.uploaded_by === u.id))),
  };
}

export function resolveAnnouncementMediaAttachments(
  ctx: AppContext,
  rawMediaIds: unknown,
  u?: { id: string; role: string; username: string; display_name?: string },
): EnrichedMediaAsset[] {
  const ids = parseMediaIds(rawMediaIds);
  if (ids.length === 0) return [];
  const allIncludingArchived = ctx.db.mediaAssets.all(true);
  const seen = new Set<string>();
  const resolved: EnrichedMediaAsset[] = [];

  for (const rawId of ids) {
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    const found = ctx.db.mediaAssets.get(rawId)
      ?? allIncludingArchived.find((m) => m.id === rawId || m.code === rawId || m.file_name === rawId);
    if (found) resolved.push(enrichMediaAsset(ctx, found, u));
  }
  return resolved;
}
