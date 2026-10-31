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
 * Đồng bộ giá trị ô Mật khẩu / Mã PIN khi chuyển đổi Vai trò và xóa sạch lỗi cảnh báo cũ.
 */
export function syncAccountSecretForRole(form: FormInstance, nextRole: Role, editing: boolean): void {
  const cur = String(form.getFieldValue('secret') ?? '');
  const nextIsEmp = isEmployeeRole(nextRole);
  if (editing && !cur) {
    form.setFields([{ name: 'secret', value: '', errors: [] }]);
    return;
  }
  const needRegen = !cur || (nextIsEmp ? !PIN_REGEX.test(cur) : PIN_REGEX.test(cur) || cur.length < 6);
  const nextVal = needRegen ? generateAccountSecret(nextRole) : cur;
  form.setFields([{ name: 'secret', value: nextVal, errors: [] }]);
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
    syncAccountSecretForRole(form, role, editing);
  }, [open, editing, role, form]);

  const rules: Rule[] = [
    {
      validator: async (_rule, value) => {
        const liveRole = (form.getFieldValue('role') as Role | undefined) ?? role;
        const liveIsEmp = isEmployeeRole(liveRole);
        const str = String(value ?? '');
        if (!str) {
          if (editing) return;
          throw new Error(liveIsEmp ? 'Vui lòng nhập mã PIN đăng nhập' : 'Vui lòng nhập mật khẩu đăng nhập');
        }
        if (liveIsEmp && !PIN_REGEX.test(str)) {
          throw new Error('Mã PIN đăng nhập phải gồm đúng 6 chữ số');
        }
        if (!liveIsEmp && str.length < 6) {
          throw new Error('Mật khẩu tối thiểu 6 ký tự');
        }
      },
    },
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
            normalize={(v) => {
              const liveRole = (form.getFieldValue('role') as Role | undefined) ?? role;
              return isEmployeeRole(liveRole) && typeof v === 'string' ? v.replace(/\D/g, '').slice(0, 6) : v;
            }}
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
              const liveRole = (form.getFieldValue('role') as Role | undefined) ?? role;
              form.setFields([{ name: 'secret', value: generateAccountSecret(liveRole), errors: [] }]);
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
