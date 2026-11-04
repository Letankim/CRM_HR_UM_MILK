import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRIVE_FOLDERS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const avatarRamCache = new Map<string, { buffer: Buffer; mimeType: string }>();

const sanitizeKey = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '');

function getLocalAvatarDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'avatars');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveAvatarUrl(fileId?: string | null): string | null {
  const raw = (fileId ?? '').trim();
  if (!raw) return null;
  return raw.startsWith('data:image/') ? raw : `/api/employees/avatars/${encodeURIComponent(raw)}`;
}

export function putAvatarCache(ctx: AppContext, key: string, buffer: Buffer, mimeType = 'image/jpeg'): void {
  const safe = sanitizeKey(key);
  if (!safe) return;
  if (avatarRamCache.size >= 120) {
    const oldest = avatarRamCache.keys().next().value;
    if (oldest) avatarRamCache.delete(oldest);
  }
  avatarRamCache.set(safe, { buffer, mimeType });
  try { writeFileSync(join(getLocalAvatarDir(ctx), `${safe}.jpg`), buffer); } catch { /* ephemeral */ }
}

export async function loadAvatarBuffer(ctx: AppContext, fileId?: string | null): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const raw = (fileId ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:image/')) {
    const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    return { buffer: Buffer.from(m[2]!, 'base64'), mimeType: m[1] as string };
  }
  const safe = sanitizeKey(raw);
  if (!safe) return null;
  const inRam = avatarRamCache.get(safe);
  if (inRam) return inRam;

  const diskPath = join(getLocalAvatarDir(ctx), `${safe}.jpg`);
  if (existsSync(diskPath)) {
    try {
      const buffer = readFileSync(diskPath);
      avatarRamCache.set(safe, { buffer, mimeType: 'image/jpeg' });
      return { buffer, mimeType: 'image/jpeg' };
    } catch { /* fallback to Drive */ }
  }

  if (ctx.google.downloadDriveFile) {
    try {
      const driveBuf = await ctx.google.downloadDriveFile(raw);
      if (driveBuf && driveBuf.length > 0) {
        putAvatarCache(ctx, safe, driveBuf, 'image/jpeg');
        return { buffer: driveBuf, mimeType: 'image/jpeg' };
      }
    } catch { /* drive error fallback */ }
  }
  return null;
}

export async function saveEmployeeAvatar(
  ctx: AppContext,
  params: { employeeId: string; base64: string; actorId: string },
): Promise<{ fileId: string; url: string }> {
  const { employeeId, actorId } = params;
  const emp = ctx.db.employees.get(employeeId) ?? ctx.db.employees.find((e) => e.employee_code === employeeId);
  if (!emp) throw Errors.notFound('Hồ sơ nhân sự', employeeId);

  const trimmed = (params.base64 ?? '').trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Errors.fieldValidation('avatar_base64', 'INVALID_FORMAT', 'Ảnh đại diện phải là tệp ảnh PNG, JPG hoặc WEBP hợp lệ', trimmed.slice(0, 40));

  const buffer = Buffer.from(match[2]!.replace(/\s+/g, ''), 'base64');
  if (buffer.length < 64) throw Errors.fieldValidation('avatar_base64', 'INVALID_VALUE', 'Tệp ảnh đại diện quá nhỏ hoặc rỗng', 'empty_avatar');
  if (buffer.length > MAX_AVATAR_BYTES) throw Errors.fieldValidation('avatar_base64', 'OUT_OF_RANGE', 'Ảnh đại diện vượt quá dung lượng tối đa 5MB', buffer.length);

  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 10);
  const safeCode = (emp.employee_code || emp.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${safeCode}_avatar_${Date.now()}_${hash}.jpg`;
  const localId = `avatar_${safeCode}_${Date.now()}_${hash}`;
  let finalFileId = localId;

  putAvatarCache(ctx, localId, buffer, 'image/jpeg');

  if (ctx.google.uploadDriveMedia) {
    try {
      const up = await ctx.google.uploadDriveMedia({
        rootFolder: DRIVE_FOLDERS.EMPLOYEE_DOCUMENTS,
        folderSegments: ['avatars'],
        fileName,
        mimeType: 'image/jpeg',
        data: buffer,
      });
      if (up?.fileId) {
        finalFileId = up.fileId;
        putAvatarCache(ctx, finalFileId, buffer, 'image/jpeg');
      }
    } catch {
      // Giữ localId nếu Drive tạm thời không kết nối
    }
  }

  await ctx.db.employees.update(emp.id, emp.version, { avatar_file_id: finalFileId }, actorId);
  return { fileId: finalFileId, url: resolveAvatarUrl(finalFileId)! };
}

export async function removeEmployeeAvatar(
  ctx: AppContext,
  employeeId: string,
  actorId: string,
): Promise<void> {
  const emp = ctx.db.employees.get(employeeId) ?? ctx.db.employees.find((e) => e.employee_code === employeeId);
  if (!emp) throw Errors.notFound('Hồ sơ nhân sự', employeeId);
  if (!emp.avatar_file_id) return;
  await ctx.db.employees.update(emp.id, emp.version, { avatar_file_id: '' }, actorId);
}
