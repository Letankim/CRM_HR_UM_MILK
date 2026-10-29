'use client';

import { BellOutlined, CheckOutlined, MutedOutlined, ReloadOutlined, SoundOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, List, Popover, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useTrackUnreadNotifications } from '@/lib/notification-sound';
import { BRAND } from '../theme';

interface HeaderNotifItem {
  id: string;
  code: string;
  title: string;
  body: string;
  targetLabel: string;
  readStatus: string;
  created_at?: string;
  link?: string;
}

export interface HeaderNotificationBellProps {
  userId: string;
  portal: 'backoffice' | 'employee';
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  playTestSound: () => void;
}

export function HeaderNotificationBell({
  userId, portal, soundEnabled, setSoundEnabled, playTestSound,
}: HeaderNotificationBellProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);

  const defaultCenterHref = portal === 'backoffice' ? '/admin/notifications' : '/nv/thong-bao';
  const notifsQ = useQuery({
    queryKey: ['notifications', portal === 'backoffice' ? 'header-bell' : 'nv-bell'],
    queryFn: () => api.list<HeaderNotifItem>('/notifications?per_page=12&sort_by=created_at&sort_order=desc'),
  });

  const markAllMut = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read', {}),
    onSuccess: () => {
      message.success('Đã đánh dấu đã đọc tất cả thông báo');
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifItems = notifsQ.data?.data ?? [];
  const notifTotal = notifsQ.data?.meta.pagination.total ?? 0;
  const unreadCount = Number(
    notifsQ.data?.meta.filters?.unread_count ?? notifItems.filter((n) => n.readStatus === 'UNREAD').length,
  );
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
  const unreadKeys = useMemo(() => notifItems.filter((n) => n.readStatus === 'UNREAD').map((n) => `ntf:${n.id}`), [notifItems]);

  useTrackUnreadNotifications(userId, unreadKeys, notifsQ.isSuccess, (newKeys) => {
    const firstNew = notifItems.find((n) => newKeys.includes(`ntf:${n.id}`));
    if (firstNew) message.info({ key: `rt-${portal}-bell-toast`, content: `Thông báo mới: ${firstNew.title}` });
  });

  const popoverContent = (
    <div style={{ width: 448, maxWidth: 'calc(100vw - 32px)' }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={6} style={{ paddingBottom: 8, borderBottom: `1px solid ${BRAND.border}` }}>
        <Space size={6}>
          <Typography.Text strong style={{ fontSize: 13 }}>Thông báo đã nhận ({notifTotal})</Typography.Text>
          {unreadCount > 0 && <Tag color="red" style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>{badgeText} chưa đọc</Tag>}
        </Space>
        <Space size={4}>
          <Tooltip title="Nghe thử chuông thông báo">
            <Button size="small" type="text" icon={soundEnabled ? <SoundOutlined style={{ color: BRAND.primary }} /> : <MutedOutlined />} onClick={playTestSound} />
          </Tooltip>
          <Switch size="small" checked={soundEnabled} onChange={setSoundEnabled} checkedChildren="Chuông" unCheckedChildren="Tắt" />
          {unreadCount > 0 && (
            <Tooltip title="Đánh dấu tất cả thông báo là đã đọc">
              <Button size="small" type="text" icon={<CheckOutlined />} loading={markAllMut.isPending} onClick={() => markAllMut.mutate()}>Đọc hết</Button>
            </Tooltip>
          )}
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={notifsQ.isFetching} onClick={() => void notifsQ.refetch()}>Làm mới</Button>
        </Space>
      </Flex>

      <Spin spinning={notifsQ.isFetching}>
        <div style={{ maxHeight: 'min(340px, calc(100dvh - 180px))', overflowY: 'auto', paddingRight: 2 }}>
          {notifItems.length === 0 ? (
            <div style={{ padding: '14px 4px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>Chưa có thông báo hoặc bản tin mới</div>
          ) : (
            <List
              size="small"
              dataSource={notifItems}
              renderItem={(n) => {
                const unread = n.readStatus === 'UNREAD';
                return (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '8px 6px' }}
                    onClick={() => {
                      if (unread) void api.post(`/notifications/${n.id}/read`, {}).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                      setOpen(false);
                      router.push(n.link || defaultCenterHref);
                    }}
                  >
                    <div style={{ width: '100%', minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.45, wordBreak: 'break-word' }}>
                        <Tag color={unread ? 'geekblue' : 'default'} style={{ margin: '0 6px 2px 0', fontSize: 10, paddingInline: 5, lineHeight: '16px', verticalAlign: 'text-top' }}>{n.code}</Tag>
                        <span>{n.title}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.4, marginTop: 3, wordBreak: 'break-word' }}>
                        {n.created_at ? `${dayjs(n.created_at).format('HH:mm DD/MM')} · ` : ''}{n.targetLabel} · {n.body}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </div>
      </Spin>

      <Button type="primary" ghost size="small" icon={<BellOutlined />} block style={{ marginTop: 8 }} onClick={() => { setOpen(false); router.push(defaultCenterHref); }}>
        Xem chi tiết tất cả thông báo ({notifTotal})
      </Button>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} content={popoverContent} trigger="click" placement="bottomRight">
      <Button
        size="small"
        className="umbm-header-pill"
        loading={notifsQ.isLoading}
        aria-label={unreadCount > 0 ? `Thông báo (${badgeText} chưa đọc)` : 'Thông báo'}
        style={{
          height: 34, minWidth: 34, width: unreadCount > 0 ? 'auto' : 34,
          paddingInline: unreadCount > 0 ? 9 : 0, borderRadius: 6, borderColor: BRAND.headerControlBorder,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {!notifsQ.isLoading && <BellOutlined style={{ fontSize: 15, color: '#0F172A' }} />}
        {unreadCount > 0 && (
          <span
            className="num"
            style={{
              height: 18, minWidth: 18, paddingInline: unreadCount > 9 ? 6 : 5, borderRadius: 9,
              background: '#DC2626', color: '#FFFFFF', fontSize: 11, fontWeight: 700, lineHeight: '18px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {badgeText}
          </span>
        )}
      </Button>
    </Popover>
  );
}
