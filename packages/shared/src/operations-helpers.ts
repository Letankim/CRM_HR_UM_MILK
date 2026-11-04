/**
 * Helper tính toán ngày tháng và trạng thái cửa sổ đăng ký nghỉ OFF theo tuần.
 */

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromYmd = (s: string) => new Date(`${s}T00:00:00Z`);
const isoWeekday = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

export function addDaysYmd(ymd: string, days: number): string {
  const d = fromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

/** Thứ 2 của tuần chứa ngày `ymd`. */
export function mondayOfWeek(ymd: string): string {
  return addDaysYmd(ymd, 1 - isoWeekday(fromYmd(ymd)));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
}

export interface OffWindowSettingsInput {
  offWindowOpenWeekday: number;
  offWindowOpenTime: string;
  offWindowCloseWeekday: number;
  offWindowCloseTime: string;
}

export interface OffWindowState {
  isOpen: boolean;
  /** Mốc mở / đóng của kỳ đăng ký đang diễn ra hoặc sắp tới (YYYY-MM-DD HH:mm, giờ Việt Nam) */
  opensAt: string;
  closesAt: string;
  /** Tuần được đăng ký nghỉ OFF (tuần ngay sau thời điểm đóng cổng) */
  targetWeekStart: string;
  targetWeekEnd: string;
  message: string;
}

/**
 * Tính trạng thái cổng đăng ký nghỉ OFF theo tuần.
 * Mặc định mở 09:00 Thứ 6 và đóng 09:00 Thứ 7; nghỉ OFF đăng ký cho tuần kế tiếp (Thứ 2 – Chủ nhật).
 */
export function evaluateOffWindow(settings: OffWindowSettingsInput, todayYmd: string, nowHm: string): OffWindowState {
  const thisMonday = mondayOfWeek(todayYmd);
  const span = (monday: string) => {
    const open = addDaysYmd(monday, settings.offWindowOpenWeekday - 1);
    let close = addDaysYmd(monday, settings.offWindowCloseWeekday - 1);
    if (close < open || (close === open && settings.offWindowCloseTime <= settings.offWindowOpenTime)) close = addDaysYmd(close, 7);
    return { open: `${open} ${settings.offWindowOpenTime}`, close: `${close} ${settings.offWindowCloseTime}`, closeDate: close };
  };
  const now = `${todayYmd} ${nowHm}`;
  let cur = span(thisMonday);
  if (now >= cur.close) cur = span(addDaysYmd(thisMonday, 7));
  const prev = span(addDaysYmd(thisMonday, -7));
  if (now >= prev.open && now < prev.close) cur = prev;
  const isOpen = now >= cur.open && now < cur.close;
  const targetWeekStart = addDaysYmd(mondayOfWeek(cur.closeDate), 7);
  const targetWeekEnd = addDaysYmd(targetWeekStart, 6);
  const fmt = (s: string) => `${s.slice(11)} ngày ${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const weekVi = `${targetWeekStart.slice(8, 10)}/${targetWeekStart.slice(5, 7)} – ${targetWeekEnd.slice(8, 10)}/${targetWeekEnd.slice(5, 7)}/${targetWeekEnd.slice(0, 4)}`;
  return {
    isOpen,
    opensAt: cur.open,
    closesAt: cur.close,
    targetWeekStart,
    targetWeekEnd,
    message: isOpen
      ? `Cổng đăng ký nghỉ OFF đang mở đến ${fmt(cur.close)} cho tuần ${weekVi}.`
      : `Cổng đăng ký nghỉ OFF đang đóng. Kỳ đăng ký tiếp theo mở từ ${fmt(cur.open)} đến ${fmt(cur.close)} cho tuần ${weekVi}.`,
  };
}
