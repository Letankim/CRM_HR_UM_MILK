'use client';

import { App, Button, Card, Flex, Form, Input, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { CloudDownloadOutlined, DeleteOutlined, EditOutlined, FileProtectOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { TimeSelect } from './DateTimePickers';
import { BackupDetailDrawer, GovernanceDetailDrawer, POLICY_CATEGORY_LABELS, POLICY_CATEGORY_OPTIONS, PolicyFormModal } from './GovernanceAndCommsModals';
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

  const [govSubTab, setGovSubTab] = useState<'policies' | 'backups'>('policies');
  const [polModal, setPolModal] = useState(false);
  const [editingPol, setEditingPol] = useState<Record<string, unknown> | null>(null);
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const [viewingBackup, setViewingBackup] = useState<Record<string, unknown> | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [catFilter, setCatFilter] = useState('ALL');
  const [polPage, setPolPage] = useState(1);
  const [polPerPage, setPolPerPage] = useState(10);
  const [bkpSearch, setBkpSearch] = useState('');
  const debouncedBkpQ = useDebouncedValue(bkpSearch, 400);
  const [bkpStatusFilter, setBkpStatusFilter] = useState('ALL');
  const [bkpPage, setBkpPage] = useState(1);
  const [bkpPerPage, setBkpPerPage] = useState(10);
  const [mntScope, setMntScope] = useState('ALL');
  const [mntExpectedEnd, setMntExpectedEnd] = useState('');
  const [polForm] = Form.useForm();

  const polParams = useMemo(() => {
    const p = new URLSearchParams({ page: String(polPage), per_page: String(polPerPage) });
    if (debouncedQ) p.set('q', debouncedQ);
    if (catFilter !== 'ALL') p.set('category', catFilter);
    return p.toString();
  }, [polPage, polPerPage, debouncedQ, catFilter]);

  const bkpParams = useMemo(() => {
    const p = new URLSearchParams({ page: String(bkpPage), per_page: String(bkpPerPage) });
    if (debouncedBkpQ) p.set('q', debouncedBkpQ);
    if (bkpStatusFilter !== 'ALL') p.set('status', bkpStatusFilter);
    return p.toString();
  }, [bkpPage, bkpPerPage, debouncedBkpQ, bkpStatusFilter]);

  const polQ = useQuery({ queryKey: ['policies', polParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/policies?${polParams}`), enabled: mode === 'governance', retry: false });
  const mntQ = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/maintenance'), enabled: mode === 'governance', retry: false });
  const bkpQ = useQuery({ queryKey: ['backups', bkpParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/backups?${bkpParams}`), enabled: mode === 'governance' && canBackupOrMaint, retry: false });

  const refreshAll = () => ['policies', 'maintenance', 'backups', 'mkt-comms', 'nv-comms', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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

  const filteredPolicies = polQ.data?.data ?? [];
  const filteredBackups = bkpQ.data?.data ?? [];
  const polTotal = polQ.data?.meta.pagination.total ?? filteredPolicies.length;
  const bkpTotal = bkpQ.data?.meta.pagination.total ?? filteredBackups.length;

  const mnt = mntQ.data?.[0];
  const savedEndTime = useMemo(() => {
    const raw = String(mnt?.expected_end_at || '').trim();
    if (/^\d{2}:\d{2}$/.test(raw)) return raw;
    return mnt?.enabled ? (raw.match(/(\d{2}:\d{2})/)?.[1] ?? '') : '';
  }, [mnt?.expected_end_at, mnt?.enabled]);

  useEffect(() => {
    if (mnt?.scope) setMntScope(String(mnt.scope));
    if (savedEndTime) setMntExpectedEnd(savedEndTime);
  }, [mnt?.scope, savedEndTime]);

  if (mode === 'comms') return <MktCommsCenter />;

  const policiesPane = (
    <>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '14px 16px', marginTop: 4, marginBottom: 16 }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space size={10} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã chính sách, tiêu đề, người ban hành..." value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPolPage(1); }} style={{ width: 260 }} />
            <Select value={catFilter} onChange={(v) => { setCatFilter(v); setPolPage(1); }} style={{ width: 240 }} options={[{ value: 'ALL', label: 'Tất cả nhóm quy định / bộ phận' }, ...POLICY_CATEGORY_OPTIONS]} />
          </Space>
          <Space size={10} wrap>
            <Button icon={<ReloadOutlined />} loading={polQ.isFetching} onClick={refreshAll}>Làm mới</Button>
            {canManagePolicies && <Button type="primary" icon={<PlusOutlined />} onClick={openCreatePolicy}>Ban hành chính sách / quy định mới</Button>}
          </Space>
        </Flex>
      </div>
      <Table
        size="small" rowKey="id" loading={polQ.isLoading}
        pagination={{ current: polPage, pageSize: polPerPage, total: polTotal, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} chính sách`, onChange: (p, ps) => { setPolPage(ps !== polPerPage ? 1 : p); setPolPerPage(ps); } }}
        dataSource={filteredPolicies} scroll={{ x: 'max-content' }}
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
    <Card size="small" title="Chế độ Bảo trì & Sao lưu Khôi phục Hệ thống" extra={canBackupOrMaint && <Space size={6}><Button size="small" icon={<CloudDownloadOutlined />} onClick={() => postMut.mutate({ url: '/admin/backups', body: { kind: 'PRE_OPERATION', action: 'BACKUP' } })}>Sao lưu ngay</Button><Button size="small" type="primary" icon={<ToolOutlined />} onClick={() => postMut.mutate({ url: '/admin/backups', body: { kind: 'DAILY', action: 'RESTORE_VERIFY' } })}>Diễn tập Khôi phục</Button></Space>}>
      <Flex justify="space-between" align="center" wrap gap={10} style={{ padding: '10px 14px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, marginBottom: 12 }}>
        <Space wrap>
          <Typography.Text strong>Chế độ Bảo trì:</Typography.Text>
          <Tag color={mnt?.enabled ? 'red' : 'green'}>{mnt?.enabled ? 'ĐANG BẢO TRÌ' : 'HOẠT ĐỘNG BÌNH THƯỜNG'}</Tag>
          <Select size="small" value={mntScope} onChange={(v) => { setMntScope(v); if (mnt?.enabled) postMut.mutate({ url: '/admin/maintenance', body: { version: Number(mnt?.version) || 1, enabled: true, scope: v, expected_end_at: mntExpectedEnd || String(mnt?.expected_end_at || ''), banner_message: 'Hệ thống đang bảo trì nâng cấp định kỳ' } }); }} style={{ width: 195 }} options={[{ value: 'ALL', label: 'Phạm vi: Toàn hệ thống' }, { value: 'EMPLOYEE_APP', label: 'Phạm vi: Cổng Nhân viên' }, { value: 'ATTENDANCE', label: 'Phạm vi: Điểm danh GPS' }, { value: 'PAYROLL', label: 'Phạm vi: Kỳ lương' }, { value: 'BACKOFFICE', label: 'Phạm vi: Cổng Quản trị' }]} />
          <TimeSelect size="small" placeholder="Giờ mở lại (VD: 23:30)" value={mntExpectedEnd} onChange={(v) => { setMntExpectedEnd(v); if (mnt?.enabled && v) postMut.mutate({ url: '/admin/maintenance', body: { version: Number(mnt?.version) || 1, enabled: true, scope: mntScope || String(mnt?.scope || 'ALL'), expected_end_at: v, banner_message: `Hệ thống đang bảo trì nâng cấp định kỳ (Dự kiến mở lại lúc ${v})` } }); }} style={{ width: 185 }} />
        </Space>
        <Switch
          disabled={!canBackupOrMaint}
          loading={postMut.isPending}
          checked={Boolean(mnt?.enabled)}
          onChange={(checked) => {
            const endTime = mntExpectedEnd || savedEndTime;
            if (checked && !endTime) {
              message.warning('Vui lòng chọn Giờ mở lại dự kiến trước khi bật chế độ bảo trì');
              return;
            }
            postMut.mutate({ url: '/admin/maintenance', body: { version: Number(mnt?.version) || 1, enabled: checked, scope: mntScope || String(mnt?.scope || 'ALL'), expected_end_at: endTime, banner_message: checked ? `Hệ thống đang bảo trì nâng cấp định kỳ (Dự kiến mở lại lúc ${endTime})` : 'Hệ thống hoạt động bình thường', reason: checked ? 'Bảo trì định kỳ từ Quản trị viên' : 'Kết thúc bảo trì từ Quản trị viên' } });
          }}
        />
      </Flex>
      <Flex justify="space-between" align="center" wrap gap={10} style={{ marginBottom: 12 }}>
        <Space size={8} wrap>
          <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã BKP, loại sao lưu, ngày giờ..." value={bkpSearch} onChange={(e) => { setBkpSearch(e.target.value); setBkpPage(1); }} style={{ width: 250 }} />
          <Select value={bkpStatusFilter} onChange={(v) => { setBkpStatusFilter(v); setBkpPage(1); }} style={{ width: 205 }} options={[{ value: 'ALL', label: 'Tất cả trạng thái sao lưu' }, { value: 'SUCCESS', label: 'Thành công' }, { value: 'FAILED', label: 'Thất bại' }, { value: 'VERIFIED', label: 'Đã diễn tập kiểm chứng' }]} />
        </Space>
        <Button size="small" icon={<ReloadOutlined />} loading={bkpQ.isFetching} onClick={refreshAll}>Làm mới lịch sử</Button>
      </Flex>
      <Table
        size="small" rowKey="id" loading={bkpQ.isLoading}
        pagination={{ current: bkpPage, pageSize: bkpPerPage, total: bkpTotal, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t) => `Tổng ${t} bản sao lưu`, onChange: (p, ps) => { setBkpPage(ps !== bkpPerPage ? 1 : p); setBkpPerPage(ps); } }}
        dataSource={filteredBackups}
        columns={[
          { title: 'Mã sao lưu', dataIndex: 'backup_code', width: 120, render: (v: string, r) => <Typography.Link strong onClick={() => setViewingBackup(r)}><Tag color="geekblue">{v}</Tag></Typography.Link> },
          { title: 'Loại sao lưu', dataIndex: 'kindLabel', render: (v: string, r) => <Typography.Link strong onClick={() => setViewingBackup(r)}>{v}</Typography.Link> },
          { title: 'Thực hiện bởi', dataIndex: 'actorName', width: 190, render: (v: string) => <Tag color="cyan">{v || 'Tự động theo lịch hệ thống'}</Tag> },
          { title: 'Thời điểm thực hiện', dataIndex: 'started_at', width: 185, render: (v: string) => <span className="num">{v ? dayjs(v).format('HH:mm:ss DD/MM/YYYY') : '—'}</span> },
          { title: 'Diễn tập khôi phục', dataIndex: 'verified_restore', width: 145, render: (v: boolean) => v ? <Tag color="green">Đã kiểm chứng</Tag> : <Tag>Bản sao lưu</Tag> },
          { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> },
          { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết bản sao lưu & thống kê các bảng" onViewDetail={() => setViewingBackup(r)} /> },
        ]}
      />
    </Card>
  );

  const canEditViewing = viewing ? canEditItem(viewing) : false;

  return (
    <>
      <Card size="small" styles={{ body: { padding: '12px 20px 20px' } }}>
        <Tabs activeKey={govSubTab} onChange={(k) => setGovSubTab(k as 'policies' | 'backups')} items={[
          { key: 'policies', label: <span><FileProtectOutlined /> Chính sách Vận hành &amp; Quy định ({polTotal})</span>, children: policiesPane },
          ...(canBackupOrMaint ? [{ key: 'backups', label: <span><CloudDownloadOutlined /> Bảo trì &amp; Sao lưu ({bkpTotal})</span>, children: backupsPane }] : []),
        ]} />
      </Card>
      <PolicyFormModal open={polModal} editing={editingPol} form={polForm} isAdmin={isAdmin} loading={postMut.isPending || putMut.isPending} onClose={() => setPolModal(false)} onSubmit={(v) => { if (editingPol) putMut.mutate({ url: `/admin/policies/${editingPol.id}`, body: { ...v, version: editingPol.version, owner_override_approved: true } }); else postMut.mutate({ url: '/admin/policies', body: v }); setPolModal(false); }} />
      <GovernanceDetailDrawer record={viewing} kind="policy" onClose={() => setViewing(null)} onEdit={canEditViewing && canManagePolicies ? openEditPolicy : undefined} onBroadcast={canEditViewing && canManagePolicies ? (r) => postMut.mutate({ url: `/admin/policies/${r.id}/broadcast`, body: {} }) : undefined} />
      <BackupDetailDrawer record={viewingBackup} onClose={() => setViewingBackup(null)} />
    </>
  );
}
