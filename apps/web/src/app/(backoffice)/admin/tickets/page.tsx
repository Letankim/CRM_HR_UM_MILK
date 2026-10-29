'use client';

import { App, Card, Col, Row, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CustomerServiceOutlined, DeleteOutlined,
  EditOutlined, FileExcelOutlined, MessageOutlined, SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import {
  TICKET_CATEGORY_OPTIONS, TICKET_DEPARTMENT_OPTIONS, TICKET_PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS,
} from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { TicketCreateEditModal } from '@/ui/components/TicketCreateEditModal';
import { TicketDetailDrawer } from '@/ui/components/TicketDetailDrawer';
import { exportTicketsExcel, type SupportTicketItem } from '@/ui/components/ticket-types';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { data: me } = useMe();
  const [q, setQ] = useState(''), [scope, setScope] = useState('ALL'), [dept, setDept] = useState('');
  const [category, setCategory] = useState(''), [priority, setPriority] = useState(''), [status, setStatus] = useState('');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(12), [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false), [editing, setEditing] = useState<SupportTicketItem | null>(null), [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [q, scope, dept, category, priority, status]);

  const buildQs = (refresh = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage), scope });
    if (q.trim()) sp.set('q', q.trim());
    if (dept) sp.set('target_department', dept);
    if (category) sp.set('category', category);
    if (priority) sp.set('priority', priority);
    if (status) sp.set('status', status);
    if (refresh) sp.set('refresh', '1');
    return sp.toString();
  };

  const listQ = useQuery({
    queryKey: ['tickets', page, perPage, q, scope, dept, category, priority, status],
    queryFn: () => api.list<SupportTicketItem>(`/tickets?${buildQs(false)}`),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.list<SupportTicketItem>(`/tickets?${buildQs(true)}`);
      qc.setQueryData(['tickets', page, perPage, q, scope, dept, category, priority, status], fresh);
      message.success('Đã đồng bộ danh sách phiếu hỗ trợ mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ phiếu hỗ trợ thất bại');
    } finally {
      setRefreshing(false);
    }
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/tickets/${id}`),
    onSuccess: () => {
      message.success('Đã xóa phiếu hỗ trợ thành công');
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể xóa phiếu hỗ trợ'),
  });

  const bulkMut = useMutation({
    mutationFn: (payload: { ids: string[]; action: 'IN_PROGRESS' | 'RESOLVE' | 'CLOSE' | 'DELETE' }) => api.post('/tickets/bulk-action', payload),
    onSuccess: () => {
      message.success('Đã thực hiện thao tác hàng loạt thành công');
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác hàng loạt thất bại'),
  });

  const rows = listQ.data?.data ?? [];
  const meta = listQ.data?.meta;
  const openCount = Number(meta?.filters?.open_count ?? 0);
  const inProgressCount = Number(meta?.filters?.in_progress_count ?? 0);
  const resolvedCount = Number(meta?.filters?.resolved_count ?? 0);
  const totalCount = meta?.pagination.total ?? rows.length;
  const canDeleteRow = (r: SupportTicketItem) => me?.user.role === 'ADMIN' || me?.user.role === 'HR' || r.requester_user_id === me?.user.id;

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          { label: 'Tổng phiếu hỗ trợ', val: totalCount, color: BRAND.primary, icon: <CustomerServiceOutlined /> },
          { label: 'Chờ tiếp nhận', val: openCount, color: '#D97706', icon: <ClockCircleOutlined /> },
          { label: 'Đang xử lý', val: inProgressCount, color: '#2563EB', icon: <SyncOutlined /> },
          { label: 'Đã phản hồi / Giải quyết', val: resolvedCount, color: '#15803D', icon: <CheckCircleOutlined /> },
        ].map((k) => (
          <Col xs={12} md={6} key={k.label}>
            <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
              <div style={{ fontSize: 12, color: BRAND.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>{k.icon}<span>{k.label}</span></div>
              <div className="num" style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.val}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <FilterToolbar
        searchPlaceholder="Tìm mã phiếu, tiêu đề, người gửi, người phụ trách..."
        searchValue={q}
        onSearchChange={setQ}
        selects={[
          {
            key: 'scope', value: scope, width: 205, onChange: setScope,
            options: [
              { value: 'ALL', label: 'Tất cả phiếu thuộc phạm vi' },
              { value: 'ASSIGNED_TO_ME', label: 'Giao cho tôi / Bộ phận tôi' },
              { value: 'DIRECT_TO_ME', label: 'Chỉ định đích danh tôi' },
              { value: 'CREATED_BY_ME', label: 'Phiếu do tôi tạo' },
            ],
          },
          { key: 'dept', value: dept, width: 205, onChange: setDept, options: [{ value: '', label: 'Tất cả bộ phận tiếp nhận' }, ...TICKET_DEPARTMENT_OPTIONS] },
          { key: 'cat', value: category, width: 210, onChange: setCategory, options: [{ value: '', label: 'Tất cả phân loại' }, ...TICKET_CATEGORY_OPTIONS] },
          { key: 'status', value: status, width: 175, onChange: setStatus, options: [{ value: '', label: 'Mọi trạng thái' }, ...TICKET_STATUS_OPTIONS] },
          { key: 'prio', value: priority, width: 150, onChange: setPriority, options: [{ value: '', label: 'Mọi mức ưu tiên' }, ...TICKET_PRIORITY_OPTIONS] },
        ]}
        onRefresh={() => void handleRefresh()}
        refreshing={refreshing}
        onExportExcel={() => exportTicketsExcel(rows)}
        primaryActionLabel="Tạo phiếu hỗ trợ"
        onPrimaryAction={() => { setEditing(null); setModalOpen(true); }}
      />

      <DataTableCard<SupportTicketItem>
        dataSource={rows}
        meta={meta}
        loading={listQ.isLoading}
        codeExtractor={(r) => r.ticket_code}
        onPageChange={(p, ps) => { setPage(p); setPerPage(ps); }}
        bulkActions={[
          { key: 'progress', label: 'Tiếp nhận xử lý', icon: <SyncOutlined />, eligibleFilter: (r) => r.status === 'OPEN', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'IN_PROGRESS' }, { onSuccess: clr }) },
          { key: 'resolve', label: 'Đánh dấu Đã giải quyết', type: 'primary', icon: <CheckCircleOutlined />, eligibleFilter: (r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS', confirm: 'Đánh dấu hoàn tất giải quyết các phiếu đã chọn?', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'RESOLVE' }, { onSuccess: clr }) },
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: (sel) => exportTicketsExcel(sel) },
          { key: 'delete', label: 'Xóa đã chọn', danger: true, icon: <DeleteOutlined />, eligibleFilter: canDeleteRow, confirm: 'Xóa các phiếu hỗ trợ đã chọn?', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'DELETE' }, { onSuccess: clr }) },
        ]}
        columns={[
          {
            title: 'Tiêu đề & Nội dung thắc mắc', key: 'subject', width: 310,
            render: (_, r) => (
              <div style={{ cursor: 'pointer' }} onClick={() => setDetailId(r.id)}>
                <Space size={6} wrap>
                  <Typography.Text strong style={{ color: BRAND.primary }}>{r.subject}</Typography.Text>
                  {r.related_label && <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{r.related_label}</Tag>}
                </Space>
                <div style={{ fontSize: 12, color: BRAND.textSecondary, marginTop: 2 }}>{r.categoryLabel}</div>
              </div>
            ),
          },
          {
            title: 'Người gửi & Chi nhánh', key: 'req', width: 210,
            render: (_, r) => (
              <div>
                <Typography.Text strong>{r.requesterName}</Typography.Text>
                <div style={{ fontSize: 12, color: BRAND.textSecondary }}>{r.requesterRoleLabel} · {r.branchName}</div>
              </div>
            ),
          },
          {
            title: 'Bộ phận & Người xử lý', key: 'dept', width: 235,
            render: (_, r) => (
              <div>
                <Typography.Text strong>{r.departmentLabel}</Typography.Text>
                <div style={{ fontSize: 12, color: r.assignee_user_id ? BRAND.primary : BRAND.textSecondary }}>Phụ trách: {r.assigneeName}</div>
              </div>
            ),
          },
          { title: 'Ưu tiên', key: 'prio', width: 120, render: (_, r) => <StatusTag value={r.priority} label={r.priorityLabel} /> },
          {
            title: 'Trạng thái & Trao đổi', key: 'st', width: 180,
            render: (_, r) => (
              <Space direction="vertical" size={2}>
                <StatusTag value={r.status} label={r.statusLabel} />
                <span style={{ fontSize: 11.5, color: BRAND.textSecondary }}><MessageOutlined /> {r.messageCount} tin trao đổi · {dayjs(r.updated_at || r.created_at).format('DD/MM HH:mm')}</span>
              </Space>
            ),
          },
          {
            title: 'Thao tác', key: 'actions', width: 92,
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem & Phản hồi phiếu hỗ trợ"
                onViewDetail={() => setDetailId(r.id)}
                loading={deleteMut.isPending}
                menuItems={[
                  { key: 'edit', icon: <EditOutlined />, label: 'Sửa / Điều phối bộ phận', onClick: () => { setEditing(r); setModalOpen(true); } },
                  ...(canDeleteRow(r) ? [{
                    key: 'del', danger: true, icon: <DeleteOutlined />, label: 'Xóa phiếu hỗ trợ',
                    onClick: () => modal.confirm({ title: `Xóa phiếu hỗ trợ ${r.ticket_code}?`, content: 'Phiếu sẽ được ẩn an toàn khỏi danh sách.', okText: 'Xóa phiếu', okButtonProps: { danger: true }, cancelText: 'Hủy', onOk: () => deleteMut.mutateAsync(r.id) }),
                  }] : []),
                ]}
              />
            ),
          },
        ]}
      />

      <TicketCreateEditModal open={modalOpen} editingTicket={editing} onClose={() => { setModalOpen(false); setEditing(null); }} />
      <TicketDetailDrawer ticketId={detailId} isBackoffice onClose={() => setDetailId(null)} />
    </div>
  );
}
