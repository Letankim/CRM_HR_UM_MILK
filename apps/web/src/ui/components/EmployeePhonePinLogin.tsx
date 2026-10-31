'use client';

import { useState } from 'react';
import { Alert, Avatar, Button, Flex, Form, Input, Typography } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, LockOutlined, LoginOutlined, PhoneOutlined } from '@ant-design/icons';
import { PIN_REGEX } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { PinOtpInput } from './PinOtpInput';

const PHONE_REGEX = /^0\d{9}$/;

interface LookupResult {
  phone: string;
  maskedPhone: string;
  displayName: string;
  pinLength?: number;
  authKind?: 'PIN' | 'PASSWORD';
}

export interface EmployeePhonePinLoginProps {
  /** Thực hiện đăng nhập; ném ApiClientError khi thất bại để hiển thị lỗi tại ô nhập */
  onLogin: (phone: string, pin: string) => Promise<void>;
}

/** Chuẩn hóa số điện thoại về dạng 10 chữ số bắt đầu bằng 0 (chấp nhận người dùng gõ +84 / 84) */
function normalizePhoneInput(raw?: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) return `0${digits.slice(2)}`;
  return digits.slice(0, 10);
}

/**
 * Đăng nhập Cổng Nhân viên 2 bước: (1) nhập số điện thoại để tra cứu tài khoản,
 * (2) xác nhận đúng người (tên & SĐT đã che) rồi nhập mã PIN 6 chữ số.
 */
export function EmployeePhonePinLogin({ onLogin }: EmployeePhonePinLoginProps) {
  const [phoneForm] = Form.useForm<{ phone: string }>();
  const [pinForm] = Form.useForm<{ pin: string }>();
  const [account, setAccount] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup({ phone }: { phone: string }) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LookupResult>('/auth/employee/lookup', { phone });
      setAccount({ ...res, phone: res.phone || phone });
      pinForm.resetFields();
    } catch (e) {
      if (e instanceof ApiClientError) {
        const fieldErr = e.details.find((d) => d.field === 'phone' || d.field === 'identifier');
        if (fieldErr) phoneForm.setFields([{ name: 'phone', errors: [fieldErr.message] }]);
        else setError(e.message);
      } else {
        setError('Không kết nối được máy chủ, vui lòng thử lại');
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitPin({ pin }: { pin: string }) {
    if (!account || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onLogin(account.phone, pin);
    } catch (e) {
      pinForm.setFieldValue('pin', '');
      if (e instanceof ApiClientError) {
        const fieldErr = e.details.find((d) => d.field === 'secret' || d.field === 'pin');
        if (fieldErr) pinForm.setFields([{ name: 'pin', errors: [fieldErr.message] }]);
        else setError(e.message);
      } else {
        setError('Không kết nối được máy chủ, vui lòng thử lại');
      }
    } finally {
      setLoading(false);
    }
  }

  function backToPhone() {
    setAccount(null);
    setError(null);
    pinForm.resetFields();
  }

  return (
    <>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16, borderRadius: 4 }} />}

      {!account ? (
        <Form form={phoneForm} layout="vertical" requiredMark={false} onFinish={lookup} disabled={loading} size="large">
          <Form.Item
            name="phone"
            label="Số điện thoại"
            normalize={normalizePhoneInput}
            rules={[
              { required: true, message: 'Vui lòng nhập số điện thoại' },
              { pattern: PHONE_REGEX, message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0' },
            ]}
          >
            <Input prefix={<PhoneOutlined />} inputMode="numeric" autoComplete="username" placeholder="Ví dụ: 0901000001" autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<ArrowRightOutlined />} iconPosition="end" block loading={loading} style={{ marginTop: 4 }}>
            Tiếp tục
          </Button>
        </Form>
      ) : (
        <Form form={pinForm} layout="vertical" requiredMark={false} onFinish={submitPin} disabled={loading} size="large">
          <Flex align="center" gap={10} style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC', padding: '10px 12px', marginBottom: 16 }}>
            <Avatar size={36} style={{ background: '#EFF6FF', color: '#2563EB', border: '1px solid #93C5FD', fontWeight: 700 }}>
              {(account.displayName || 'N').charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
              <Typography.Text strong style={{ display: 'block', color: '#0F172A' }} ellipsis>{account.displayName}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{account.maskedPhone}</Typography.Text>
            </div>
            <Button type="link" size="small" icon={<ArrowLeftOutlined />} onClick={backToPhone} disabled={loading} style={{ paddingInline: 0 }}>
              Đổi số điện thoại
            </Button>
          </Flex>
          {account.authKind === 'PASSWORD' ? (
            <Form.Item
              name="pin"
              label="Mật khẩu đăng nhập"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu đăng nhập' }]}
            >
              <Input.Password prefix={<LockOutlined />} autoFocus autoComplete="current-password" placeholder="Nhập mật khẩu tài khoản" />
            </Form.Item>
          ) : (
            <Form.Item
              name="pin"
              label="Mã PIN đăng nhập (6 chữ số)"
              rules={[
                { required: true, message: 'Vui lòng nhập mã PIN đăng nhập' },
                { pattern: PIN_REGEX, message: 'Mã PIN đăng nhập phải gồm đúng 6 chữ số' },
              ]}
            >
              <PinOtpInput autoFocus onComplete={(pin) => void submitPin({ pin })} />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" icon={<LoginOutlined />} block loading={loading} style={{ marginTop: 4 }}>
            Đăng nhập
          </Button>
        </Form>
      )}
    </>
  );
}
