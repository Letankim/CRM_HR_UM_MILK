import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttendanceEvent } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';

/**
 * Lưu trữ ảnh Camera chấm công & ảnh minh chứng phiếu lỗi chấm công.
 * Cấu trúc thư mục Google Drive: 01_ATTENDANCE_PHOTOS / YYYY-MM / YYYY-MM-DD / <Ca làm việc>
 * (ảnh minh chứng: 03_ADJUSTMENT_EVIDENCE / YYYY-MM / YYYY-MM-DD / <Ca làm việc>).
 */
function getLocalPhotosDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'attendance-photos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
const sanitizeFileId = (fileId: string) => fileId.replace(/[^a-zA-Z0-9_-]/g, '');
const MAX_PHOTO_RAM_CACHE = 60;
const photoRamCache = new Map<string, Buffer>();
let driveUploadsInFlight = 0;
let migratingPhotos = false;

function putPhotoCache(key: string, buf: Buffer): void {
  if (!key) return;
  photoRamCache.delete(key);
  if (photoRamCache.size >= MAX_PHOTO_RAM_CACHE) {
    const oldest = photoRamCache.keys().next().value;
    if (oldest) photoRamCache.delete(oldest);
  }
  photoRamCache.set(key, buf);
}

/** Tên thư mục ca an toàn cho Google Drive, ví dụ "Ca Sáng (07h00-12h00)". */
export function buildShiftFolderName(shiftLabel: string | undefined, shiftCode: string | undefined, startAt?: string, endAt?: string): string {
  const base = (shiftLabel || shiftCode || 'Ca lam viec').replace(/\s*\([^)]*\)\s*/g, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Ca lam viec';
  return startAt && endAt ? `${base} (${startAt.replace(':', 'h')}-${endAt.replace(':', 'h')})` : base;
}

/** Danh sách thư mục con Tháng / Ngày / Ca cho một ngày công. */
export function buildAttendanceFolderSegments(workDate: string, shiftFolder: string): string[] {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(workDate) ? workDate : dayjs().format('YYYY-MM-DD');
  return [day.slice(0, 7), day, shiftFolder];
}

export async function persistAttendancePhoto(
  ctx: AppContext,
  params: { base64: string; employeeCode: string; checkType: 'CHECK_IN' | 'CHECK_OUT' | 'EVIDENCE'; workDate: string; shiftFolder?: string; rootFolder?: 'ATTENDANCE' | 'EVIDENCE' },
  forceDriveUpload = false,
): Promise<{ fileId: string; sha256: string }> {
  const match = params.base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mimeType = match?.[1] ?? 'image/jpeg', rawPayload = match?.[2] ?? params.base64;
  const buffer = Buffer.from(rawPayload, 'base64');
  const sha256 = `sha256_${createHash('sha256').update(buffer).digest('hex').slice(0, 12)}`;
  if (!match || buffer.length <= 64) return { fileId: 'demo_camera_selfie', sha256 };

  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const safeCode = (params.employeeCode || 'NV').replace(/[^a-zA-Z0-9_-]/g, '');
  const workDate = params.workDate || dayjs().format('YYYY-MM-DD');
  const folderSegments = buildAttendanceFolderSegments(workDate, params.shiftFolder || 'Ca lam viec');
  const fileName = `${safeCode}_${params.checkType}_${workDate}_${dayjs().format('HHmmss')}_${Date.now() % 100000}.${ext}`;
  let fileId = `local_${Date.now()}_${sha256.slice(-6)}`, uploadedToDrive = false;

  if (ctx.google.uploadAttendancePhoto && (forceDriveUpload || driveUploadsInFlight < 2)) {
    driveUploadsInFlight++;
    try {
      const uploaded = await ctx.google.uploadAttendancePhoto({ fileName, mimeType, data: buffer, monthFolder: workDate.slice(0, 7), folderSegments, rootFolder: params.rootFolder ?? 'ATTENDANCE' });
      if (uploaded.fileId) { fileId = uploaded.fileId; uploadedToDrive = true; }
    } catch { /* fallback */ } finally { driveUploadsInFlight--; }
  }
  const safeCacheKey = sanitizeFileId(fileId);
  putPhotoCache(safeCacheKey, buffer);
  try { writeFileSync(join(getLocalPhotosDir(ctx), `${safeCacheKey}.jpg`), buffer); } catch { /* ignore ephemeral disk */ }

  if (!uploadedToDrive && ctx.google.uploadAttendancePhoto && params.base64.length <= 42_000) {
    setTimeout(() => { void migrateLegacyBase64Photos(ctx); }, 1500);
    return { fileId: params.base64, sha256 };
  }
  return { fileId, sha256 };
}

export async function loadAttendancePhotoBuffer(ctx: AppContext, fileId: string): Promise<Buffer | null> {
  const safeId = sanitizeFileId(fileId);
  if (!safeId) return null;
  const ramHit = photoRamCache.get(safeId);
  if (ramHit) { putPhotoCache(safeId, ramHit); return ramHit; }
  const cachePath = join(getLocalPhotosDir(ctx), `${safeId}.jpg`);
  if (existsSync(cachePath)) {
    try { const buf = readFileSync(cachePath); putPhotoCache(safeId, buf); return buf; } catch { /* fallback drive */ }
  }
  if (ctx.google.downloadDriveFile && !safeId.startsWith('local_')) {
    const buf = await ctx.google.downloadDriveFile(safeId);
    if (buf) { putPhotoCache(safeId, buf); try { writeFileSync(cachePath, buf); } catch { /* ignore */ } return buf; }
  }
  return null;
}

export async function migrateLegacyBase64Photos(ctx: AppContext): Promise<void> {
  if (migratingPhotos || !ctx.google.uploadAttendancePhoto) return;
  const legacyRows = ctx.db.attendanceEvents.all().filter((e) => e.photo_drive_file_id?.startsWith('data:image/')).slice(0, 5);
  if (legacyRows.length === 0) return;
  migratingPhotos = true;
  try {
    const patches: { id: string; expectedVersion: number; patch: Partial<AttendanceEvent> }[] = [];
    for (const ev of legacyRows) {
      const emp = ctx.db.employees.get(ev.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === ev.employee_id);
      const uploaded = await persistAttendancePhoto(ctx, { base64: ev.photo_drive_file_id, employeeCode: emp?.employee_code ?? ev.employee_id, checkType: ev.type, workDate: ev.work_date, shiftFolder: buildShiftFolderName(undefined, ev.shift_code) }, true);
      if (!uploaded.fileId.startsWith('data:image/')) patches.push({ id: ev.id, expectedVersion: ev.version, patch: { photo_drive_file_id: uploaded.fileId, photo_sha256: uploaded.sha256 } });
    }
    if (patches.length > 0) await ctx.db.attendanceEvents.batchUpdate(patches, 'system-drive-sync');
  } catch { /* retry later */ } finally { migratingPhotos = false; }
}
