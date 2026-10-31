import { DEFAULT_OPERATION_SETTINGS, OPERATION_SETTING_KEYS, normalizeOperationSettings, type OperationSettings } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { setCheckoutGraceMinutes } from './checkout-grace.js';

type Field = keyof OperationSettings;

const FIELD_KEYS: Record<Field, string> = {
  pinRotationDays: OPERATION_SETTING_KEYS.PIN_ROTATION_DAYS,
  offWindowOpenWeekday: OPERATION_SETTING_KEYS.OFF_WINDOW_OPEN_WEEKDAY,
  offWindowOpenTime: OPERATION_SETTING_KEYS.OFF_WINDOW_OPEN_TIME,
  offWindowCloseWeekday: OPERATION_SETTING_KEYS.OFF_WINDOW_CLOSE_WEEKDAY,
  offWindowCloseTime: OPERATION_SETTING_KEYS.OFF_WINDOW_CLOSE_TIME,
  officialWeeklyOffLimit: OPERATION_SETTING_KEYS.OFFICIAL_WEEKLY_OFF_LIMIT,
  maxShiftsPerDay: OPERATION_SETTING_KEYS.MAX_SHIFTS_PER_DAY,
  checkoutMaxLateHours: OPERATION_SETTING_KEYS.CHECKOUT_MAX_LATE_HOURS,
  dataPartitionMonth: OPERATION_SETTING_KEYS.DATA_PARTITION_MONTH,
};

const FIELD_META: Record<Field, { label: string; category: string }> = {
  pinRotationDays: { label: 'Chu kỳ bắt buộc đổi mã PIN (ngày, 0 = không áp dụng)', category: 'SECURITY' },
  offWindowOpenWeekday: { label: 'Ngày mở cổng đăng ký nghỉ OFF', category: 'SCHEDULE' },
  offWindowOpenTime: { label: 'Giờ mở cổng đăng ký nghỉ OFF', category: 'SCHEDULE' },
  offWindowCloseWeekday: { label: 'Ngày đóng cổng đăng ký nghỉ OFF', category: 'SCHEDULE' },
  offWindowCloseTime: { label: 'Giờ đóng cổng đăng ký nghỉ OFF', category: 'SCHEDULE' },
  officialWeeklyOffLimit: { label: 'Số ngày nghỉ OFF tối đa / tuần (Nhân viên chính thức)', category: 'SCHEDULE' },
  maxShiftsPerDay: { label: 'Số ca tối đa của 1 nhân viên trong 1 ngày', category: 'SCHEDULE' },
  checkoutMaxLateHours: { label: 'Thời hạn tối đa chấm công Ra ca sau giờ kết thúc ca (giờ)', category: 'ATTENDANCE' },
  dataPartitionMonth: { label: 'Phân vùng dữ liệu tháng đang hoạt động', category: 'DATA' },
};

/** Đọc cấu hình vận hành từ SYSTEM_SETTINGS (thiếu thì dùng mặc định) và đồng bộ thời hạn Ra ca. */
export function getOperationSettings(db: Database): OperationSettings {
  const raw: Partial<Record<Field, unknown>> = {};
  for (const field of Object.keys(FIELD_KEYS) as Field[]) {
    const row = db.systemSettings.find((s) => s.key === FIELD_KEYS[field]);
    if (!row || row.value.trim() === '') continue;
    raw[field] = typeof DEFAULT_OPERATION_SETTINGS[field] === 'number' ? Number(row.value) : row.value.trim();
  }
  const settings = normalizeOperationSettings(raw);
  setCheckoutGraceMinutes(settings.checkoutMaxLateHours * 60);
  return settings;
}

/** Lưu các trường cấu hình thay đổi (upsert từng khóa) và trả về cấu hình chuẩn hóa mới. */
export async function saveOperationSettings(db: Database, patch: Partial<OperationSettings>, actorId: string): Promise<OperationSettings> {
  const current = getOperationSettings(db);
  const next = normalizeOperationSettings({ ...current, ...patch });
  for (const field of Object.keys(FIELD_KEYS) as Field[]) {
    if (patch[field] === undefined || next[field] === current[field]) continue;
    const key = FIELD_KEYS[field], value = String(next[field]), meta = FIELD_META[field];
    const existing = db.systemSettings.find((s) => s.key === key);
    if (existing) await db.systemSettings.update(existing.id, existing.version, { value }, actorId);
    else await db.systemSettings.insert({ key, value, label: meta.label, category: meta.category, value_type: typeof next[field] === 'number' ? 'NUMBER' : 'STRING', note: 'Cấu hình vận hành do Quản trị viên thiết lập' }, actorId);
  }
  return getOperationSettings(db);
}

export function describeOperationSettings(settings: OperationSettings) {
  return (Object.keys(FIELD_KEYS) as Field[]).map((field) => ({ field, key: FIELD_KEYS[field], value: settings[field], ...FIELD_META[field] }));
}
