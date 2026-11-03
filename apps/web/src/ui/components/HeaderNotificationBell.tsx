'use client';

import { BellOutlined, CheckOutlined, DesktopOutlined, MutedOutlined, ReloadOutlined, RightOutlined, SoundOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, List, Popover, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  buildNotificationCenterUrl, dispatchOsDesktopNotification,
  shouldTriggerFloatingPopup, useDesktopNotifications, type FloatingNotifPayload,
} from '@/lib/desktop-notification';
import { useTrackUnreadNotifications } from '@/lib/notification-sound';
import { BRAND } from '../theme';

interface HeaderNotifItem extends FloatingNotifPayload {
  id: string; code: string; title: string; body: string;
  targetLabel: string; readStatus: string; created_at?: string; link?: string;
}

export interface HeaderNotificationBellProps {
  userId: string; portal: 'backoffice' | 'employee';
  soundEnabled: boolean; setSoundEnabled: (enabled: boolean) => void; playTestSound: () => void;
}

export function HeaderNotificationBell({
  userId, portal, soundEnabled, setSoundEnabled, playTestSound,
}: HeaderNotificationBellProps) {
  const router = useRouter(), qc = useQueryClient();
  const { message, notification } = App.useApp();
  const [open, setOpen] = useState(false);

  const defaultCenterHref = portal === 'backoffice' ? '/admin/notifications' : '/nv/thong-bao';
  const notifsQ = useQuery({
    queryKey: ['notifications', portal === 'backoffice' ? 'header-bell' : 'nv-bell'],
    queryFn: () => api.list<HeaderNotifItem>('/notifications?per_page=12&sort_by=created_at&sort_order=desc'),
  });

  const handleNavigateToNotif = useCallback((notifId: string, targetUrl?: string) => {
    if (notifId) void api.post(`/notifications/${notifId}/read`, {}).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    setOpen(false);
    router.push(targetUrl || buildNotificationCenterUrl(portal, notifId));
  }, [portal, qc, router]);

  const { desktopEnabled, permission, toggleDesktopEnabled, requestPermissionNow } = useDesktopNotifications(portal, handleNavigateToNotif);

  const showZaloBottomRightCard = useCallback((item: HeaderNotifItem) => {
    const floatKey = `umbm-zalo-float-${item.id || Date.now()}`, targetUrl = buildNotificationCenterUrl(portal, item.id);
    void dispatchOsDesktopNotification(item, portal, handleNavigateToNotif);
    if (!desktopEnabled) return;
    const onCardClick = () => { notification.destroy(floatKey); handleNavigateToNotif(item.id, targetUrl); };
    notification.open({
      key: floatKey, placement: 'bottomRight', duration: 9,
      style: { border: '1px solid #93C5FD', borderRadius: 4, background: '#FFFFFF', padding: '12px 14px' },
      message: (
        <div onClick={onCardClick} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, paddingRight: 12 }}>
          <Tag color="blue" style={{ margin: 0, fontSize: 10, fontWeight: 700, lineHeight: '16px', paddingInline: 5 }}>{item.code || 'THÔNG BÁO'}</Tag>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{item.title}</span>
        </div>
      ),
      description: (
        <div onClick={onCardClick} style={{ cursor: 'pointer', marginTop: 2 }}>
          <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.45, marginBottom: 6 }}>{item.body || item.targetLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#2563EB', fontWeight: 600 }}>
            <span style={{ color: '#64748B', fontWeight: 400 }}>{item.targetLabel || 'Hệ thống Ụm Bò Milk HR'}</span>
            <span>Nhấn để mở mục Thông báo <RightOutlined style={{ fontSize: 10 }} /></span>
          </div>
        </div>
      ),
    });
  }, [desktopEnabled, handleNavigateToNotif, notification, portal]);

  const markAllMut = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read', {}),
    onSuccess: () => { message.success('Đã đánh dấu đã đọc tất cả thông báo'); void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const notifItems = notifsQ.data?.data ?? [], notifTotal = notifsQ.data?.meta.pagination.total ?? 0;
  const unreadCount = Number(notifsQ.data?.meta.filters?.unread_count ?? notifItems.filter((n) => n.readStatus === 'UNREAD').length);
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
  const unreadKeys = useMemo(() => notifItems.filter((n) => n.readStatus === 'UNREAD').map((n) => `ntf:${n.id}`), [notifItems]);

  useTrackUnreadNotifications(userId, unreadKeys, notifsQ.isSuccess, (newKeys) => {
    for (const item of notifItems.filter((n) => newKeys.includes(`ntf:${n.id}`)).slice(0, 2)) {
      if (shouldTriggerFloatingPopup(item.id)) showZaloBottomRightCard(item);
    }
  });

  const popoverContent = (
    <div style={{ width: 468, maxWidth: 'calc(100vw - 32px)' }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={6} style={{ paddingBottom: 8, borderBottom: `1px solid ${BRAND.border}` }}>
        <Space size={6}>
          <Typography.Text strong style={{ fontSize: 13 }}>Thông báo đã nhận ({notifTotal})</Typography.Text>
          {unreadCount > 0 && <Tag color="red" style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>{badgeText} chưa đọc</Tag>}
        </Space>
        <Space size={4} wrap>
          <Tooltip title="Nghe thử chuông & Xem thử thông báo nổi góc dưới phải">
            <Button
              size="small" type="text" icon={soundEnabled ? <SoundOutlined style={{ color: BRAND.primary }} /> : <MutedOutlined />}
              onClick={() => { playTestSound(); showZaloBottomRightCard(notifItems[0] ?? { id: '', code: 'HT-TEST', title: 'Thông báo nổi góc dưới bên phải (Như Zalo)', body: 'Khi có thông báo mới, hộp thoại sẽ nổi ở góc dưới phải màn hình ngay cả khi bạn đang ở tab khác.', targetLabel: 'Hệ thống Ụm Bò Milk HR', readStatus: 'UNREAD' }); }}
            />
          </Tooltip>
          <Switch size="small" checked={soundEnabled} onChange={setSoundEnabled} checkedChildren="Chuông" unCheckedChildren="Tắt" />
          <Tooltip title={permission === 'denied' ? 'Trình duyệt đang chặn thông báo — vui lòng bật quyền thông báo trên thanh địa chỉ trình duyệt' : 'Bật/tắt thông báo nổi góc dưới bên phải màn hình như Zalo (kể cả khi ở tab khác)'}>
            <Switch size="small" checked={desktopEnabled && permission !== 'denied'} onChange={(val) => void toggleDesktopEnabled(val)} checkedChildren="Góc phải" unCheckedChildren="Tắt nổi" />
          </Tooltip>
          {permission === 'default' && <Button size="small" type="link" icon={<DesktopOutlined />} style={{ paddingInline: 4 }} onClick={() => void requestPermissionNow()}>Cấp quyền ngoài Tab</Button>}
          {unreadCount > 0 && <Tooltip title="Đánh dấu tất cả thông báo là đã đọc"><Button size="small" type="text" icon={<CheckOutlined />} loading={markAllMut.isPending} onClick={() => markAllMut.mutate()}>Đọc hết</Button></Tooltip>}
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={notifsQ.isFetching} onClick={() => void notifsQ.refetch()}>Làm mới</Button>
        </Space>
      </Flex>

      <Spin spinning={notifsQ.isFetching}>
        <div style={{ maxHeight: 'min(340px, calc(100dvh - 180px))', overflowY: 'auto', paddingRight: 2 }}>
          {notifItems.length === 0 ? (
            <div style={{ padding: '14px 4px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>Chưa có thông báo hoặc bản tin mới</div>
          ) : (
            <List
              size="small" dataSource={notifItems}
              renderItem={(n) => {
                const unread = n.readStatus === 'UNREAD';
                return (
                  <List.Item style={{ cursor: 'pointer', padding: '8px 6px' }} onClick={() => handleNavigateToNotif(n.id, buildNotificationCenterUrl(portal, n.id))}>
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
        size="small" className="umbm-header-pill" loading={notifsQ.isLoading}
        aria-label={unreadCount > 0 ? `Thông báo (${badgeText} chưa đọc)` : 'Thông báo'}
        style={{ height: 34, minWidth: 34, width: unreadCount > 0 ? 'auto' : 34, paddingInline: unreadCount > 0 ? 9 : 0, borderRadius: 6, borderColor: BRAND.headerControlBorder, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, lineHeight: 1, verticalAlign: 'middle' }}
      >
        {!notifsQ.isLoading && <BellOutlined style={{ fontSize: 15, color: '#0F172A', display: 'inline-flex', alignItems: 'center' }} />}
        {unreadCount > 0 && <span className="num" style={{ height: 18, minWidth: 18, paddingInline: unreadCount > 9 ? 6 : 5, borderRadius: 9, background: '#DC2626', color: '#FFFFFF', fontSize: 11, fontWeight: 700, lineHeight: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badgeText}</span>}
      </Button>
    </Popover>
  );
}
