'use client';

import { Alert, Drawer, Grid, Layout, Menu, Spin, Tag, Tooltip } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SYSTEM_CONFIG, type Permission } from '@umbm/shared';
import { api } from '@/lib/api';
import { canAccessPath, isUnauthorized, loginPath, resolveLandingRoute, useLogout, useMe } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { TopHeaderBar } from './components/TopHeaderBar';
import { BACKOFFICE_NAV } from './nav-config';
import { BRAND } from './theme';

export function BackofficeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { data, isLoading, error } = useMe();
  const logout = useLogout('backoffice');
  const mntQ = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<{ enabled?: boolean; message?: string }[]>('/admin/maintenance'), enabled: !!data, retry: false });
  const activeMaint = mntQ.data?.[0]?.enabled ? mntQ.data[0] : null;

  useRealtime('backoffice', !!data, data?.socketToken);

  useEffect(() => {
    if (isUnauthorized(error) || (!isLoading && !data) || (data && data.app !== 'backoffice')) {
      router.replace(loginPath('backoffice'));
      return;
    }
    if (data && !canAccessPath(data.user, pathname, searchParams.get('section'))) {
      router.replace(resolveLandingRoute(data.user, 'backoffice'));
    }
  }, [data, error, isLoading, pathname, router, searchParams]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  const isCompactSider = collapsed && !isMobile;

  const menuItems = useMemo<ItemType[]>(() => {
    if (!data) return [];
    const has = (perms: Permission[]) => perms.length === 0 || perms.some((p) => data.user.permissions.includes(p));
    const groups = BACKOFFICE_NAV.map((g) => ({
      ...g,
      visibleItems: g.items.filter((i) => has(i.perms)),
    })).filter((g) => g.visibleItems.length > 0);

    if (isCompactSider) {
      const flat: ItemType[] = [];
      groups.forEach((g, idx) => {
        if (idx > 0) flat.push({ type: 'divider', key: `div-${g.key}` });
        g.visibleItems.forEach((i) => {
          flat.push({
            key: i.key,
            icon: i.icon,
            title: `${i.label} (${g.label})`,
            label: <Link href={i.key}>{i.label}</Link>,
          });
        });
      });
      return flat;
    }

    return groups.map((g) => ({
      key: g.key,
      label: <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>{g.label}</span>,
      children: g.visibleItems.map((i) => ({
        key: i.key,
        icon: i.icon,
        title: i.label,
        label: <Link href={i.key}>{i.label}</Link>,
      })),
    }));
  }, [data, isCompactSider]);

  const activeNav = useMemo(() => {
    const section = searchParams.get('section');
    const fullKey = section ? `${pathname}?section=${section}` : pathname;
    for (const g of BACKOFFICE_NAV) {
      for (const item of g.items) {
        if (fullKey === item.key) return { group: g.label, item };
      }
    }
    for (const g of BACKOFFICE_NAV) {
      for (const item of g.items) {
        if (pathname === item.key || pathname.startsWith(`${item.key}/`)) return { group: g.label, item };
      }
    }
    return { group: 'Bàn làm việc', item: BACKOFFICE_NAV[0]!.items[0]! };
  }, [pathname, searchParams]);

  if (isLoading || !data) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Spin tip="Đang tải phiên làm việc..." size="large"><div style={{ width: 120, height: 48 }} /></Spin>
      </div>
    );
  }

  const versionLabel = SYSTEM_CONFIG.version.startsWith('v') ? SYSTEM_CONFIG.version : `v${SYSTEM_CONFIG.version}`;

  const brand = (
    <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: isCompactSider ? 'center' : 'flex-start', gap: 10, padding: isCompactSider ? 0 : '0 16px', borderBottom: `1px solid ${BRAND.border}` }}>
      <Tooltip placement="right" title={isCompactSider ? `${SYSTEM_CONFIG.brandName} — ${SYSTEM_CONFIG.brandSubtitle}` : undefined}>
        <div
          style={{ width: 34, height: 34, borderRadius: 6, background: '#0F172A', border: `1px solid ${BRAND.primary}`, color: '#FFFFFF', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, letterSpacing: 0.4, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => router.push('/dashboard')}
        >
          {SYSTEM_CONFIG.brandShortCode}
        </div>
      </Tooltip>
      {!isCompactSider && (
        <div style={{ lineHeight: 1.15, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.3, color: '#0F172A' }}>{SYSTEM_CONFIG.brandName}</div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.6, color: '#64748B' }}>{SYSTEM_CONFIG.brandSubtitle}</div>
        </div>
      )}
    </div>
  );

  const menu = (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isCompactSider ? '8px 0' : '6px 4px' }}>
      <Menu
        className="umbm-sider-menu"
        mode="inline"
        inlineIndent={10}
        inlineCollapsed={isCompactSider}
        defaultOpenKeys={BACKOFFICE_NAV.map((g) => g.key)}
        items={menuItems}
        selectedKeys={[activeNav.item.key]}
        onClick={({ key }) => { if (key.startsWith('/')) router.push(key); }}
        style={{ borderInlineEnd: 'none' }}
      />
    </div>
  );

  const versionFooter = (
    <div style={{ padding: isCompactSider ? '10px 4px' : '10px 16px', borderTop: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: isCompactSider ? 'center' : 'space-between', background: '#FFFFFF' }}>
      {!isCompactSider && <span style={{ fontSize: 12, color: '#64748B' }}>Phiên bản hệ thống</span>}
      <Tooltip placement="right" title={isCompactSider ? `Phiên bản hệ thống ${versionLabel}` : undefined}>
        <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
          {isCompactSider ? versionLabel.replace(/\.0$/, '') : versionLabel}
        </Tag>
      </Tooltip>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      {!isMobile && (
        <Layout.Sider
          width={260}
          collapsedWidth={68}
          collapsed={collapsed}
          style={{ borderRight: `1px solid ${BRAND.border}`, position: 'sticky', top: 0, height: '100dvh' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {brand}
            {menu}
            {versionFooter}
          </div>
        </Layout.Sider>
      )}

      {isMobile && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          width={264}
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' }, header: { display: 'none' } }}
        >
          {brand}
          {menu}
          {versionFooter}
        </Drawer>
      )}

      <Layout style={{ minWidth: 0, flex: 1, overflowX: 'hidden' }}>
        <TopHeaderBar
          isMobile={isMobile}
          collapsed={collapsed}
          onToggleNav={() => (isMobile ? setDrawerOpen(true) : setCollapsed((c) => !c))}
          breadcrumbGroup={activeNav.group}
          breadcrumbTitle={activeNav.item.breadcrumbTitle}
          user={data.user}
          onLogout={logout}
        />
        <Layout.Content style={{ padding: isMobile ? 12 : 20, width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
          {activeMaint && (
            <Alert
              type="warning"
              banner
              showIcon
              style={{ marginBottom: 14, borderRadius: 4, border: '1px solid #F59E0B' }}
              message={`CHẾ ĐỘ BẢO TRÌ ĐANG BẬT: ${activeMaint.message || 'Hệ thống đang bảo trì nâng cấp định kỳ'}`}
            />
          )}
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
