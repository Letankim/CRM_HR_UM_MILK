'use client';

import type { CSSProperties } from 'react';
import { DatePicker, Select, TimePicker } from 'antd';
import dayjs from 'dayjs';

export interface DateStringPickerProps {
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minDate?: string;
}

/**
 * DatePicker hiển thị chuẩn DD/MM/YYYY cho người dùng Việt Nam,
 * nhưng lưu giá trị chuỗi YYYY-MM-DD tương thích trực tiếp với Form & API.
 */
export function DateStringPicker({ value, onChange, placeholder = 'Chọn ngày (DD/MM/YYYY)', disabled, minDate }: DateStringPickerProps) {
  const parsed = value ? dayjs(value.slice(0, 10), 'YYYY-MM-DD') : null;
  return (
    <DatePicker
      style={{ width: '100%' }}
      format="DD/MM/YYYY"
      placeholder={placeholder}
      disabled={disabled}
      disabledDate={minDate ? (d) => d.isBefore(dayjs(minDate.slice(0, 10), 'YYYY-MM-DD'), 'day') : undefined}
      value={parsed && parsed.isValid() ? parsed : null}
      onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : '')}
    />
  );
}

/**
 * TimePicker chọn giờ:phút (HH:mm) từ danh sách cuộn, lưu chuỗi HH:mm cho Form & API.
 */
export function TimeStringPicker({
  value,
  onChange,
  placeholder = 'Chọn giờ (HH:mm)',
  disabled,
}: {
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const parsed = value && /^\d{2}:\d{2}/.test(value) ? dayjs(`2000-01-01T${value.slice(0, 5)}:00`) : null;
  return (
    <TimePicker
      style={{ width: '100%' }}
      format="HH:mm"
      needConfirm={false}
      placeholder={placeholder}
      disabled={disabled}
      value={parsed && parsed.isValid() ? parsed : null}
      onChange={(t) => onChange?.(t ? t.format('HH:mm') : '')}
    />
  );
}

export const TIME_30M_OPTIONS = Array.from({ length: 36 }, (_, idx) => {
  const totalMin = (6 * 60) + idx * 30;
  const h = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const m = String(totalMin % 60).padStart(2, '0');
  const endMin = totalMin + 30;
  const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
  const em = String(endMin % 60).padStart(2, '0');
  const t = `${h}:${m}`;
  return {
    value: t,
    label: `${t}`,
    slotLabel: `${t} – ${eh}:${em} (30p)`,
  };
});

export function TimeSelect({
  value,
  onChange,
  slotRange = false,
  placeholder = 'Chọn giờ',
  minTime,
  size,
  style,
}: {
  value?: string;
  onChange?: (val: string) => void;
  slotRange?: boolean;
  placeholder?: string;
  minTime?: string;
  size?: 'small' | 'middle' | 'large';
  style?: CSSProperties;
}) {
  const baseOpts = TIME_30M_OPTIONS.map((o) => ({
    value: o.value,
    label: slotRange ? o.slotLabel : o.label,
    disabled: Boolean(minTime && o.value < minTime),
  }));
  const options = value && !baseOpts.some((o) => o.value === value) ? [{ value, label: value, disabled: Boolean(minTime && value < minTime) }, ...baseOpts] : baseOpts;
  return (
    <Select
      showSearch
      allowClear
      size={size}
      style={{ width: '100%', ...style }}
      placeholder={placeholder}
      value={value || undefined}
      onChange={(val) => onChange?.(val ?? '')}
      options={options}
    />
  );
}
