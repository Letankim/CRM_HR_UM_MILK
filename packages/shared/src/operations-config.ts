/**
 * Cấu hình vận hành do Quản trị viên điều chỉnh (lưu tại bảng SYSTEM_SETTINGS):
 * - Chu kỳ bắt buộc đổi mã PIN, cửa sổ đăng ký nghỉ OFF theo tuần, giới hạn ra ca muộn,
 *   số ca tối đa / ngày và phân vùng dữ liệu theo tháng.
 * Hàm thuần dùng chung cho cả Backend và Frontend.
 */

export const OPERATION_SETTING_KEYS = {
  PIN_ROTATION_DAYS: 'AUTH_PIN_ROTATION_DAYS',
  OFF_WINDOW_OPEN_WEEKDAY: 'SCHEDULE_OFF_WINDOW_OPEN_WEEKDAY',
  OFF_WINDOW_OPEN_TIME: 'SCHEDULE_OFF_WINDOW_OPEN_TIME',
  OFF_WINDOW_CLOSE_WEEKDAY: 'SCHEDULE_OFF_WINDOW_CLOSE_WEEKDAY',
  OFF_WINDOW_CLOSE_TIME: 'SCHEDULE_OFF_WINDOW_CLOSE_TIME',
  OFFICIAL_WEEKLY_OFF_LIMIT: 'SCHEDULE_OFFICIAL_WEEKLY_OFF_LIMIT',
  MAX_SHIFTS_PER_DAY: 'SCHEDULE_MAX_SHIFTS_PER_DAY',
  CHECKOUT_MAX_LATE_HOURS: 'ATTENDANCE_CHECKOUT_MAX_LATE_HOURS',
  DATA_PARTITION_MONTH: 'DATA_PARTITION_ACTIVE_MONTH',
  DATA_PARTITIONS_REGISTRY: 'DATA_PARTITIONS_REGISTRY',
  PAYROLL_ADMIN_SIGNATURE_FILE_ID: 'PAYROLL_ADMIN_SIGNATURE_FILE_ID',
  PAYROLL_ADMIN_SIGNER_NAME: 'PAYROLL_ADMIN_SIGNER_NAME',
  PAYROLL_ADMIN_SIGNED_UPDATED_AT: 'PAYROLL_ADMIN_SIGNED_UPDATED_AT',
} as const;

export type MonthlyPartitionMode = 'ROOT_FILE' | 'MONTHLY_FILE' | 'LEGACY_TAB';

export interface MonthlyPartitionRegistryEntry {
  monthKey: string;
  fileName: string;
  spreadsheetId: string;
  folderId: string;
  folderPath: string;
  webViewLink: string;
  mode: 'MONTHLY_FILE' | 'LEGACY_TAB';
  createdAt: string;
  createdBy: string;
}

export const PARTITION_MODE_LABELS: Record<MonthlyPartitionMode, string> = {
  ROOT_FILE: 'Tệp gốc mặc định',
  MONTHLY_FILE: 'Tệp riêng theo tháng',
  LEGACY_TAB: 'Phân vùng tháng cũ',
};

const MONTH_KEY_RE = /^\d{4}_(0[1-9]|1[0-2])$/;

/** Đọc sổ đăng ký các file Google Spreadsheet theo tháng từ JSON trong SYSTEM_SETTINGS. */
export function parsePartitionRegistry(raw: string | null | undefined): MonthlyPartitionRegistryEntry[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byMonth = new Map<string, MonthlyPartitionRegistryEntry>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const monthKey = typeof item.monthKey === 'string' ? item.monthKey.trim() : '';
      const spreadsheetId = typeof item.spreadsheetId === 'string' ? item.spreadsheetId.trim() : '';
      if (!MONTH_KEY_RE.test(monthKey) || !spreadsheetId) continue;
      byMonth.set(monthKey, {
        monthKey,
        fileName: typeof item.fileName === 'string' && item.fileName.trim() ? item.fileName.trim() : `UMBM_MONTHLY_${monthKey}`,
        spreadsheetId,
        folderId: typeof item.folderId === 'string' ? item.folderId.trim() : '',
        folderPath: typeof item.folderPath === 'string' ? item.folderPath.trim() : '',
        webViewLink: typeof item.webViewLink === 'string' ? item.webViewLink.trim() : '',
        mode: item.mode === 'LEGACY_TAB' ? 'LEGACY_TAB' : 'MONTHLY_FILE',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        createdBy: typeof item.createdBy === 'string' ? item.createdBy : '',
      });
    }
    return Array.from(byMonth.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  } catch {
    return [];
  }
}

export interface OperationSettings {
  pinRotationDays: number;
  offWindowOpenWeekday: number;
  offWindowOpenTime: string;
  offWindowCloseWeekday: number;
  offWindowCloseTime: string;
  officialWeeklyOffLimit: number;
  maxShiftsPerDay: number;
  checkoutMaxLateHours: number;
  dataPartitionMonth: string;
}

export const DEFAULT_OPERATION_SETTINGS: OperationSettings = {
  pinRotationDays: 90,
  offWindowOpenWeekday: 5,
  offWindowOpenTime: '09:00',
  offWindowCloseWeekday: 6,
  offWindowCloseTime: '09:00',
  officialWeeklyOffLimit: 2,
  maxShiftsPerDay: 2,
  checkoutMaxLateHours: 3,
  dataPartitionMonth: '',
};

/** 1 = Thứ 2 ... 6 = Thứ 7, 7 = Chủ nhật (chuẩn ISO). */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật',
};
export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: WEEKDAY_LABELS[value]! }));

export const SHIFT_SWAP_KIND_LABELS = { SWAP: 'Đổi ca 2 chiều', GIVE: 'Nhường ca' } as const;
/** Nhãn tiếng Việt cho các bảng dữ liệu phân vùng theo tháng (không hiển thị tên tab nội bộ). */
export const PARTITION_TABLE_LABELS: Record<string, string> = {
  SHIFT_ASSIGNMENTS: 'Lịch phân ca', LEAVE_REQUESTS: 'Đơn nghỉ OFF', SHIFT_SWAPS: 'Đổi ca / Nhường ca',
  ATTENDANCE_EVENTS: 'Chấm công Vào/Ra', ATTENDANCE_ADJUSTMENTS: 'Phiếu bổ sung công',
};
export const ADJUSTMENT_PUNCH_TYPE_LABELS = {
  CHECK_IN: 'Lỗi chấm công Vào ca',
  CHECK_OUT: 'Lỗi chấm công Ra ca',
  FULL_SHIFT: 'Bù công cả ca',
} as const;
export const ADJUSTMENT_PUNCH_TYPE_OPTIONS = (Object.keys(ADJUSTMENT_PUNCH_TYPE_LABELS) as (keyof typeof ADJUSTMENT_PUNCH_TYPE_LABELS)[])
  .map((value) => ({ value, label: ADJUSTMENT_PUNCH_TYPE_LABELS[value] }));

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

export function normalizeOperationSettings(raw: Partial<Record<keyof OperationSettings, unknown>>): OperationSettings {
  const num = (v: unknown, fb: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fb;
  };
  const hm = (v: unknown, fb: string) => (typeof v === 'string' && HM_RE.test(v.trim()) ? v.trim() : fb);
  const d = DEFAULT_OPERATION_SETTINGS;
  const month = typeof raw.dataPartitionMonth === 'string' && /^\d{4}_(0[1-9]|1[0-2])$/.test(raw.dataPartitionMonth) ? raw.dataPartitionMonth : '';
  return {
    pinRotationDays: num(raw.pinRotationDays, d.pinRotationDays, 0, 3650),
    offWindowOpenWeekday: num(raw.offWindowOpenWeekday, d.offWindowOpenWeekday, 1, 7),
    offWindowOpenTime: hm(raw.offWindowOpenTime, d.offWindowOpenTime),
    offWindowCloseWeekday: num(raw.offWindowCloseWeekday, d.offWindowCloseWeekday, 1, 7),
    offWindowCloseTime: hm(raw.offWindowCloseTime, d.offWindowCloseTime),
    officialWeeklyOffLimit: num(raw.officialWeeklyOffLimit, d.officialWeeklyOffLimit, 0, 7),
    maxShiftsPerDay: num(raw.maxShiftsPerDay, d.maxShiftsPerDay, 1, 4),
    checkoutMaxLateHours: num(raw.checkoutMaxLateHours, d.checkoutMaxLateHours, 0, 12),
    dataPartitionMonth: month,
  };
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
export function evaluateOffWindow(settings: OperationSettings, todayYmd: string, nowHm: string): OffWindowState {
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
