'use client';

import { Alert, App, Button, Col, Form, Input, Modal, Row, Select, Space, Tabs } from 'antd';
import { CloseOutlined, KeyOutlined, SafetyCertificateOutlined, SaveOutlined, SettingOutlined, TeamOutlined, ThunderboltOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ROLE_OPTIONS, getAllowedExtraPermissionsForRole, type Permission, type Role } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { generateAccountSecret, generateUsername } from '@/lib/auto-generate';
import type { AccountRowItem } from './AccountDetailDrawer';
import { AccountPermissionsFormSection } from './AccountPermissionsTab';
import type { EmployeeRowItem } from './employee-table-columns';

interface AccountFormValues {
  username: string;
  display_name: string;
  phone_number?: string;
  email?: string;
  role: Role;
  secret?: string;
  employee_id?: string;
  branch_scope?: string;
  extra_permissions?: Permission[];
  reason?: string;
}

export interface AccountCreateModalProps {
  open: boolean;
  editing?: AccountRowItem | null;
  onClose: () => void;
}

export function AccountCreateModal({ open, editing, onClose }: AccountCreateModalProps) {
  const [form] = Form.useForm<AccountFormValues>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('login');
  const [showSecret, setShowSecret] = useState(true);
  const currentRole: Role = Form.useWatch('role', form) ?? editing?.role ?? 'THU_VIEC';

  const employeesQuery = useQuery({ queryKey: ['employees', 'select-for-account'], queryFn: () => api.list<EmployeeRowItem>('/admin/employees?per_page=100'), enabled: open });
  const branchesQuery = useQuery({ queryKey: ['branches', 'select-for-account'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'), enabled: open });

  const employeeOptions = useMemo(
    () =>
      (employeesQuery.data?.data ?? []).map((e) => ({
        value: e.employeeCode,
        label: `${e.employeeCode} — ${e.fullName} (${e.positionTitle} · ${e.branchName})${e.username ? ` [Đang gắn @${e.username}]` : ' [Chưa gắn TK]'}`,
        raw: e,
      })),
    [employeesQuery.data],
  );

  const branchOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Toàn hệ thống (Tất cả chi nhánh)' },
      ...(branchesQuery.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })),
    ],
    [branchesQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab('login');
    if (editing) {
      setShowSecret(false);
      const initialScope =
        editing.branchScope === 'ALL'
          ? editing.primaryBranchId && ['THU_VIEC', 'CHINH_THUC', 'STORE'].includes(editing.role)
            ? editing.primaryBranchId
            : 'ALL'
          : editing.branchScope[0] ?? editing.primaryBranchId ?? 'ALL';
      form.setFieldsValue({
        username: editing.username, display_name: editing.displayName, phone_number: editing.phone,
        email: editing.email ?? '', role: editing.role, employee_id: editing.employeeId ?? undefined,
        branch_scope: initialScope, secret: '', extra_permissions: editing.extraPermissions ?? [], reason: '',
      });
    } else {
      setShowSecret(true);
      form.resetFields();
      form.setFieldsValue({ role: 'THU_VIEC', branch_scope: 'ALL', secret: generateAccountSecret('THU_VIEC'), extra_permissions: [], reason: '' });
    }
  }, [open, editing, form]);

  const saveMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      editing
        ? api.put(`/admin/accounts/${editing.id}`, {
            ...values, employee_id: values.employee_id ?? '', version: editing.version,
            secret: values.secret || undefined, extra_permissions: values.extra_permissions ?? [],
          })
        : api.post('/admin/accounts', { ...values, extra_permissions: values.extra_permissions ?? [] }),
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật tài khoản, phân quyền và đồng bộ hồ sơ thành công' : 'Đã tạo tài khoản mới (Trạng thái: Chờ Quản trị viên kích hoạt)');
      ['accounts', 'account-audit-history', 'employees', 'branches', 'schedules', 'me'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) form.setFields(err.details.map((d) => ({ name: d.field as keyof AccountFormValues, errors: [d.message] })));
        message.error(err.message);
      } else {
        message.error('Không thể lưu tài khoản, vui lòng thử lại');
      }
    },
  });

  return (
    <Modal
      title={editing ? `Chỉnh sửa Tài khoản & Phân quyền — @${editing.username}` : 'Thêm Tài khoản Hệ thống Mới'}
      open={open}
      onOk={async () => saveMutation.mutate(await form.validateFields())}
      onCancel={onClose}
      okText={editing ? 'Lưu cập nhật' : 'Tạo tài khoản'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <UserAddOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={saveMutation.isPending}
      width="72vw"
      forceRender
    >
      <Form<AccountFormValues> form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'login',
              forceRender: true,
              label: <span><SafetyCertificateOutlined /> Thông tin Đăng nhập &amp; Vai trò</span>,
              children: (
                <>
                  <Row gutter={12}>
                    <Col span={12}><Form.Item name="display_name" label="Họ và tên" rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}><Input placeholder="Ví dụ: Nguyễn Văn An" /></Form.Item></Col>
                    <Col span={12}>
                      <Form.Item label="Tên đăng nhập" required>
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name="username" noStyle rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}>
                            <Input prefix={<UserOutlined />} disabled={!!editing} placeholder="Ví dụ: nv.an" />
                          </Form.Item>
                          {!editing && <Button icon={<ThunderboltOutlined />} onClick={() => form.setFieldsValue({ username: generateUsername(form.getFieldValue('display_name'), form.getFieldValue('employee_id'), form.getFieldValue('username')) })}>Tự sinh</Button>}
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="phone_number" label="Số điện thoại"><Input placeholder="Ví dụ: 0901000001" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="email" label="Email"><Input placeholder="Ví dụ: nv.an@umbomilk.vn" /></Form.Item></Col>
                    <Col span={8}>
                      <Form.Item name="role" label="Vai trò chính" rules={[{ required: true }]}>
                        <Select
                          options={ROLE_OPTIONS}
                          onChange={(nextRole: Role) => {
                            const allowed = new Set(getAllowedExtraPermissionsForRole(nextRole));
                            const cur: Permission[] = form.getFieldValue('extra_permissions') ?? [];
                            form.setFieldValue('extra_permissions', cur.filter((p) => allowed.has(p)));
                          }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item label={editing ? 'Mật khẩu mới (Được băm bảo mật Argon2id)' : 'Mật khẩu / Mã PIN (Được băm bảo mật Argon2id)'} required={!editing}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item name="secret" noStyle rules={editing ? [] : [{ required: true, min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' }]}>
                        <Input.Password
                          prefix={<KeyOutlined />}
                          visibilityToggle={{ visible: showSecret, onVisibleChange: setShowSecret }}
                          placeholder={editing ? 'Để trống nếu giữ nguyên mật khẩu hiện tại' : 'Nhập mật khẩu hoặc nhấn nút Tự sinh bên cạnh'}
                        />
                      </Form.Item>
                      <Button icon={<ThunderboltOutlined />} onClick={() => { setShowSecret(true); form.setFieldsValue({ secret: generateAccountSecret(form.getFieldValue('role')) }); }}>Tự sinh MK</Button>
                    </Space.Compact>
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'permissions',
              forceRender: true,
              label: <span><SettingOutlined /> Phân quyền &amp; Permission bổ sung</span>,
              children: <AccountPermissionsFormSection role={currentRole} />,
            },
            {
              key: 'link',
              forceRender: true,
              label: <span><TeamOutlined /> Liên kết Hồ sơ Nhân sự &amp; Chi nhánh</span>,
              children: (
                <>
                  <Form.Item name="employee_id" label="Nhân sự liên kết">
                    <Select
                      showSearch allowClear optionFilterProp="label" loading={employeesQuery.isLoading} options={employeeOptions}
                      placeholder="Chọn hồ sơ nhân sự để gắn với tài khoản này (hoặc bỏ trống nếu là TK Quản trị nội bộ)"
                      onChange={(val) => {
                        const found = employeeOptions.find((o) => o.value === val)?.raw;
                        if (found) {
                          if (!form.getFieldValue('display_name')) form.setFieldValue('display_name', found.fullName);
                          if (!form.getFieldValue('phone_number')) form.setFieldValue('phone_number', found.phone);
                          if (found.branchId) form.setFieldValue('branch_scope', found.branchId);
                          if (!editing && !form.getFieldValue('username')) form.setFieldValue('username', `nv.${found.employeeCode.toLowerCase()}`);
                        }
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="branch_scope" label="Phạm vi chi nhánh"><Select options={branchOptions} /></Form.Item>
                  <Alert type="info" showIcon message="Khi chọn một Hồ sơ Nhân sự ở trên, hệ thống sẽ tự động liên kết tài khoản với hồ sơ nhân sự để đồng bộ lịch làm việc, điểm danh và phiếu lương." />
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
