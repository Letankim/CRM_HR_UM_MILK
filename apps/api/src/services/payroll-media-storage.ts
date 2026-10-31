import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRIVE_FOLDERS, OPERATION_SETTING_KEYS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';

const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const MAX_RAM_ITEMS = 120;
const mediaRamCache = new Map<string, { buffer: Buffer; mimeType: string }>();

function getLocalMediaDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'payroll-media');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const sanitizeKey = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '');

export function toCleanDriveSlug(input: string, fallback = 'Item'): string {
  const ascii = (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || fallback;
}

export function detectImageMime(buf: Buffer, declaredMime = 'image/png'): { mimeType: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' } {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (declaredMime.includes('jpeg') || declaredMime.includes('jpg')) return { mimeType: 'image/jpeg', ext: 'jpg' };
  return { mimeType: 'image/png', ext: 'png' };
}

function putMediaCache(ctx: AppContext, key: string, buffer: Buffer, mimeType: string): void {
  const safeKey = sanitizeKey(key);
  if (!safeKey) return;
  mediaRamCache.delete(safeKey);
  if (mediaRamCache.size >= MAX_RAM_ITEMS) {
    const oldest = mediaRamCache.keys().next().value;
    if (oldest) mediaRamCache.delete(oldest);
  }
  mediaRamCache.set(safeKey, { buffer, mimeType });
  const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
  try { writeFileSync(join(getLocalMediaDir(ctx), `${safeKey}.${ext}`), buffer); } catch { /* ephemeral disk */ }
}

export function resolvePayrollMediaUrl(fileId?: string | null): string | null {
  const raw = (fileId ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:image/')) return raw;
  return `/api/payroll/media/${encodeURIComponent(raw)}`;
}

export async function persistPayrollMedia(
  ctx: AppContext,
  params: {
    base64: string;
    rootFolder: string;
    folderSegments?: string[];
    fileBaseName: string;
    fieldName?: string;
    labelVi?: string;
  },
): Promise<{ fileId: string; mimeType: string }> {
  const field = params.fieldName ?? 'signature_base64';
  const label = params.labelVi ?? 'Hình ảnh chữ ký';
  const trimmed = (params.base64 ?? '').trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    throw Errors.fieldValidation(field, 'INVALID_FORMAT', `${label} phải là tệp ảnh PNG hoặc JPG hợp lệ`, trimmed.slice(0, 40));
  }
  const buffer = Buffer.from(match[2]!.replace(/\s+/g, ''), 'base64');
  if (buffer.length < 64) {
    throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} quá nhỏ hoặc trống, vui lòng chọn/ký lại`, 'empty_image');
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw Errors.fieldValidation(field, 'OUT_OF_RANGE', `${label} vượt quá dung lượng tối đa 6MB`, buffer.length);
  }
  const { mimeType, ext } = detectImageMime(buffer, match[1]);
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 10);
  const fileName = `${params.fileBaseName}_${dayjs().format('YYYYMMDD_HHmmss')}.${ext}`;
  const localId = `pmedia_${Date.now()}_${hash}`;
  putMediaCache(ctx, localId, buffer, mimeType);

  if (ctx.google.uploadDriveMedia) {
    try {
      const uploaded = await ctx.google.uploadDriveMedia({
        rootFolder: params.rootFolder,
        folderSegments: params.folderSegments,
        fileName,
        mimeType,
        data: buffer,
      });
      if (uploaded.fileId) {
        putMediaCache(ctx, uploaded.fileId, buffer, mimeType);
        return { fileId: uploaded.fileId, mimeType };
      }
    } catch {
      if (trimmed.length <= 42_000) return { fileId: trimmed, mimeType };
    }
  }
  return { fileId: localId, mimeType };
}

export async function loadPayrollMediaBuffer(ctx: AppContext, fileId?: string | null): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const raw = (fileId ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:image/')) {
    const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    const buffer = Buffer.from(m[2]!, 'base64');
    return { buffer, mimeType: detectImageMime(buffer, m[1]).mimeType };
  }
  const safeKey = sanitizeKey(raw);
  if (!safeKey) return null;
  const ram = mediaRamCache.get(safeKey);
  if (ram) return ram;

  const dir = getLocalMediaDir(ctx);
  for (const candidate of [`${safeKey}.png`, `${safeKey}.jpg`]) {
    const p = join(dir, candidate);
    if (existsSync(p)) {
      try {
        const buffer = readFileSync(p);
        const { mimeType } = detectImageMime(buffer);
        putMediaCache(ctx, safeKey, buffer, mimeType);
        return { buffer, mimeType };
      } catch { /* fallback drive */ }
    }
  }
  if (ctx.google.downloadDriveFile && !safeKey.startsWith('pmedia_')) {
    const buffer = await ctx.google.downloadDriveFile(safeKey);
    if (buffer && buffer.length > 0) {
      const { mimeType } = detectImageMime(buffer);
      putMediaCache(ctx, safeKey, buffer, mimeType);
      return { buffer, mimeType };
    }
  }
  return null;
}

async function upsertSystemSetting(ctx: AppContext, key: string, value: string, label: string, actorId: string) {
  const existing = ctx.db.systemSettings.find((s) => s.key === key);
  if (existing) return ctx.db.systemSettings.update(existing.id, existing.version, { value, label, category: 'PAYROLL_SIGNATURE' }, actorId);
  return ctx.db.systemSettings.insert({ key, value, note: label, category: 'PAYROLL_SIGNATURE', label, value_type: 'STRING' }, actorId);
}

export function getConfiguredAdminSignature(ctx: AppContext) {
  const fileId = ctx.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNATURE_FILE_ID)?.value?.trim() || '';
  const signerName = ctx.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNER_NAME)?.value?.trim() || '';
  const updatedAt = ctx.db.systemSettings.find((s) => s.key === OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNED_UPDATED_AT)?.value?.trim() || null;
  return {
    fileId,
    signatureUrl: resolvePayrollMediaUrl(fileId),
    signerName,
    updatedAt,
    driveFolder: `${DRIVE_FOLDERS.PAYROLL_SIGNATURES}/01_QUAN_TRI`,
  };
}

export async function saveConfiguredAdminSignature(
  ctx: AppContext,
  params: { base64: string; signerName: string; actorId: string },
) {
  const saved = await persistPayrollMedia(ctx, {
    base64: params.base64,
    rootFolder: DRIVE_FOLDERS.PAYROLL_SIGNATURES,
    folderSegments: ['01_QUAN_TRI'],
    fileBaseName: `CHU_KY_QUAN_TRI_${toCleanDriveSlug(params.signerName, 'ADMIN')}`,
    fieldName: 'signature_base64',
    labelVi: 'Ảnh chữ ký Ban Quản trị',
  });
  const ts = nowIso();
  await upsertSystemSetting(ctx, OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNATURE_FILE_ID, saved.fileId, 'Mã tệp Drive chữ ký Ban Quản trị', params.actorId);
  await upsertSystemSetting(ctx, OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNER_NAME, params.signerName, 'Người đại diện ký Ban Quản trị', params.actorId);
  await upsertSystemSetting(ctx, OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNED_UPDATED_AT, ts, 'Thời điểm cập nhật chữ ký Ban Quản trị', params.actorId);
  return getConfiguredAdminSignature(ctx);
}
