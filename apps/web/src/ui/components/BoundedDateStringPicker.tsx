'use client';

import { DatePicker } from 'antd';
import dayjs from 'dayjs';

export interface BoundedDateStringPickerProps {
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
}

/** DatePicker DD/MM/YYYY lưu chuỗi YYYY-MM-DD, giới hạn trong khoảng `minDate..maxDate` (bao gồm 2 đầu). */
export function BoundedDateStringPicker({ value, onChange, placeholder = 'Chọn ngày (DD/MM/YYYY)', disabled, minDate, maxDate }: BoundedDateStringPickerProps) {
  const parsed = value ? dayjs(value.slice(0, 10), 'YYYY-MM-DD') : null;
  const min = minDate ? dayjs(minDate.slice(0, 10), 'YYYY-MM-DD') : null;
  const max = maxDate ? dayjs(maxDate.slice(0, 10), 'YYYY-MM-DD') : null;
  return (
    <DatePicker
      style={{ width: '100%' }}
      format="DD/MM/YYYY"
      placeholder={placeholder}
      disabled={disabled}
      defaultPickerValue={min ?? undefined}
      disabledDate={(d) => Boolean((min && d.isBefore(min, 'day')) || (max && d.isAfter(max, 'day')))}
      value={parsed && parsed.isValid() ? parsed : null}
      onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : '')}
    />
  );
}
