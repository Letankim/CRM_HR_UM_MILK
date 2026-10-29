'use client';

import { App, Card, Col, Row, Typography } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, CustomerServiceOutlined,
  DeleteOutlined, EditOutlined, FileExcelOutlined, SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { TICKET_DEPARTMENT_OPTIONS, TICKET_STATUS_OPTIONS } from '@umbm/shared';
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

const shortDept = (label: string) => label.replace(/^(Bộ phận|Phòng|Ban)\s+/i, '');
const oneLineStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { data: me } = useMe();
  const [q, setQ] = useState(''), [scope, setScope] = useState('ALL'), [dept, setDept] = useState(''), [status, setStatus] = useState('');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(12), [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false), [editing, setEditing] = useState<SupportTicketItem | null>(null), [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [q, scope, dept, status]);

  const buildQs = (refresh = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage), scope });
    if (q.trim()) sp.set('q', q.trim());
    if (dept) sp.set('target_department', dept);
    if (status) sp.set('status', status);
    if (refresh) sp.set('refresh', '1');
    return sp.toString();
  };

  const listQ = useQuery({
    queryKey: ['tickets', page, perPage, q, scope, dept, status],
    queryFn: () => api.list<SupportTicketItem>(`/tickets?${buildQs(false)}`),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.list<SupportTicketItem>(`/tickets?${buildQs(true)}`);
      qc.setQueryData(['tickets', page, perPage, q, scope, dept, status], fresh);
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
  const isRequesterRow = (r: SupportTicketItem) => Boolean(r.isRequester ?? r.requester_user_id === me?.user.id);
  const isAssignedRow = (r: SupportTicketItem) =>
    Boolean(r.isAssignedToMe ?? (!isRequesterRow(r) && (r.assignee_user_id ? r.assignee_user_id === me?.user.id : r.target_department === me?.user.role)));
  const canForwardRow = (r: SupportTicketItem) => r.status !== 'CLOSED' && Boolean(r.canForward ?? isAssignedRow(r));
  const canEditOwnRow = (r: SupportTicketItem) => r.status === 'OPEN' && isRequesterRow(r);
  const canDeleteRow = (r: SupportTicketItem) => me?.user.role === 'ADMIN' || me?.user.role === 'HR' || isRequesterRow(r);

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
        searchPlaceholder="Tìm mã phiếu, tiêu đề, người gửi, phân loại..."
        searchValue={q}
        onSearchChange={setQ}
        selects={[
          {
            key: 'scope', value: scope, width: 185, onChange: setScope,
            options: [
              { value: 'ALL', label: 'Tất cả phiếu thuộc phạm vi' },
              { value: 'ASSIGNED_TO_ME', label: 'Giao cho tôi / Bộ phận' },
              { value: 'DIRECT_TO_ME', label: 'Chỉ định đích danh tôi' },
              { value: 'CREATED_BY_ME', label: 'Phiếu do tôi tạo' },
            ],
          },
          { key: 'dept', value: dept, width: 190, onChange: setDept, options: [{ value: '', label: 'Tất cả bộ phận' }, ...TICKET_DEPARTMENT_OPTIONS.map((o) => ({ value: o.value, label: shortDept(o.label) }))] },
          { key: 'status', value: status, width: 175, onChange: setStatus, options: [{ value: '', label: 'Mọi trạng thái' }, ...TICKET_STATUS_OPTIONS] },
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
          { key: 'progress', label: 'Tiếp nhận xử lý', icon: <SyncOutlined />, eligibleFilter: (r) => isAssignedRow(r) && r.status === 'OPEN', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'IN_PROGRESS' }, { onSuccess: clr }) },
          { key: 'resolve', label: 'Đánh dấu Đã giải quyết', type: 'primary', icon: <CheckCircleOutlined />, eligibleFilter: (r) => isAssignedRow(r) && (r.status === 'OPEN' || r.status === 'IN_PROGRESS'), confirm: 'Đánh dấu hoàn tất giải quyết các phiếu đã chọn?', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'RESOLVE' }, { onSuccess: clr }) },
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <FileExcelOutlined />, onClick: (sel) => exportTicketsExcel(sel) },
          { key: 'delete', label: 'Xóa đã chọn', danger: true, icon: <DeleteOutlined />, eligibleFilter: canDeleteRow, confirm: 'Xóa các phiếu hỗ trợ đã chọn?', onClick: (sel, clr) => bulkMut.mutate({ ids: sel.map((r) => r.id), action: 'DELETE' }, { onSuccess: clr }) },
        ]}
        columns={[
          {
            title: 'Tiêu đề phiếu hỗ trợ', key: 'subject', width: 230, ellipsis: true,
            render: (_, r) => (
              <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => setDetailId(r.id)} title={r.subject}>
                <div style={{ ...oneLineStyle, fontWeight: 600, fontSize: 13, color: BRAND.primary }}>{r.subject}</div>
                <div style={{ ...oneLineStyle, fontSize: 12, color: BRAND.textSecondary, marginTop: 2 }}>{r.categoryLabel}</div>
              </div>
            ),
          },
          {
            title: 'Người gửi', key: 'req', width: 145, ellipsis: true,
            render: (_, r) => (
              <div style={{ minWidth: 0 }} title={`${r.requesterName} · ${r.branchName}`}>
                <div style={{ ...oneLineStyle, fontWeight: 600, fontSize: 13 }}>{r.requesterName}</div>
                <div style={{ ...oneLineStyle, fontSize: 12, color: BRAND.textSecondary, marginTop: 2 }}>{r.branchName}</div>
              </div>
            ),
          },
          {
            title: 'Bộ phận xử lý', key: 'dept', width: 155, ellipsis: true,
            render: (_, r) => (
              <div style={{ minWidth: 0 }} title={`${r.departmentLabel} — ${r.assigneeName}`}>
                <div style={{ ...oneLineStyle, fontWeight: 600, fontSize: 13 }}>{shortDept(r.departmentLabel)}</div>
                <div style={{ ...oneLineStyle, fontSize: 12, color: r.assignee_user_id ? BRAND.primary : BRAND.textSecondary, marginTop: 2 }}>
                  {r.assignee_user_id ? r.assigneeName : 'Toàn bộ phận'}
                </div>
              </div>
            ),
          },
          { title: 'Ưu tiên', key: 'prio', width: 118, render: (_, r) => <StatusTag value={r.priority} label={r.priorityLabel} /> },
          { title: 'Trạng thái', key: 'st', width: 192, render: (_, r) => <StatusTag value={r.status} label={r.statusLabel} /> },
          {
            title: 'Cập nhật', key: 'time', width: 138,
            render: (_, r) => <span className="num" style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>{dayjs(r.updated_at || r.created_at).format('HH:mm DD/MM/YYYY')}</span>,
          },
          {
            title: 'Thao tác', key: 'actions', width: 84, align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem & Phản hồi phiếu hỗ trợ"
                onViewDetail={() => setDetailId(r.id)}
                loading={deleteMut.isPending}
                menuItems={[
                  ...(canForwardRow(r) ? [{ key: 'forward', icon: <EditOutlined />, label: 'Điều phối / Chuyển bộ phận', onClick: () => { setEditing(r); setModalOpen(true); } }] : []),
                  ...(canEditOwnRow(r) ? [{ key: 'edit', icon: <EditOutlined />, label: 'Sửa nội dung phiếu', onClick: () => { setEditing(r); setModalOpen(true); } }] : []),
                  ...(canDeleteRow(r) ? [{
                    key: 'del', danger: true, icon: <DeleteOutlined />, label: 'Xóa phiếu hỗ trợ',
                    onClick: () => modal.confirm({
                      title: `Xóa phiếu hỗ trợ ${r.ticket_code}?`, content: 'Phiếu sẽ được ẩn an toàn khỏi danh sách.',
                      okText: 'Xóa phiếu', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelText: 'Hủy', cancelButtonProps: { icon: <CloseOutlined /> },
                      onOk: () => deleteMut.mutateAsync(r.id),
                    }),
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
