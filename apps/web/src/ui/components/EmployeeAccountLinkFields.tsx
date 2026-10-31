'use client';

import { Alert, Button, Col, Form, Input, Radio, Row, Select, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { KeyOutlined, LinkOutlined, ThunderboltOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { generatePin6, generateUsername } from '@/lib/auto-generate';
import { StatusTag } from '../StatusTag';
import type { AccountRowItem } from './AccountDetailDrawer';
import type { EmployeeRowItem } from './employee-table-columns';

export type EmployeeAccountMode = 'AUTO_CREATE' | 'LINK_EXISTING' | 'NONE';

/** Mã PIN đăng nhập của nhân viên bắt buộc đúng 6 chữ số */
const PIN_RULE = { pattern: /^\d{6}$/, message: 'Mã PIN đăng nhập phải gồm đúng 6 chữ số' };

export interface EmployeeAccountLinkFieldsProps {
  form: FormInstance;
  editing?: EmployeeRowItem | null;
}

/**
 * Tab cấu hình & liên kết Tài khoản Người dùng ngay trong Hồ sơ Nhân sự.
 * Hỗ trợ: Tự sinh tài khoản mới (kèm nút Tự sinh Username & Mã PIN điền thẳng vào ô nhập) hoặc Liên kết tài khoản có sẵn.
 */
export function EmployeeAccountLinkFields({ form, editing }: EmployeeAccountLinkFieldsProps) {
  const mode = (Form.useWatch('account_mode', form) as EmployeeAccountMode | undefined) ?? 'AUTO_CREATE';
  const fullName = Form.useWatch('full_name', form) as string | undefined;
  const empCode = Form.useWatch('employee_code', form) as string | undefined;
  const [showPin, setShowPin] = useState(true);
  const canReadAccounts = useCan()('account.read');

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'select-for-employee'],
    queryFn: () => api.list<AccountRowItem>('/admin/accounts?per_page=100'),
    enabled: canReadAccounts,
  });

  const accountOptions = useMemo(() => {
    const rows = accountsQuery.data?.data ?? [];
    const mapped = rows.map((u) => {
      const linkedTag = u.employeeId ? `Đang gắn ${u.employeeId}` : 'Chưa gắn hồ sơ NV';
      return {
        value: u.id,
        label: `@${u.username} — ${u.displayName} (${u.roleLabel}) · ${linkedTag}`,
      };
    });
    if (editing?.userId && editing.username && !mapped.some((m) => m.value === editing.userId)) {
      mapped.unshift({
        value: editing.userId,
        label: `@${editing.username} — ${editing.userDisplayName || editing.fullName} (${editing.userRoleLabel || 'Tài khoản liên kết'}) · Đang gắn ${editing.employeeCode}`,
      });
    }
    return mapped;
  }, [accountsQuery.data, editing]);

  const handleGenUsername = () => {
    const cur = form.getFieldValue('username') as string | undefined;
    form.setFieldsValue({ username: generateUsername(fullName, empCode, cur) });
  };

  const handleGenPin = () => {
    setShowPin(true);
    form.setFieldsValue({ initial_pin: generatePin6() });
  };

  return (
    <div>
      {editing?.username && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space size={8} wrap>
              <span>Tài khoản đang liên kết:</span>
              <Tag color="blue" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>
                <UserOutlined /> @{editing.username}
              </Tag>
              {editing.accountStatus && <StatusTag value={editing.accountStatus} />}
              {editing.userRoleLabel && <span style={{ color: '#475569' }}>({editing.userRoleLabel})</span>}
            </Space>
          }
        />
      )}

      <Form.Item name="account_mode" label="Liên kết tài khoản">
        <Radio.Group optionType="button" buttonStyle="solid">
          {!editing?.userId && (
            <Radio.Button value="AUTO_CREATE">
              <UserAddOutlined /> Tự động tạo tài khoản mới
            </Radio.Button>
          )}
          <Radio.Button value="LINK_EXISTING">
            <LinkOutlined /> Liên kết tài khoản có sẵn
          </Radio.Button>
          <Radio.Button value="NONE">Chưa liên kết tài khoản</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {mode === 'AUTO_CREATE' && !editing?.userId && (
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: 12, background: '#F8FAFC' }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Tên đăng nhập">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="username" noStyle>
                    <Input prefix={<UserOutlined />} placeholder="Để trống tự sinh theo mã NV" />
                  </Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={handleGenUsername}>
                    Tự sinh
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Mã PIN đăng nhập (6 chữ số)" required>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="initial_pin" noStyle rules={[{ required: true, message: 'Vui lòng nhập mã PIN đăng nhập' }, PIN_RULE]}>
                    <Input.Password
                      prefix={<KeyOutlined />}
                      inputMode="numeric"
                      maxLength={6}
                      visibilityToggle={{ visible: showPin, onVisibleChange: setShowPin }}
                      placeholder="Nhập 6 chữ số"
                    />
                  </Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={handleGenPin}>
                    Tự sinh PIN
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          <Alert type="info" showIcon style={{ borderRadius: 4 }} message="Nhân viên sẽ bắt buộc đổi mã PIN ngay ở lần đăng nhập đầu tiên" />
        </div>
      )}

      {mode === 'LINK_EXISTING' && (
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: 12, background: '#F8FAFC' }}>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item
                name="link_user_id"
                label="Tài khoản liên kết"
                rules={[{ required: true, message: 'Vui lòng chọn tài khoản để liên kết' }]}
              >
                <Select
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  loading={accountsQuery.isLoading}
                  options={accountOptions}
                  placeholder="Tìm theo @username, họ tên hoặc vai trò..."
                />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item label="Đặt lại mã PIN (6 chữ số)">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="initial_pin" noStyle rules={[PIN_RULE]}>
                    <Input.Password
                      prefix={<KeyOutlined />}
                      inputMode="numeric"
                      maxLength={6}
                      visibilityToggle={{ visible: showPin, onVisibleChange: setShowPin }}
                      placeholder="Để trống nếu giữ nguyên"
                    />
                  </Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={handleGenPin}>
                    Tự sinh PIN
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
}
