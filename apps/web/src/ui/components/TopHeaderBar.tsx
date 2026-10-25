'use client';

import { Avatar, Badge, Breadcrumb, Button, Dropdown, Flex, Layout, List, Popover, Space, Spin, Tag, Typography } from 'antd';
import {
  BellOutlined, DownOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined,
  MenuOutlined, MenuUnfoldOutlined, ReloadOutlined, SafetyCertificateOutlined,
  ShopOutlined, UserOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, ROLE_SHORT_LABELS, type PublicUser } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
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
    enabled: can('account.read'),
  });
  const notifsQ = useQuery({
    queryKey: ['notifications', 'header-bell'],
    queryFn: () => api.list<{ id: string; code: string; title: string; body: string; categoryLabel: string; targetLabel: string; readStatus: string }>('/notifications?per_page=6'),
  });

  const pendingTotal = pendingAccounts.data?.meta.pagination.total ?? 0;
  const pendingItems = pendingAccounts.data?.data ?? [];
  const notifItems = notifsQ.data?.data ?? [];
  const notifTotal = notifsQ.data?.meta.pagination.total ?? 0;
  const unreadNotifCount = notifItems.filter((n) => n.readStatus === 'UNREAD').length;
  const totalBadge = pendingTotal + unreadNotifCount;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  const notificationContent = (
    <div style={{ width: 340 }}>
      <Flex justify="space-between" align="center" style={{ paddingBottom: 8, borderBottom: `1px solid ${BRAND.border}` }}>
        <Typography.Text strong style={{ fontSize: 13 }}>Thông báo đã nhận ({notifTotal + pendingTotal})</Typography.Text>
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={pendingAccounts.isFetching || notifsQ.isFetching} onClick={() => { pendingAccounts.refetch(); notifsQ.refetch(); }}>
          Làm mới
        </Button>
      </Flex>
      <Spin spinning={pendingAccounts.isFetching || notifsQ.isFetching}>
        {pendingItems.length === 0 && notifItems.length === 0 ? (
          <div style={{ padding: '14px 4px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
            Chưa có thông báo hoặc bản tin mới
          </div>
        ) : (
          <List
            size="small"
            dataSource={[
              ...pendingItems.map((i) => ({ key: `acc-${i.id}`, title: `${i.displayName} (${i.username})`, desc: `Chờ kích hoạt · ${i.roleLabel}`, tag: 'Tài khoản', href: '/admin/accounts?status=PENDING_ACTIVATION' })),
              ...notifItems.map((n) => ({ key: `ntf-${n.id}`, title: n.title, desc: `${n.targetLabel} · ${n.body}`, tag: n.code, href: '/admin/notifications' })),
            ].slice(0, 6)}
            renderItem={(item) => (
              <List.Item style={{ cursor: 'pointer', paddingInline: 4 }} onClick={() => router.push(item.href)}>
                <List.Item.Meta
                  title={<Space size={4}><Tag color="geekblue" style={{ margin: 0, fontSize: 10, paddingInline: 4 }}>{item.tag}</Tag><span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span></Space>}
                  description={<span style={{ fontSize: 11 }}>{item.desc}</span>}
                />
              </List.Item>
            )}
          />
        )}
      </Spin>
      <Button type="primary" ghost size="small" icon={<BellOutlined />} block style={{ marginTop: 6 }} onClick={() => router.push('/admin/notifications')}>
        Xem chi tiết tất cả thông báo ({notifTotal + pendingTotal})
      </Button>
    </div>
  );

  return (
    <Layout.Header
      style={{
        borderBottom: `1px solid ${BRAND.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        paddingInline: 16,
      }}
    >
      <Flex align="center" gap={10} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Button
          size="small"
          className="umbm-header-pill"
          icon={isMobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggleNav}
          style={{ width: 32, height: 32, borderRadius: 6, borderColor: BRAND.headerControlBorder, flexShrink: 0 }}
          aria-label="Đóng mở thanh điều hướng"
        />
        {isMobile ? (
          <Typography.Text strong ellipsis style={{ color: '#0F172A', fontSize: 13 }}>
            {breadcrumbTitle}
          </Typography.Text>
        ) : (
          <Breadcrumb
            items={[
              { title: 'Quản trị' },
              { title: breadcrumbGroup },
              { title: <Typography.Text strong style={{ color: '#0F172A', fontSize: 13 }}>{breadcrumbTitle}</Typography.Text> },
            ]}
          />
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

        {!isMobile && (
          <Button
            size="small"
            className="umbm-header-pill"
            icon={<ShopOutlined />}
            onClick={() => router.push('/nv/login')}
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
