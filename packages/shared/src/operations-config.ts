/**
 * Cấu hình vận hành do Quản trị viên điều chỉnh (lưu tại bảng SYSTEM_SETTINGS):
 * - Chu kỳ bắt buộc đổi mã PIN, cửa sổ đăng ký nghỉ OFF theo tuần, giới hạn ra ca muộn,
 *   số ca tối đa / ngày, chế độ làm việc khối Văn phòng và phân vùng dữ liệu theo tháng.
 * Hàm thuần dùng chung cho cả Backend và Frontend.
 */

export * from './operations-helpers.js';

export const OPERATION_SETTING_KEYS = {
  PIN_ROTATION_DAYS: 'AUTH_PIN_ROTATION_DAYS',
  OFF_WINDOW_OPEN_WEEKDAY: 'SCHEDULE_OFF_WINDOW_OPEN_WEEKDAY',
  OFF_WINDOW_OPEN_TIME: 'SCHEDULE_OFF_WINDOW_OPEN_TIME',
  OFF_WINDOW_CLOSE_WEEKDAY: 'SCHEDULE_OFF_WINDOW_CLOSE_WEEKDAY',
  OFF_WINDOW_CLOSE_TIME: 'SCHEDULE_OFF_WINDOW_CLOSE_TIME',
  OFFICIAL_WEEKLY_OFF_LIMIT: 'SCHEDULE_OFFICIAL_WEEKLY_OFF_LIMIT',
  MAX_SHIFTS_PER_DAY: 'SCHEDULE_MAX_SHIFTS_PER_DAY',
  CHECKOUT_MAX_LATE_HOURS: 'ATTENDANCE_CHECKOUT_MAX_LATE_HOURS',
  STANDARD_WORK_DAYS_PER_MONTH: 'PAYROLL_STANDARD_WORK_DAYS_PER_MONTH',
  STANDARD_HOURS_PER_DAY: 'PAYROLL_STANDARD_HOURS_PER_DAY',
  DATA_PARTITION_MONTH: 'DATA_PARTITION_ACTIVE_MONTH',
  DATA_PARTITIONS_REGISTRY: 'DATA_PARTITIONS_REGISTRY',
  PAYROLL_ADMIN_SIGNATURE_FILE_ID: 'PAYROLL_ADMIN_SIGNATURE_FILE_ID',
  PAYROLL_ADMIN_SIGNER_NAME: 'PAYROLL_ADMIN_SIGNER_NAME',
  PAYROLL_ADMIN_SIGNED_UPDATED_AT: 'PAYROLL_ADMIN_SIGNED_UPDATED_AT',
  PAYROLL_FINANCE_SIGNATURE_FILE_ID: 'PAYROLL_FINANCE_SIGNATURE_FILE_ID',
  PAYROLL_FINANCE_SIGNER_NAME: 'PAYROLL_FINANCE_SIGNER_NAME',
  PAYROLL_FINANCE_SIGNED_UPDATED_AT: 'PAYROLL_FINANCE_SIGNED_UPDATED_AT',
  OFFICE_WORKDAY_MODE: 'OFFICE_WORKDAY_MODE',
  OFFICE_SATURDAY_START_TIME: 'OFFICE_SATURDAY_START_TIME',
  OFFICE_SATURDAY_END_TIME: 'OFFICE_SATURDAY_END_TIME',
  OFFICE_SATURDAY_HOURS: 'OFFICE_SATURDAY_HOURS',
} as const;

export type MonthlyPartitionMode = 'ROOT_FILE' | 'MONTHLY_FILE' | 'LEGACY_TAB';

export type OfficeWorkdayMode = 'MON_TO_FRI' | 'MON_TO_SAT' | 'MON_TO_SAT_MORNING';

export const OFFICE_WORKDAY_MODE_LABELS: Record<OfficeWorkdayMode, string> = {
  MON_TO_FRI: 'Thứ 2 – Thứ 6 (Nghỉ Thứ 7 & CN)',
  MON_TO_SAT: 'Thứ 2 – Thứ 7 (Nghỉ Chủ nhật)',
  MON_TO_SAT_MORNING: 'Thứ 2 – Thứ 6 + Sáng Thứ 7 (Nghỉ chiều T7 & CN)',
};

export const OFFICE_WORKDAY_MODE_OPTIONS = (Object.keys(OFFICE_WORKDAY_MODE_LABELS) as OfficeWorkdayMode[])
  .map((value) => ({ value, label: OFFICE_WORKDAY_MODE_LABELS[value] }));

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
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
  dataPartitionMonth: string;
  officeWorkdayMode: OfficeWorkdayMode;
  officeSaturdayStartTime: string;
  officeSaturdayEndTime: string;
  officeSaturdayHours: number;
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
  standardWorkDaysPerMonth: 26,
  standardHoursPerDay: 8,
  dataPartitionMonth: '',
  officeWorkdayMode: 'MON_TO_FRI',
  officeSaturdayStartTime: '08:00',
  officeSaturdayEndTime: '12:00',
  officeSaturdayHours: 4,
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật',
};
export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: WEEKDAY_LABELS[value]! }));

export const SHIFT_SWAP_KIND_LABELS = {
  SWAP: 'Đổi ca 2 chiều',
  GIVE: 'Nhường ca',
  HR_DISPATCH: 'Điều phối khẩn cấp (+30k)',
  HR_SUPPORT: 'Hỗ trợ liên chi nhánh',
} as const;
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

export function normalizeOperationSettings(raw: Partial<Record<keyof OperationSettings, unknown>>): OperationSettings {
  const num = (v: unknown, fb: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fb;
  };
  const hm = (v: unknown, fb: string) => (typeof v === 'string' && HM_RE.test(v.trim()) ? v.trim() : fb);
  const d = DEFAULT_OPERATION_SETTINGS;
  const month = typeof raw.dataPartitionMonth === 'string' && /^\d{4}_(0[1-9]|1[0-2])$/.test(raw.dataPartitionMonth) ? raw.dataPartitionMonth : '';
  const validMode = (v: unknown): OfficeWorkdayMode => (v === 'MON_TO_SAT' || v === 'MON_TO_SAT_MORNING' ? v : 'MON_TO_FRI');
  return {
    pinRotationDays: num(raw.pinRotationDays, d.pinRotationDays, 0, 3650),
    offWindowOpenWeekday: num(raw.offWindowOpenWeekday, d.offWindowOpenWeekday, 1, 7),
    offWindowOpenTime: hm(raw.offWindowOpenTime, d.offWindowOpenTime),
    offWindowCloseWeekday: num(raw.offWindowCloseWeekday, d.offWindowCloseWeekday, 1, 7),
    offWindowCloseTime: hm(raw.offWindowCloseTime, d.offWindowCloseTime),
    officialWeeklyOffLimit: num(raw.officialWeeklyOffLimit, d.officialWeeklyOffLimit, 0, 7),
    maxShiftsPerDay: num(raw.maxShiftsPerDay, d.maxShiftsPerDay, 1, 4),
    checkoutMaxLateHours: num(raw.checkoutMaxLateHours, d.checkoutMaxLateHours, 0, 12),
    standardWorkDaysPerMonth: num(raw.standardWorkDaysPerMonth, d.standardWorkDaysPerMonth, 1, 31),
    standardHoursPerDay: num(raw.standardHoursPerDay, d.standardHoursPerDay, 1, 24),
    dataPartitionMonth: month,
    officeWorkdayMode: validMode(raw.officeWorkdayMode),
    officeSaturdayStartTime: hm(raw.officeSaturdayStartTime, d.officeSaturdayStartTime),
    officeSaturdayEndTime: hm(raw.officeSaturdayEndTime, d.officeSaturdayEndTime),
    officeSaturdayHours: num(raw.officeSaturdayHours, d.officeSaturdayHours, 1, 12),
  };
}
