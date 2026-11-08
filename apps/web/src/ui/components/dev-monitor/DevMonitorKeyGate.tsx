'use client';

import { useState } from 'react';
import { Alert, Button, Card, Flex, Form, Input, Space, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, KeyOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { ApiClientError } from '@/lib/api';
import { verifyDevMonitorKey } from '@/lib/dev-monitor-api';

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
      setErrorMsg('Vui lòng nhập mã khóa giám sát kỹ thuật');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyDevMonitorKey(trimmed);
      onVerified(trimmed);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Không thể kết nối tới máy chủ API để xác thực khóa';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: '100vh', width: '100%', background: '#F8FAFC', padding: 24 }}
    >
      <Card
        style={{ width: '100%', maxWidth: 480, border: '1px solid #E5E7EB', borderRadius: 4, boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}
        styles={{ body: { padding: 28 } }}
      >
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <Flex align="center" justify="space-between">
            <Space size={10}>
              <Flex
                align="center"
                justify="center"
                style={{ width: 38, height: 38, borderRadius: 4, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#2563EB', fontSize: 18 }}
              >
                <SafetyCertificateOutlined />
              </Flex>
              <div>
                <Typography.Text strong style={{ fontSize: 15, color: '#0F172A', display: 'block' }}>
                  {SYSTEM_CONFIG.brandName} · TRUNG TÂM GIÁM SÁT KỸ THUẬT
                </Typography.Text>
                <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>
                  Thống kê toàn diện Hạ tầng, Dung lượng PostgreSQL & Dữ liệu
                </Typography.Text>
              </div>
            </Space>
            <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>{SYSTEM_CONFIG.version}</Tag>
          </Flex>

          <Alert
            type="info"
            showIcon
            icon={<LockOutlined />}
            message="Yêu cầu xác thực khóa hệ thống phía Backend"
            description="Trang thống kê dành riêng cho kỹ thuật viên vận hành. Vui lòng nhập mã khóa mặc định hệ thống được cấu hình trong biến môi trường máy chủ để mở bảng điều khiển."
            style={{ borderRadius: 4 }}
          />

          {errorMsg ? (
            <Alert type="error" showIcon message={errorMsg} style={{ borderRadius: 4 }} />
          ) : null}

          <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
            <Form.Item
              name="key"
              label={<span style={{ fontWeight: 600, color: '#0F172A' }}>Mã khóa giám sát hệ thống</span>}
              rules={[{ required: true, message: 'Vui lòng nhập mã khóa hệ thống' }]}
            >
              <Input.Password
                size="large"
                prefix={<KeyOutlined style={{ color: '#64748B' }} />}
                placeholder="Nhập mã khóa hệ thống để xác thực với Backend API..."
                autoFocus
                autoComplete="off"
              />
            </Form.Item>

            <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 4 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                icon={<SafetyCertificateOutlined />}
              >
                Xác thực Backend & Mở bảng thống kê
              </Button>
              <Button
                type="default"
                block
                icon={<ArrowLeftOutlined />}
                href="/login"
              >
                Quay về trang Đăng nhập Quản trị
              </Button>
            </Space>
          </Form>
        </Space>
      </Card>
    </Flex>
  );
}
