'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Space } from 'antd';
import type { FormInstance } from 'antd';
import type { Rule } from 'antd/es/form';
import { KeyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { isEmployeeRole, PIN_REGEX, type Role } from '@umbm/shared';
import { generateAccountSecret } from '@/lib/auto-generate';

export interface AccountSecretFieldProps {
  form: FormInstance;
  open: boolean;
  editing: boolean;
  role: Role;
}

/**
 * Ô Mật khẩu / Mã PIN đăng nhập trong biểu mẫu Tài khoản.
 * Nhân viên (Thử việc / Chính thức) bắt buộc mã PIN đúng 6 chữ số; tài khoản được cấp
 * hoặc đặt lại mã sẽ bị bắt buộc đổi mã ở lần đăng nhập kế tiếp.
 */
export function AccountSecretField({ form, open, editing, role }: AccountSecretFieldProps) {
  const [showSecret, setShowSecret] = useState(!editing);
  const isEmployee = isEmployeeRole(role);
  const noun = isEmployee ? 'mã PIN' : 'mật khẩu';

  useEffect(() => {
    if (open) setShowSecret(!editing);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    const cur = String(form.getFieldValue('secret') ?? '');
    if (!editing && !cur) {
      form.setFieldsValue({ secret: generateAccountSecret(role) });
      return;
    }
    if (cur && ((isEmployee && !PIN_REGEX.test(cur)) || (!isEmployee && PIN_REGEX.test(cur)))) {
      form.setFieldsValue({ secret: generateAccountSecret(role) });
      void form.validateFields(['secret']).catch(() => undefined);
    }
  }, [open, editing, role, isEmployee, form]);

  const rules: Rule[] = [
    ...(editing ? [] : [{ required: true, message: isEmployee ? 'Vui lòng nhập mã PIN đăng nhập' : 'Vui lòng nhập mật khẩu đăng nhập' }]),
    isEmployee
      ? { pattern: PIN_REGEX, message: 'Mã PIN đăng nhập phải gồm đúng 6 chữ số' }
      : { min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' },
  ];

  const label = editing
    ? isEmployee ? 'Đặt lại mã PIN đăng nhập (6 chữ số)' : 'Đặt lại mật khẩu'
    : isEmployee ? 'Mã PIN đăng nhập (6 chữ số)' : 'Mật khẩu đăng nhập';

  return (
    <>
      <Form.Item label={label} required={!editing}>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item
            name="secret"
            noStyle
            rules={rules}
            dependencies={['role']}
            normalize={(v) => (isEmployee && typeof v === 'string' ? v.replace(/\D/g, '').slice(0, 6) : v)}
          >
            <Input.Password
              prefix={<KeyOutlined />}
              inputMode={isEmployee ? 'numeric' : 'text'}
              maxLength={isEmployee ? 6 : undefined}
              visibilityToggle={{ visible: showSecret, onVisibleChange: setShowSecret }}
              placeholder={editing ? `Để trống nếu giữ nguyên ${noun} hiện tại` : `Nhập ${noun} hoặc nhấn nút Tự sinh bên cạnh`}
            />
          </Form.Item>
          <Button
            icon={<ThunderboltOutlined />}
            onClick={() => {
              setShowSecret(true);
              form.setFieldsValue({ secret: generateAccountSecret(role) });
              void form.validateFields(['secret']).catch(() => undefined);
            }}
          >
            {isEmployee ? 'Tự sinh PIN' : 'Tự sinh MK'}
          </Button>
        </Space.Compact>
      </Form.Item>
      <Alert
        type="info"
        showIcon
        style={{ borderRadius: 4 }}
        message={
          editing
            ? `Khi đặt lại ${noun}, người dùng sẽ bắt buộc đổi ${noun} mới ngay ở lần đăng nhập tiếp theo`
            : `Người dùng sẽ bắt buộc đổi ${noun} ngay ở lần đăng nhập đầu tiên`
        }
      />
    </>
  );
}
