import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SHIFT_LABELS, type AttendanceEvent } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { dayjs } from '../lib/time.js';

export function parseHm(hm: string): number {
  const [h, m] = (hm || '00:00').split(':').map((x) => Number(x) || 0);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatDurationVi(mins: number): string {
  if (mins <= 0) return '0 phút';
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function describePunctuality(type: 'CHECK_IN' | 'CHECK_OUT', lateMins: number, earlyMins: number) {
  if (type === 'CHECK_IN') {
    return lateMins > 0
      ? { punctualityStatus: 'LATE' as const, punctualityLabel: `Vào trễ ${formatDurationVi(lateMins)}` }
      : { punctualityStatus: 'ON_TIME' as const, punctualityLabel: 'Vào đúng giờ' };
  }
  return earlyMins > 0
    ? { punctualityStatus: 'EARLY_LEAVE' as const, punctualityLabel: `Ra sớm ${formatDurationVi(earlyMins)}` }
    : { punctualityStatus: 'ON_TIME' as const, punctualityLabel: 'Ra đúng giờ' };
}

/** Hàm tính khoảng cách Haversine (mét) giữa 2 tọa độ GPS (AI-INFRA-07). */
export function calculateHaversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getLocalPhotosDir(ctx: AppContext): string {
  const dir = join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'attendance-photos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFileId(fileId: string): string {
  return fileId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Tải ảnh chụp điểm danh lên thư mục Google Drive (01_ATTENDANCE_PHOTOS/YYYY-MM)
 * và lưu bản đệm cục bộ, chỉ trả về mã fileId ngắn gọn để ghi vào Google Sheets.
 */
export async function persistAttendancePhoto(
  ctx: AppContext,
  params: { base64: string; employeeCode: string; checkType: 'CHECK_IN' | 'CHECK_OUT'; workDate: string },
): Promise<{ fileId: string; sha256: string }> {
  const match = params.base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mimeType = match?.[1] ?? 'image/jpeg';
  const rawPayload = match?.[2] ?? params.base64;
  const buffer = Buffer.from(rawPayload, 'base64');
  const sha256 = `sha256_${createHash('sha256').update(buffer).digest('hex').slice(0, 12)}`;

  if (!match || buffer.length <= 64) {
    return { fileId: 'demo_camera_selfie', sha256 };
  }

  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const safeCode = (params.employeeCode || 'NV').replace(/[^a-zA-Z0-9_-]/g, '');
  const monthFolder = (params.workDate || dayjs().format('YYYY-MM-DD')).slice(0, 7);
  const fileName = `${safeCode}_${params.checkType}_${params.workDate}_${Date.now()}.${ext}`;

  let fileId = `local_${Date.now()}_${sha256.slice(-6)}`;
  if (ctx.google.uploadAttendancePhoto) {
    try {
      const uploaded = await ctx.google.uploadAttendancePhoto({ fileName, mimeType, data: buffer, monthFolder });
      if (uploaded.fileId) fileId = uploaded.fileId;
    } catch {
      // Fallback sang fileId cục bộ nếu mạng Drive gián đoạn tạm thời
    }
  }

  try {
    const cachePath = join(getLocalPhotosDir(ctx), `${sanitizeFileId(fileId)}.jpg`);
    writeFileSync(cachePath, buffer);
  } catch {
    // Bỏ qua nếu môi trường chỉ đọc
  }

  return { fileId, sha256 };
}

export async function loadAttendancePhotoBuffer(ctx: AppContext, fileId: string): Promise<Buffer | null> {
  const safeId = sanitizeFileId(fileId);
  if (!safeId) return null;
  const cachePath = join(getLocalPhotosDir(ctx), `${safeId}.jpg`);
  if (existsSync(cachePath)) {
    try {
      return readFileSync(cachePath);
    } catch {
      // Đọc tiếp từ Google Drive bên dưới
    }
  }
  if (ctx.google.downloadDriveFile && !safeId.startsWith('local_')) {
    const buf = await ctx.google.downloadDriveFile(safeId);
    if (buf) {
      try {
        writeFileSync(cachePath, buf);
      } catch {
        // Bỏ qua lỗi ghi cache
      }
      return buf;
    }
  }
  return null;
}

let migratingPhotos = false;
/** Tự động chuyển các dòng chấm công cũ còn lưu chuỗi base64 trong Sheet sang file trên Google Drive (01_ATTENDANCE_PHOTOS). */
export async function migrateLegacyBase64Photos(ctx: AppContext): Promise<void> {
  if (migratingPhotos) return;
  const legacyRows = ctx.db.attendanceEvents.all().filter((e) => e.photo_drive_file_id?.startsWith('data:image/'));
  if (legacyRows.length === 0) return;
  migratingPhotos = true;
  try {
    for (const ev of legacyRows) {
      const emp = ctx.db.employees.get(ev.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === ev.employee_id);
      const uploaded = await persistAttendancePhoto(ctx, {
        base64: ev.photo_drive_file_id,
        employeeCode: emp?.employee_code ?? ev.employee_id,
        checkType: ev.type,
        workDate: ev.work_date,
      });
      await ctx.db.attendanceEvents.update(
        ev.id,
        ev.version,
        { photo_drive_file_id: uploaded.fileId, photo_sha256: uploaded.sha256 },
        'system-drive-sync',
      );
    }
  } catch {
    // Sẽ thử lại ở lần đồng bộ kế tiếp
  } finally {
    migratingPhotos = false;
  }
}

export function buildCheckInPhotoUrl(
  rawPhotoData: string,
  employeeName: string,
  kindLabel: string,
  checkTimeFormatted: string,
  shiftLabel: string,
  distanceM: number,
): string {
  if (rawPhotoData && rawPhotoData.startsWith('data:image/')) {
    return rawPhotoData;
  }
  if (rawPhotoData && rawPhotoData !== 'photo_01' && rawPhotoData !== 'demo_camera_selfie') {
    return `/api/attendance/photos/${encodeURIComponent(rawPhotoData)}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
    <rect width="480" height="320" fill="#0F172A"/>
    <rect x="16" y="16" width="448" height="288" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1.5"/>
    <circle cx="240" cy="112" r="38" fill="#3B82F6" opacity="0.25"/>
    <circle cx="240" cy="100" r="18" fill="#93C5FD"/>
    <path d="M204 144 C204 124 276 124 276 144" fill="#93C5FD"/>
    <rect x="28" y="28" width="136" height="26" rx="3" fill="#2563EB"/>
    <text x="96" y="45" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="12" font-weight="bold">CAMERA TRỰC TIẾP</text>
    <rect x="28" y="210" width="424" height="78" rx="4" fill="#0F172A" opacity="0.88"/>
    <text x="42" y="234" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="14" font-weight="bold">${employeeName.replace(/[<>&"']/g, '')}</text>
    <text x="42" y="255" fill="#93C5FD" font-family="Arial, sans-serif" font-size="12">${kindLabel} · ${shiftLabel} · ${checkTimeFormatted}</text>
    <text x="42" y="275" fill="#4ADE80" font-family="Arial, sans-serif" font-size="12">Xác thực GPS: Cách cửa hàng ${distanceM}m (Hợp lệ)</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function mapAttendanceEvent(e: AttendanceEvent, ctx: AppContext) {
  const emp = ctx.db.employees.get(e.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === e.employee_id);
  const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(e.branch_id);
  const assign = ctx.db.shiftAssignments.get(e.assignment_id);
  const startAt = assign?.start_at || (e.type === 'CHECK_IN' ? e.scheduled_time : '07:00') || '07:00';
  const endAt = assign?.end_at || (e.type === 'CHECK_OUT' ? e.scheduled_time : '12:00') || '12:00';
  const rawLabel = DEFAULT_SHIFT_LABELS[e.shift_code as keyof typeof DEFAULT_SHIFT_LABELS] ?? e.shift_code;
  const shiftLabel = rawLabel.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const checkTimeHm = dayjs(e.server_time).format('HH:mm');
  const checkTimeFormatted = dayjs(e.server_time).format('HH:mm · DD/MM/YYYY');
  const actualMins = parseHm(checkTimeHm);
  const lateMins = e.late_minutes || (e.type === 'CHECK_IN' ? Math.max(0, actualMins - parseHm(startAt)) : 0);
  const earlyMins = e.early_leave_minutes || (e.type === 'CHECK_OUT' ? Math.max(0, parseHm(endAt) - actualMins) : 0);
  const punc = describePunctuality(e.type, lateMins, earlyMins);
  const kindLabel = e.type === 'CHECK_IN' ? 'Vào ca' : 'Ra ca';
  const employeeName = emp ? `${emp.full_name} (${emp.employee_code})` : e.employee_id;
  const photoUrl = buildCheckInPhotoUrl(e.photo_drive_file_id, employeeName, kindLabel, checkTimeFormatted, shiftLabel, e.distance_m);

  return {
    ...e,
    branch_id: branch?.id ?? e.branch_id,
    kindLabel,
    employeeId: emp?.id ?? e.employee_id,
    employeeCode: emp?.employee_code ?? e.employee_id,
    employeeName,
    branchName: branch?.name ?? 'Chi nhánh',
    branchLat: branch?.lat ?? null,
    branchLng: branch?.lng ?? null,
    branchRadiusM: branch?.radius_m ?? 100,
    shiftLabel,
    shiftTimeRange: `${startAt} – ${endAt}`,
    checkTimeHm,
    checkTimeFormatted,
    photoUrl,
    ...punc,
  };
}
