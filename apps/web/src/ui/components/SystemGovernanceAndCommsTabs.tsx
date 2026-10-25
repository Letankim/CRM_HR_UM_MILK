'use client';

import { Alert, App, Button, Card, Flex, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { CloseOutlined, CloudDownloadOutlined, DeleteOutlined, EditOutlined, FileProtectOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SendOutlined, SettingOutlined, ToolOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { TimeSelect } from './DateTimePickers';
import { GovernanceDetailDrawer, POLICY_CATEGORY_LABELS, POLICY_CATEGORY_OPTIONS, PolicyFormModal } from './GovernanceAndCommsModals';
import { MktCommsCenter } from './MktCommsCenter';
import { RowActionButtons } from './RowActionButtons';

export function SystemGovernanceAndCommsTabs({ mode = 'governance' }: { mode?: 'governance' | 'comms' }) {
  const qc = useQueryClient();
  const can = useCan();
  const me = useMe().data?.user;
  const isAdmin = me?.role === 'ADMIN';
  const canManagePolicies = can('system.config', 'employee.manage');
  const canBackupOrMaint = can('system.backup', 'system.maintenance', 'system.config');
  const canEditItem = (r: Record<string, unknown>) =>
    Boolean(isAdmin || r.canEdit || r.isMine || (me && (r.created_by === me.id || r.approved_by === me.username || r.approved_by === me.displayName)));
  const { message, modal } = App.useApp();

  const [govSubTab, setGovSubTab] = useState<'policies' | 'backups' | 'settings'>('policies');
  const [polModal, setPolModal] = useState(false);
  const [editingPol, setEditingPol] = useState<Record<string, unknown> | null>(null);
  const [settingModal, setSettingModal] = useState(false);
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [catFilter, setCatFilter] = useState('ALL');
  const [mntScope, setMntScope] = useState('ALL');
  const [mntExpectedEnd, setMntExpectedEnd] = useState('');
  const [polForm] = Form.useForm();
  const [setForm] = Form.useForm();

  const polQ = useQuery({ queryKey: ['policies'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/policies'), enabled: mode === 'governance', retry: false });
  const mntQ = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/maintenance'), enabled: mode === 'governance', retry: false });
  const bkpQ = useQuery({ queryKey: ['backups'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/backups'), enabled: mode === 'governance' && canBackupOrMaint, retry: false });
  const cfgQ = useQuery({ queryKey: ['system-settings'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/system-settings'), enabled: mode === 'governance' && isAdmin, retry: false });

  const refreshAll = () => ['policies', 'maintenance', 'backups', 'system-settings', 'mkt-comms', 'nv-comms', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const onErr = (fallback: string) => (e: unknown) => message.error(e instanceof ApiClientError ? e.message : fallback);
  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: (_res, vars) => { message.success(vars.url.endsWith('/broadcast') ? 'Đã phát thông báo phổ biến chính sách tới toàn công ty' : 'Đã thực thi thao tác thành công'); refreshAll(); },
    onError: onErr('Thao tác thất bại'),
  });
  const putMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.put(url, body), onSuccess: () => { message.success('Đã lưu cập nhật thành công'); refreshAll(); }, onError: onErr('Cập nhật thất bại') });
  const delMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body), onSuccess: () => { message.success('Đã xóa bản ghi thành công'); refreshAll(); }, onError: onErr('Xóa thất bại') });

  const openCreatePolicy = () => {
    setEditingPol(null); polForm.resetFields();
    polForm.setFieldsValue({ category: 'ATTENDANCE', policy_version: 'v5.1', effective_from: dayjs().format('YYYY-MM-DD'), is_locked_policy: false, broadcast_company: true, content_html: '<p><strong>1. Mục đích áp dụng:</strong> Chuẩn hóa quy định vận hành, nhân sự và chấm công cho toàn bộ chi nhánh Ụm Bò Milk.</p>' });
    setPolModal(true);
  };
  const openEditPolicy = (r: Record<string, unknown>) => {
    setEditingPol(r);
    polForm.setFieldsValue({ key: String(r.key || ''), category: r.category || 'ATTENDANCE', policy_version: r.policy_version || 'v5.1', description: r.description || r.title, value_json: r.value_json, effective_from: r.effective_from || dayjs().format('YYYY-MM-DD'), effective_to: r.effective_to || '', is_locked_policy: Boolean(r.is_locked_policy), broadcast_company: false, content_html: r.content_html || r.note || `<p>${r.description ?? ''}</p>` });
    setPolModal(true);
  };

  const filteredPolicies = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase();
    return (polQ.data ?? []).filter((p) => (catFilter === 'ALL' || p.category === catFilter) && (!q || `${p.key || ''} ${p.description || ''} ${p.title || ''} ${p.value_json || ''} ${p.approved_by || ''}`.toLowerCase().includes(q)));
  }, [polQ.data, catFilter, debouncedQ]);

  if (mode === 'comms') return <MktCommsCenter />;

  const mnt = mntQ.data?.[0];

  const policiesPane = (
    <>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '14px 16px', marginTop: 4, marginBottom: 16 }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space size={10} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã chính sách, tiêu đề, người ban hành..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 260 }} />
            <Select value={catFilter} onChange={setCatFilter} style={{ width: 240 }} options={[{ value: 'ALL', label: 'Tất cả nhóm quy định / bộ phận' }, ...POLICY_CATEGORY_OPTIONS]} />
          </Space>
          <Space size={10} wrap>
            <Button icon={<ReloadOutlined />} loading={polQ.isFetching} onClick={refreshAll}>Làm mới</Button>
            {canManagePolicies && <Button type="primary" icon={<PlusOutlined />} onClick={openCreatePolicy}>Ban hành chính sách / quy định mới</Button>}
          </Space>
        </Flex>
      </div>
      <Table
        size="small" rowKey="id" loading={polQ.isLoading} pagination={{ pageSize: 12 }} dataSource={filteredPolicies} scroll={{ x: 'max-content' }}
        columns={[
          { title: 'Mã chính sách', dataIndex: 'key', width: 165, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Nhóm quy định / Bộ phận', dataIndex: 'category', width: 190, render: (v: string) => POLICY_CATEGORY_LABELS[v] ?? v },
          { title: 'Tên chính sách / Quy định phổ biến', dataIndex: 'description', ellipsis: true, render: (v: string, r) => <Typography.Link strong onClick={() => setViewing(r)}>{v}</Typography.Link> },
          { title: 'Giá trị hiệu lực', dataIndex: 'value_json', width: 160, render: (v: string) => <Tag color="blue">{v}</Tag> },
          { title: 'Hiệu lực & Ban hành', width: 195, render: (_, r) => <div><div className="num" style={{ fontSize: 12 }}>Từ: {String(r.effective_from || '—')}</div><div style={{ fontSize: 11, color: '#64748B' }}>Bởi: {String(r.creatorName || r.approved_by || 'Hệ thống')} {Boolean(r.isMine) && <Tag color="cyan" style={{ margin: '0 0 0 4px', fontSize: 10 }}>Của bạn</Tag>}</div></div> },
          { title: 'Bảo vệ', dataIndex: 'is_locked_policy', width: 105, render: (v: boolean) => v ? <Tag color="red">Khóa cốt lõi</Tag> : <Tag color="green">Đang áp dụng</Tag> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết văn bản chính sách"
                onViewDetail={() => setViewing(r)}
                menuItems={canManagePolicies && canEditItem(r) ? [
                  { key: 'broadcast', icon: <SendOutlined />, label: 'Phổ biến toàn công ty (Gửi thông báo)', onClick: () => postMut.mutate({ url: `/admin/policies/${r.id}/broadcast`, body: {} }) },
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa chính sách', onClick: () => openEditPolicy(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa chính sách', onClick: () => modal.confirm({ title: `Xóa chính sách "${r.key}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true }, onOk: () => delMut.mutateAsync({ url: `/admin/policies/${r.id}`, body: { version: r.version, owner_override_approved: true } }) }) },
                ] : []}
              />
            ),
          },
        ]}
      />
    </>
  );

  const backupsPane = (
    <Card size="small" title="Chế độ Bảo trì & Sao lưu Khôi phục Google Drive" extra={canBackupOrMaint && <Space size={6}><Button size="small" icon={<CloudDownloadOutlined />} onClick={() => postMut.mutate({ url: '/admin/backups', body: { kind: 'PRE_OPERATION', action: 'BACKUP' } })}>Sao lưu ngay</Button><Button size="small" type="primary" icon={<ToolOutlined />} onClick={() => postMut.mutate({ url: '/admin/backups', body: { kind: 'DAILY', action: 'RESTORE_VERIFY' } })}>Diễn tập Khôi phục</Button></Space>}>
      <Flex justify="space-between" align="center" wrap gap={10} style={{ padding: '10px 14px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, marginBottom: 12 }}>
        <Space wrap>
          <Typography.Text strong>Chế độ Bảo trì:</Typography.Text>
          <Tag color={mnt?.enabled ? 'red' : 'green'}>{mnt?.enabled ? 'ĐANG BẢO TRÌ' : 'HOẠT ĐỘNG BÌNH THƯỜNG'}</Tag>
          <Select size="small" value={String(mnt?.scope || mntScope)} onChange={setMntScope} style={{ width: 185 }} options={[{ value: 'ALL', label: 'Phạm vi: Toàn hệ thống' }, { value: 'ATTENDANCE', label: 'Phạm vi: Điểm danh GPS' }, { value: 'PAYROLL', label: 'Phạm vi: Kỳ lương' }]} />
          <TimeSelect size="small" placeholder="Giờ mở lại (VD: 23:30)" value={mntExpectedEnd} onChange={setMntExpectedEnd} style={{ width: 185 }} />
        </Space>
        <Switch disabled={!canBackupOrMaint} checked={Boolean(mnt?.enabled)} onChange={(checked) => postMut.mutate({ url: '/admin/maintenance', body: { version: mnt?.version ?? 1, enabled: checked, scope: mntScope, expected_end_at: mntExpectedEnd || null, banner_message: 'Hệ thống đang bảo trì nâng cấp định kỳ', reason: 'Bảo trì định kỳ từ Quản trị viên' } })} />
      </Flex>
      <Table
        size="small" rowKey="id" pagination={false} dataSource={bkpQ.data ?? []}
        columns={[
          { title: 'Mã sao lưu', dataIndex: 'backup_code', width: 130, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Loại sao lưu', dataIndex: 'kindLabel' },
          { title: 'Thời điểm thực hiện', dataIndex: 'started_at', width: 210, render: (v: string) => <span className="num">{v ? dayjs(v).format('HH:mm:ss DD/MM/YYYY') : '—'}</span> },
          { title: 'Diễn tập khôi phục', dataIndex: 'verified_restore', width: 150, render: (v: boolean) => v ? <Tag color="green">Đã kiểm chứng</Tag> : <Tag>Bản sao lưu</Tag> },
          { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag value={v} /> },
        ]}
      />
    </Card>
  );

  const settingsPane = (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert type="warning" showIcon message="Bảo mật Cấu hình Hệ thống" description="Bảng Cài đặt hệ thống chỉ dùng để lưu các thông số vận hành chung (Múi giờ, Chu kỳ lương, Ngưỡng cảnh báo, Tiền tố mã). Vì lý do an toàn bảo mật, vui lòng không nhập mật khẩu hoặc khóa bảo mật tại đây." />
      {isAdmin && <Flex justify="flex-end"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setForm.resetFields(); setSettingModal(true); }}>Cập nhật / Thêm tham số hệ thống</Button></Flex>}
      <Table
        size="small" rowKey="key" pagination={false} dataSource={cfgQ.data ?? []}
        columns={[
          { title: 'Mã tham số', dataIndex: 'key', width: 230, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Giá trị hiện hành', dataIndex: 'value_json', width: 220, render: (v: string) => <Tag color="blue">{v}</Tag> },
          { title: 'Mô tả tham số hệ thống', dataIndex: 'description' },
          { title: 'Thao tác', width: 100, align: 'right', render: (_, r) => isAdmin ? <Button size="small" icon={<EditOutlined />} onClick={() => { setForm.setFieldsValue(r); setSettingModal(true); }}>Sửa</Button> : null },
        ]}
      />
    </Space>
  );

  const canEditViewing = viewing ? canEditItem(viewing) : false;

  return (
    <>
      <Card size="small" styles={{ body: { padding: '12px 20px 20px' } }}>
        <Tabs activeKey={govSubTab} onChange={(k) => setGovSubTab(k as 'policies' | 'backups' | 'settings')} items={[
          { key: 'policies', label: <span><FileProtectOutlined /> Chính sách Vận hành &amp; Quy định ({filteredPolicies.length})</span>, children: policiesPane },
          ...(canBackupOrMaint ? [{ key: 'backups', label: <span><CloudDownloadOutlined /> Bảo trì &amp; Sao lưu ({bkpQ.data?.length ?? 0})</span>, children: backupsPane }] : []),
          ...(isAdmin ? [{ key: 'settings', label: <span><SettingOutlined /> Cài đặt Hệ thống ({cfgQ.data?.length ?? 0})</span>, children: settingsPane }] : []),
        ]} />
      </Card>
      <PolicyFormModal open={polModal} editing={editingPol} form={polForm} isAdmin={isAdmin} loading={postMut.isPending || putMut.isPending} onClose={() => setPolModal(false)} onSubmit={(v) => { if (editingPol) putMut.mutate({ url: `/admin/policies/${editingPol.id}`, body: { ...v, version: editingPol.version, owner_override_approved: true } }); else postMut.mutate({ url: '/admin/policies', body: v }); setPolModal(false); }} />
      <Modal width={680} open={settingModal} title="Cập nhật Tham số Cài đặt Hệ thống" okText="Lưu tham số" cancelText="Hủy bỏ" onCancel={() => setSettingModal(false)} onOk={() => setForm.submit()}>
        <Form form={setForm} layout="vertical" onFinish={(v) => { putMut.mutate({ url: '/admin/system-settings', body: v }); setSettingModal(false); }}>
          <Form.Item name="key" label="Mã tham số cấu hình" rules={[{ required: true }]}><Input placeholder="VD: APP_TIMEZONE" /></Form.Item>
          <Form.Item name="value_json" label="Giá trị áp dụng" rules={[{ required: true }]}><Input placeholder="VD: Asia/Ho_Chi_Minh" /></Form.Item>
          <Form.Item name="description" label="Mô tả tham số" rules={[{ required: true }]}><Input placeholder="Mô tả ý nghĩa tham số vận hành..." /></Form.Item>
        </Form>
      </Modal>
      <GovernanceDetailDrawer record={viewing} kind="policy" onClose={() => setViewing(null)} onEdit={canEditViewing && canManagePolicies ? openEditPolicy : undefined} onBroadcast={canEditViewing && canManagePolicies ? (r) => postMut.mutate({ url: `/admin/policies/${r.id}/broadcast`, body: {} }) : undefined} />
    </>
  );
}
