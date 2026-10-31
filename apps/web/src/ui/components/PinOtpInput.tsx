'use client';

import { Input } from 'antd';
import type { GetRef } from 'antd';
import { useEffect, useRef } from 'react';

type OtpRef = GetRef<typeof Input.OTP>;

export interface PinOtpInputProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Gọi khi người dùng nhập đủ 6 chữ số (dùng để tự gửi biểu mẫu) */
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
  status?: '' | 'error' | 'warning';
}

export const PIN_LENGTH = 6;

/**
 * Ô nhập mã PIN 6 chữ số (ẩn ký tự, chỉ nhận số) dùng chung cho
 * Đăng nhập Cổng Nhân viên, Đổi mã PIN bắt buộc và Hồ sơ cá nhân.
 */
export function PinOtpInput({ value, onChange, onComplete, autoFocus, disabled, size = 'large', status }: PinOtpInputProps) {
  const ref = useRef<OtpRef>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <Input.OTP
      ref={ref}
      length={PIN_LENGTH}
      mask
      type="tel"
      size={size}
      status={status}
      disabled={disabled}
      value={value ?? ''}
      formatter={(str) => str.replace(/\D/g, '')}
      onInput={(cells) => {
        // onInput phát sinh trên mọi lần gõ/xóa để giá trị biểu mẫu luôn khớp ô nhập
        const clean = cells.join('').replace(/\D/g, '').slice(0, PIN_LENGTH);
        onChange?.(clean);
      }}
      onChange={(full) => {
        const clean = full.replace(/\D/g, '').slice(0, PIN_LENGTH);
        onChange?.(clean);
        if (clean.length === PIN_LENGTH) onComplete?.(clean);
      }}
    />
  );
}
