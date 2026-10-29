'use client';

import { App, Button, Card, Empty, Flex, Grid, Input, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { CustomerServiceOutlined, MessageOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { TICKET_CATEGORY_OPTIONS, TICKET_DEPARTMENT_OPTIONS, TICKET_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { TicketCreateEditModal } from '@/ui/components/TicketCreateEditModal';
import { TicketDetailDrawer } from '@/ui/components/TicketDetailDrawer';
import type { SupportTicketItem } from '@/ui/components/ticket-types';
import { useDebouncedValue } from '@/ui/hooks/useDebouncedValue';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';

export default function EmployeeSupportTicketsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [category, setCategory] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const buildQs = (refresh = false) => {
    const sp = new URLSearchParams({ per_page: '50' });
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    if (status) sp.set('status', status);
    if (dept) sp.set('target_department', dept);
    if (category) sp.set('category', category);
    if (refresh) sp.set('refresh', '1');
    return sp.toString();
  };

  const listQ = useQuery({
    queryKey: ['tickets', 'nv', debouncedQ, status, dept, category],
    queryFn: () => api.list<SupportTicketItem>(`/tickets?${buildQs(false)}`),
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.list<SupportTicketItem>(`/tickets?${buildQs(true)}`);
      qc.setQueryData(['tickets', 'nv', debouncedQ, status, dept, category], fresh);
      message.success('Đã đồng bộ danh sách phiếu hỗ trợ của bạn');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ phiếu hỗ trợ thất bại');
    } finally {
      setRefreshing(false);
    }
  };

  const items = listQ.data?.data ?? [];

  return (
    <div style={{ padding: isDesktop ? 0 : '8px 6px', width: '100%' }}>
      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={<span><CustomerServiceOutlined /> Phiếu hỗ trợ &amp; Giải đáp thắc mắc ({items.length})</span>}
        extra={
          <Space size={8}>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleRefresh()}>Làm mới</Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo phiếu hỗ trợ</Button>
          </Space>
        }
      >
        <Flex gap={8} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            placeholder="Tìm theo mã phiếu, tiêu đề, nội dung..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: isDesktop ? 260 : '100%' }}
          />
          <Select value={dept} onChange={setDept} style={{ width: isDesktop ? 205 : '100%' }} options={[{ value: '', label: 'Mọi bộ phận tiếp nhận' }, ...TICKET_DEPARTMENT_OPTIONS]} />
          <Select value={category} onChange={setCategory} style={{ width: isDesktop ? 210 : '100%' }} options={[{ value: '', label: 'Mọi phân loại vấn đề' }, ...TICKET_CATEGORY_OPTIONS]} />
          <Select value={status} onChange={setStatus} style={{ width: isDesktop ? 175 : '100%' }} options={[{ value: '', label: 'Mọi trạng thái xử lý' }, ...TICKET_STATUS_OPTIONS]} />
        </Flex>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        {listQ.isLoading ? (
          <div style={{ padding: 28, textAlign: 'center' }}><Spin /></div>
        ) : items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Bạn chưa có phiếu hỗ trợ hoặc thắc mắc nào. Bấm Tạo phiếu hỗ trợ để gửi trực tiếp tới Kế toán, Nhân sự hoặc Quản lý Cửa hàng."
            style={{ padding: 28 }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Gửi phiếu hỗ trợ ngay</Button>
          </Empty>
        ) : (
          <List
            dataSource={items}
            renderItem={(t) => {
              const lastMsg = t.messages[t.messages.length - 1];
              return (
                <List.Item style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => setDetailId(t.id)}>
                  <div style={{ width: '100%' }}>
                    <Flex justify="space-between" align="flex-start" wrap gap={8}>
                      <Space size={6} wrap>
                        <Tag color="geekblue" style={{ margin: 0 }}>{t.ticket_code}</Tag>
                        <Typography.Text strong style={{ fontSize: 14 }}>{t.subject}</Typography.Text>
                        <StatusTag value={t.status} label={t.statusLabel} />
                        <StatusTag value={t.priority} label={t.priorityLabel} />
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <MessageOutlined /> {t.messageCount} trao đổi · {dayjs(t.updated_at || t.created_at).format('HH:mm DD/MM/YYYY')}
                      </Typography.Text>
                    </Flex>
                    <div style={{ fontSize: 12, color: BRAND.primary, fontWeight: 500, marginTop: 4 }}>
                      Gửi tới: {t.departmentLabel} · Người phụ trách: {t.assigneeName}{t.related_label ? ` · Đính kèm: ${t.related_label}` : ''}
                    </div>
                    {lastMsg && (
                      <div style={{ fontSize: 12.5, color: BRAND.textSecondary, marginTop: 4 }}>
                        <strong>{lastMsg.sender_name}:</strong> {lastMsg.content.length > 140 ? `${lastMsg.content.slice(0, 140)}...` : lastMsg.content}
                      </div>
                    )}
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      <TicketCreateEditModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(saved) => setDetailId(saved.id)} />
      <TicketDetailDrawer ticketId={detailId} isBackoffice={false} onClose={() => setDetailId(null)} />
    </div>
  );
}
