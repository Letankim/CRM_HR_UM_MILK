'use client';

import { Alert, Avatar, Badge, Breadcrumb, Button, Dropdown, Flex, Grid, Layout, List, Menu, Popover, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import {
  AppstoreOutlined, BellOutlined, BookOutlined, CalendarOutlined, DownOutlined, EnvironmentOutlined,
  FieldTimeOutlined, FileDoneOutlined, FileTextOutlined, HomeOutlined, KeyOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, MutedOutlined, NotificationOutlined, ReloadOutlined,
  RightOutlined, SoundOutlined, SwapOutlined, UserOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ROLE_LABELS, ROLE_SHORT_LABELS, SYSTEM_CONFIG } from '@umbm/shared';
import { api } from '@/lib/api';
import { isUnauthorized, loginPath, useLogout, useMe } from '@/lib/auth';
import { useNotificationSound, useTrackUnreadNotifications } from '@/lib/notification-sound';
import { useRealtime } from '@/lib/realtime';
import { UserProfileModal } from './components/UserProfileModal';
import { BRAND } from './theme';

const MOBILE_TABS = [
  { href: '/nv', label: 'Trang chủ', icon: <HomeOutlined /> },
  { href: '/nv/lich', label: 'Lịch làm', icon: <CalendarOutlined /> },
  { href: '/nv/diem-danh', label: 'Điểm danh', icon: <EnvironmentOutlined />, primary: true },
  { href: '/nv/doi-ca', label: 'Đổi ca', icon: <SwapOutlined /> },
];

const DESKTOP_GROUPS = [
  {
    key: 'grp-work',
    label: 'Bàn làm việc cá nhân',
    items: [
      { key: '/nv', label: 'Tổng quan & Ca hôm nay', icon: <HomeOutlined /> },
      { key: '/nv/diem-danh', label: 'Điểm danh GPS & Camera', icon: <EnvironmentOutlined /> },
      { key: '/nv/lich', label: 'Lịch làm việc & Đăng ký ca', icon: <CalendarOutlined /> },
      { key: '/nv/nghi-phep', label: 'Đơn nghỉ OFF & Khẩn cấp', icon: <FileDoneOutlined /> },
      { key: '/nv/doi-ca', label: 'Yêu cầu Đổi ca nội bộ', icon: <SwapOutlined /> },
      { key: '/nv/cong', label: 'Bảng công & Bổ sung công', icon: <FieldTimeOutlined /> },
    ],
  },
  {
    key: 'grp-benefit',
    label: 'Phúc lợi & Đào tạo',
    items: [
      { key: '/nv/thong-bao', label: 'Trung tâm Thông báo', icon: <BellOutlined /> },
      { key: '/nv/phieu-luong', label: 'Phiếu lương cá nhân', icon: <FileTextOutlined /> },
      { key: '/nv/bai-kiem-tra', label: 'Bài kiểm tra Nghiệp vụ', icon: <BookOutlined /> },
      { key: '/nv/ban-tin', label: 'Bản tin truyền thông nội bộ', icon: <NotificationOutlined /> },
    ],
  },
];

export function EmployeeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);
  const { data, isLoading, error } = useMe();
  const logout = useLogout('employee');
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);

  const mntQ = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<{ enabled?: boolean; message?: string }[]>('/admin/maintenance'), enabled: !!data, retry: false });
  const notifsQ = useQuery({ queryKey: ['notifications', 'nv-bell'], queryFn: () => api.list<{ id: string; code: string; title: string; body: string; targetLabel: string; readStatus: string }>('/notifications?per_page=12'), enabled: !!data, retry: false });
  const activeMaint = mntQ.data?.[0]?.enabled ? mntQ.data[0] : null;
  const notifItems = notifsQ.data?.data ?? [];
  const notifTotal = notifsQ.data?.meta.pagination.total ?? 0;
  const unreadNotifCount = Number(notifsQ.data?.meta.filters?.unread_count ?? notifItems.filter((n) => n.readStatus === 'UNREAD').length);
  const { soundEnabled, setSoundEnabled, toggleSound, playTestSound } = useNotificationSound();
  const unreadKeys = useMemo(() => notifItems.filter((n) => n.readStatus === 'UNREAD').map((n) => `ntf:${n.id}`), [notifItems]);
  useTrackUnreadNotifications(data?.user.id, unreadKeys, notifsQ.isSuccess);
  useRealtime('employee', !!data, data?.socketToken);

  useEffect(() => {
    if (isUnauthorized(error) || (!isLoading && !data)) router.replace(loginPath('employee'));
  }, [data, error, isLoading, router]);
  if (isLoading || !data) return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}><Spin /></div>;

  const u = data.user, isInternal = !['THU_VIEC', 'CHINH_THUC'].includes(u.role);
  const isMoreActive = ['/nv/them', '/nv/nghi-phep', '/nv/cong', '/nv/phieu-luong', '/nv/bai-kiem-tra', '/nv/ban-tin'].some((p) => pathname.startsWith(p));
  const versionLabel = SYSTEM_CONFIG.version.startsWith('v') ? SYSTEM_CONFIG.version : `v${SYSTEM_CONFIG.version}`;
  const activeDesktopItem = (() => {
    for (const g of DESKTOP_GROUPS) for (const item of g.items) if (item.key === '/nv' ? pathname === '/nv' : pathname.startsWith(item.key)) return { group: g.label, item };
    return { group: 'Bàn làm việc cá nhân', item: DESKTOP_GROUPS[0]!.items[0]! };
  })();
  const desktopMenuItems: ItemType[] = collapsed
    ? DESKTOP_GROUPS.flatMap((g) => g.items.map((i) => ({ key: i.key, icon: i.icon, label: <Link href={i.key}>{i.label}</Link> })))
    : DESKTOP_GROUPS.map((g) => ({ key: g.key, label: <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>{g.label}</span>, children: g.items.map((i) => ({ key: i.key, icon: i.icon, label: <Link href={i.key}>{i.label}</Link> })) }));
  const mobileMoreMenu = (
    <div style={{ width: 280, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 140px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.textSecondary, padding: '2px 8px 4px', borderBottom: `1px solid ${BRAND.border}` }}>CHỌN TIỆN ÍCH NHÂN SỰ</div>
      {[
        { label: 'Đơn nghỉ OFF & Nghỉ khẩn cấp', desc: 'Đăng ký nghỉ phép OFF & xem trạng thái duyệt', icon: <FileDoneOutlined />, onClick: () => router.push('/nv/nghi-phep') },
        { label: 'Yêu cầu Đổi ca nội bộ', desc: 'Tạo đề nghị đổi ca & xác nhận nhận ca', icon: <SwapOutlined />, onClick: () => router.push('/nv/doi-ca') },
        { label: 'Bảng công & Bổ sung công', desc: 'Gửi phiếu giải trình bổ sung công', icon: <FieldTimeOutlined />, onClick: () => router.push('/nv/cong') },
        { label: 'Trung tâm Thông báo', desc: 'Tất cả thông báo cá nhân & vai trò', icon: <BellOutlined />, onClick: () => router.push('/nv/thong-bao') },
        { label: 'Phiếu lương cá nhân', desc: 'Xem chi tiết & xác nhận lương', icon: <FileTextOutlined />, onClick: () => router.push('/nv/phieu-luong') },
        { label: 'Bài kiểm tra Nghiệp vụ', desc: 'Làm bài thi SOP & quy chế', icon: <BookOutlined />, onClick: () => router.push('/nv/bai-kiem-tra') },
        { label: 'Bản tin truyền thông nội bộ', desc: 'Thông báo & chiến dịch mới', icon: <NotificationOutlined />, onClick: () => router.push('/nv/ban-tin') },
        { label: `Âm thanh thông báo: ${soundEnabled ? 'Đang bật' : 'Đang tắt'}`, desc: 'Bấm để Bật / Tắt chuông báo thông báo mới', icon: soundEnabled ? <SoundOutlined /> : <MutedOutlined />, onClick: toggleSound },
        { label: 'Hồ sơ cá nhân & Ngân hàng', desc: 'Cập nhật SĐT, Email, STK', icon: <UserOutlined />, onClick: () => setProfileTab('info') },
        { label: 'Đổi mật khẩu / Mã PIN', desc: 'Cập nhật mã bảo mật cá nhân', icon: <KeyOutlined />, onClick: () => setProfileTab('password') },
      ].map((item) => (
        <div key={item.label} onClick={() => { setMoreOpen(false); item.onClick(); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${BRAND.border}`, background: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: BRAND.primary, fontSize: 16 }}>{item.icon}</span><div><div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text, lineHeight: 1.25 }}>{item.label}</div><div style={{ fontSize: 11, color: BRAND.textSecondary }}>{item.desc}</div></div></div>
          <RightOutlined style={{ fontSize: 11, color: BRAND.textSecondary }} />
        </div>
      ))}
    </div>
  );

  if (isDesktop) {
    return (
      <Layout style={{ minHeight: '100dvh' }}>
        <Layout.Sider className="umbm-fixed-sider" width={260} collapsedWidth={68} collapsed={collapsed} style={{ borderRight: `1px solid ${BRAND.border}`, position: 'fixed', top: 0, left: 0, bottom: 0, height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', zIndex: 100 }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100dvh', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, height: 56, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10, padding: collapsed ? 0 : '0 16px', borderBottom: `1px solid ${BRAND.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 6, background: '#0F172A', border: `1px solid ${BRAND.primary}`, color: '#FFFFFF', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, cursor: 'pointer' }} onClick={() => router.push('/nv')}>{SYSTEM_CONFIG.brandShortCode}</div>
              {!collapsed && <div style={{ lineHeight: 1.15, overflow: 'hidden', whiteSpace: 'nowrap' }}><div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>{SYSTEM_CONFIG.brandName}</div><div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: '#64748B' }}>CỔNG NHÂN VIÊN</div></div>}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: collapsed ? '8px 0' : '6px 4px' }}>
              <Menu className="umbm-sider-menu" mode="inline" inlineIndent={10} inlineCollapsed={collapsed} defaultOpenKeys={DESKTOP_GROUPS.map((g) => g.key)} items={desktopMenuItems} selectedKeys={[activeDesktopItem.item.key]} style={{ borderInlineEnd: 'none' }} />
            </div>
            <div style={{ flexShrink: 0, padding: collapsed ? '10px 4px' : '10px 16px', borderTop: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', background: '#FFFFFF' }}>
              {!collapsed && <span style={{ fontSize: 12, color: '#64748B' }}>Phiên bản hệ thống</span>}
              <Tooltip placement="right" title={collapsed ? `Phiên bản hệ thống ${versionLabel}` : undefined}><Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{collapsed ? versionLabel.replace(/\.0$/, '') : versionLabel}</Tag></Tooltip>
            </div>
          </div>
        </Layout.Sider>

        <Layout style={{ minWidth: 0, flex: 1, marginLeft: collapsed ? 68 : 260, transition: 'margin-left 0.2s ease' }}>
          <Layout.Header style={{ borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, paddingInline: 16 }}>
            <Flex align="center" gap={12}>
              <Button size="small" className="umbm-header-pill" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((c) => !c)} style={{ width: 32, height: 32, borderRadius: 6, borderColor: BRAND.headerControlBorder }} />
              <Breadcrumb items={[{ title: 'Cổng Nhân viên' }, { title: activeDesktopItem.group }, { title: <Typography.Text strong style={{ color: '#0F172A', fontSize: 13 }}>{activeDesktopItem.item.label}</Typography.Text> }]} />
            </Flex>
            <Space size={10}>
              <Popover trigger="click" placement="bottomRight" content={
                <div style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}>
                  <Flex justify="space-between" align="center" style={{ paddingBottom: 8, borderBottom: `1px solid ${BRAND.border}` }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>Thông báo đã nhận ({notifTotal})</Typography.Text>
                    <Space size={4}>
                      <Tooltip title="Nghe thử chuông thông báo"><Button size="small" type="text" icon={soundEnabled ? <SoundOutlined style={{ color: BRAND.primary }} /> : <MutedOutlined />} onClick={playTestSound} /></Tooltip>
                      <Switch size="small" checked={soundEnabled} onChange={setSoundEnabled} checkedChildren="Chuông" unCheckedChildren="Tắt" />
                      <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => notifsQ.refetch()}>Làm mới</Button>
                    </Space>
                  </Flex>
                  <div style={{ maxHeight: 'min(340px, calc(100dvh - 180px))', overflowY: 'auto', paddingRight: 2 }}>
                    {notifItems.length === 0 ? <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: BRAND.textSecondary }}>Chưa có thông báo mới</div> : <List size="small" dataSource={notifItems} renderItem={(n) => <List.Item style={{ cursor: 'pointer', padding: '8px 6px' }} onClick={() => { if (n.readStatus === 'UNREAD') void api.post(`/notifications/${n.id}/read`, {}).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })); router.push('/nv/thong-bao'); }}><div style={{ width: '100%', minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.45, wordBreak: 'break-word' }}><Tag color={n.readStatus === 'UNREAD' ? 'geekblue' : 'default'} style={{ margin: '0 6px 2px 0', fontSize: 10, paddingInline: 5, lineHeight: '16px', verticalAlign: 'text-top' }}>{n.code}</Tag><span>{n.title}</span></div><div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.4, marginTop: 3, wordBreak: 'break-word' }}>{n.targetLabel} · {n.body}</div></div></List.Item>} />}
                  </div>
                  <Button type="primary" ghost size="small" icon={<BellOutlined />} block style={{ marginTop: 8 }} onClick={() => router.push('/nv/thong-bao')}>Xem chi tiết tất cả thông báo ({notifTotal})</Button>
                </div>
              }>
                <Badge count={unreadNotifCount} size="small" offset={[-2, 2]}><Button size="small" className="umbm-header-pill" icon={<BellOutlined />} style={{ width: 34, height: 34, borderRadius: 6, borderColor: BRAND.headerControlBorder }} /></Badge>
              </Popover>
              {isInternal && <Button size="small" className="umbm-header-pill" icon={<UserSwitchOutlined />} onClick={() => router.push('/dashboard')} style={{ height: 34, borderRadius: 6, borderColor: BRAND.headerControlBorder, paddingInline: 10 }}>Về Quản trị</Button>}
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'role', icon: <UserSwitchOutlined />, label: `${u.displayName} (${ROLE_LABELS[u.role]})`, disabled: true },
                    { type: 'divider' },
                    { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân & Cập nhật thông tin', onClick: () => setProfileTab('info') },
                    { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu / Mã PIN bảo mật', onClick: () => setProfileTab('password') },
                    { key: 'sound', icon: soundEnabled ? <SoundOutlined /> : <MutedOutlined />, label: `Âm thanh thông báo: ${soundEnabled ? 'Đang bật (Bấm để tắt)' : 'Đang tắt (Bấm để bật)'}`, onClick: toggleSound },
                    { key: 'sync', icon: <ReloadOutlined />, label: 'Làm mới toàn bộ dữ liệu trang', onClick: () => qc.invalidateQueries() },
                    { type: 'divider' },
                    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: 'Đăng xuất hệ thống', onClick: logout },
                  ],
                }}
              >
                <div className="umbm-header-pill" style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 6px', border: `1px solid ${BRAND.headerControlBorder}`, borderRadius: 8, cursor: 'pointer', background: '#F8FAFC' }}>
                  <Avatar size={24} style={{ background: BRAND.primaryBg, color: BRAND.primary, border: '1px solid #93C5FD', fontWeight: 700, fontSize: 11 }}>{(u.displayName || u.username).charAt(0).toUpperCase()}</Avatar>
                  <Typography.Text strong style={{ fontSize: 12, color: '#0F172A' }}>{u.displayName || u.username}</Typography.Text>
                  <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, lineHeight: '18px', paddingInline: 6, fontWeight: 600 }}>{ROLE_SHORT_LABELS[u.role]}</Tag>
                  <DownOutlined style={{ fontSize: 10, color: '#64748B' }} />
                </div>
              </Dropdown>
            </Space>
          </Layout.Header>
          <Layout.Content style={{ padding: 20, width: '100%', maxWidth: '100%', overflowX: 'clip' }}>
            {activeMaint && <Alert type="warning" banner showIcon style={{ marginBottom: 14 }} message={activeMaint.message || 'Hệ thống đang bảo trì nâng cấp định kỳ.'} />}
            {children}
          </Layout.Content>
        </Layout>
        <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
      </Layout>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: BRAND.layout, width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
      <div style={{ width: '100%', margin: '0 auto', minHeight: '100dvh', background: BRAND.layout, position: 'relative', paddingBottom: 72, overflowX: 'hidden' }}>
        {activeMaint && <Alert type="warning" banner showIcon message={activeMaint.message || 'Hệ thống đang bảo trì nâng cấp định kỳ.'} />}
        {children}
        <nav className="safe-bottom" style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', background: '#fff', borderTop: `1px solid ${BRAND.border}`, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', zIndex: 20 }}>
          {MOBILE_TABS.map((t) => {
            const active = t.href === '/nv' ? pathname === '/nv' : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} style={{ minHeight: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 11, fontWeight: active ? 600 : 400, color: active ? BRAND.primary : BRAND.textSecondary, textDecoration: 'none' }}>
                <span style={{ fontSize: 20, lineHeight: 1, ...(t.primary ? { width: 40, height: 40, borderRadius: 20, background: BRAND.primary, color: '#fff', display: 'grid', placeItems: 'center', marginTop: -14, fontSize: 18 } : {}) }}>{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
          <Popover content={mobileMoreMenu} trigger="click" placement="topRight" open={moreOpen} onOpenChange={setMoreOpen}>
            <div role="button" tabIndex={0} style={{ minHeight: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 11, fontWeight: isMoreActive || moreOpen ? 600 : 400, color: isMoreActive || moreOpen ? BRAND.primary : BRAND.textSecondary, cursor: 'pointer' }}><span style={{ fontSize: 20, lineHeight: 1 }}><AppstoreOutlined /></span>Thêm</div>
          </Popover>
        </nav>
        <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
      </div>
    </div>
  );
}
