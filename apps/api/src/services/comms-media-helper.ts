import type { MediaAsset } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { extractGoogleDriveFileId } from './mkt-media-storage.service.js';

export const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  BANNER: 'Banner truyền thông',
  SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện',
  POLICY_PDF: 'Văn bản chính sách (PDF)',
};

export const MEDIA_MIME_LABELS: Record<string, string> = {
  'image/png': 'Hình ảnh PNG',
  'image/jpeg': 'Hình ảnh JPEG',
  'image/jpg': 'Hình ảnh JPEG',
  'image/webp': 'Hình ảnh WebP',
  'image/gif': 'Hình ảnh GIF',
  'image/svg+xml': 'Hình ảnh Vector SVG',
  'application/pdf': 'Tài liệu PDF',
  'video/mp4': 'Video MP4',
};

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
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x || '').trim()).filter(Boolean);
      }
    } catch {
      // Fallback sang tách chuỗi dấu phẩy bên dưới
    }
  }
  return str
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Chuẩn hóa toàn bộ đường dẫn xem trước & tải tệp Media qua proxy OAuth2 cùng tên miền
 * (`/api/mkt/media/files/:id`), tương tự cơ chế ảnh điểm danh (`/api/attendance/photos/:fileId`),
 * triệt tiêu 100% lỗi 403 Forbidden khi người xem đăng nhập tài khoản Google khác.
 */
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
  const mime = String(mimeType || '').toLowerCase();
  const isImageByExt = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw) || raw.startsWith('data:image/');
  const isImage = mime.startsWith('image/') || isImageByExt;
  const isInternalPlaceholder = !raw || raw.startsWith('drive://');

  if (mediaId) {
    if (isInternalPlaceholder && !isImage) {
      return { openUrl: '', previewUrl: '', isImage: false };
    }
    const verSuffix = version && version > 1 ? `?v=${version}` : '';
    const proxyUrl = `/api/mkt/media/files/${encodeURIComponent(mediaId)}${verSuffix}`;
    return {
      openUrl: proxyUrl,
      previewUrl: isImage ? proxyUrl : '',
      isImage,
    };
  }

  if (isInternalPlaceholder) {
    return { openUrl: '', previewUrl: '', isImage };
  }

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
  const { openUrl, previewUrl, isImage } = normalizeMediaUrls(rawDrive, m.mime_type, m.id, m.version);
  const driveId = extractGoogleDriveFileId(rawDrive);
  const storageSourceLabel = !rawDrive || rawDrive.startsWith('drive://')
    ? 'Kho Media mẫu nội bộ'
    : driveId || rawDrive.startsWith('local_')
      ? 'Google Drive Hệ thống (05_MKT_MEDIA)'
      : 'Kho Media Hệ thống';
  const externalSourceUrl = /^https?:\/\//i.test(rawDrive) ? rawDrive : '';
  const creator = ctx.db.users.get(m.uploaded_by || m.created_by);

  return {
    ...m,
    code: m.code || 'MED',
    drive_url: openUrl,
    externalSourceUrl,
    openUrl,
    previewUrl,
    isImage,
    mimeLabel: MEDIA_MIME_LABELS[m.mime_type] ?? 'Tệp tài liệu',
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
    if (found) {
      resolved.push(enrichMediaAsset(ctx, found, u));
    }
  }
  return resolved;
}
