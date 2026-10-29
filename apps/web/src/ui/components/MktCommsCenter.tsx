'use client';

import { Alert, App, Button, Card, Col, Descriptions, Flex, Form, Input, Modal, Progress, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import { AudioOutlined, BellOutlined, CalendarOutlined, CheckCircleOutlined, CloseOutlined, CloudUploadOutlined, DeleteOutlined, EditOutlined, FileExcelOutlined, FolderOpenOutlined, NotificationOutlined, PlusOutlined, ReloadOutlined, RetweetOutlined, SearchOutlined, SendOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { GovernanceDetailDrawer } from './GovernanceAndCommsModals';
import { GuardButton } from './GuardButton';
import { JobPositionsManagerModal, useJobPositions } from './JobPositionsManagerModal';
import { MktAnnouncementModal, MktAudienceModal, MktCampaignModal, MktMediaModal } from './MktCommsModals';
import { RowActionButtons } from './RowActionButtons';

interface MktCommsPayload { dashboard?: Record<string, number>; audienceGroups: Record<string, unknown>[]; campaigns: Record<string, unknown>[]; announcements: Record<string, unknown>[]; mediaAssets: Record<string, unknown>[]; deliveryLogs: Record<string, unknown>[] }

export function MktCommsCenter() {
  const qc = useQueryClient();
  const can = useCan();
  const me = useMe().data?.user;
  const isAdmin = me?.role === 'ADMIN';
  const canManage = can('comms.manage', 'employee.manage', 'system.config');
  const canEditRow = (r: Record<string, unknown>) => Boolean(isAdmin || r.canEdit || r.isMine || (me && r.created_by === me.id));
  const { message, modal } = App.useApp();

  const [tab, setTab] = useState('announcements');
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [statusFilter, setStatusFilter] = useState('ALL'), [prioFilter, setPrioFilter] = useState('ALL');
  const [ancModal, setAncModal] = useState(false), [editingAnc, setEditingAnc] = useState<Record<string, unknown> | null>(null);
  const [audModal, setAudModal] = useState(false), [editingAud, setEditingAud] = useState<Record<string, unknown> | null>(null);
  const [viewingAud, setViewingAud] = useState<Record<string, unknown> | null>(null), [posModal, setPosModal] = useState(false);
  const [cmpModal, setCmpModal] = useState(false), [editingCmp, setEditingCmp] = useState<Record<string, unknown> | null>(null);
  const [medModal, setMedModal] = useState(false), [editingMed, setEditingMed] = useState<Record<string, unknown> | null>(null);
  const [viewingAnc, setViewingAnc] = useState<Record<string, unknown> | null>(null);
  const [ancForm] = Form.useForm(), [audForm] = Form.useForm(), [cmpForm] = Form.useForm(), [medForm] = Form.useForm();
  const ancPag = useClientPagination(10, 'bản tin'), audPag = useClientPagination(10, 'nhóm'), cmpPag = useClientPagination(10, 'chiến dịch'), medPag = useClientPagination(10, 'tệp'), dlvPag = useClientPagination(10, 'lượt gửi');

  const { options: jobPositionOptions } = useJobPositions();
  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50') });
  const branchOptions = useMemo(() => (branchesQ.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })), [branchesQ.data]);
  const mktQ = useQuery({ queryKey: ['mkt-comms'], queryFn: () => api.get<MktCommsPayload>('/admin/comms'), retry: false });
  const data = mktQ.data;
  const refresh = () => ['mkt-comms', 'nv-comms', 'notifications', 'job-positions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const onErr = (fb: string) => (e: unknown) => message.error(e instanceof ApiClientError ? e.message : fb);

  const postMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body), onSuccess: () => { message.success('Đã thực hiện thao tác thành công'); refresh(); }, onError: onErr('Thao tác thất bại') });
  const putMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.put(url, body), onSuccess: () => { message.success('Đã lưu cập nhật thành công'); refresh(); }, onError: onErr('Cập nhật thất bại') });
  const delMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.delete(url, body), onSuccess: () => { message.success('Đã xóa bản ghi thành công'); refresh(); }, onError: onErr('Xóa thất bại') });

  const openCreateAnc = (presetAudienceKey = 'ALL|ALL', presetStatus = 'SENT') => {
    setEditingAnc(null); ancForm.resetFields();
    ancForm.setFieldsValue({ priority: 'HIGH', status: presetStatus, audience_key: presetAudienceKey, scheduled_at: dayjs().add(1, 'day').format('YYYY-MM-DD'), scheduled_time: '08:00', requires_ack: true, media_list: [], body_md: '<p>Kính gửi toàn thể nhân sự hệ thống <strong>Ụm Bò Milk</strong>,</p>' });
    setAncModal(true);
  };
  const openEditAnc = (r: Record<string, unknown>) => {
    setEditingAnc(r);
    const mediaList = String(r.media_ids || '').replace(/[\[\]"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const rawSched = String(r.scheduled_at || '');
    ancForm.setFieldsValue({ title: r.title, summary: r.summary, priority: r.priority || 'NORMAL', status: r.status || 'SENT', audience_key: `${r.audience_scope || 'ALL'}|${r.audience_target || 'ALL'}`, campaign_id: r.campaign_id || undefined, scheduled_at: rawSched ? rawSched.slice(0, 10) : '', scheduled_time: rawSched.length >= 16 ? rawSched.slice(11, 16) : '08:00', cta_label: r.cta_label || '', cta_link: r.cta_link || '', requires_ack: Boolean(r.requires_ack), media_list: mediaList, body_md: r.body || `<p>${r.summary ?? ''}</p>` });
    setAncModal(true);
  };
  const openCreateAud = () => {
    setEditingAud(null); audForm.resetFields();
    audForm.setFieldsValue({ scope: 'CUSTOM', branch_id: 'ALL', stage: 'ALL', staff_group: 'ALL', note: 'Nhóm người nhận được cấu hình (ẩn 100% lương/GPS/CCCD)' });
    setAudModal(true);
  };
  const openEditAud = (r: Record<string, unknown>) => {
    setEditingAud(r);
    audForm.setFieldsValue({ label: r.label, scope: r.scope || 'CUSTOM', branch_id: r.branch_id || (r.scope === 'BRANCH' ? r.target : 'ALL'), stage: r.stage || (r.scope === 'STAGE' ? (r.target === 'THU_VIEC' ? 'PROBATION' : 'OFFICIAL') : 'ALL'), staff_group: r.staff_group || (r.scope === 'STAFF_GROUP' ? r.target : 'ALL'), note: r.note || '' });
    setAudModal(true);
  };
  const filteredAnc = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase();
    return (data?.announcements ?? []).filter((a) => (canManage || a.status === 'SENT') && (statusFilter === 'ALL' || a.status === statusFilter) && (prioFilter === 'ALL' || a.priority === prioFilter) && (!q || `${a.announcement_code || ''} ${a.title || ''} ${a.summary || ''} ${a.audienceLabel || ''}`.toLowerCase().includes(q)));
  }, [data?.announcements, canManage, statusFilter, prioFilter, debouncedQ]);
  const pendingOrFailedAncs = useMemo(() => (data?.announcements ?? []).filter((a) => a.status === 'DRAFT' || a.status === 'SCHEDULED' || a.status === 'FAILED'), [data?.announcements]);
  const db = data?.dashboard ?? {};
  const kpiCards = [
    { label: 'Tin đang chạy', val: db.runningCount ?? 0, color: '#16A34A', sub: 'Đã phát tới người nhận' },
    { label: 'Tin lưu nháp', val: db.draftCount ?? 0, color: '#D97706', sub: 'Chờ duyệt / hoàn thiện' },
    { label: 'Lịch phát dự kiến', val: db.scheduledCount ?? 0, color: '#2563EB', sub: 'Đặt lịch phát tự động' },
    { label: 'Nhóm người nhận', val: data?.audienceGroups?.length ?? 0, color: '#0F172A', sub: `${db.campaignCount ?? 0} chiến dịch truyền thông` },
    { label: 'Đã xác nhận đọc', val: db.acknowledgedCount ?? 0, color: '#0284C7', sub: 'Có xác nhận đọc thực tế' },
    { label: 'Cảnh báo lỗi gửi', val: db.failedCount ?? 0, color: '#DC2626', sub: 'Cần kiểm tra & gửi lại' },
  ];

  const dashboardPane = (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="Chuẩn phân quyền & bảo mật dữ liệu Truyền thông Nội bộ" description="Bộ phận Truyền thông được phép cấu hình Nhóm người nhận theo phạm vi cho phép (Toàn công ty, Chi nhánh, Thử việc/Chính thức, Nhóm vị trí); hệ thống tự động ẩn 100% lương, GPS, ảnh điểm danh và hồ sơ HR nhạy cảm. Trạng thái gửi không khẳng định người nhận đã đọc nếu chưa có xác nhận đọc thực tế." />
      <Row gutter={[12, 12]}>{kpiCards.map((k) => <Col xs={12} md={4} key={k.label}><Card size="small" styles={{ body: { padding: '12px 14px' } }}><div style={{ fontSize: 12, color: '#64748B' }}>{k.label}</div><div className="num" style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '4px 0' }}>{k.val}</div><div style={{ fontSize: 11, color: '#94A3B8' }}>{k.sub}</div></Card></Col>)}</Row>
      <Card size="small" title={`Nội dung chờ duyệt / nháp, Lịch phát sắp tới & Cảnh báo lỗi gửi (${pendingOrFailedAncs.length})`} extra={<Space size={8}><Button size="small" onClick={() => openCreateAnc('ALL|ALL', 'DRAFT')}>Lưu nháp mới</Button><Button size="small" type="primary" onClick={() => openCreateAnc('ALL|ALL', 'SENT')}>Tạo &amp; Phát tin</Button></Space>}>
        <SelectableTable size="small" rowKey="id" pagination={false} dataSource={pendingOrFailedAncs} columns={[{ title: 'Mã tin', dataIndex: 'announcement_code', width: 95, render: (v: string) => <Tag color="geekblue">{v}</Tag> }, { title: 'Tiêu đề thông báo', dataIndex: 'title', render: (v: string, r) => <Typography.Link strong onClick={() => setViewingAnc(r)}>{v}</Typography.Link> }, { title: 'Nhóm người nhận', dataIndex: 'audienceLabel', width: 185, render: (v: string) => <Tag color="blue">{v || 'Toàn công ty'}</Tag> }, { title: 'Lịch phát dự kiến', dataIndex: 'scheduled_at', width: 155, render: (v: string) => <span className="num">{v || 'Chưa đặt lịch'}</span> }, { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} label={v === 'SCHEDULED' ? 'Đã lên lịch' : v === 'FAILED' ? 'Lỗi gửi' : 'Chờ duyệt / Nháp'} /> }, { title: 'Thao tác', width: 120, align: 'right', render: (_, r) => <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => putMut.mutate({ url: `/mkt/announcements/${r.id}`, body: { ...r, status: 'SENT', publish_now: true, version: r.version } })}>Phát ngay</Button> }]} />
      </Card>
    </Space>
  );

  const announcementsPane = (
    <>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginBottom: 14 }}>
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={8} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm mã tin, tiêu đề, nhóm nhận..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 250 }} />
            <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 175 }} options={[{ value: 'ALL', label: 'Mọi trạng thái phát' }, { value: 'SENT', label: 'Đã phát hành' }, { value: 'SCHEDULED', label: 'Đã đặt lịch phát' }, { value: 'DRAFT', label: 'Bản nháp' }, { value: 'FAILED', label: 'Lỗi gửi' }]} />
            <Select value={prioFilter} onChange={setPrioFilter} style={{ width: 165 }} options={[{ value: 'ALL', label: 'Mọi mức độ' }, { value: 'URGENT', label: 'Khẩn cấp' }, { value: 'HIGH', label: 'Quan trọng' }, { value: 'NORMAL', label: 'Thông thường' }]} />
          </Space>
          <Space size={8} wrap>
            <Button icon={<ReloadOutlined />} loading={mktQ.isFetching} onClick={refresh}>Làm mới</Button>
            {canManage && <Button icon={<CalendarOutlined />} onClick={() => openCreateAnc('ALL|ALL', 'SCHEDULED')}>Đặt lịch phát</Button>}
            {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateAnc('ALL|ALL', 'SENT')}>Tạo &amp; Phát thông báo</Button>}
          </Space>
        </Flex>
      </div>
      <SelectableTable
        size="small" rowKey="id" loading={mktQ.isLoading} pagination={ancPag} dataSource={filteredAnc} scroll={{ x: 'max-content' }}
        bulkActions={(rows, clear) => [
          { key: 'excel', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: () => exportToExcel({ fileName: 'Ban_Tin_Da_Chon', sheetTitle: 'Bản tin đã chọn', columns: [{ header: 'Mã tin', render: (r) => String(r.announcement_code ?? '') }, { header: 'Tiêu đề', render: (r) => String(r.title ?? '') }, { header: 'Nhóm người nhận', render: (r) => String(r.audienceLabel ?? '') }, { header: 'Mức độ', render: (r) => String(r.priority ?? '') }, { header: 'Trạng thái', render: (r) => String(r.status ?? '') }], rows }) },
          ...(canManage ? [
            { key: 'send', label: 'Phát thông báo đã chọn', icon: <SendOutlined />, type: 'primary' as const, eligibleFilter: (x: Record<string, unknown>) => x.status !== 'SENT', onClick: async (sel: Record<string, unknown>[]) => { for (const r of sel) await api.put(`/mkt/announcements/${r.id}`, { ...r, status: 'SENT', publish_now: true, version: r.version }); message.success('Đã phát các thông báo đã chọn'); clear(); refresh(); } },
            { key: 'delete', label: 'Xóa thông báo đã chọn', icon: <DeleteOutlined />, danger: true, onClick: () => modal.confirm({ title: `Xác nhận xóa ${rows.length} thông báo đã chọn?`, okText: 'Xóa đã chọn', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: async () => { for (const r of rows) await api.delete(`/mkt/announcements/${r.id}`, { version: r.version }); message.success(`Đã xóa ${rows.length} thông báo`); clear(); refresh(); } }) },
          ] : []),
        ]}
        columns={[
          { title: 'Mã tin', dataIndex: 'announcement_code', width: 95, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Tiêu đề thông báo', dataIndex: 'title', width: 320, render: (v: string, r) => <Typography.Link strong onClick={() => setViewingAnc(r)}>{v}</Typography.Link> },
          { title: 'Nhóm người nhận', dataIndex: 'audienceLabel', width: 190, render: (v: string) => <Tag color="blue">{v || 'Toàn công ty'}</Tag> },
          { title: 'Chiến dịch', dataIndex: 'campaignName', width: 195 },
          { title: 'Mức độ', dataIndex: 'priority', width: 95, render: (v: string) => <Tag color={v === 'URGENT' || v === 'HIGH' ? 'red' : 'blue'}>{v === 'URGENT' ? 'Khẩn cấp' : v === 'HIGH' ? 'Quan trọng' : 'Thông thường'}</Tag> },
          { title: 'Trạng thái', dataIndex: 'status', width: 115, render: (v: string) => <StatusTag value={v} label={v === 'SENT' ? 'Đã phát' : v === 'SCHEDULED' ? 'Đã lên lịch' : v === 'FAILED' ? 'Lỗi gửi' : 'Bản nháp'} /> },
          { title: 'Lịch phát / Ngày gửi & Người tạo', width: 185, render: (_, r) => <div><div className="num" style={{ fontSize: 12 }}>{r.status === 'SENT' && r.sent_at ? dayjs(String(r.sent_at)).format('HH:mm DD/MM/YYYY') : r.scheduled_at ? `Lịch: ${String(r.scheduled_at).slice(0, 10)}` : 'Bản nháp'}</div><div style={{ fontSize: 11, color: '#64748B' }}>Bởi: {String(r.creatorName || r.approved_by || 'Hệ thống')} {Boolean(r.isMine) && <Tag color="cyan" style={{ margin: '0 0 0 4px', fontSize: 10 }}>Của bạn</Tag>}</div></div> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết thông báo" onViewDetail={() => setViewingAnc(r)}
                menuItems={canManage && canEditRow(r) ? [
                  r.status !== 'SENT'
                    ? { key: 'send', icon: <SendOutlined />, label: 'Phát thông báo ngay', onClick: () => putMut.mutate({ url: `/mkt/announcements/${r.id}`, body: { ...r, status: 'SENT', publish_now: true, version: r.version } }) }
                    : { key: 'draft', icon: <CloseOutlined />, label: 'Chuyển về Bản nháp', onClick: () => putMut.mutate({ url: `/mkt/announcements/${r.id}`, body: { ...r, status: 'DRAFT', publish_now: false, version: r.version } }) },
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa thông báo', onClick: () => openEditAnc(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa thông báo', onClick: () => modal.confirm({ title: `Xóa thông báo "${r.title}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/mkt/announcements/${r.id}`, body: { version: r.version } }) }) },
                ] : [{ key: 'ack', icon: <CheckCircleOutlined />, label: 'Xác nhận đã đọc', onClick: () => postMut.mutate({ url: `/announcements/${r.id}/ack`, body: {} }) }]}
              />
            ),
          },
        ]}
      />
    </>
  );

  return (
    <Card size="small" styles={{ body: { padding: '10px 18px 18px' } }}>
      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          ...(canManage ? [{ key: 'dashboard', label: <span><BellOutlined /> Tổng quan &amp; Cảnh báo phát tin</span>, children: dashboardPane }] : []),
          { key: 'announcements', label: <span><NotificationOutlined /> Bản tin, Lịch phát &amp; Đã phát ({filteredAnc.length})</span>, children: announcementsPane },
          ...(canManage ? [{
            key: 'audiences', label: <span><TeamOutlined /> Nhóm người nhận ({data?.audienceGroups?.length ?? 0})</span>,
            children: (
              <>
                <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 10 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>Cấu hình các nhóm người nhận theo Chi nhánh, Giai đoạn hoặc Vị trí công việc (Ẩn 100% dữ liệu HR nhạy cảm).</Typography.Text>
                  <Space size={8}><GuardButton perms={['employee.manage', 'system.config']} roles={['ADMIN', 'HR']} icon={<SettingOutlined />} onClick={() => setPosModal(true)}>Quản lý Vị trí công việc</GuardButton><GuardButton type="primary" perms={['comms.manage', 'employee.manage', 'system.config']} icon={<PlusOutlined />} onClick={openCreateAud}>Cấu hình nhóm người nhận mới</GuardButton></Space>
                </Flex>
                <SelectableTable
                  size="small" rowKey="id" pagination={audPag} dataSource={data?.audienceGroups ?? []}
                  bulkActions={(rows) => [{ key: 'excel', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: () => exportToExcel({ fileName: 'Nhom_Nguoi_Nhan_Da_Chon', sheetTitle: 'Nhóm người nhận', columns: [{ header: 'Tên nhóm', render: (r) => String(r.label ?? '') }, { header: 'Quy mô dự kiến', render: (r) => String(r.recipientCount ?? 0) }], rows }) }]}
                  columns={[
                    { title: 'Tên nhóm người nhận được cấu hình', dataIndex: 'label', width: 340, render: (v: string, r) => <div><Typography.Link strong onClick={() => setViewingAud(r)}>{v}</Typography.Link>{Boolean(r.isCustom) && <Tag color="purple" style={{ margin: '0 0 0 6px' }}>Đã cấu hình</Tag>}</div> },
                    { title: 'Quy mô dự kiến', dataIndex: 'recipientCount', width: 140, render: (v: number) => <Tag color="blue">{v} nhân sự</Tag> },
                    { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết nhóm người nhận" onViewDetail={() => setViewingAud(r)} menuItems={[{ key: 'compose', icon: <SendOutlined style={{ color: '#2563EB' }} />, label: 'Soạn tin cho nhóm này', onClick: () => openCreateAnc(`${r.scope}|${r.target}`, 'SENT') }, { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa cấu hình nhóm', onClick: () => openEditAud(r) }, { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa nhóm người nhận', onClick: () => modal.confirm({ title: `Xóa nhóm "${r.label}"?`, okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync({ url: `/mkt/audience-groups/${encodeURIComponent(String(r.id))}`, body: {} }) }) }]} /> },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'campaigns', label: <span><AudioOutlined /> Chiến dịch Truyền thông ({data?.campaigns?.length ?? 0})</span>,
            children: (
              <>
                <Flex justify="flex-end" style={{ marginBottom: 10 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingCmp(null); cmpForm.resetFields(); cmpForm.setFieldsValue({ campaign_code: `CMP-2026-${Math.floor(10 + Math.random() * 89)}`, channel: 'IN_APP', audience_scope: 'ALL', status: 'RUNNING', scheduled_at: dayjs().format('YYYY-MM-DD') }); setCmpModal(true); }}>Tạo chiến dịch mới</Button></Flex>
                <SelectableTable size="small" rowKey="id" pagination={cmpPag} dataSource={data?.campaigns ?? []} bulkActions={(rows) => [{ key: 'excel', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: () => exportToExcel({ fileName: 'Chien_Dich_Da_Chon', sheetTitle: 'Chiến dịch đã chọn', columns: [{ header: 'Mã chiến dịch', render: (r) => String(r.campaign_code ?? '') }, { header: 'Tên chiến dịch', render: (r) => String(r.name ?? '') }, { header: 'Kênh phát', render: (r) => String(r.channel ?? '') }, { header: 'Trạng thái', render: (r) => String(r.status ?? '') }], rows }) }]} columns={[{ title: 'Mã chiến dịch', dataIndex: 'campaign_code', width: 130, render: (v: string) => <Tag color="geekblue">{v}</Tag> }, { title: 'Tên chiến dịch truyền thông', dataIndex: 'name', render: (v: string) => <strong>{v}</strong> }, { title: 'Kênh phát', dataIndex: 'channel', width: 130, render: (v: string) => <Tag>{v === 'EMAIL' ? 'Email Doanh nghiệp' : 'Cổng Nội bộ'}</Tag> }, { title: 'Tiến độ phát bản tin', width: 200, render: (_, r) => <Progress percent={Number(r.totalAnnouncements) > 0 ? Math.round((Number(r.sentCount) / Number(r.totalAnnouncements)) * 100) : 100} size="small" /> }, { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> }, { title: 'Thao tác', width: 88, align: 'right', render: (_, r) => canEditRow(r) ? <RowActionButtons menuItems={[{ key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa chiến dịch', onClick: () => { setEditingCmp(r); cmpForm.setFieldsValue(r); setCmpModal(true); } }, { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa chiến dịch', onClick: () => delMut.mutate({ url: `/mkt/campaigns/${r.id}`, body: { version: r.version } }) }]} /> : null }]} />
              </>
            ),
          },
          {
            key: 'media', label: <span><FolderOpenOutlined /> Kho Media Nội bộ ({data?.mediaAssets?.length ?? 0})</span>,
            children: (
              <>
                <Flex justify="flex-end" style={{ marginBottom: 10 }}><Button type="primary" icon={<CloudUploadOutlined />} onClick={() => { setEditingMed(null); medForm.resetFields(); medForm.setFieldsValue({ mime_type: 'image/png', size_bytes: 245000, is_internal_only: true }); setMedModal(true); }}>Thêm Ảnh / Tài liệu vào Kho Media</Button></Flex>
                <SelectableTable size="small" rowKey="id" pagination={medPag} dataSource={data?.mediaAssets ?? []} bulkActions={(rows) => [{ key: 'excel', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: () => exportToExcel({ fileName: 'Kho_Media_Da_Chon', sheetTitle: 'Kho Media đã chọn', columns: [{ header: 'Tên tệp', render: (r) => String(r.file_name ?? '') }, { header: 'Định dạng', render: (r) => String(r.mime_type ?? '') }, { header: 'Đường dẫn', render: (r) => String(r.drive_url ?? '') }], rows }) }]} columns={[{ title: 'Tên tệp / Tài liệu', dataIndex: 'file_name', render: (v: string) => <strong>{v}</strong> }, { title: 'Định dạng', dataIndex: 'mime_type', width: 150, render: (v: string) => <Tag color="blue">{v}</Tag> }, { title: 'Đường dẫn tài liệu / Hình ảnh', dataIndex: 'drive_url', ellipsis: true }, { title: 'Phạm vi bảo mật', dataIndex: 'is_internal_only', width: 170, render: (v: boolean) => v ? <Tag color="green">Chỉ lưu hành nội bộ</Tag> : <Tag color="orange">Đã duyệt</Tag> }, { title: 'Thao tác', width: 88, align: 'right', render: (_, r) => canEditRow(r) ? <RowActionButtons menuItems={[{ key: 'edit', icon: <EditOutlined />, label: 'Cập nhật tệp', onClick: () => { setEditingMed(r); medForm.setFieldsValue(r); setMedModal(true); } }, { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa tệp Media', onClick: () => delMut.mutate({ url: `/mkt/media/${r.id}`, body: { version: r.version } }) }]} /> : null }]} />
              </>
            ),
          },
          {
            key: 'delivery', label: <span><RetweetOutlined /> Theo dõi gửi &amp; Xác nhận đọc ({data?.deliveryLogs?.length ?? 0})</span>,
            children: <SelectableTable size="small" rowKey="id" pagination={dlvPag} dataSource={data?.deliveryLogs ?? []} bulkActions={(rows, clear) => [{ key: 'retry', label: 'Thử gửi lại đã chọn', icon: <RetweetOutlined />, type: 'primary' as const, onClick: async () => { for (const r of rows) await api.post(`/mkt/delivery-logs/${r.id}/retry`, {}); message.success(`Đã thử gửi lại ${rows.length} lượt gửi`); clear(); refresh(); } }, { key: 'excel', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: () => exportToExcel({ fileName: 'Lich_Su_Gui_Tin_Da_Chon', sheetTitle: 'Lịch sử gửi tin', columns: [{ header: 'Thông báo', render: (r) => String(r.announcementTitle ?? '') }, { header: 'Người nhận', render: (r) => String(r.recipientName ?? '') }, { header: 'Trạng thái gửi', render: (r) => String(r.status ?? '') }, { header: 'Xác nhận đọc', render: (r) => String(r.readReceiptLabel ?? '') }], rows }) }]} columns={[{ title: 'Thông báo phát', dataIndex: 'announcementTitle', render: (v: string, r) => <div><strong>{v}</strong> <Tag color="geekblue">{String(r.announcementCode || '')}</Tag></div> }, { title: 'Người nhận', dataIndex: 'recipientName', width: 175, render: (v: string) => <Tag color="blue">{v || '—'}</Tag> }, { title: 'Kênh gửi', dataIndex: 'channel', width: 125, render: () => <Tag>Cổng Nội bộ</Tag> }, { title: 'Trạng thái gửi', dataIndex: 'status', width: 115, render: (v: string) => <StatusTag value={v} /> }, { title: 'Số lần gửi lại', dataIndex: 'attempts', width: 120, render: (v: number) => <span className="num">{v ?? 1} lần</span> }, { title: 'Trạng thái xác nhận đọc', dataIndex: 'readReceiptLabel', render: (v: string, r) => <Tag color={r.ack_at ? 'green' : 'default'}>{v}</Tag> }, { title: 'Lỗi gần nhất', dataIndex: 'last_error', width: 170, render: (v: string) => v ? <Tag color="red">{v}</Tag> : <span style={{ color: '#94A3B8' }}>Không có lỗi</span> }, { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons menuItems={[{ key: 'retry', icon: <RetweetOutlined style={{ color: '#2563EB' }} />, label: 'Thử gửi lại thông báo', onClick: () => postMut.mutate({ url: `/mkt/delivery-logs/${r.id}/retry`, body: {} }) }]} /> }]} />,
          }] : []),
        ]}
      />
      <MktAnnouncementModal open={ancModal} editing={editingAnc} form={ancForm} campaigns={data?.campaigns ?? []} audienceGroups={data?.audienceGroups ?? []} mediaAssets={data?.mediaAssets ?? []} loading={postMut.isPending || putMut.isPending} onClose={() => setAncModal(false)} onSubmit={(v) => { if (editingAnc) putMut.mutate({ url: `/mkt/announcements/${editingAnc.id}`, body: { ...v, version: editingAnc.version } }); else postMut.mutate({ url: '/mkt/announcements', body: v }); setAncModal(false); }} />
      <MktAudienceModal open={audModal} editing={editingAud} form={audForm} branches={branchOptions} jobPositionOptions={jobPositionOptions} loading={postMut.isPending || putMut.isPending} onClose={() => setAudModal(false)} onSubmit={(v) => { if (editingAud) putMut.mutate({ url: `/mkt/audience-groups/${encodeURIComponent(String(editingAud.id))}`, body: v }); else postMut.mutate({ url: '/mkt/audience-groups', body: v }); setAudModal(false); }} />
      <MktCampaignModal open={cmpModal} editing={editingCmp} form={cmpForm} loading={postMut.isPending || putMut.isPending} onClose={() => setCmpModal(false)} onSubmit={(v) => { if (editingCmp) putMut.mutate({ url: `/mkt/campaigns/${editingCmp.id}`, body: { ...v, version: editingCmp.version } }); else postMut.mutate({ url: '/mkt/campaigns', body: v }); setCmpModal(false); }} />
      <MktMediaModal open={medModal} editing={editingMed} form={medForm} loading={postMut.isPending || putMut.isPending} onClose={() => setMedModal(false)} onSubmit={(v) => { if (editingAud && false) return; if (editingMed) putMut.mutate({ url: `/mkt/media/${editingMed.id}`, body: { ...v, version: editingMed.version } }); else postMut.mutate({ url: '/mkt/media', body: v }); setMedModal(false); }} />
      <JobPositionsManagerModal open={posModal} onClose={() => setPosModal(false)} />
      <GovernanceDetailDrawer record={viewingAnc} kind="announcement" onClose={() => setViewingAnc(null)} onEdit={viewingAnc && canManage && canEditRow(viewingAnc) ? openEditAnc : undefined} />
      <Modal open={Boolean(viewingAud)} title="Chi tiết Nhóm người nhận" width={640} destroyOnHidden onCancel={() => setViewingAud(null)} footer={<Button icon={<CloseOutlined />} onClick={() => setViewingAud(null)}>Đóng</Button>}>
        {viewingAud && <Descriptions bordered size="small" column={1} style={{ marginTop: 10 }} items={[{ key: 'label', label: 'Tên nhóm người nhận', children: <strong>{String(viewingAud.label)}</strong> }, { key: 'cnt', label: 'Quy mô dự kiến', children: <Tag color="blue">{Number(viewingAud.recipientCount ?? 0)} nhân sự</Tag> }, { key: 'note', label: 'Mô tả & Chính sách bảo mật', children: String(viewingAud.note || 'Ẩn 100% thông tin lương, GPS, ảnh điểm danh và CCCD nhân sự.') }]} />}
      </Modal>
    </Card>
  );
}
