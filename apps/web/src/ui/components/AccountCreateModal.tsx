'use client';

import { App, Button, Col, Form, Input, Modal, Row, Select, Space, Tabs } from 'antd';
import { CloseOutlined, SafetyCertificateOutlined, SaveOutlined, SettingOutlined, TeamOutlined, ThunderboltOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLE_OPTIONS, getAllowedExtraPermissionsForRole, isEmployeeRole, type Permission, type Role } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { generateAccountSecret, generateUsername } from '@/lib/auto-generate';
import { applyEmployeeDiffsToAccountForm, computeEmployeeToAccountDiffs } from '@/lib/linked-entity-sync';
import { useLinkedEntityDetail } from '../hooks/useLinkedEntityDetail';
import type { AccountRowItem } from './AccountDetailDrawer';
import { AccountPermissionsFormSection } from './AccountPermissionsTab';
import { AccountSecretField, syncAccountSecretForRole } from './AccountSecretField';
import type { EmployeeRowItem } from './employee-table-columns';
import { LinkedEntitySyncBanner, promptLinkedEntitySyncModal } from './LinkedEntitySyncBanner';

interface AccountFormValues {
  username: string; display_name: string; phone_number?: string; email?: string; role: Role;
  secret?: string; employee_id?: string; branch_scope?: string; extra_permissions?: Permission[]; reason?: string;
}

export interface AccountCreateModalProps {
  open: boolean;
  editing?: AccountRowItem | null;
  onClose: () => void;
}

export function AccountCreateModal({ open, editing, onClose }: AccountCreateModalProps) {
  const [form] = Form.useForm<AccountFormValues>();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('login');

  const watchedAll = Form.useWatch([], form);
  const currentRole: Role = watchedAll?.role ?? editing?.role ?? 'THU_VIEC';
  const watchedEmpId = watchedAll?.employee_id;
  const isEmpRole = isEmployeeRole(currentRole);

  const employeesQuery = useQuery({ queryKey: ['employees', 'select-for-account'], queryFn: () => api.list<EmployeeRowItem>('/admin/employees?per_page=200'), enabled: open });
  const branchesQuery = useQuery({ queryKey: ['branches', 'select-for-account'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'), enabled: open });

  const matchEmp = useCallback((e: EmployeeRowItem, key: string) => e.employeeCode === key || e.id === key, []);
  const { entity: fetchedEmp, loading: fetchingEmp, fetchFresh } = useLinkedEntityDetail<EmployeeRowItem>({
    enabled: open,
    selectedKey: watchedEmpId,
    endpointPrefix: '/admin/employees',
    matchItem: matchEmp,
    fallbackList: employeesQuery.data?.data ?? [],
  });

  const employeeOptions = useMemo(() => {
    const rows = [...(employeesQuery.data?.data ?? [])].sort((a, b) => Number(Boolean(a.username)) - Number(Boolean(b.username)));
    return rows.map((e) => ({
      value: e.employeeCode,
      label: `${e.employeeCode} — ${e.fullName} (${e.positionTitle} · ${e.branchName})${e.username ? ` · Đang gắn @${e.username}` : ' · Chưa gắn TK'}`,
    }));
  }, [employeesQuery.data]);

  const branchOptions = useMemo(
    () => [{ value: 'ALL', label: 'Toàn hệ thống (Tất cả chi nhánh)' }, ...(branchesQuery.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))],
    [branchesQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab('login');
    if (editing) {
      const initialScope = editing.branchScope === 'ALL'
        ? editing.primaryBranchId && ['THU_VIEC', 'CHINH_THUC', 'STORE'].includes(editing.role) ? editing.primaryBranchId : 'ALL'
        : editing.branchScope[0] ?? editing.primaryBranchId ?? 'ALL';
      form.setFieldsValue({
        username: editing.username, display_name: editing.displayName, phone_number: editing.phone,
        email: editing.email ?? '', role: editing.role, employee_id: editing.employeeId ?? undefined,
        branch_scope: initialScope, secret: '', extra_permissions: editing.extraPermissions ?? [], reason: '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ role: 'THU_VIEC', branch_scope: 'ALL', secret: generateAccountSecret('THU_VIEC'), extra_permissions: [], reason: '' });
    }
  }, [open, editing, form]);

  const handleSelectLinkedEmployee = async (nextEmpCode?: string) => {
    const emp = await fetchFresh(nextEmpCode);
    if (!emp) return;
    const diffs = computeEmployeeToAccountDiffs(emp, form.getFieldsValue(true), branchOptions, !!editing);
    const warningText = emp.username && emp.username !== editing?.username
      ? `Hồ sơ ${emp.employeeCode} hiện đang gắn với tài khoản @${emp.username}. Nếu lưu, liên kết hồ sơ nhân sự này sẽ chuyển sang tài khoản hiện tại.`
      : null;

    if (diffs.length > 0) {
      promptLinkedEntitySyncModal({
        modal, title: `Đối chiếu thông tin từ hồ sơ ${emp.employeeCode} — ${emp.fullName}`,
        description: `Hồ sơ nhân sự ${emp.employeeCode} (${emp.fullName}) có ${diffs.length} thông tin chung khác với dữ liệu trên biểu mẫu tài khoản. Bạn có muốn tự động điền dữ liệu mới từ hồ sơ nhân sự không?`,
        warningText, diffs,
        onConfirm: () => { applyEmployeeDiffsToAccountForm(form, diffs, !!editing); message.success(`Đã tự động điền ${diffs.length} thông tin từ hồ sơ ${emp.employeeCode}`); },
      });
    } else message.info(`Thông tin trên biểu mẫu tài khoản đã khớp với hồ sơ ${emp.employeeCode}`);
  };

  const liveDiffs = useMemo(
    () => (fetchedEmp && watchedEmpId ? computeEmployeeToAccountDiffs(fetchedEmp, watchedAll, branchOptions, !!editing) : []),
    [fetchedEmp, watchedEmpId, watchedAll, branchOptions, editing],
  );
  const liveWarning = fetchedEmp?.username && fetchedEmp.username !== editing?.username
    ? `Hồ sơ ${fetchedEmp.employeeCode} hiện đang gắn với tài khoản @${fetchedEmp.username}.`
    : null;

  const saveMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      editing
        ? api.put<{ emailQueued?: boolean; queuedToEmail?: string | null }>(`/admin/accounts/${editing.id}`, {
            ...values, employee_id: values.employee_id ?? '', version: editing.version, secret: values.secret || undefined, extra_permissions: values.extra_permissions ?? [],
          })
        : api.post<{ emailQueued?: boolean; queuedToEmail?: string | null }>('/admin/accounts', { ...values, extra_permissions: values.extra_permissions ?? [] }),
    onSuccess: (res, vars) => {
      const secretNoun = isEmployeeRole(vars.role) ? 'mã PIN 6 số' : 'mật khẩu';
      const queuedMsg = res?.emailQueued && res?.queuedToEmail
        ? (editing ? (vars.secret ? ` — Đã đưa email ${secretNoun} mới vào hàng đợi gửi tới ${res.queuedToEmail}` : '') : ` — Đã đưa email cấp tài khoản & ${secretNoun} vào hàng đợi gửi tới ${res.queuedToEmail}`)
        : '';
      message.success((editing ? 'Đã cập nhật tài khoản, phân quyền và đồng bộ hồ sơ thành công' : 'Đã tạo tài khoản mới (Trạng thái: Chờ Quản trị viên kích hoạt)') + queuedMsg);
      ['accounts', 'account-audit-history', 'employees', 'branches', 'schedules', 'me', 'integrations'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) form.setFields(err.details.map((d) => ({ name: d.field as keyof AccountFormValues, errors: [d.message] })));
        message.error(err.message);
      } else message.error('Không thể lưu tài khoản, vui lòng thử lại');
    },
  });

  return (
    <Modal
      title={editing ? `Chỉnh sửa Tài khoản & Phân quyền — @${editing.username}` : 'Thêm Tài khoản Hệ thống Mới'}
      open={open} onCancel={onClose} width="72vw" forceRender confirmLoading={saveMutation.isPending}
      onOk={async () => saveMutation.mutate(await form.validateFields())}
      okText={editing ? 'Lưu cập nhật' : 'Tạo tài khoản'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editing ? <SaveOutlined /> : <UserAddOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
    >
      <Form<AccountFormValues> form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Tabs
          activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: 'login', forceRender: true, label: <span><SafetyCertificateOutlined /> Thông tin Đăng nhập &amp; Vai trò</span>,
              children: (
                <>
                  <Row gutter={12}>
                    <Col span={12}><Form.Item name="display_name" label="Họ và tên" rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}><Input placeholder="Ví dụ: Nguyễn Văn An" /></Form.Item></Col>
                    <Col span={12}>
                      <Form.Item label="Tên đăng nhập" required>
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name="username" noStyle rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}><Input prefix={<UserOutlined />} disabled={!!editing} placeholder="Ví dụ: nv.an" /></Form.Item>
                          {!editing && <Button icon={<ThunderboltOutlined />} onClick={() => form.setFields([{ name: 'username', value: generateUsername(form.getFieldValue('display_name'), form.getFieldValue('employee_id'), form.getFieldValue('username')), errors: [] }])}>Tự sinh</Button>}
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name="phone_number" label="Số điện thoại"><Input placeholder="Ví dụ: 0901000001" /></Form.Item></Col>
                    <Col span={8}><Form.Item name="email" label={isEmpRole ? 'Email (Nhận TK & mã PIN)' : 'Email (Nhận TK & mật khẩu)'}><Input placeholder="Ví dụ: nguyenvanan@gmail.com" /></Form.Item></Col>
                    <Col span={8}>
                      <Form.Item name="role" label="Vai trò chính" rules={[{ required: true }]}>
                        <Select options={ROLE_OPTIONS} onChange={(nextRole: Role) => {
                          const allowed = new Set(getAllowedExtraPermissionsForRole(nextRole));
                          const cur: Permission[] = form.getFieldValue('extra_permissions') ?? [];
                          form.setFields([{ name: 'extra_permissions', value: cur.filter((p) => allowed.has(p)), errors: [] }]);
                          syncAccountSecretForRole(form, nextRole, !!editing);
                        }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <AccountSecretField form={form} open={open} editing={!!editing} role={currentRole} />
                </>
              ),
            },
            { key: 'permissions', forceRender: true, label: <span><SettingOutlined /> Phân quyền &amp; Permission bổ sung</span>, children: <AccountPermissionsFormSection role={currentRole} /> },
            {
              key: 'link', forceRender: true, label: <span><TeamOutlined /> Liên kết Hồ sơ Nhân sự &amp; Chi nhánh</span>,
              children: (
                <>
                  <Form.Item name="employee_id" label="Nhân sự liên kết" style={{ marginBottom: watchedEmpId ? 8 : 16 }}>
                    <Select showSearch allowClear optionFilterProp="label" loading={employeesQuery.isLoading} options={employeeOptions} placeholder="Chọn hồ sơ nhân sự để gắn với tài khoản này (hoặc bỏ trống nếu là TK Quản trị nội bộ)" onChange={handleSelectLinkedEmployee} />
                  </Form.Item>
                  {watchedEmpId && (fetchingEmp || fetchedEmp) && (
                    <div style={{ marginBottom: 16 }}>
                      <LinkedEntitySyncBanner
                        loading={fetchingEmp}
                        headerTitle={fetchedEmp ? `Thông tin hồ sơ ${fetchedEmp.employeeCode} — ${fetchedEmp.fullName}` : 'Đang kiểm tra hồ sơ nhân sự'}
                        summaryItems={fetchedEmp ? [
                          { label: 'Họ và tên', value: fetchedEmp.fullName },
                          { label: 'Số điện thoại', value: fetchedEmp.phone },
                          { label: 'Email', value: fetchedEmp.email || '' },
                          { label: 'Vị trí & Giai đoạn', value: `${fetchedEmp.positionTitle} · ${fetchedEmp.stageLabel}` },
                          { label: 'Chi nhánh', value: fetchedEmp.branchName },
                        ] : []}
                        warningText={liveWarning} diffs={liveDiffs} applyButtonLabel="Điền dữ liệu từ hồ sơ NV"
                        onApply={() => { applyEmployeeDiffsToAccountForm(form, liveDiffs, !!editing); message.success(`Đã điền ${liveDiffs.length} thông tin từ hồ sơ ${fetchedEmp?.employeeCode ?? ''}`); }}
                      />
                    </div>
                  )}
                  <Form.Item name="branch_scope" label="Phạm vi chi nhánh"><Select options={branchOptions} /></Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
