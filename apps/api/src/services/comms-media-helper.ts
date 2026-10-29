import type { MediaAsset } from '@umbm/shared';
import type { AppContext } from '../context.js';

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
  'application/pdf': 'Tài liệu PDF',
  'video/mp4': 'Video MP4',
};

export interface EnrichedMediaAsset extends MediaAsset {
  drive_url: string;
  openUrl: string;
  previewUrl: string;
  isImage: boolean;
  mimeLabel: string;
  categoryLabel: string;
  sizeFormatted: string;
  securityLabel: string;
  creatorName: string;
  isMine: boolean;
  canEdit: boolean;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const DRIVE_ID_ONLY_RE = /^[a-zA-Z0-9_-]{25,64}$/;

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
      // Fallback to CSV cleanup below
    }
  }
  return str
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeMediaUrls(rawDriveField: string, mimeType: string): {
  openUrl: string;
  previewUrl: string;
  isImage: boolean;
} {
  const raw = String(rawDriveField || '').trim();
  const mime = String(mimeType || '').toLowerCase();
  const isImageByExt = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw) || raw.startsWith('data:image/');
  const isImage = mime.startsWith('image/') || isImageByExt;

  if (!raw || raw.startsWith('drive://')) {
    return { openUrl: '', previewUrl: '', isImage };
  }

  const driveFileMatch = raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i)
    ?? raw.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?[^#]*id=([a-zA-Z0-9_-]+)/i);
  if (driveFileMatch?.[1]) {
    const fileId = driveFileMatch[1];
    return {
      openUrl: raw.startsWith('http') ? raw : `https://drive.google.com/file/d/${fileId}/view`,
      previewUrl: isImage ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200` : '',
      isImage,
    };
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:image/') || raw.startsWith('/')) {
    return { openUrl: raw, previewUrl: isImage ? raw : '', isImage };
  }

  if (DRIVE_ID_ONLY_RE.test(raw) && !ULID_RE.test(raw)) {
    return {
      openUrl: `https://drive.google.com/file/d/${raw}/view`,
      previewUrl: isImage ? `https://drive.google.com/thumbnail?id=${raw}&sz=w1200` : '',
      isImage,
    };
  }

  return { openUrl: '', previewUrl: '', isImage };
}

export function enrichMediaAsset(
  ctx: AppContext,
  m: MediaAsset,
  u?: { id: string; role: string; username: string; display_name?: string },
  canModify?: (user: { id: string; role: string; username: string; display_name?: string }, rec: { created_by: string; uploaded_by?: string }) => boolean,
): EnrichedMediaAsset {
  const { openUrl, previewUrl, isImage } = normalizeMediaUrls(m.drive_file_id, m.mime_type);
  const creator = ctx.db.users.get(m.uploaded_by || m.created_by);
  return {
    ...m,
    code: m.code || 'MED',
    drive_url: openUrl || (m.drive_file_id?.startsWith('drive://') ? '' : m.drive_file_id),
    openUrl,
    previewUrl,
    isImage,
    mimeLabel: MEDIA_MIME_LABELS[m.mime_type] ?? 'Tệp tài liệu',
    categoryLabel: MEDIA_CATEGORY_LABELS[m.category] ?? 'Tài liệu nội bộ',
    sizeFormatted: formatMediaSize(m.size_bytes),
    securityLabel: m.is_internal_only ? 'Chỉ lưu hành nội bộ' : 'Công khai có kiểm soát',
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
