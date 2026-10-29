import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaAsset } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const MAX_MEDIA_RAM_CACHE = 40;

export interface CachedMktMediaMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const mktMediaRamCache = new Map<string, Buffer>();
const mktMediaMetaRamCache = new Map<string, CachedMktMediaMeta>();

const CATEGORY_VI: Record<string, string> = {
  BANNER: 'Banner truyền thông', SOP_DOC: 'Tài liệu quy trình (SOP)',
  EVENT_PHOTO: 'Hình ảnh sự kiện', POLICY_PDF: 'Văn bản chính sách',
  ARCHIVE_PACKAGE: 'Gói tệp nén / Tư liệu', OFFICE_SHEET: 'Biểu mẫu Word / Excel / Trình chiếu',
  VIDEO_AUDIO: 'Video / Âm thanh đào tạo',
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip', tgz: 'application/gzip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', json: 'application/json', md: 'text/markdown',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
};

export function guessMimeByExtension(fileName = ''): string {
  const m = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?.*)?$/);
  return (m?.[1] && EXT_TO_MIME[m[1]]) ? EXT_TO_MIME[m[1]]! : 'application/octet-stream';
}

export function resolveUploadExtension(mime: string, originalName = ''): string {
  const origMatch = originalName.trim().toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  if (origMatch?.[1] && EXT_TO_MIME[origMatch[1]]) return origMatch[1];
  const baseMime = String(mime || '').split(';')[0]!.trim().toLowerCase();
  const found = Object.entries(EXT_TO_MIME).find(([, m]) => baseMime === m || baseMime.startsWith(m));
  return found?.[0] ?? 'bin';
}

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

export function saveMediaMetaCache(ctx: AppContext, key: string, meta: CachedMktMediaMeta): void {
  if (!key || (!meta.fileName && meta.sizeBytes <= 0)) return;
  mktMediaMetaRamCache.set(key, meta);
  try { writeFileSync(join(getLocalMktMediaDir(ctx), `${key}.meta.json`), JSON.stringify(meta), 'utf8'); } catch { /* ignore ephemeral disk */ }
}

export function readMediaMetaCache(ctx: AppContext, key: string): CachedMktMediaMeta | null {
  if (!key) return null;
  const ramHit = mktMediaMetaRamCache.get(key);
  if (ramHit) return ramHit;
  try {
    const metaPath = join(getLocalMktMediaDir(ctx), `${key}.meta.json`);
    if (existsSync(metaPath)) {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as CachedMktMediaMeta;
      if (parsed && typeof parsed === 'object') { mktMediaMetaRamCache.set(key, parsed); return parsed; }
    }
  } catch { /* ignore corrupt meta */ }
  return null;
}

export function saveMediaCache(ctx: AppContext, key: string, buf: Buffer, meta?: Partial<CachedMktMediaMeta>): void {
  if (!key || buf.length === 0) return;
  putMediaRamCache(key, buf);
  try { writeFileSync(join(getLocalMktMediaDir(ctx), `${key}.bin`), buf); } catch { /* ignore ephemeral disk */ }
  if (meta?.fileName || meta?.mimeType) {
    saveMediaMetaCache(ctx, key, { fileName: meta.fileName || '', mimeType: meta.mimeType || 'application/octet-stream', sizeBytes: meta.sizeBytes || buf.length });
  }
}

export function readMediaCache(ctx: AppContext, key: string): Buffer | null {
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
  if (!raw || raw.startsWith('drive://') || raw.startsWith('data:') || raw.startsWith('local_') || raw.startsWith('h_') || raw.startsWith('/')) return null;
  const pathMatch = raw.match(/(?:drive|docs)\.google\.com\/(?:file|document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]{8,})/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = raw.match(/(?:drive\.google\.com\/(?:open|uc|thumbnail)|drive\.usercontent\.google\.com\/download)\?([^#]+)/i);
  if (queryMatch?.[1]) {
    const idParam = new URLSearchParams(queryMatch[1]).get('id');
    if (idParam && idParam.trim().length >= 8) return idParam.trim();
  }
  const lhMatch = raw.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{8,})/i);
  if (lhMatch?.[1]) return lhMatch[1];
  return (!/^https?:\/\//i.test(raw) && /^[a-zA-Z0-9_-]{8,80}$/.test(raw)) ? raw : null;
}

export function detectBufferMimeType(buf: Buffer, fallbackMime = 'application/octet-stream', fileName = ''): string {
  const fb = String(fallbackMime || '').split(';')[0]!.trim().toLowerCase(), extMime = guessMimeByExtension(fileName);
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d && (fb.startsWith('image/') || extMime === 'image/bmp')) return 'image/bmp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'application/vnd.rar';
  if (buf.length >= 6 && buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return 'application/x-7z-compressed';
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'application/gzip';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    const zipHead = buf.subarray(0, 2048).toString('latin1');
    if (extMime.includes('wordprocessingml') || fb.includes('wordprocessingml') || zipHead.includes('word/')) return EXT_TO_MIME.docx!;
    if (extMime.includes('spreadsheetml') || fb.includes('spreadsheetml') || zipHead.includes('xl/')) return EXT_TO_MIME.xlsx!;
    if (extMime.includes('presentationml') || fb.includes('presentationml') || zipHead.includes('ppt/')) return EXT_TO_MIME.pptx!;
    return 'application/zip';
  }
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    if (extMime === 'application/vnd.ms-excel' || fb.includes('ms-excel')) return 'application/vnd.ms-excel';
    if (extMime === 'application/vnd.ms-powerpoint' || fb.includes('ms-powerpoint')) return 'application/vnd.ms-powerpoint';
    return 'application/msword';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return extMime === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.length >= 3 && (buf.subarray(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0))) return 'audio/mpeg';
  const headText = buf.subarray(0, 512).toString('utf8').trimStart();
  if (headText.startsWith('<svg') || (headText.startsWith('<?xml') && headText.includes('<svg'))) return 'image/svg+xml; charset=utf-8';
  return (fb && fb !== 'application/octet-stream' && fb !== 'binary/octet-stream') ? fb : extMime;
}

export async function persistMktMediaUpload(
  ctx: AppContext,
  params: { base64: string; fileName: string; mimeType?: string },
): Promise<{ fileId: string; mimeType: string; sizeBytes: number }> {
  const match = params.base64.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
  const declaredMime = match?.[1] || params.mimeType || 'application/octet-stream';
  const buffer = Buffer.from((match?.[2] ?? params.base64).trim(), 'base64');
  const actualMime = detectBufferMimeType(buffer, declaredMime, params.fileName).split(';')[0]!.trim();
  const sha = createHash('sha256').update(buffer).digest('hex').slice(0, 12), ext = resolveUploadExtension(actualMime, params.fileName);
  const baseSlug = (params.fileName || 'mkt-media').replace(/\.[a-zA-Z0-9]{2,5}$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'mkt_media';
  let fileId = `local_mkt_${Date.now()}_${sha}`;
  if (ctx.google.uploadMktMedia && buffer.length > 0) {
    try {
      const uploaded = await ctx.google.uploadMktMedia({ fileName: `${baseSlug}_${Date.now()}.${ext}`, mimeType: actualMime, data: buffer, monthFolder: dayjs().format('YYYY-MM') });
      if (uploaded.fileId) fileId = uploaded.fileId;
    } catch { /* fallback local disk cache */ }
  }
  saveMediaCache(ctx, toMktCacheKey(fileId), buffer, { fileName: params.fileName, mimeType: actualMime, sizeBytes: buffer.length });
  return { fileId, mimeType: actualMime, sizeBytes: buffer.length };
}

function buildFallbackMktBannerSvg(asset?: Partial<MediaAsset>): Buffer {
  const safe = (s: string) => s.replace(/[<>&"']/g, '');
  const code = safe(asset?.code || 'MED'), title = safe((asset?.file_name || 'Tệp truyền thông nội bộ').slice(0, 56));
  const cat = safe(CATEGORY_VI[asset?.category || 'BANNER'] ?? 'Tài liệu truyền thông nội bộ');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><rect width="720" height="360" fill="#0F172A"/><rect x="18" y="18" width="684" height="324" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1.5"/><rect x="36" y="36" width="218" height="28" rx="3" fill="#2563EB"/><text x="145" y="55" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="12" font-weight="bold">KHO MEDIA NỘI BỘ ỤM BÒ MILK</text><text x="36" y="148" fill="#93C5FD" font-family="Arial, sans-serif" font-size="14" font-weight="bold">[${code}] · ${cat}</text><text x="36" y="188" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="22" font-weight="bold">${title}</text><text x="36" y="232" fill="#94A3B8" font-family="Arial, sans-serif" font-size="13">Tài liệu truyền thông nội bộ được phân phối qua cổng bảo mật hệ thống</text></svg>`, 'utf8');
}

export async function loadMktMediaFile(ctx: AppContext, idOrFileId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const asset = ctx.db.mediaAssets.get(idOrFileId) ?? ctx.db.mediaAssets.all(true).find((m) => m.id === idOrFileId || m.code === idOrFileId || m.drive_file_id === idOrFileId);
  if (!asset && ULID_RE.test(idOrFileId)) return null;
  const rawSource = String(asset ? asset.drive_file_id : idOrFileId).trim();
  const driveId = extractGoogleDriveFileId(rawSource), cacheKey = toMktCacheKey(driveId ?? rawSource);
  const cachedMeta = cacheKey ? readMediaMetaCache(ctx, cacheKey) : null;
  const fileName = asset?.file_name || cachedMeta?.fileName || 'mkt-media-file';
  const fallbackMime = asset?.mime_type || cachedMeta?.mimeType || guessMimeByExtension(fileName);
  const isImage = fallbackMime.toLowerCase().startsWith('image/') || rawSource.startsWith('data:image/');

  if (rawSource.startsWith('data:')) {
    const match = rawSource.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/), buf = Buffer.from((match?.[2] ?? '').trim(), 'base64');
    if (buf.length > 0) return { buffer: buf, mimeType: detectBufferMimeType(buf, match?.[1] || fallbackMime, fileName), fileName };
  }
  if (rawSource && !rawSource.startsWith('drive://')) {
    const cached = readMediaCache(ctx, cacheKey);
    if (cached) return { buffer: cached, mimeType: detectBufferMimeType(cached, fallbackMime, fileName), fileName };
  }
  if (driveId && ctx.google.downloadDriveFile) {
    const buf = await ctx.google.downloadDriveFile(driveId);
    if (buf && buf.length > 0) { if (buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf); return { buffer: buf, mimeType: detectBufferMimeType(buf, fallbackMime, fileName), fileName }; }
  }
  const fetchTarget = driveId ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t` : (/^https?:\/\//i.test(rawSource) ? rawSource : '');
  if (fetchTarget) {
    try {
      const res = await fetch(fetchTarget, { redirect: 'follow', signal: AbortSignal.timeout(15_000) }), ct = res.headers.get('content-type') || '';
      if (res.ok && !ct.includes('text/html')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) { if (buf.length <= 20 * 1024 * 1024) saveMediaCache(ctx, cacheKey, buf); return { buffer: buf, mimeType: detectBufferMimeType(buf, ct.split(';')[0] || fallbackMime, fileName), fileName }; }
      }
    } catch { /* fallback below */ }
  }
  return (asset && isImage) ? { buffer: buildFallbackMktBannerSvg(asset), mimeType: 'image/svg+xml; charset=utf-8', fileName: `${fileName}.svg` } : null;
}
