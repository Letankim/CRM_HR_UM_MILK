import type { AppContext } from '../context.js';
import { formatMediaSize, resolveMediaMimeLabel } from './comms-media-helper.js';
import {
  detectBufferMimeType,
  extractGoogleDriveFileId,
  guessMimeByExtension,
  readMediaCache,
  saveMediaCache,
  toMktCacheKey,
} from './mkt-media-storage.service.js';

export interface ProbedMktMediaInfo {
  reachable: boolean;
  driveFileId: string | null;
  fileName: string;
  mimeType: string;
  mimeLabel: string;
  sizeBytes: number;
  sizeFormatted: string;
  isImage: boolean;
  previewUrl: string;
}

function parseContentDispositionName(header: string | null): string {
  if (!header) return '';
  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, '')); } catch { /* ignore */ }
  }
  const plainMatch = header.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  return plainMatch?.[1]?.trim() ?? '';
}

function normalizeKnownMime(rawMime: string, fileName = ''): string {
  const base = String(rawMime || '').split(';')[0]!.trim().toLowerCase();
  if (base.startsWith('application/vnd.google-apps.')) return 'application/pdf';
  if (base === 'image/jpg') return 'image/jpeg';
  if (base === 'application/x-zip-compressed' || base === 'multipart/x-zip') return 'application/zip';
  if (base === 'application/x-rar-compressed') return 'application/vnd.rar';
  if (base && base !== 'application/octet-stream' && base !== 'binary/octet-stream') return base;
  return guessMimeByExtension(fileName);
}

export async function probeMktMediaSource(ctx: AppContext, rawInput: string): Promise<ProbedMktMediaInfo> {
  const raw = String(rawInput || '').trim();
  const driveId = extractGoogleDriveFileId(raw);
  const cacheKey = toMktCacheKey(driveId ?? raw);
  let fileName = '';
  let declaredMime = '';
  let sizeBytes = 0;
  let buf = cacheKey ? readMediaCache(ctx, cacheKey) : null;
  let reachable = Boolean(buf && buf.length > 0);

  if (driveId) {
    if (ctx.google.getDriveFileMeta) {
      const meta = await ctx.google.getDriveFileMeta(driveId);
      if (meta) {
        fileName = meta.name || fileName;
        declaredMime = meta.mimeType || declaredMime;
        sizeBytes = meta.sizeBytes || sizeBytes;
        if (meta.sizeBytes > 0 || meta.name) reachable = true;
      }
    }
    const metaMime = normalizeKnownMime(declaredMime, fileName);
    const shouldPrewarmBytes = !buf && (!reachable || sizeBytes <= 0 || (metaMime.startsWith('image/') && sizeBytes <= 12 * 1024 * 1024));
    if (shouldPrewarmBytes && ctx.google.downloadDriveFile) {
      buf = await ctx.google.downloadDriveFile(driveId);
      if (buf && buf.length > 0 && buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf);
    }
    if (!buf && shouldPrewarmBytes && (raw.startsWith('http') || ctx.google.mode === 'google')) {
      try {
        const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(8_000),
        });
        const ct = res.headers.get('content-type') || '';
        const dispName = parseContentDispositionName(res.headers.get('content-disposition'));
        if (dispName && !fileName) fileName = dispName;
        if (res.ok && !ct.includes('text/html')) {
          const downloaded = Buffer.from(await res.arrayBuffer());
          if (downloaded.length > 0) {
            buf = downloaded;
            if (!declaredMime) declaredMime = ct;
            if (buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf);
          }
        }
      } catch { /* fallback below */ }
    }
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      const parsedUrl = new URL(raw);
      const lastSeg = decodeURIComponent(parsedUrl.pathname.split('/').filter(Boolean).pop() || '');
      if (lastSeg && /\.[a-zA-Z0-9]{2,5}$/.test(lastSeg)) fileName = lastSeg;
    } catch { /* ignore */ }
    if (!buf) {
      try {
        const res = await fetch(raw, { redirect: 'follow', signal: AbortSignal.timeout(8_000) });
        const ct = res.headers.get('content-type') || '';
        const dispName = parseContentDispositionName(res.headers.get('content-disposition'));
        if (dispName) fileName = dispName;
        if (res.ok && !ct.includes('text/html')) {
          const downloaded = Buffer.from(await res.arrayBuffer());
          if (downloaded.length > 0) {
            buf = downloaded;
            declaredMime = ct;
            if (buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf);
          } else {
            sizeBytes = Number(res.headers.get('content-length') || 0);
          }
        }
      } catch { /* unreachable external host */ }
    }
  }

  if (buf && buf.length > 0) {
    reachable = true;
    sizeBytes = buf.length;
    declaredMime = detectBufferMimeType(buf, declaredMime, fileName);
  }

  const mimeType = normalizeKnownMime(declaredMime, fileName);
  const isImage = mimeType.startsWith('image/');
  const previewTarget = driveId ?? cacheKey;
  const previewUrl = reachable && isImage && previewTarget ? `/api/mkt/media/files/${encodeURIComponent(previewTarget)}` : '';

  return {
    reachable,
    driveFileId: driveId,
    fileName,
    mimeType,
    mimeLabel: resolveMediaMimeLabel(mimeType, fileName),
    sizeBytes,
    sizeFormatted: formatMediaSize(sizeBytes),
    isImage,
    previewUrl,
  };
}
