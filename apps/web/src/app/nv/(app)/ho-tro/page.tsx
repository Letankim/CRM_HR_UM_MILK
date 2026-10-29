'use client';

import { App, Button, Card, Empty, Flex, Grid, List, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { TICKET_DEPARTMENT_OPTIONS, TICKET_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
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

export default function EmployeeSupportTicketsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [q, status, dept]);

  const buildQs = (refresh = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (q.trim()) sp.set('q', q.trim());
    if (status) sp.set('status', status);
    if (dept) sp.set('target_department', dept);
    if (refresh) sp.set('refresh', '1');
    return sp.toString();
  };

  const listQ = useQuery({
    queryKey: ['tickets', 'nv', page, perPage, q, status, dept],
    queryFn: () => api.list<SupportTicketItem>(`/tickets?${buildQs(false)}`),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.list<SupportTicketItem>(`/tickets?${buildQs(true)}`);
      qc.setQueryData(['tickets', 'nv', page, perPage, q, status, dept], fresh);
      message.success('Đã đồng bộ danh sách phiếu hỗ trợ của bạn');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ phiếu hỗ trợ thất bại');
    } finally {
      setRefreshing(false);
    }
  };

  const items = listQ.data?.data ?? [];
  const meta = listQ.data?.meta;

  return (
    <div style={{ padding: isDesktop ? 0 : '8px 6px', width: '100%' }}>
      <FilterToolbar
        searchPlaceholder="Tìm mã phiếu, tiêu đề, phân loại..."
        searchValue={q}
        onSearchChange={setQ}
        selects={[
          { key: 'dept', value: dept, width: 190, onChange: setDept, options: [{ value: '', label: 'Tất cả bộ phận' }, ...TICKET_DEPARTMENT_OPTIONS.map((o) => ({ value: o.value, label: shortDept(o.label) }))] },
          { key: 'status', value: status, width: 175, onChange: setStatus, options: [{ value: '', label: 'Mọi trạng thái' }, ...TICKET_STATUS_OPTIONS] },
        ]}
        onRefresh={() => void handleRefresh()}
        refreshing={refreshing}
        onExportExcel={isDesktop ? () => exportTicketsExcel(items) : undefined}
        primaryActionLabel="Tạo phiếu hỗ trợ"
        onPrimaryAction={() => setCreateOpen(true)}
      />

      {isDesktop ? (
        <DataTableCard<SupportTicketItem>
          selectable={false}
          dataSource={items}
          meta={meta}
          loading={listQ.isLoading}
          codeExtractor={(r) => r.ticket_code}
          onPageChange={(p, ps) => { setPage(p); setPerPage(ps); }}
          emptyText="Bạn chưa có phiếu hỗ trợ hoặc thắc mắc nào. Bấm Tạo phiếu hỗ trợ để gửi tới Kế toán, Nhân sự hoặc Quản lý Cửa hàng."
          columns={[
            {
              title: 'Tiêu đề phiếu hỗ trợ', key: 'subject', width: 280, ellipsis: true,
              render: (_, r) => (
                <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => setDetailId(r.id)} title={r.subject}>
                  <div style={{ ...oneLineStyle, fontWeight: 600, fontSize: 13, color: BRAND.primary }}>{r.subject}</div>
                  <div style={{ ...oneLineStyle, fontSize: 12, color: BRAND.textSecondary, marginTop: 2 }}>{r.categoryLabel}</div>
                </div>
              ),
            },
            {
              title: 'Bộ phận xử lý', key: 'dept', width: 175, ellipsis: true,
              render: (_, r) => (
                <div style={{ minWidth: 0 }} title={`${r.departmentLabel} — ${r.assigneeName}`}>
                  <div style={{ ...oneLineStyle, fontWeight: 600, fontSize: 13 }}>{shortDept(r.departmentLabel)}</div>
                  <div style={{ ...oneLineStyle, fontSize: 12, color: r.assignee_user_id ? BRAND.primary : BRAND.textSecondary, marginTop: 2 }}>
                    {r.assignee_user_id ? r.assigneeName : 'Toàn bộ phận'}
                  </div>
                </div>
              ),
            },
            { title: 'Ưu tiên', key: 'prio', width: 100, render: (_, r) => <StatusTag value={r.priority} label={r.priorityLabel} /> },
            { title: 'Trạng thái', key: 'st', width: 145, render: (_, r) => <StatusTag value={r.status} label={r.statusLabel} /> },
            {
              title: 'Cập nhật', key: 'time', width: 120,
              render: (_, r) => <span className="num" style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>{dayjs(r.updated_at || r.created_at).format('HH:mm DD/MM/YYYY')}</span>,
            },
            {
              title: 'Thao tác', key: 'actions', width: 84, align: 'right',
              render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết & Phản hồi" onViewDetail={() => setDetailId(r.id)} />,
            },
          ]}
        />
      ) : (
        <Card size="small" styles={{ body: { padding: 0 } }}>
          {listQ.isLoading ? (
            <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div>
          ) : items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bạn chưa có phiếu hỗ trợ hoặc thắc mắc nào." style={{ padding: 24 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo phiếu hỗ trợ</Button>
            </Empty>
          ) : (
            <List
              dataSource={items}
              renderItem={(t) => (
                <List.Item style={{ padding: '10px 12px', cursor: 'pointer' }} onClick={() => setDetailId(t.id)}>
                  <div style={{ width: '100%', minWidth: 0 }}>
                    <Flex justify="space-between" align="center" gap={8}>
                      <Space size={6} style={{ minWidth: 0, flex: 1 }}>
                        <Tag color="geekblue" style={{ margin: 0 }}>{t.ticket_code}</Tag>
                        <Typography.Text strong ellipsis style={{ fontSize: 13 }}>{t.subject}</Typography.Text>
                      </Space>
                      <StatusTag value={t.status} label={t.statusLabel} />
                    </Flex>
                    <Flex justify="space-between" align="center" style={{ marginTop: 4, fontSize: 12, color: BRAND.textSecondary }}>
                      <span>{shortDept(t.departmentLabel)}</span>
                      <span className="num">{dayjs(t.updated_at || t.created_at).format('HH:mm DD/MM')}</span>
                    </Flex>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}

      <TicketCreateEditModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(saved) => setDetailId(saved.id)} />
      <TicketDetailDrawer ticketId={detailId} isBackoffice={false} onClose={() => setDetailId(null)} />
    </div>
  );
}
