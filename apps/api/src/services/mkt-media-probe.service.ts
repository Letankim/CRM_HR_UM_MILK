import type { AppContext } from '../context.js';
import { formatMediaSize, resolveMediaMimeLabel } from './comms-media-helper.js';
import {
  detectBufferMimeType,
  extractGoogleDriveFileId,
  guessMimeByExtension,
  readMediaCache,
  readMediaMetaCache,
  resolveUploadExtension,
  saveMediaCache,
  saveMediaMetaCache,
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

function decodeHtmlAttr(val: string): string {
  return val
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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
  const cachedMeta = cacheKey ? readMediaMetaCache(ctx, cacheKey) : null;
  let buf = cacheKey ? readMediaCache(ctx, cacheKey) : null;
  let fileName = cachedMeta?.fileName || '';
  let declaredMime = cachedMeta?.mimeType || '';
  let sizeBytes = buf?.length || cachedMeta?.sizeBytes || 0;
  let reachable = Boolean((buf && buf.length > 0) || (cachedMeta && cachedMeta.sizeBytes > 0));

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
    const canQueryPublicDrive = ctx.google.mode === 'google' || (!buf && raw.startsWith('http'));
    const directDownloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`;

    if (canQueryPublicDrive && (!fileName || sizeBytes <= 0)) {
      try {
        const headRes = await fetch(directDownloadUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5_000) });
        const ct = headRes.headers.get('content-type') || '';
        const dispName = parseContentDispositionName(headRes.headers.get('content-disposition'));
        if (dispName && !fileName) fileName = dispName;
        if (headRes.ok && !ct.includes('text/html')) {
          reachable = true;
          const cl = Number(headRes.headers.get('content-length') || 0);
          if (cl > 0 && sizeBytes <= 0) sizeBytes = cl;
          if (!declaredMime) declaredMime = ct;
        }
      } catch { /* fallback to view / download */ }
    }

    if (canQueryPublicDrive && !fileName) {
      try {
        const viewRes = await fetch(`https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`, { redirect: 'follow', signal: AbortSignal.timeout(5_000) });
        if (viewRes.ok) {
          const html = await viewRes.text();
          const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
          if (ogMatch?.[1]) {
            fileName = decodeHtmlAttr(ogMatch[1]);
            if (/docs\.google\.com\/(?:document|spreadsheets|presentation)\//i.test(raw)) {
              reachable = true;
              if (!declaredMime) declaredMime = 'application/pdf';
            }
          }
        }
      } catch { /* ignore view fallback */ }
    }

    const currMime = normalizeKnownMime(declaredMime, fileName);
    const shouldPrewarmBytes = !buf && (!reachable || sizeBytes <= 0 || (currMime.startsWith('image/') && sizeBytes <= 12 * 1024 * 1024) || (currMime === 'application/octet-stream' && sizeBytes > 0 && sizeBytes <= 4 * 1024 * 1024));
    if (shouldPrewarmBytes && ctx.google.downloadDriveFile) {
      buf = await ctx.google.downloadDriveFile(driveId);
      if (buf && buf.length > 0 && buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf);
    }
    if (!buf && shouldPrewarmBytes && canQueryPublicDrive) {
      try {
        const res = await fetch(directDownloadUrl, { redirect: 'follow', signal: AbortSignal.timeout(9_000) });
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
      if (lastSeg && /\.[a-zA-Z0-9]{2,5}$/.test(lastSeg)) fileName = fileName || lastSeg;
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
  if (reachable && !fileName) {
    const ext = resolveUploadExtension(mimeType);
    const shortId = (driveId || cacheKey || 'media').replace(/^h_/, '').slice(0, 8);
    fileName = ext && ext !== 'bin' ? `tep-dinh-kem-${shortId}.${ext}` : `tep-dinh-kem-${shortId}`;
  }
  if (reachable && cacheKey) {
    saveMediaMetaCache(ctx, cacheKey, { fileName, mimeType, sizeBytes });
  }

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
