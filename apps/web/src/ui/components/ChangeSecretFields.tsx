'use client';

import { Form, Input } from 'antd';
import type { Rule } from 'antd/es/form';
import { KeyOutlined, LockOutlined } from '@ant-design/icons';
import { PIN_REGEX } from '@umbm/shared';
import { PinOtpInput } from './PinOtpInput';

export interface ChangeSecretFormValues {
  current_secret: string;
  new_secret: string;
  confirm_secret: string;
}

export interface ChangeSecretFieldsProps {
  /** Nhân viên (Thử việc / Chính thức) dùng mã PIN 6 chữ số; tài khoản quản trị dùng mật khẩu */
  isEmployee: boolean;
  /** Mã PIN / mật khẩu hiện tại là mã do Nhân sự cấp (lần đầu đăng nhập hoặc vừa đặt lại) */
  issuedSecret?: boolean;
  autoFocus?: boolean;
}

/**
 * Bộ 3 ô nhập Đổi mã PIN / mật khẩu (hiện tại, mới, xác nhận) dùng chung cho
 * hộp thoại Bắt buộc đổi mã PIN và tab Bảo mật trong Hồ sơ cá nhân.
 */
export function ChangeSecretFields({ isEmployee, issuedSecret, autoFocus }: ChangeSecretFieldsProps) {
  const noun = isEmployee ? 'mã PIN' : 'mật khẩu';
  const Noun = isEmployee ? 'Mã PIN' : 'Mật khẩu';

  const newRules: Rule[] = [
    { required: true, message: `Vui lòng nhập ${noun} mới` },
    isEmployee
      ? { pattern: PIN_REGEX, message: 'Mã PIN mới phải gồm đúng 6 chữ số' }
      : { min: 6, message: 'Mật khẩu mới tối thiểu 6 ký tự' },
    ({ getFieldValue }) => ({
      validator(_, value) {
        if (!value || value !== getFieldValue('current_secret')) return Promise.resolve();
        return Promise.reject(new Error(`${Noun} mới phải khác ${noun} hiện tại`));
      },
    }),
  ];

  const confirmRules: Rule[] = [
    { required: true, message: `Vui lòng nhập lại ${noun} mới` },
    ({ getFieldValue }) => ({
      validator(_, value) {
        if (!value || getFieldValue('new_secret') === value) return Promise.resolve();
        return Promise.reject(new Error(`${Noun} xác nhận không khớp với ${noun} mới`));
      },
    }),
  ];

  const currentLabel = issuedSecret ? `${Noun} hiện tại (do Nhân sự cấp)` : `${Noun} hiện tại`;
  const currentRules: Rule[] = [
    { required: true, message: `Vui lòng nhập ${noun} hiện tại` },
    ...(isEmployee ? [{ pattern: PIN_REGEX, message: 'Mã PIN hiện tại phải gồm đúng 6 chữ số' }] : []),
  ];

  if (isEmployee) {
    return (
      <>
        <Form.Item name="current_secret" label={currentLabel} rules={currentRules} style={{ marginBottom: 14 }}>
          <PinOtpInput autoFocus={autoFocus} />
        </Form.Item>
        <Form.Item name="new_secret" label="Mã PIN mới (6 chữ số)" rules={newRules} dependencies={['current_secret']} style={{ marginBottom: 14 }}>
          <PinOtpInput />
        </Form.Item>
        <Form.Item name="confirm_secret" label="Nhập lại mã PIN mới" rules={confirmRules} dependencies={['new_secret']} style={{ marginBottom: 4 }}>
          <PinOtpInput />
        </Form.Item>
      </>
    );
  }

  return (
    <>
      <Form.Item name="current_secret" label={currentLabel} rules={currentRules} style={{ marginBottom: 14 }}>
        <Input.Password size="large" prefix={<LockOutlined />} autoFocus={autoFocus} autoComplete="current-password" placeholder="Nhập mật khẩu đang sử dụng" />
      </Form.Item>
      <Form.Item name="new_secret" label="Mật khẩu mới" rules={newRules} dependencies={['current_secret']} style={{ marginBottom: 14 }}>
        <Input.Password size="large" prefix={<KeyOutlined />} autoComplete="new-password" placeholder="Tối thiểu 6 ký tự" />
      </Form.Item>
      <Form.Item name="confirm_secret" label="Nhập lại mật khẩu mới" rules={confirmRules} dependencies={['new_secret']} style={{ marginBottom: 4 }}>
        <Input.Password size="large" prefix={<KeyOutlined />} autoComplete="new-password" placeholder="Nhập lại chính xác mật khẩu mới" />
      </Form.Item>
    </>
  );
}
