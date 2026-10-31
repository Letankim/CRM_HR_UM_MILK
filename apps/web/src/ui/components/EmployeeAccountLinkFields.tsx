'use client';

import { Alert, App, Button, Col, Form, Input, Radio, Row, Select, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { KeyOutlined, LinkOutlined, ThunderboltOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { isEmployeeRole, PIN_REGEX, type Role } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { generateAccountSecret, generatePin6, generateUsername } from '@/lib/auto-generate';
import { applyAccountDiffsToEmployeeForm, computeAccountToEmployeeDiffs } from '@/lib/linked-entity-sync';
import { useLinkedEntityDetail } from '../hooks/useLinkedEntityDetail';
import { StatusTag } from '../StatusTag';
import type { AccountRowItem } from './AccountDetailDrawer';
import type { EmployeeRowItem } from './employee-table-columns';
import { LinkedEntitySyncBanner, promptLinkedEntitySyncModal } from './LinkedEntitySyncBanner';

export type EmployeeAccountMode = 'AUTO_CREATE' | 'LINK_EXISTING' | 'NONE';

export interface EmployeeAccountLinkFieldsProps {
  form: FormInstance;
  editing?: EmployeeRowItem | null;
  branches?: { label: string; value: string }[];
  modalOpen?: boolean;
}

export function EmployeeAccountLinkFields({ form, editing, branches = [], modalOpen = true }: EmployeeAccountLinkFieldsProps) {
  const { modal, message } = App.useApp();
  const watchedAll = (Form.useWatch([], form) as Record<string, unknown> | undefined) ?? {};
  const mode = (watchedAll.account_mode as EmployeeAccountMode | undefined) ?? 'AUTO_CREATE';
  const linkUserId = watchedAll.link_user_id as string | undefined;
  const fullName = watchedAll.full_name as string | undefined;
  const empCode = watchedAll.employee_code as string | undefined;
  const [showPin, setShowPin] = useState(true);
  const canReadAccounts = useCan()('account.read');

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'select-for-employee'],
    queryFn: () => api.list<AccountRowItem>('/admin/accounts?per_page=200'),
    enabled: modalOpen && canReadAccounts,
  });

  const matchAcc = useCallback((u: AccountRowItem, key: string) => u.id === key, []);
  const { entity: fetchedAccount, loading: fetchingDetail, fetchFresh } = useLinkedEntityDetail<AccountRowItem>({
    enabled: modalOpen && mode === 'LINK_EXISTING' && canReadAccounts,
    selectedKey: linkUserId,
    endpointPrefix: '/admin/accounts',
    matchItem: matchAcc,
    fallbackList: accountsQuery.data?.data ?? [],
  });

  const accountOptions = useMemo(() => {
    const rows = [...(accountsQuery.data?.data ?? [])].sort((a, b) => Number(Boolean(a.employeeId)) - Number(Boolean(b.employeeId)));
    const mapped = rows.map((u) => ({
      value: u.id,
      label: `@${u.username} — ${u.displayName} (${u.roleLabel}) · ${u.employeeId ? `Đang gắn ${u.employeeId}` : 'Chưa gắn hồ sơ NV'}`,
    }));
    if (editing?.userId && editing.username && !mapped.some((m) => m.value === editing.userId)) {
      mapped.unshift({
        value: editing.userId,
        label: `@${editing.username} — ${editing.userDisplayName || editing.fullName} (${editing.userRoleLabel || 'Tài khoản liên kết'}) · Đang gắn ${editing.employeeCode}`,
      });
    }
    return mapped;
  }, [accountsQuery.data, editing]);

  const linkedRole: Role | undefined = useMemo(() => {
    if (fetchedAccount && fetchedAccount.id === linkUserId) return fetchedAccount.role;
    const targetId = linkUserId ?? editing?.userId;
    if (!targetId) return undefined;
    const found = (accountsQuery.data?.data ?? []).find((u) => u.id === targetId);
    return found?.role ?? (editing?.userId === targetId ? (editing.userRole as Role | undefined) : undefined);
  }, [fetchedAccount, linkUserId, accountsQuery.data, editing]);
  const isLinkedEmployee = !linkedRole || isEmployeeRole(linkedRole);

  const validateInitialPin = async (_rule: unknown, value: unknown) => {
    const liveMode = (form.getFieldValue('account_mode') as EmployeeAccountMode | undefined) ?? 'AUTO_CREATE';
    const str = String(value ?? '');
    if (liveMode === 'NONE') return;
    if (liveMode === 'AUTO_CREATE') {
      if (!str) throw new Error('Vui lòng nhập mã PIN đăng nhập');
      if (!PIN_REGEX.test(str)) throw new Error('Mã PIN đăng nhập phải gồm đúng 6 chữ số');
      return;
    }
    if (!str) return;
    if (isLinkedEmployee && !PIN_REGEX.test(str)) throw new Error('Mã PIN đăng nhập phải gồm đúng 6 chữ số');
    if (!isLinkedEmployee && str.length < 6) throw new Error('Mật khẩu tối thiểu 6 ký tự');
  };

  const handleSelectLinkedAccount = async (nextUserId?: string) => {
    const acc = await fetchFresh(nextUserId);
    if (!acc) {
      form.setFields([{ name: 'initial_pin', value: '', errors: [] }]);
      return;
    }
    const curPin = String(form.getFieldValue('initial_pin') ?? '');
    const nextIsEmp = isEmployeeRole(acc.role);
    const syncedPin = !curPin ? '' : nextIsEmp ? (PIN_REGEX.test(curPin) ? curPin : generatePin6()) : !PIN_REGEX.test(curPin) && curPin.length >= 6 ? curPin : generateAccountSecret(acc.role);
    form.setFields([{ name: 'initial_pin', value: syncedPin, errors: [] }]);

    const diffs = computeAccountToEmployeeDiffs(acc, form.getFieldsValue(true) as Record<string, unknown>, branches, !!editing);
    const warningText = acc.employeeId && acc.employeeId !== editing?.employeeCode
      ? `Tài khoản @${acc.username} hiện đang gắn với hồ sơ ${acc.employeeId}${acc.employeeName ? ` (${acc.employeeName})` : ''}. Nếu lưu, liên kết tài khoản sẽ chuyển sang hồ sơ nhân sự này.`
      : null;

    if (diffs.length > 0) {
      promptLinkedEntitySyncModal({
        modal, title: `Đối chiếu thông tin từ tài khoản @${acc.username}`,
        description: `Tài khoản @${acc.username} (${acc.displayName}) có ${diffs.length} thông tin chung khác với dữ liệu trên biểu mẫu. Bạn có muốn tự động điền dữ liệu mới từ tài khoản vào biểu mẫu không?`,
        warningText, diffs,
        onConfirm: () => { applyAccountDiffsToEmployeeForm(form, diffs); message.success(`Đã tự động điền ${diffs.length} thông tin từ tài khoản @${acc.username}`); },
      });
    } else message.info(`Thông tin trên biểu mẫu đã khớp với tài khoản @${acc.username}`);
  };

  const liveDiffs = useMemo(
    () => (fetchedAccount && mode === 'LINK_EXISTING' ? computeAccountToEmployeeDiffs(fetchedAccount, watchedAll, branches, !!editing) : []),
    [fetchedAccount, mode, watchedAll, branches, editing],
  );
  const liveWarning = fetchedAccount?.employeeId && fetchedAccount.employeeId !== editing?.employeeCode
    ? `Tài khoản @${fetchedAccount.username} hiện đang gắn với hồ sơ ${fetchedAccount.employeeId}${fetchedAccount.employeeName ? ` (${fetchedAccount.employeeName})` : ''}.`
    : null;

  return (
    <div>
      {editing?.username && (
        <Alert
          type="success" showIcon style={{ marginBottom: 12 }}
          message={
            <Space size={8} wrap>
              <span>Tài khoản đang liên kết:</span>
              <Tag color="blue" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}><UserOutlined /> @{editing.username}</Tag>
              {editing.accountStatus && <StatusTag value={editing.accountStatus} />}
              {editing.userRoleLabel && <span style={{ color: '#475569' }}>({editing.userRoleLabel})</span>}
            </Space>
          }
        />
      )}

      <Form.Item name="account_mode" label="Liên kết tài khoản">
        <Radio.Group
          optionType="button" buttonStyle="solid"
          onChange={(ev) => {
            const nextMode = ev.target.value as EmployeeAccountMode;
            const curPin = String(form.getFieldValue('initial_pin') ?? '');
            form.setFields([
              { name: 'initial_pin', value: nextMode === 'AUTO_CREATE' ? (PIN_REGEX.test(curPin) ? curPin : generatePin6()) : '', errors: [] },
              { name: 'link_user_id', value: form.getFieldValue('link_user_id'), errors: [] },
            ]);
          }}
        >
          {!editing?.userId && <Radio.Button value="AUTO_CREATE"><UserAddOutlined /> Tự động tạo tài khoản mới</Radio.Button>}
          <Radio.Button value="LINK_EXISTING"><LinkOutlined /> Liên kết tài khoản có sẵn</Radio.Button>
          <Radio.Button value="NONE">Chưa liên kết tài khoản</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {mode === 'AUTO_CREATE' && !editing?.userId && (
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: 12, background: '#F8FAFC' }}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item label="Tên đăng nhập">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="username" noStyle><Input prefix={<UserOutlined />} placeholder="Để trống tự sinh theo mã NV" /></Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={() => form.setFields([{ name: 'username', value: generateUsername(fullName, empCode, form.getFieldValue('username')), errors: [] }])}>Tự sinh</Button>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Mã PIN đăng nhập (6 chữ số)" required>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="initial_pin" noStyle rules={[{ validator: validateInitialPin }]} normalize={(v) => (typeof v === 'string' ? v.replace(/\D/g, '').slice(0, 6) : v)}>
                    <Input.Password prefix={<KeyOutlined />} inputMode="numeric" maxLength={6} visibilityToggle={{ visible: showPin, onVisibleChange: setShowPin }} placeholder="Nhập 6 chữ số" />
                  </Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={() => { setShowPin(true); form.setFields([{ name: 'initial_pin', value: generatePin6(), errors: [] }]); }}>Tự sinh PIN</Button>
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
            <Col xs={24} md={14}>
              <Form.Item name="link_user_id" label="Tài khoản liên kết" rules={[{ required: true, message: 'Vui lòng chọn tài khoản để liên kết' }]} style={{ marginBottom: linkUserId ? 4 : 16 }}>
                <Select showSearch allowClear optionFilterProp="label" loading={accountsQuery.isLoading} options={accountOptions} placeholder="Tìm theo @username, họ tên hoặc vai trò..." onChange={handleSelectLinkedAccount} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label={isLinkedEmployee ? 'Đặt lại mã PIN (6 chữ số)' : 'Đặt lại mật khẩu'} style={{ marginBottom: linkUserId ? 4 : 16 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="initial_pin" noStyle rules={[{ validator: validateInitialPin }]} normalize={(v) => (isLinkedEmployee && typeof v === 'string' ? v.replace(/\D/g, '').slice(0, 6) : v)}>
                    <Input.Password prefix={<KeyOutlined />} inputMode={isLinkedEmployee ? 'numeric' : 'text'} maxLength={isLinkedEmployee ? 6 : undefined} visibilityToggle={{ visible: showPin, onVisibleChange: setShowPin }} placeholder="Để trống nếu giữ nguyên" />
                  </Form.Item>
                  <Button icon={<ThunderboltOutlined />} onClick={() => { setShowPin(true); form.setFields([{ name: 'initial_pin', value: isLinkedEmployee ? generatePin6() : generateAccountSecret(linkedRole), errors: [] }]); }}>{isLinkedEmployee ? 'Tự sinh PIN' : 'Tự sinh MK'}</Button>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          {linkUserId && (fetchingDetail || fetchedAccount) && (
            <LinkedEntitySyncBanner
              loading={fetchingDetail} headerTitle={fetchedAccount ? `Thông tin tài khoản @${fetchedAccount.username}` : 'Đang kiểm tra tài khoản'}
              summaryItems={fetchedAccount ? [{ label: 'Họ và tên', value: fetchedAccount.displayName }, { label: 'Số điện thoại', value: fetchedAccount.phone }, { label: 'Email', value: fetchedAccount.email || '' }, { label: 'Vai trò', value: fetchedAccount.roleLabel }, { label: 'Chi nhánh', value: fetchedAccount.employeeBranchName || fetchedAccount.branchNames }] : []}
              warningText={liveWarning} diffs={liveDiffs} applyButtonLabel="Điền dữ liệu từ tài khoản"
              onApply={() => { applyAccountDiffsToEmployeeForm(form, liveDiffs); message.success(`Đã điền ${liveDiffs.length} thông tin từ tài khoản @${fetchedAccount?.username ?? ''}`); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
