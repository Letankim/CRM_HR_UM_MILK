'use client';

import { Button, Form, Input, Skeleton, Typography, Alert, Divider } from 'antd';
import { LockOutlined, LoginOutlined, UserOutlined, PhoneOutlined, SwapOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SYSTEM_CONFIG, type PublicUser } from '@umbm/shared';
import { api, ApiClientError, hasSessionFlag, markSessionActive } from '@/lib/api';
import { resolveLandingRoute, useMe, type AppKind } from '@/lib/auth';
import { AhrBrandMark, AhrWordmarkSvg, AutoStackBadge } from './components/AhrBrandLogo';
import { BRAND } from './theme';

interface Props {
  app: AppKind;
}

export function LoginForm({ app }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [checkExisting, setCheckExisting] = useState(false);
  const isEmployee = app === 'employee';

  useEffect(() => {
    setMounted(true);
    setCheckExisting(hasSessionFlag());
  }, []);

  const { data: activeSession } = useMe(checkExisting);

  useEffect(() => {
    if (activeSession?.user) {
      const target = resolveLandingRoute(activeSession.user, activeSession.app, params.get('next'));
      router.replace(target);
    }
  }, [activeSession, params, router]);

  async function onFinish(values: { identifier: string; secret: string }) {
    setLoading(true);
    setError(null);
    const cleanId = values.identifier.trim();
    const looksLikePhone = /^(\+?84|0)\d{8,10}$/.test(cleanId.replace(/\s+/g, ''));
    const effectiveApp: AppKind = isEmployee ? 'employee' : looksLikePhone ? 'employee' : 'backoffice';

    try {
      const res = await api.post<{ user: PublicUser; socketToken?: string | null }>('/auth/login', {
        identifier: cleanId,
        secret: values.secret,
        app: effectiveApp,
      });
      markSessionActive(true);
      qc.clear();
      qc.setQueryData(['me'], { user: res.user, app: effectiveApp, socketToken: res.socketToken ?? null });
      const target = resolveLandingRoute(res.user, effectiveApp, params.get('next'));
      router.replace(target);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Không kết nối được máy chủ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: BRAND.layout,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 390,
          background: '#fff',
          border: `1px solid ${BRAND.border}`,
          borderRadius: 6,
          padding: '32px 28px 24px',
        }}
      >
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <AhrBrandMark size={40} tiled />
              <div style={{ lineHeight: 1.15 }}>
                <AhrWordmarkSvg height={20} />
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#64748B', letterSpacing: 0.5, marginTop: 3 }}>
                  {SYSTEM_CONFIG.brandSubtitle}
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: BRAND.primary,
                background: BRAND.primaryBg,
                border: `1px solid ${BRAND.primaryBorder}`,
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              {isEmployee ? 'Cổng Nhân viên' : 'Cổng Quản trị'}
            </span>
          </div>
          <Typography.Title level={4} style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 18 }}>
            {isEmployee ? 'Đăng nhập Cổng Nhân viên' : 'Đăng nhập Hệ thống Quản trị'}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {isEmployee ? 'Đăng nhập bằng số điện thoại và mật khẩu cá nhân' : 'Đăng nhập bằng tài khoản quản trị hoặc số điện thoại'}
          </Typography.Text>
        </div>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        {!mounted ? (
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        ) : (
          <Form layout="vertical" requiredMark={false} onFinish={onFinish} disabled={loading} size="large">
            <Form.Item
              name="identifier"
              label={isEmployee ? 'Số điện thoại' : 'Tên đăng nhập hoặc Số điện thoại'}
              rules={[{ required: true, message: isEmployee ? 'Vui lòng nhập số điện thoại' : 'Vui lòng nhập tên đăng nhập hoặc số điện thoại' }]}
            >
              <Input
                prefix={isEmployee ? <PhoneOutlined /> : <UserOutlined />}
                autoComplete="username"
                inputMode="text"
                placeholder={isEmployee ? 'Ví dụ: 0901000001' : 'Ví dụ: admin, hr, store1 hoặc 0901000001'}
                autoFocus
              />
            </Form.Item>
            <Form.Item
              name="secret"
              label="Mật khẩu"
              rules={[
                { required: true, message: 'Vui lòng nhập mật khẩu' },
                { min: 6, message: 'Tối thiểu 6 ký tự' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
                inputMode="text"
                placeholder="Nhập mật khẩu đăng nhập"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<LoginOutlined />} block loading={loading} style={{ marginTop: 4 }}>
              Đăng nhập hệ thống
            </Button>
          </Form>
        )}

        <Divider style={{ margin: '18px 0 12px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
          <Typography.Text type="secondary">Quên mật khẩu? Liên hệ Nhân sự</Typography.Text>
          <Link href={isEmployee ? '/login' : '/nv/login'} style={{ fontWeight: 600 }}>
            <SwapOutlined /> {isEmployee ? 'Cổng Quản trị' : 'Cổng Nhân viên'}
          </Link>
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: `1px dashed ${BRAND.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11.5,
            color: '#64748B',
          }}
        >
          <span>Nền tảng <strong>{SYSTEM_CONFIG.productName}</strong> {SYSTEM_CONFIG.version}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span>bởi</span>
            <AutoStackBadge height={13} showWordmark />
          </span>
        </div>
      </div>
    </div>
  );
}
