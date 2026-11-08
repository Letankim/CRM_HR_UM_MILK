'use client';

import { useState } from 'react';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { ArrowLeftOutlined, KeyOutlined, LoginOutlined } from '@ant-design/icons';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { ApiClientError } from '@/lib/api';
import { verifyDevMonitorKey } from '@/lib/dev-monitor-api';
import { AhrBrandMark, AhrWordmarkSvg } from '../AhrBrandLogo';
import { BRAND } from '../../theme';

interface DevMonitorKeyGateProps {
  onVerified: (key: string) => void;
}

export function DevMonitorKeyGate({ onVerified }: DevMonitorKeyGateProps) {
  const [form] = Form.useForm<{ key: string }>();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (values: { key: string }) => {
    const trimmed = values.key?.trim() ?? '';
    if (!trimmed) {
      setErrorMsg('Vui lòng nhập mã truy cập');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyDevMonitorKey(trimmed);
      onVerified(trimmed);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Không kết nối được máy chủ');
    } finally {
      setLoading(false);
    }
  };

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
          maxWidth: 400,
          background: '#FFFFFF',
          border: `1px solid ${BRAND.border}`,
          borderRadius: 4,
          padding: '30px 28px 24px',
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <AhrBrandMark size={38} tiled />
              <div style={{ lineHeight: 1.15 }}>
                <AhrWordmarkSvg height={19} />
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#64748B', letterSpacing: 0.4, marginTop: 3, whiteSpace: 'nowrap' }}>
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {SYSTEM_CONFIG.version}
            </span>
          </div>

          <Typography.Title level={4} style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>
            Giám sát Hệ thống
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Vui lòng nhập mã truy cập để tiếp tục
          </Typography.Text>
        </div>

        {errorMsg ? (
          <Alert type="error" showIcon message={errorMsg} style={{ marginBottom: 16, borderRadius: 4 }} />
        ) : null}

        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false} disabled={loading} size="large">
          <Form.Item
            name="key"
            label="Mã truy cập"
            rules={[{ required: true, message: 'Vui lòng nhập mã truy cập' }]}
          >
            <Input.Password
              prefix={<KeyOutlined style={{ color: '#64748B' }} />}
              placeholder="Nhập mã truy cập"
              autoFocus
              autoComplete="off"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            icon={<LoginOutlined />}
            style={{ marginBottom: 10 }}
          >
            Truy cập
          </Button>
          <Button type="default" block icon={<ArrowLeftOutlined />} href="/login">
            Quay lại đăng nhập
          </Button>
        </Form>
      </div>
    </div>
  );
}
