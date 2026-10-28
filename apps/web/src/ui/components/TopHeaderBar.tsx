'use client';

import { Avatar, Badge, Breadcrumb, Button, Dropdown, Flex, Layout, List, Popover, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import {
  BellOutlined, DownOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined,
  MenuOutlined, MenuUnfoldOutlined, MutedOutlined, ReloadOutlined, SafetyCertificateOutlined,
  ShopOutlined, SoundOutlined, UserOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ROLE_LABELS, ROLE_SHORT_LABELS, type PublicUser } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useNotificationSound, useTrackUnreadNotifications } from '@/lib/notification-sound';
import { BRAND } from '../theme';
import { UserProfileModal } from './UserProfileModal';

export interface TopHeaderBarProps {
  isMobile: boolean; collapsed: boolean; onToggleNav: () => void;
  breadcrumbGroup: string; breadcrumbTitle: string; user: PublicUser; onLogout: () => Promise<void> | void;
}

interface PendingAccountPreview { id: string; username: string; displayName: string; roleLabel: string; }

export function TopHeaderBar({
  isMobile, collapsed, onToggleNav, breadcrumbGroup, breadcrumbTitle, user, onLogout,
}: TopHeaderBarProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);

  const pendingAccounts = useQuery({
    queryKey: ['accounts', 'PENDING_ACTIVATION', 'header-badge'],
    queryFn: () => api.list<PendingAccountPreview>('/admin/accounts?status=PENDING_ACTIVATION&per_page=5'),
    enabled: can('account.activate'),
  });
  const notifsQ = useQuery({
    queryKey: ['notifications', 'header-bell'],
    queryFn: () => api.list<{ id: string; code: string; title: string; body: string; categoryLabel: string; targetLabel: string; readStatus: string; link?: string }>('/notifications?per_page=12'),
  });

  const pendingTotal = pendingAccounts.data?.meta.pagination.total ?? 0;
  const pendingItems = pendingAccounts.data?.data ?? [];
  const notifItems = notifsQ.data?.data ?? [];
  const notifTotal = notifsQ.data?.meta.pagination.total ?? 0;
  const unreadNotifCount = Number(notifsQ.data?.meta.filters?.unread_count ?? notifItems.filter((n) => n.readStatus === 'UNREAD').length);
  const totalBadge = pendingTotal + unreadNotifCount;
  const { soundEnabled, setSoundEnabled, toggleSound, playTestSound } = useNotificationSound();
  const unreadKeys = useMemo(
    () => [...pendingItems.map((p) => `acc:${p.id}`), ...notifItems.filter((n) => n.readStatus === 'UNREAD').map((n) => `ntf:${n.id}`)],
    [pendingItems, notifItems],
  );
  const canActivate = can('account.activate');
  useTrackUnreadNotifications(user.id, unreadKeys, notifsQ.isSuccess && (!canActivate || pendingAccounts.isSuccess));

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await onLogout(); } finally { setLoggingOut(false); }
  };

  const notificationContent = (
    <div style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}>
      <Flex justify="space-between" align="center" style={{ paddingBottom: 8, borderBottom: `1px solid ${BRAND.border}` }}>
        <Typography.Text strong style={{ fontSize: 13 }}>Thông báo đã nhận ({notifTotal + pendingTotal})</Typography.Text>
        <Space size={4}>
          <Tooltip title="Nghe thử chuông thông báo">
            <Button size="small" type="text" icon={soundEnabled ? <SoundOutlined style={{ color: BRAND.primary }} /> : <MutedOutlined />} onClick={playTestSound} />
          </Tooltip>
          <Switch size="small" checked={soundEnabled} onChange={setSoundEnabled} checkedChildren="Chuông" unCheckedChildren="Tắt" />
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={pendingAccounts.isFetching || notifsQ.isFetching} onClick={() => { pendingAccounts.refetch(); notifsQ.refetch(); }}>
            Làm mới
          </Button>
        </Space>
      </Flex>
      <Spin spinning={pendingAccounts.isFetching || notifsQ.isFetching}>
        <div style={{ maxHeight: 'min(340px, calc(100dvh - 180px))', overflowY: 'auto', paddingRight: 2 }}>
          {pendingItems.length === 0 && notifItems.length === 0 ? (
            <div style={{ padding: '14px 4px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
              Chưa có thông báo hoặc bản tin mới
            </div>
          ) : (
            <List
              size="small"
              dataSource={[
                ...notifItems.map((n) => ({ key: `ntf-${n.id}`, notifId: n.id, unread: n.readStatus === 'UNREAD', title: n.title, desc: `${n.targetLabel} · ${n.body}`, tag: n.code, href: n.link || '/admin/notifications' })),
                ...pendingItems.map((i) => ({ key: `acc-${i.id}`, notifId: '', unread: true, title: `${i.displayName} (${i.username})`, desc: `Chờ kích hoạt · ${i.roleLabel}`, tag: 'Tài khoản', href: '/admin/accounts?status=PENDING_ACTIVATION' })),
              ].slice(0, 12)}
              renderItem={(item) => (
                <List.Item
                  style={{ cursor: 'pointer', padding: '8px 6px' }}
                  onClick={() => {
                    if (item.notifId && item.unread) {
                      void api.post(`/notifications/${item.notifId}/read`, {}).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                    }
                    router.push(item.href);
                  }}
                >
                  <div style={{ width: '100%', minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.45, wordBreak: 'break-word' }}>
                      <Tag color={item.unread ? 'geekblue' : 'default'} style={{ margin: '0 6px 2px 0', fontSize: 10, paddingInline: 5, lineHeight: '16px', verticalAlign: 'text-top' }}>{item.tag}</Tag>
                      <span>{item.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.4, marginTop: 3, wordBreak: 'break-word' }}>{item.desc}</div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </Spin>
      <Button type="primary" ghost size="small" icon={<BellOutlined />} block style={{ marginTop: 8 }} onClick={() => router.push('/admin/notifications')}>
        Xem chi tiết tất cả thông báo ({notifTotal + pendingTotal})
      </Button>
    </div>
  );

  return (
    <Layout.Header style={{ borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, paddingInline: 16 }}>
      <Flex align="center" gap={10} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Button size="small" className="umbm-header-pill" icon={isMobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={onToggleNav} style={{ width: 32, height: 32, borderRadius: 6, borderColor: BRAND.headerControlBorder, flexShrink: 0 }} aria-label="Đóng mở thanh điều hướng" />
        {isMobile ? (
          <Typography.Text strong ellipsis style={{ color: '#0F172A', fontSize: 13 }}>{breadcrumbTitle}</Typography.Text>
        ) : (
          <Breadcrumb items={[{ title: 'Quản trị' }, { title: breadcrumbGroup }, { title: <Typography.Text strong style={{ color: '#0F172A', fontSize: 13 }}>{breadcrumbTitle}</Typography.Text> }]} />
        )}
      </Flex>

      <Space size={10}>
        {!isMobile && can('integration.read') && (
          <Button
            size="small"
            className="umbm-header-pill"
            icon={<SafetyCertificateOutlined style={{ color: BRAND.primary }} />}
            onClick={() => router.push('/admin/integrations')}
            style={{ height: 34, borderRadius: 6, borderColor: BRAND.headerControlBorder, paddingInline: 10 }}
          >
            Trợ lý đối soát
          </Button>
        )}

        <Popover content={notificationContent} trigger="click" placement="bottomRight">
          <Badge count={totalBadge} size="small" offset={[-2, 2]}>
            <Button
              size="small"
              className="umbm-header-pill"
              icon={<BellOutlined />}
              loading={pendingAccounts.isLoading}
              style={{ width: 34, height: 34, borderRadius: 6, borderColor: BRAND.headerControlBorder }}
              aria-label="Thông báo"
            />
          </Badge>
        </Popover>

        {!isMobile && user.role !== 'MKT' && (
          <Button
            size="small"
            className="umbm-header-pill"
            icon={<ShopOutlined />}
            onClick={() => router.push('/nv')}
            style={{ height: 34, borderRadius: 6, borderColor: BRAND.headerControlBorder, paddingInline: 10 }}
          >
            Cổng NV
          </Button>
        )}

        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'role',
                icon: <UserSwitchOutlined />,
                label: user.displayName === ROLE_LABELS[user.role] ? `@${user.username} · ${ROLE_LABELS[user.role]}` : `${user.displayName} (${ROLE_LABELS[user.role]})`,
                disabled: true,
              },
              { type: 'divider' },
              { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân & Cập nhật thông tin', onClick: () => setProfileTab('info') },
              { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu / Mã PIN bảo mật', onClick: () => setProfileTab('password') },
              { key: 'sound', icon: soundEnabled ? <SoundOutlined /> : <MutedOutlined />, label: `Âm thanh thông báo: ${soundEnabled ? 'Đang bật (Bấm để tắt)' : 'Đang tắt (Bấm để bật)'}`, onClick: toggleSound },
              { key: 'sync', icon: <ReloadOutlined />, label: 'Làm mới toàn bộ dữ liệu trang', onClick: () => qc.invalidateQueries() },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, danger: true, label: loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất hệ thống', onClick: handleLogout },
            ],
          }}
        >
          <div
            className="umbm-header-pill"
            style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', border: `1px solid ${BRAND.headerControlBorder}`, borderRadius: 8, cursor: 'pointer', background: '#F8FAFC' }}
          >
            <Avatar size={24} style={{ background: BRAND.primaryBg, color: BRAND.primary, border: '1px solid #93C5FD', fontWeight: 700, fontSize: 11 }}>
              {loggingOut ? <Spin size="small" /> : (user.displayName || user.username).charAt(0).toUpperCase()}
            </Avatar>
            {!isMobile && (
              <>
                <Typography.Text strong style={{ fontSize: 12, color: '#0F172A' }}>{user.displayName || user.username}</Typography.Text>
                <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, lineHeight: '18px', paddingInline: 6, fontWeight: 600 }}>
                  {ROLE_SHORT_LABELS[user.role]}
                </Tag>
                <DownOutlined style={{ fontSize: 10, color: '#64748B' }} />
              </>
            )}
          </div>
        </Dropdown>
      </Space>

      <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
    </Layout.Header>
  );
}
