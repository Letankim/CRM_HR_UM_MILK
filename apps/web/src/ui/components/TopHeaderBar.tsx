'use client';

import { Avatar, Breadcrumb, Button, Dropdown, Flex, Layout, Space, Spin, Tag, Typography } from 'antd';
import {
  DownOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MutedOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  SoundOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, ROLE_SHORT_LABELS, type PublicUser } from '@umbm/shared';
import { useCan } from '@/lib/auth';
import { useNotificationSound } from '@/lib/notification-sound';
import { BRAND } from '../theme';
import { HeaderNotificationBell } from './HeaderNotificationBell';
import { UserProfileModal } from './UserProfileModal';

export interface TopHeaderBarProps {
  isMobile: boolean;
  collapsed: boolean;
  onToggleNav: () => void;
  breadcrumbGroup: string;
  breadcrumbTitle: string;
  user: PublicUser;
  onLogout: () => Promise<void> | void;
}

export function TopHeaderBar({
  isMobile,
  collapsed,
  onToggleNav,
  breadcrumbGroup,
  breadcrumbTitle,
  user,
  onLogout,
}: TopHeaderBarProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);
  const { soundEnabled, setSoundEnabled, toggleSound, playTestSound } = useNotificationSound();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

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

        <HeaderNotificationBell
          userId={user.id}
          portal="backoffice"
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
          playTestSound={playTestSound}
        />

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
                label:
                  user.displayName === ROLE_LABELS[user.role]
                    ? `@${user.username} · ${ROLE_LABELS[user.role]}`
                    : `${user.displayName} (${ROLE_LABELS[user.role]})`,
                disabled: true,
              },
              { type: 'divider' },
              { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân & Cập nhật thông tin', onClick: () => setProfileTab('info') },
              { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu / Mã PIN bảo mật', onClick: () => setProfileTab('password') },
              {
                key: 'sound',
                icon: soundEnabled ? <SoundOutlined /> : <MutedOutlined />,
                label: `Âm thanh thông báo: ${soundEnabled ? 'Đang bật (Bấm để tắt)' : 'Đang tắt (Bấm để bật)'}`,
                onClick: toggleSound,
              },
              { key: 'sync', icon: <ReloadOutlined />, label: 'Làm mới toàn bộ dữ liệu trang', onClick: () => qc.invalidateQueries() },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, danger: true, label: loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất hệ thống', onClick: handleLogout },
            ],
          }}
        >
          <div
            className="umbm-header-pill"
            style={{
              height: 36,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px 0 6px',
              border: `1px solid ${BRAND.headerControlBorder}`,
              borderRadius: 8,
              cursor: 'pointer',
              background: '#F8FAFC',
            }}
          >
            <Avatar
              size={24}
              style={{ background: BRAND.primaryBg, color: BRAND.primary, border: '1px solid #93C5FD', fontWeight: 700, fontSize: 11 }}
            >
              {loggingOut ? <Spin size="small" /> : (user.displayName || user.username).charAt(0).toUpperCase()}
            </Avatar>
            {!isMobile && (
              <>
                <Typography.Text strong style={{ fontSize: 12, color: '#0F172A' }}>
                  {user.displayName || user.username}
                </Typography.Text>
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
