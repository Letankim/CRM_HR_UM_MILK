'use client';

import { App, Badge, Button, Card, Col, Form, Row, Space, Statistic, Switch, Tag, Typography } from 'antd';
import {
  BellOutlined, CheckCircleOutlined, CloseOutlined, DeleteOutlined,
  ExclamationCircleOutlined, FileExcelOutlined, LinkOutlined, MutedOutlined, SoundOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useNotificationSound } from '@/lib/notification-sound';
import { PageHeader } from '../PageHeader';
import { DataTableCard } from './DataTableCard';
import { FilterToolbar } from './FilterToolbar';
import {
  NOTIFICATION_CATEGORY_OPTIONS,
  NOTIFICATION_READ_OPTIONS,
  NOTIFICATION_SCOPE_OPTIONS,
  NOTIFICATION_SEVERITY_OPTIONS,
  NotificationDetailDrawer,
  type NotificationItem,
  SendNotificationModal,
} from './NotificationModals';
import { RowActionButtons } from './RowActionButtons';

export function NotificationsCenterView({ portal = 'backoffice' }: { portal?: 'backoffice' | 'employee' }) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const canSend = can('notification.send', 'comms.manage', 'system.config');
  const { message, modal } = App.useApp();
  const { soundEnabled, setSoundEnabled, playTestSound } = useNotificationSound();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('ALL');
  const [scopeType, setScopeType] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [readStatus, setReadStatus] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [viewing, setViewing] = useState<NotificationItem | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm] = Form.useForm();

  const queryParams = new URLSearchParams({
    page: String(page), per_page: String(perPage), sort_by: 'created_at', sort_order: sortOrder,
    ...(q ? { q } : {}), ...(category !== 'ALL' ? { category } : {}), ...(scopeType !== 'ALL' ? { scope_type: scopeType } : {}),
    ...(severity !== 'ALL' ? { severity } : {}), ...(readStatus !== 'ALL' ? { read_status: readStatus } : {}),
  }).toString();

  const listQ = useQuery({ queryKey: ['notifications', 'list', queryParams], queryFn: () => api.list<NotificationItem>(`/notifications?${queryParams}`) });
  const allStatsQ = useQuery({ queryKey: ['notifications', 'stats'], queryFn: () => api.list<NotificationItem>('/notifications?per_page=100') });
  const usersQ = useQuery({ queryKey: ['notifications', 'recipients'], queryFn: () => api.get<{ id: string; username: string; displayName: string; roleLabel: string }[]>('/notifications/recipients'), enabled: canSend });

  const refreshAll = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readMut = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}), onSuccess: refreshAll });
  const markAllMut = useMutation({ mutationFn: (ids?: string[]) => api.post('/notifications/mark-all-read', { ids }), onSuccess: () => { message.success('Đã đánh dấu đã đọc các thông báo'); refreshAll(); } });
  const delMut = useMutation({ mutationFn: (id: string) => api.delete(`/notifications/${id}`), onSuccess: () => { message.success('Đã xóa thông báo thành công'); refreshAll(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thông báo thất bại') });
  const sendMut = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post('/notifications', body), onSuccess: () => { message.success('Đã phát hành và gửi thông báo thành công'); setSendOpen(false); sendForm.resetFields(); refreshAll(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Gửi thông báo thất bại') });

  const handleOpenDetail = (record: NotificationItem) => {
    const nowIso = new Date().toISOString();
    setViewing({ ...record, readStatus: 'READ', readStatusLabel: 'Đã đọc', read_at: record.read_at || nowIso });
    if (record.readStatus === 'UNREAD') readMut.mutate(record.id);
  };

  const handleExport = (rows: NotificationItem[]) => {
    exportToExcel<NotificationItem>({
      fileName: `Danh_Sach_Thong_Bao_${dayjs().format('YYYYMMDD_HHmm')}`,
      sheetTitle: 'DANH SÁCH THÔNG BÁO & BẢN TIN HỆ THỐNG ĐÃ NHẬN',
      columns: [
        { header: 'Mã thông báo', key: 'code' },
        { header: 'Phân loại', key: 'categoryLabel' },
        { header: 'Tiêu đề', key: 'title' },
        { header: 'Nội dung tóm tắt', key: 'body' },
        { header: 'Đối tượng nhận', key: 'targetLabel' },
        { header: 'Mức độ', key: 'severityLabel' },
        { header: 'Trạng thái', key: 'readStatusLabel' },
        { header: 'Thời gian nhận', key: 'created_at' },
      ],
      rows,
    });
  };

  const allItems = allStatsQ.data?.data ?? listQ.data?.data ?? [];
  const totalCount = allStatsQ.data?.meta.pagination.total ?? listQ.data?.meta.pagination.total ?? 0;
  const unreadCount = allItems.filter((i) => i.readStatus === 'UNREAD').length;
  const urgentCount = allItems.filter((i) => i.severity === 'CRITICAL' || i.severity === 'WARNING').length;
  const targetedCount = allItems.filter((i) => i.scopeType !== 'BROADCAST').length;

  const soundControlBar = (
    <Space size={8} wrap>
      <Space size={6} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #E5E7EB', background: '#F8FAFC' }}>
        {soundEnabled ? <SoundOutlined style={{ color: '#2563EB' }} /> : <MutedOutlined style={{ color: '#64748B' }} />}
        <span style={{ fontSize: 12, fontWeight: 600 }}>Chuông thông báo:</span>
        <Switch size="small" checked={soundEnabled} onChange={(val) => { setSoundEnabled(val); message.success(val ? 'Đã bật âm thanh thông báo' : 'Đã tắt âm thanh thông báo'); }} checkedChildren="Đang bật" unCheckedChildren="Đang tắt" />
      </Space>
      <Button size="small" icon={<SoundOutlined />} onClick={playTestSound}>Nghe thử chuông</Button>
      <Button size="small" icon={<CheckCircleOutlined />} onClick={() => markAllMut.mutate(undefined)} loading={markAllMut.isPending} disabled={unreadCount === 0}>
        Đánh dấu tất cả đã đọc ({unreadCount})
      </Button>
    </Space>
  );

  return (
    <div>
      {portal === 'backoffice' ? (
        <PageHeader
          title="Trung tâm Thông báo & Hộp thư Hệ thống"
          description="Theo dõi toàn bộ bản tin nội bộ, thông báo theo vai trò và thông báo cá nhân được cập nhật tức thời."
          extra={soundControlBar}
        />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Cấu hình bật / tắt âm thanh chuông báo khi có thông báo mới (lưu trên trình duyệt của bạn).</Typography.Text>
          {soundControlBar}
        </div>
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng thông báo đã nhận" value={totalCount} prefix={<BellOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Chưa đọc" value={unreadCount} prefix={<Badge status={unreadCount > 0 ? 'processing' : 'default'} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Quan trọng & Khẩn cấp" value={urgentCount} prefix={<ExclamationCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Theo vai trò & Cá nhân" value={targetedCount} prefix={<TeamOutlined />} /></Card></Col>
      </Row>

      <FilterToolbar
        searchPlaceholder="Tìm theo mã, tiêu đề, nội dung, vai trò nhận..."
        searchValue={q}
        onSearchChange={(val) => { setQ(val); setPage(1); }}
        selects={[
          { key: 'cat', value: category, width: 215, options: NOTIFICATION_CATEGORY_OPTIONS, onChange: (v) => { setCategory(v); setPage(1); } },
          { key: 'scope', value: scopeType, width: 210, options: NOTIFICATION_SCOPE_OPTIONS, onChange: (v) => { setScopeType(v); setPage(1); } },
          { key: 'sev', value: severity, width: 155, options: NOTIFICATION_SEVERITY_OPTIONS, onChange: (v) => { setSeverity(v); setPage(1); } },
          { key: 'read', value: readStatus, width: 170, options: NOTIFICATION_READ_OPTIONS, onChange: (v) => { setReadStatus(v); setPage(1); } },
          { key: 'sort', value: sortOrder, width: 165, options: [{ value: 'desc', label: 'Mới nhất trước' }, { value: 'asc', label: 'Cũ nhất trước' }], onChange: (v) => { setSortOrder(v as 'desc' | 'asc'); setPage(1); } },
        ]}
        onRefresh={refreshAll}
        refreshing={listQ.isFetching}
        onExportExcel={() => handleExport(listQ.data?.data ?? [])}
        primaryActionLabel={canSend ? 'Phát thông báo mới' : undefined}
        onPrimaryAction={canSend ? () => { sendForm.resetFields(); setSendOpen(true); } : undefined}
      />

      <DataTableCard<NotificationItem>
        dataSource={listQ.data?.data ?? []}
        meta={listQ.data?.meta}
        loading={listQ.isLoading}
        codeExtractor={(r) => r.code}
        onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
        bulkActions={[
          { key: 'bulk-read', label: 'Đánh dấu đã đọc đã chọn', type: 'primary', icon: <CheckCircleOutlined />, eligibleFilter: (r) => r.readStatus === 'UNREAD', onClick: (rows, clear) => { markAllMut.mutate(rows.map((r) => r.id)); clear(); } },
          { key: 'bulk-export', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: (rows) => { handleExport(rows); } },
          { key: 'bulk-del', label: 'Xóa đã chọn', danger: true, icon: <DeleteOutlined />, onClick: (rows, clear) => { modal.confirm({ title: `Xóa ${rows.length} thông báo đã chọn?`, content: 'Các thông báo đã chọn sẽ được xóa khỏi hộp thư của bạn.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: async () => { await Promise.all(rows.map((r) => api.delete(`/notifications/${r.id}`))); refreshAll(); clear(); } }); } },
        ]}
        columns={[
          {
            title: 'Tiêu đề & Nội dung thông báo',
            dataIndex: 'title',
            ellipsis: true,
            render: (_, r) => (
              <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => handleOpenDetail(r)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.readStatus === 'UNREAD' && <Badge status="processing" color="#2563EB" />}
                  <Typography.Link strong={r.readStatus === 'UNREAD'} style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</Typography.Link>
                </div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.body}</div>
              </div>
            ),
          },
          { title: 'Phân loại', dataIndex: 'categoryLabel', width: 150, ellipsis: true, render: (v: string) => <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> },
          { title: 'Đối tượng nhận', dataIndex: 'targetLabel', width: 160, ellipsis: true, render: (v: string, r) => <Tag color={r.scopeType === 'PERSONAL' ? 'purple' : r.scopeType === 'ROLE' ? 'cyan' : 'geekblue'} style={{ margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</Tag> },
          { title: 'Mức độ', dataIndex: 'severityLabel', width: 88, render: (v: string, r) => <Tag color={r.severity === 'CRITICAL' ? 'red' : r.severity === 'WARNING' ? 'gold' : 'default'} style={{ margin: 0 }}>{v}</Tag> },
          { title: 'Trạng thái', dataIndex: 'readStatusLabel', width: 86, render: (v: string, r) => <Tag color={r.readStatus === 'READ' ? 'green' : 'gold'} style={{ margin: 0 }}>{v}</Tag> },
          { title: 'Thời gian nhận', dataIndex: 'created_at', width: 118, render: (v: string) => <span className="num" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{dayjs(v).format('HH:mm DD/MM/YYYY')}</span> },
          {
            title: 'Thao tác', key: 'actions', width: 84, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết thông báo"
                onViewDetail={() => handleOpenDetail(r)}
                menuItems={[
                  ...(r.readStatus === 'UNREAD' ? [{ key: 'read', icon: <CheckCircleOutlined />, label: 'Đánh dấu đã đọc', onClick: () => readMut.mutate(r.id) }] : []),
                  ...(r.link ? [{ key: 'goto', icon: <LinkOutlined />, label: 'Đi tới màn hình liên quan', onClick: () => router.push(r.link) }] : []),
                  { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa thông báo', onClick: () => delMut.mutate(r.id) },
                ]}
              />
            ),
          },
        ]}
      />

      <NotificationDetailDrawer record={viewing} onClose={() => setViewing(null)} onNavigate={(l) => router.push(l)} />
      <SendNotificationModal
        open={sendOpen}
        form={sendForm}
        loading={sendMut.isPending}
        userOptions={(usersQ.data ?? []).map((u) => ({ value: u.id, label: `${u.displayName} (@${u.username}) · ${u.roleLabel}` }))}
        onClose={() => setSendOpen(false)}
        onSubmit={(v) => sendMut.mutate(v)}
      />
    </div>
  );
}
