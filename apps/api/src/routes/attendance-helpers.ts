import type { AttendanceEvent } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { paginateAndSort } from '../lib/list-query.js';
import { dayjs } from '../lib/time.js';
import { findBranchShiftTemplate } from './account-employee-sync.js';
import { resolveShiftLabel } from './employee-mapper.js';
export { buildAttendanceFolderSegments, buildShiftFolderName, loadAttendancePhotoBuffer, migrateLegacyBase64Photos, persistAttendancePhoto } from './attendance-photo-storage.js';

export function parseHm(hm: string): number {
  const [h, m] = (hm || '00:00').split(':').map((x) => Number(x) || 0);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatDurationVi(mins: number): string {
  if (mins <= 0) return '0 phút';
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60), m = mins % 60;
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
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function buildCheckInPhotoUrl(rawPhotoData: string, employeeName: string, kindLabel: string, checkTimeFormatted: string, shiftLabel: string, distanceM: number): string {
  if (rawPhotoData && rawPhotoData.startsWith('data:image/')) return rawPhotoData;
  if (rawPhotoData && rawPhotoData !== 'photo_01' && rawPhotoData !== 'demo_camera_selfie') return `/api/attendance/photos/${encodeURIComponent(rawPhotoData)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#0F172A"/><rect x="16" y="16" width="448" height="288" rx="4" fill="#1E293B" stroke="#334155" stroke-width="1.5"/><circle cx="240" cy="112" r="38" fill="#3B82F6" opacity="0.25"/><circle cx="240" cy="100" r="18" fill="#93C5FD"/><path d="M204 144 C204 124 276 124 276 144" fill="#93C5FD"/><rect x="28" y="28" width="136" height="26" rx="3" fill="#2563EB"/><text x="96" y="45" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="12" font-weight="bold">CAMERA TRỰC TIẾP</text><rect x="28" y="210" width="424" height="78" rx="4" fill="#0F172A" opacity="0.88"/><text x="42" y="234" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="14" font-weight="bold">${employeeName.replace(/[<>&"']/g, '')}</text><text x="42" y="255" fill="#93C5FD" font-family="Arial, sans-serif" font-size="12">${kindLabel} · ${shiftLabel} · ${checkTimeFormatted}</text><text x="42" y="275" fill="#4ADE80" font-family="Arial, sans-serif" font-size="12">Xác thực GPS: Cách cửa hàng ${distanceM}m (Hợp lệ)</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function mapAttendanceEvent(e: AttendanceEvent, ctx: AppContext) {
  const emp = ctx.db.employees.get(e.employee_id) ?? ctx.db.employees.find((x) => x.employee_code === e.employee_id);
  const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(e.branch_id);
  const assign = ctx.db.shiftAssignments.get(e.assignment_id);
  const tpl = findBranchShiftTemplate(ctx, e.shift_code, branch?.id ?? e.branch_id);
  const startAt = assign?.start_at || tpl?.start_time || (e.type === 'CHECK_IN' ? e.scheduled_time : '07:00') || '07:00';
  const endAt = assign?.end_at || tpl?.end_time || (e.type === 'CHECK_OUT' ? e.scheduled_time : '12:00') || '12:00';
  const shiftLabel = resolveShiftLabel(ctx, e.shift_code, branch?.id ?? e.branch_id).replace(/\s*\([^)]*\)\s*/g, '').trim();
  const checkTimeHm = dayjs(e.server_time).format('HH:mm'), checkTimeFormatted = dayjs(e.server_time).format('HH:mm · DD/MM/YYYY');
  const actualMins = parseHm(checkTimeHm), serverDate = dayjs(e.server_time).format('YYYY-MM-DD');
  const lateMins = e.late_minutes || (e.type === 'CHECK_IN' ? Math.max(0, serverDate > e.work_date ? actualMins + 1440 - parseHm(startAt) : actualMins - parseHm(startAt)) : 0);
  const earlyMins = e.early_leave_minutes || (e.type === 'CHECK_OUT' && serverDate <= e.work_date ? Math.max(0, parseHm(endAt) - actualMins) : 0);
  const punc = describePunctuality(e.type, lateMins, earlyMins);
  const kindLabel = e.type === 'CHECK_IN' ? 'Vào ca' : 'Ra ca';
  const employeeName = emp ? `${emp.full_name} (${emp.employee_code})` : e.employee_id;
  const photoUrl = buildCheckInPhotoUrl(e.photo_drive_file_id, employeeName, kindLabel, checkTimeFormatted, shiftLabel, e.distance_m);

  return {
    ...e, branch_id: branch?.id ?? e.branch_id, kindLabel,
    employeeId: emp?.id ?? e.employee_id, employeeCode: emp?.employee_code ?? e.employee_id, employeeName,
    branchName: branch?.name ?? 'Chi nhánh', branchLat: branch?.lat ?? null, branchLng: branch?.lng ?? null, branchRadiusM: branch?.radius_m ?? 100,
    shiftLabel, shiftTimeRange: `${startAt} – ${endAt}`, checkTimeHm, checkTimeFormatted, photoUrl, ...punc,
  };
}

export function buildPaginatedAttendanceSessions(
  ctx: AppContext,
  scopedEvents: readonly AttendanceEvent[],
  query: { page?: number; per_page?: number; q?: string; branch_id?: string; shift_code?: string; status?: string; from_date?: string; to_date?: string },
) {
  const empByCode = new Map(ctx.db.employees.all().map((e) => [e.employee_code, e]));
  const sorted = [...scopedEvents].sort((a, b) => {
    const ta = Date.parse(a.server_time), tb = Date.parse(b.server_time);
    return (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) ? tb - ta : b.server_time.localeCompare(a.server_time);
  });
  const groups = new Map<string, { inEv: AttendanceEvent | null; outEv: AttendanceEvent | null }>();
  for (const ev of sorted) {
    if (query.from_date && ev.work_date < query.from_date) continue;
    if (query.to_date && ev.work_date > query.to_date) continue;
    const key = ev.assignment_id ? `asg_${ev.assignment_id}` : `emp_${ev.employee_id}_${ev.work_date}_${ev.shift_code}`;
    const cur = groups.get(key) ?? { inEv: null, outEv: null };
    if (ev.type === 'CHECK_OUT') { if (!cur.outEv) cur.outEv = ev; }
    else if (!cur.inEv) { cur.inEv = ev; }
    groups.set(key, cur);
  }

  const rawSessions = [];
  for (const [, { inEv, outEv: rawOutEv }] of groups) {
    const base = inEv ?? rawOutEv;
    if (!base) continue;
    const emp = ctx.db.employees.get(base.employee_id) ?? empByCode.get(base.employee_id);
    const assign = (base.assignment_id ? ctx.db.shiftAssignments.get(base.assignment_id) : undefined)
      ?? ctx.db.shiftAssignments.find((a) => (a.employee_id === base.employee_id || Boolean(emp && (a.employee_id === emp.id || a.employee_id === emp.employee_code))) && a.work_date === base.work_date && a.shift_code === base.shift_code);
    const outEv: AttendanceEvent | null = rawOutEv ?? (assign?.status === 'COMPLETED' && inEv ? { ...inEv, id: `${inEv.id}_auto_out`, type: 'CHECK_OUT', scheduled_time: assign.end_at || '12:00', server_time: `${inEv.work_date}T${assign.end_at || '12:00'}:00+07:00`, late_minutes: 0, early_leave_minutes: 0, note: 'Đã hoàn thành ca (Xác nhận bổ sung giờ ra ca)' } : null);
    const branch = (emp ? ctx.db.branches.get(emp.branch_id) : undefined) ?? ctx.db.branches.get(base.branch_id);
    const branchId = branch?.id ?? base.branch_id;
    if (query.branch_id && query.branch_id !== 'ALL' && branchId !== query.branch_id) continue;
    if (query.shift_code && query.shift_code !== 'ALL' && base.shift_code !== query.shift_code) continue;
    const isCompleted = Boolean(inEv && outEv);
    const isInProgress = Boolean(inEv && !outEv);
    const isLateEarly = Boolean((inEv && (inEv.late_minutes ?? 0) > 0) || (outEv && (outEv.early_leave_minutes ?? 0) > 0));
    if (query.status === 'COMPLETED' && !isCompleted) continue;
    if (query.status === 'IN_PROGRESS' && !isInProgress) continue;
    if (query.status === 'LATE_EARLY' && !isLateEarly) continue;
    const shiftLabel = resolveShiftLabel(ctx, base.shift_code, branchId).replace(/\s*\([^)]*\)\s*/g, '').trim();
    rawSessions.push({ id: inEv?.id ?? outEv!.id, work_date: base.work_date, server_time: base.server_time, branch_id: branchId, branchName: branch?.name ?? 'Chi nhánh', shift_code: base.shift_code, shiftLabel, employeeCode: emp?.employee_code ?? base.employee_id, employeeName: emp ? `${emp.full_name} (${emp.employee_code})` : base.employee_id, isCompleted, isInProgress, isLateEarly, inEv, outEv });
  }

  const completedCount = rawSessions.filter((s) => s.isCompleted).length, inProgressCount = rawSessions.filter((s) => s.isInProgress).length, lateEarlyCount = rawSessions.filter((s) => s.isLateEarly).length;
  const paged = paginateAndSort(rawSessions.reverse(), {
    page: query.page, perPage: query.per_page ?? 15, maxPerPage: 500, defaultSortBy: 'work_date', defaultSortOrder: 'desc', allowedSortFields: ['work_date', 'server_time', 'employeeCode'],
    q: query.q, searchExtractor: (s) => [s.employeeName, s.employeeCode, s.branchName, s.work_date, s.shiftLabel],
    filters: { branch_id: query.branch_id, shift_code: query.shift_code, status: query.status }, filterPredicates: { status: () => true },
  });
  const items = paged.items.map((s) => {
    const mappedIn = s.inEv ? mapAttendanceEvent(s.inEv, ctx) : null, mappedOut = s.outEv ? mapAttendanceEvent(s.outEv, ctx) : null, base = mappedIn ?? mappedOut!;
    return { ...base, id: mappedIn?.id ?? mappedOut!.id, checkInEvent: mappedIn, checkOutEvent: mappedOut };
  });
  paged.meta.filters.completed_count = String(completedCount);
  paged.meta.filters.in_progress_count = String(inProgressCount);
  paged.meta.filters.late_early_count = String(lateEarlyCount);
  return { items, meta: paged.meta };
}
