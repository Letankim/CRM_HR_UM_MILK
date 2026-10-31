'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { addDaysYmd, DEFAULT_OPERATION_SETTINGS, type OffWindowState, type OperationSettings } from '@umbm/shared';
import { api } from '@/lib/api';

/** Tóm tắt chu kỳ thử việc 12 ngày trả về từ `GET /my-attendance` (`probationCycle`). */
export interface ProbationCycleSummary {
  start: string; end: string; workRequired: number; offLimit: number;
  scheduledCount: number; offCount: number; isLocked: boolean;
}

export interface BranchPeerItem {
  id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string; busyShiftsByDate?: Record<string, string>;
}

/** Các trường bổ sung của `GET /my-attendance` phục vụ Cổng nhân viên (cổng OFF, đăng ký ca thử việc). */
export interface SelfAttendanceExtras {
  offWindow?: OffWindowState;
  canRegisterShift?: boolean;
  probationCycle?: ProbationCycleSummary | null;
}

export type OffWindowInfo = OffWindowState & { officialWeeklyOffLimit: number; maxShiftsPerDay: number };

export const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

/** Đọc dữ liệu Cổng nhân viên dùng chung cache `['my-attendance']`. */
export function useMyAttendanceExtras(enabled = true) {
  return useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => api.get<SelfAttendanceExtras & { profile?: { employeeId: string; employeeCode: string; stage?: string }; todayDate?: string }>('/my-attendance'),
    enabled,
  });
}

/** Trạng thái cổng đăng ký nghỉ OFF theo tuần (`GET /schedule/off-window`). */
export function useOffWindow(enabled = true) {
  return useQuery({ queryKey: ['off-window'], queryFn: () => api.get<OffWindowInfo>('/schedule/off-window'), enabled, retry: false });
}

/** Số giờ tối đa được Ra ca sau giờ kết thúc ca (cấu hình vận hành, mặc định 3 giờ). */
export function useCheckoutLateHours(): number {
  const q = useQuery({
    queryKey: ['operations-config', 'self'],
    queryFn: () => api.get<{ settings?: OperationSettings }>('/admin/operations-config'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.settings?.checkoutMaxLateHours ?? DEFAULT_OPERATION_SETTINGS.checkoutMaxLateHours;
}

/** Giờ hiện tại (HH:mm) tự cập nhật định kỳ, không gọi lại API. */
export function useNowHm(intervalMs = 30_000): string {
  const [hm, setHm] = useState(() => dayjs().format('HH:mm'));
  useEffect(() => {
    const t = setInterval(() => setHm(dayjs().format('HH:mm')), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return hm;
}

/** Ca làm việc chưa tới giờ kết thúc (không được Ra ca sớm). Hỗ trợ ca qua đêm. */
export function isBeforeShiftEnd(s: Record<string, unknown>, todayDate: string, nowHm: string): boolean {
  const wd = String(s.workDate || s.work_date || '');
  const st = String(s.startAt || s.start_at || '07:00'), en = String(s.endAt || s.end_at || '12:00');
  const overnight = en <= st;
  if (!wd) return false;
  if (wd > todayDate) return true;
  if (wd === todayDate) return overnight ? true : nowHm < en;
  if (overnight && addDaysYmd(wd, 1) === todayDate) return nowHm < en;
  return false;
}

/** Nhãn trạng thái ca hiển thị trong ô chọn ca điểm danh. */
export function describeSelfShiftState(s: Record<string, unknown>, todayDate: string, nowHm: string, lateHours: number): string {
  const wd = String(s.workDate || ''), isT = wd === todayDate;
  const hasIn = Boolean(s.checkInEvent), hasOut = Boolean(s.checkOutEvent);
  const exp = s.status === 'ABSENT' || Boolean(s.isAbsentShift) || (!hasIn && s.status === 'PUBLISHED' && (wd < todayDate || (isT && (Boolean(s.isExpiredToday) || nowHm > String(s.endAt || '12:00')))));
  if (s.status === 'DRAFT') return 'Chờ CH / HR duyệt phân ca';
  if (s.status === 'COMPLETED' || (hasIn && hasOut)) return 'Đã hoàn thành ca';
  if (exp) return 'Vắng mặt (Quá giờ ca — Cần bù công)';
  if (hasIn && Boolean(s.isForgotCheckout)) return `Quên Ra ca (Quá ${lateHours} giờ sau giờ kết thúc — Cần gửi phiếu lỗi)`;
  if (hasIn && Boolean(s.isWithinCheckoutGrace)) return `Đã vào ca (Còn hạn Ra ca đến ${String(s.checkoutGraceDeadlineHm || '')})`;
  if (hasIn && isBeforeShiftEnd(s, todayDate, nowHm)) return `Đã vào ca (Ra ca từ ${String(s.endAt || '12:00')})`;
  if (hasIn) return 'Đã vào ca (Chờ Ra ca)';
  return isT ? 'Hôm nay · Chưa vào ca' : 'Đã duyệt · Chưa tới ngày';
}

/** Danh sách lựa chọn ca cho ô chọn ca điểm danh cá nhân. */
export function buildSelfShiftOptions(shifts: Record<string, unknown>[], todayDate: string, nowHm: string, lateHours: number) {
  return shifts.map((s) => {
    const isT = String(s.workDate) === todayDate;
    return {
      value: String(s.id),
      label: `${isT ? '[HÔM NAY] ' : ''}${dayjs(String(s.workDate)).format('DD/MM/YYYY')} · ${cleanShiftName(s.shiftLabel)} (${String(s.startAt || '07:00')} – ${String(s.endAt || '12:00')}) · ${describeSelfShiftState(s, todayDate, nowHm, lateHours)}`,
    };
  });
}

/** Chọn ca mặc định để điểm danh: ưu tiên ca đang chờ Ra ca, rồi ca hôm nay chưa hoàn thành. */
export function pickActiveSelfShift<T extends Record<string, unknown>>(shifts: T[], selectedId: string, todayDate: string): T | null {
  return shifts.find((s) => String(s.id) === selectedId)
    ?? shifts.find((s) => Boolean(s.canCheckOutNow))
    ?? shifts.find((s) => String(s.workDate) === todayDate && s.status === 'PUBLISHED' && !s.isAbsentShift && !s.isExpiredToday && !(s.checkInEvent && s.checkOutEvent))
    ?? shifts.find((s) => String(s.workDate) === todayDate && s.status === 'PUBLISHED')
    ?? shifts.find((s) => String(s.workDate) === todayDate)
    ?? shifts[0] ?? null;
}
