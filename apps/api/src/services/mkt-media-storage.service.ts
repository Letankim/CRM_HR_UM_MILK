import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaAsset } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const MAX_MEDIA_RAM_CACHE = 40;
const mktMediaRamCache = new Map<string, Buffer>();

const CATEGORY_VI: Record<string, string> = {
  BANNER: 'Banner truyền thông', SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện', POLICY_PDF: 'Văn bản chính sách (PDF)',
};

function getLocalMktMediaDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'mkt-media');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function toMktCacheKey(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return SAFE_KEY_RE.test(trimmed) ? trimmed : `h_${createHash('sha256').update(trimmed).digest('hex').slice(0, 28)}`;
}

function putMediaRamCache(key: string, buf: Buffer): void {
  if (!key) return;
  mktMediaRamCache.delete(key);
  if (mktMediaRamCache.size >= MAX_MEDIA_RAM_CACHE) {
    const oldest = mktMediaRamCache.keys().next().value;
    if (oldest) mktMediaRamCache.delete(oldest);
  }
  mktMediaRamCache.set(key, buf);
}

function saveMediaCache(ctx: AppContext, key: string, buf: Buffer): void {
  if (!key || buf.length === 0) return;
  putMediaRamCache(key, buf);
  try { writeFileSync(join(getLocalMktMediaDir(ctx), `${key}.bin`), buf); } catch { /* ignore ephemeral disk */ }
}

function readMediaCache(ctx: AppContext, key: string): Buffer | null {
  if (!key) return null;
  const ramHit = mktMediaRamCache.get(key);
  if (ramHit) { putMediaRamCache(key, ramHit); return ramHit; }
  try {
    const diskPath = join(getLocalMktMediaDir(ctx), `${key}.bin`);
    if (existsSync(diskPath)) {
      const buf = readFileSync(diskPath);
      if (buf.length > 0) { putMediaRamCache(key, buf); return buf; }
    }
  } catch { /* fallback drive */ }
  return null;
}

export function extractGoogleDriveFileId(rawInput: string): string | null {
  const raw = String(rawInput || '').trim();
  if (!raw || raw.startsWith('drive://') || raw.startsWith('data:') || raw.startsWith('local_') || raw.startsWith('/')) {
    return null;
  }
  const pathMatch = raw.match(/(?:drive|docs)\.google\.com\/(?:file|document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]{8,})/i);
  if (pathMatch?.[1]) return pathMatch[1];

  const queryMatch = raw.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?([^#]+)/i);
  if (queryMatch?.[1]) {
    const idParam = new URLSearchParams(queryMatch[1]).get('id');
    if (idParam && idParam.trim().length >= 8) return idParam.trim();
  }

  const lhMatch = raw.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{8,})/i);
  if (lhMatch?.[1]) return lhMatch[1];

  if (!/^https?:\/\//i.test(raw) && /^[a-zA-Z0-9_-]{8,80}$/.test(raw)) {
    return raw;
  }
  return null;
}

export function detectBufferMimeType(buf: Buffer, fallbackMime = 'application/octet-stream'): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  const headText = buf.subarray(0, 160).toString('utf8').trimStart();
  if (headText.startsWith('<svg') || headText.startsWith('<?xml')) return 'image/svg+xml; charset=utf-8';
  return fallbackMime || 'application/octet-stream';
}

function mimeToExt(mime: string): string {
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return 'png';
}

export async function persistMktMediaUpload(
  ctx: AppContext,
  params: { base64: string; fileName: string; mimeType?: string },
): Promise<{ fileId: string; mimeType: string; sizeBytes: number }> {
  const match = params.base64.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
  const declaredMime = match?.[1] || params.mimeType || 'image/png';
  const rawPayload = (match?.[2] ?? params.base64).trim();
  const buffer = Buffer.from(rawPayload, 'base64');
  const actualMime = detectBufferMimeType(buffer, declaredMime);
  const sha = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  const ext = mimeToExt(actualMime);
  const baseSlug = (params.fileName || 'mkt-media').replace(/\.[a-zA-Z0-9]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'mkt_media';
  const uploadName = `${baseSlug}_${Date.now()}.${ext}`;
  const monthFolder = dayjs().format('YYYY-MM');

  let fileId = `local_mkt_${Date.now()}_${sha}`;
  if (ctx.google.uploadMktMedia && buffer.length > 0) {
    try {
      const uploaded = await ctx.google.uploadMktMedia({
        fileName: uploadName,
        mimeType: actualMime.split(';')[0]!.trim(),
        data: buffer,
        monthFolder,
      });
      if (uploaded.fileId) fileId = uploaded.fileId;
    } catch {
      // Giữ bản lưu cache đĩa cục bộ khi chưa cấu hình hoặc mất mạng tạm thời
    }
  }
  saveMediaCache(ctx, toMktCacheKey(fileId), buffer);
  return { fileId, mimeType: actualMime.split(';')[0]!.trim(), sizeBytes: buffer.length };
}

function buildFallbackMktBannerSvg(asset?: Partial<MediaAsset>): Buffer {
  const safe = (s: string) => s.replace(/[<>&"']/g, '');
  const code = safe(asset?.code || 'MED');
  const title = safe((asset?.file_name || 'Tệp truyền thông nội bộ').slice(0, 56));
  const cat = safe(CATEGORY_VI[asset?.category || 'BANNER'] ?? 'Tài liệu truyền thông nội bộ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><rect width="720" height="360" fill="#0F172A"/><rect x="18" y="18" width="684" height="324" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1.5"/><rect x="36" y="36" width="218" height="28" rx="3" fill="#2563EB"/><text x="145" y="55" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="12" font-weight="bold">KHO MEDIA NỘI BỘ ỤM BÒ MILK</text><text x="36" y="148" fill="#93C5FD" font-family="Arial, sans-serif" font-size="14" font-weight="bold">[${code}] · ${cat}</text><text x="36" y="188" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="22" font-weight="bold">${title}</text><text x="36" y="232" fill="#94A3B8" font-family="Arial, sans-serif" font-size="13">Tài liệu truyền thông nội bộ được phân phối qua cổng bảo mật hệ thống</text></svg>`;
  return Buffer.from(svg, 'utf8');
}

export async function loadMktMediaFile(
  ctx: AppContext,
  idOrFileId: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const asset = ctx.db.mediaAssets.get(idOrFileId)
    ?? ctx.db.mediaAssets.all(true).find((m) => m.id === idOrFileId || m.code === idOrFileId || m.drive_file_id === idOrFileId);
  if (!asset && ULID_RE.test(idOrFileId)) return null;

  const rawSource = String(asset ? asset.drive_file_id : idOrFileId).trim();
  const fileName = asset?.file_name || 'mkt-media-file';
  const fallbackMime = asset?.mime_type || 'image/png';
  const isImage = fallbackMime.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(rawSource) || rawSource.startsWith('data:image/');

  if (rawSource.startsWith('data:')) {
    const match = rawSource.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
    const buf = Buffer.from((match?.[2] ?? '').trim(), 'base64');
    if (buf.length > 0) return { buffer: buf, mimeType: detectBufferMimeType(buf, match?.[1] || fallbackMime), fileName };
  }

  const driveId = extractGoogleDriveFileId(rawSource);
  const cacheKey = toMktCacheKey(driveId ?? rawSource);
  if (rawSource && !rawSource.startsWith('drive://')) {
    const cached = readMediaCache(ctx, cacheKey);
    if (cached) return { buffer: cached, mimeType: detectBufferMimeType(cached, fallbackMime), fileName };
  }

  if (driveId) {
    if (ctx.google.downloadDriveFile) {
      const buf = await ctx.google.downloadDriveFile(driveId);
      if (buf && buf.length > 0) {
        saveMediaCache(ctx, cacheKey, buf);
        return { buffer: buf, mimeType: detectBufferMimeType(buf, fallbackMime), fileName };
      }
    }
    try {
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`, { redirect: 'follow', signal: AbortSignal.timeout(8_000) });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !ct.includes('text/html')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) {
          saveMediaCache(ctx, cacheKey, buf);
          return { buffer: buf, mimeType: detectBufferMimeType(buf, ct.split(';')[0] || fallbackMime), fileName };
        }
      }
    } catch { /* fallback below */ }
  } else if (/^https?:\/\//i.test(rawSource)) {
    try {
      const res = await fetch(rawSource, { redirect: 'follow', signal: AbortSignal.timeout(8_000) });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !(isImage && ct.includes('text/html'))) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) {
          saveMediaCache(ctx, cacheKey, buf);
          return { buffer: buf, mimeType: detectBufferMimeType(buf, ct.split(';')[0] || fallbackMime), fileName };
        }
      }
    } catch { /* fallback below */ }
  }

  if (asset && isImage) {
    return { buffer: buildFallbackMktBannerSvg(asset), mimeType: 'image/svg+xml; charset=utf-8', fileName: `${fileName}.svg` };
  }
  return null;
}
