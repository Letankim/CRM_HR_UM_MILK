import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRIVE_FOLDERS, OPERATION_SETTING_KEYS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { dayjs, nowIso } from '../lib/time.js';
import { tolerantWrite } from './background-write.js';

const MAX_MEDIA_BYTES = 8 * 1024 * 1024, MAX_RAM_ITEMS = 160;
const mediaRamCache = new Map<string, { buffer: Buffer; mimeType: string }>();
const localToDriveAlias = new Map<string, string>();
const payrollDriveQueue: Array<() => Promise<void>> = [];
let payrollDriveInFlight = 0;

function enqueuePayrollDriveUpload(job: () => Promise<void>): void {
  payrollDriveQueue.push(job);
  const pump = () => {
    while (payrollDriveInFlight < 3 && payrollDriveQueue.length > 0) {
      const next = payrollDriveQueue.shift()!;
      payrollDriveInFlight++;
      void next().catch(() => undefined).finally(() => { payrollDriveInFlight--; pump(); });
    }
  };
  pump();
}

function getLocalMediaDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'payroll-media');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const sanitizeKey = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '');

export function toCleanDriveSlug(input: string, fallback = 'Item'): string {
  const ascii = (input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D')).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ascii || fallback;
}

export function detectImageMime(buf: Buffer, declaredMime = 'image/png'): { mimeType: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' } {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mimeType: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (declaredMime.includes('jpeg') || declaredMime.includes('jpg')) return { mimeType: 'image/jpeg', ext: 'jpg' };
  return { mimeType: 'image/png', ext: 'png' };
}

function putMediaCache(ctx: AppContext, key: string, buffer: Buffer, mimeType: string): void {
  const safeKey = sanitizeKey(key);
  if (!safeKey) return;
  mediaRamCache.delete(safeKey);
  if (mediaRamCache.size >= MAX_RAM_ITEMS) { const oldest = mediaRamCache.keys().next().value; if (oldest) mediaRamCache.delete(oldest); }
  mediaRamCache.set(safeKey, { buffer, mimeType });
  try { writeFileSync(join(getLocalMediaDir(ctx), `${safeKey}.${mimeType.includes('jpeg') ? 'jpg' : 'png'}`), buffer); } catch { /* ephemeral disk */ }
}

export function resolvePayrollMediaUrl(fileId?: string | null): string | null {
  const raw = (fileId ?? '').trim();
  if (!raw) return null;
  return raw.startsWith('data:image/') ? raw : `/api/payroll/media/${encodeURIComponent(raw)}`;
}

export interface PersistedPayrollMedia {
  fileId: string;
  mimeType: string;
  syncDrive?: (onDriveFileId: (driveFileId: string) => Promise<unknown>) => void;
}

export async function persistPayrollMedia(
  ctx: AppContext,
  params: { base64: string; rootFolder: string; folderSegments?: string[]; fileBaseName: string; fieldName?: string; labelVi?: string; asyncDrive?: boolean },
): Promise<PersistedPayrollMedia> {
  const field = params.fieldName ?? 'signature_base64', label = params.labelVi ?? 'Hình ảnh chữ ký', trimmed = (params.base64 ?? '').trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Errors.fieldValidation(field, 'INVALID_FORMAT', `${label} phải là tệp ảnh PNG hoặc JPG hợp lệ`, trimmed.slice(0, 40));
  const buffer = Buffer.from(match[2]!.replace(/\s+/g, ''), 'base64');
  if (buffer.length < 64) throw Errors.fieldValidation(field, 'INVALID_VALUE', `${label} quá nhỏ hoặc trống, vui lòng chọn/ký lại`, 'empty_image');
  if (buffer.length > MAX_MEDIA_BYTES) throw Errors.fieldValidation(field, 'OUT_OF_RANGE', `${label} vượt quá dung lượng tối đa 8MB`, buffer.length);

  const { mimeType, ext } = detectImageMime(buffer, match[1]);
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 10);
  const fileName = `${params.fileBaseName}_${dayjs().format('YYYYMMDD_HHmmss')}.${ext}`, localId = `pmedia_${Date.now()}_${hash}`;
  putMediaCache(ctx, localId, buffer, mimeType);

  if (ctx.google.uploadDriveMedia) {
    const uploadArgs = { rootFolder: params.rootFolder, folderSegments: params.folderSegments, fileName, mimeType, data: buffer };
    if (params.asyncDrive && !process.env.VITEST && ctx.google.mode === 'google') {
      return {
        fileId: localId, mimeType,
        syncDrive: (onDriveFileId) => enqueuePayrollDriveUpload(async () => {
          const uploaded = await ctx.google.uploadDriveMedia!(uploadArgs);
          if (uploaded.fileId) {
            putMediaCache(ctx, uploaded.fileId, buffer, mimeType);
            localToDriveAlias.set(localId, uploaded.fileId);
            await tolerantWrite(() => onDriveFileId(uploaded.fileId));
          }
        }),
      };
    }
    try {
      const uploaded = await ctx.google.uploadDriveMedia(uploadArgs);
      if (uploaded.fileId) { putMediaCache(ctx, uploaded.fileId, buffer, mimeType); return { fileId: uploaded.fileId, mimeType }; }
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
  const driveKey = localToDriveAlias.get(safeKey) ?? safeKey;
  if (ctx.google.downloadDriveFile && !driveKey.startsWith('pmedia_')) {
    const buffer = await ctx.google.downloadDriveFile(driveKey);
    if (buffer && buffer.length > 0) {
      const { mimeType } = detectImageMime(buffer);
      putMediaCache(ctx, driveKey, buffer, mimeType);
      return { buffer, mimeType };
    }
  }
  return null;
}

async function batchUpsertSystemSettings(
  ctx: AppContext,
  entries: Array<{ key: string; value: string; label: string }>,
  actorId: string,
): Promise<void> {
  const toUpdate: Array<{ id: string; expectedVersion: number; patch: { value: string; label: string; category: string } }> = [];
  const toInsert: Array<{ key: string; value: string; label: string }> = [];
  for (const e of entries) {
    const existing = ctx.db.systemSettings.find((s) => s.key === e.key);
    if (existing) toUpdate.push({ id: existing.id, expectedVersion: existing.version, patch: { value: e.value, label: e.label, category: 'PAYROLL_SIGNATURE' } });
    else toInsert.push(e);
  }
  if (toUpdate.length > 0) await ctx.db.systemSettings.batchUpdate(toUpdate, actorId);
  if (toInsert.length > 0) {
    await Promise.all(toInsert.map((e) => ctx.db.systemSettings.insert({ key: e.key, value: e.value, note: e.label, category: 'PAYROLL_SIGNATURE', label: e.label, value_type: 'STRING' }, actorId)));
  }
}

const ROLE_SIG_META = {
  ADMIN: {
    fileKey: OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNATURE_FILE_ID,
    signerKey: OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNER_NAME,
    updatedKey: OPERATION_SETTING_KEYS.PAYROLL_ADMIN_SIGNED_UPDATED_AT,
    folder: '01_QUAN_TRI', prefix: 'CHU_KY_QUAN_TRI', fallbackSlug: 'ADMIN', titleVi: 'Ban Quản trị',
  },
  FINANCE: {
    fileKey: OPERATION_SETTING_KEYS.PAYROLL_FINANCE_SIGNATURE_FILE_ID,
    signerKey: OPERATION_SETTING_KEYS.PAYROLL_FINANCE_SIGNER_NAME,
    updatedKey: OPERATION_SETTING_KEYS.PAYROLL_FINANCE_SIGNED_UPDATED_AT,
    folder: '02_KE_TOAN', prefix: 'CHU_KY_KE_TOAN', fallbackSlug: 'FINANCE', titleVi: 'Kế toán',
  },
} as const;

function readRoleSignature(ctx: AppContext, role: keyof typeof ROLE_SIG_META) {
  const m = ROLE_SIG_META[role];
  const fileId = ctx.db.systemSettings.find((s) => s.key === m.fileKey)?.value?.trim() || '';
  const signerName = ctx.db.systemSettings.find((s) => s.key === m.signerKey)?.value?.trim() || '';
  const updatedAt = ctx.db.systemSettings.find((s) => s.key === m.updatedKey)?.value?.trim() || null;
  return { fileId, signatureUrl: resolvePayrollMediaUrl(fileId), signerName, updatedAt, driveFolder: `${DRIVE_FOLDERS.PAYROLL_SIGNATURES}/${m.folder}` };
}

async function writeRoleSignature(ctx: AppContext, role: keyof typeof ROLE_SIG_META, params: { base64: string; signerName: string; actorId: string }) {
  const m = ROLE_SIG_META[role];
  const saved = await persistPayrollMedia(ctx, {
    base64: params.base64, rootFolder: DRIVE_FOLDERS.PAYROLL_SIGNATURES, folderSegments: [m.folder],
    fileBaseName: `${m.prefix}_${toCleanDriveSlug(params.signerName, m.fallbackSlug)}`,
    fieldName: 'signature_base64', labelVi: `Ảnh chữ ký ${m.titleVi}`, asyncDrive: true,
  });
  await batchUpsertSystemSettings(ctx, [
    { key: m.fileKey, value: saved.fileId, label: `Mã tệp Drive chữ ký ${m.titleVi}` },
    { key: m.signerKey, value: params.signerName, label: `Người đại diện ký ${m.titleVi}` },
    { key: m.updatedKey, value: nowIso(), label: `Thời điểm cập nhật chữ ký ${m.titleVi}` },
  ], params.actorId);
  saved.syncDrive?.(async (driveFileId) => {
    const row = ctx.db.systemSettings.find((s) => s.key === m.fileKey);
    if (row && row.value === saved.fileId) await ctx.db.systemSettings.update(row.id, row.version, { value: driveFileId }, 'system-drive-sync');
  });
  return readRoleSignature(ctx, role);
}

export const getConfiguredAdminSignature = (ctx: AppContext) => readRoleSignature(ctx, 'ADMIN');
export const saveConfiguredAdminSignature = (ctx: AppContext, p: { base64: string; signerName: string; actorId: string }) => writeRoleSignature(ctx, 'ADMIN', p);
export const getConfiguredFinanceSignature = (ctx: AppContext) => readRoleSignature(ctx, 'FINANCE');
export const saveConfiguredFinanceSignature = (ctx: AppContext, p: { base64: string; signerName: string; actorId: string }) => writeRoleSignature(ctx, 'FINANCE', p);
