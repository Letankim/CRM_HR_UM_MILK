'use client';

import { useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Descriptions, Flex, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  ClusterOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { ApiClientError } from '@/lib/api';
import {
  executeDevAction,
  formatUptime,
  pingPublicHealthApi,
  type DevActionKind,
  type DevSystemStatsResponse,
} from '@/lib/dev-monitor-api';

interface DevRuntimeActionsTabProps {
  devKey: string;
  runtime: DevSystemStatsResponse['runtime'];
  onActionCompleted: () => Promise<void>;
}

export function DevRuntimeActionsTab({ devKey, runtime, onActionCompleted }: DevRuntimeActionsTabProps) {
  const { message } = AntApp.useApp();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<{ title: string; detail: string; ok: boolean } | null>(null);

  const runAction = async (kind: DevActionKind) => {
    setBusyAction(kind);
    try {
      const res = await executeDevAction(devKey, kind);
      setLastActionResult({ title: res.message, detail: JSON.stringify(res.data, null, 2), ok: true });
      message.success(res.message);
      await onActionCompleted();
    } catch (err) {
      const errMsg = err instanceof ApiClientError ? err.message : 'Thực thi thao tác kỹ thuật thất bại';
      setLastActionResult({ title: errMsg, detail: '', ok: false });
      message.error(errMsg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestPublicHealth = async () => {
    setBusyAction('PUBLIC_HEALTH');
    try {
      const res = await pingPublicHealthApi();
      const pg = res.data.postgres;
      const summary = pg.enabled
        ? `API /api/health phản hồi ổn định — Đã gọi Keep-Alive tới PostgreSQL thành công (${pg.latency_ms ?? 0} ms)`
        : 'API /api/health phản hồi ổn định (Chưa cấu hình DATABASE_URL)';
      setLastActionResult({ title: summary, detail: JSON.stringify(res.data, null, 2), ok: true });
      message.success(summary);
    } catch {
      setLastActionResult({ title: 'Không thể gọi /api/health', detail: '', ok: false });
      message.error('Không thể gọi /api/health');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={<Space><ToolOutlined /><span>Bảng Điều khiển Tác vụ Kỹ thuật & Chống Ngủ đông PostgreSQL</span></Space>}
        style={{ border: '1px solid #E5E7EB', borderRadius: 4 }}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Cơ chế Keep-Alive chống ngủ đông Cloud PostgreSQL đã tích hợp sẵn vào /api/health"
            description="Mỗi khi Render Health Check, UptimeRobot hoặc Cron gọi vào GET /api/health, hệ thống tự động thực thi truy vấn giữ ấm trực tiếp lên PostgreSQL (SELECT 1) kèm kiểm tra khôi phục kết nối, giúp cả Render Web Service lẫn Cloud PostgreSQL luôn sẵn sàng 24/7."
            style={{ borderRadius: 4 }}
          />

          <Flex gap={10} wrap="wrap">
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busyAction === 'PUBLIC_HEALTH'}
              onClick={handleTestPublicHealth}
            >
              Gọi thử GET /api/health (Keep-Alive PostgreSQL)
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              loading={busyAction === 'PING_POSTGRES'}
              onClick={() => void runAction('PING_POSTGRES')}
            >
              Đo độ trễ SQL trực tiếp
            </Button>
            <Button
              icon={<CloudSyncOutlined />}
              loading={busyAction === 'FLUSH_OUTBOX'}
              onClick={() => void runAction('FLUSH_OUTBOX')}
            >
              Đẩy ngay Hàng đợi Outbox lên Sheets
            </Button>
            <Button
              icon={<SyncOutlined />}
              loading={busyAction === 'RECONCILE_PG_SHEETS'}
              onClick={() => void runAction('RECONCILE_PG_SHEETS')}
            >
              Đối soát 2 chiều PostgreSQL & Google Sheets
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={busyAction === 'RECONCILE_INTEGRITY'}
              onClick={() => void runAction('RECONCILE_INTEGRITY')}
            >
              Quét & Sửa Toàn vẹn Dữ liệu Nghiệp vụ
            </Button>
          </Flex>

          {lastActionResult ? (
            <Alert
              type={lastActionResult.ok ? 'success' : 'error'}
              showIcon
              message={lastActionResult.title}
              description={
                lastActionResult.detail ? (
                  <pre style={{ margin: '8px 0 0', padding: 10, background: '#0F172A', color: '#F8FAFC', borderRadius: 4, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                    {lastActionResult.detail}
                  </pre>
                ) : undefined
              }
              style={{ borderRadius: 4 }}
            />
          ) : null}
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<Space><ClusterOutlined /><span>Tài nguyên Máy chủ Node.js & Hệ điều hành (Host/Container)</span></Space>} style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <div>
                <Flex justify="space-between">
                  <Typography.Text strong style={{ fontSize: 13 }}>Bộ nhớ V8 Heap Node.js</Typography.Text>
                  <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>{runtime.memory.heapUsedMb} MB / {runtime.memory.heapTotalMb} MB ({runtime.memory.heapUsagePercent}%)</Typography.Text>
                </Flex>
                <Progress percent={runtime.memory.heapUsagePercent} size="small" strokeColor="#2563EB" />
              </div>

              <div>
                <Flex justify="space-between">
                  <Typography.Text strong style={{ fontSize: 13 }}>Bộ nhớ RAM Hệ điều hành</Typography.Text>
                  <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>Đã dùng {runtime.os.usedMemMb} MB / {runtime.os.totalMemMb} MB · Trống {runtime.os.freeMemMb} MB</Typography.Text>
                </Flex>
                <Progress percent={runtime.os.memUsagePercent} size="small" strokeColor={runtime.os.memUsagePercent >= 85 ? '#DC2626' : '#16A34A'} />
              </div>

              <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Phiên bản Node.js">{runtime.nodeVersion}</Descriptions.Item>
                <Descriptions.Item label="Tiến trình (PID)">#{runtime.pid}</Descriptions.Item>
                <Descriptions.Item label="Hệ điều hành" span={2}>{runtime.platform} · Host: {runtime.hostname}</Descriptions.Item>
                <Descriptions.Item label="Vi xử lý (CPU)" span={2}>{runtime.os.cpuModel} ({runtime.os.cpuCores} nhân)</Descriptions.Item>
                <Descriptions.Item label="Bộ nhớ RSS / External">{runtime.memory.rssMb} MB RSS · {runtime.memory.externalMb} MB Ext</Descriptions.Item>
                <Descriptions.Item label="Tải trung bình (Load)">{runtime.os.loadAvg.join(' / ')}</Descriptions.Item>
                <Descriptions.Item label="Thời gian hoạt động">{formatUptime(runtime.uptimeSeconds)}</Descriptions.Item>
                <Descriptions.Item label="Múi giờ máy chủ">{runtime.timezone}</Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Trạng thái Kết nối Tích hợp Ngoại vi & Hàng đợi Ghi" style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }}>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="Kết nối Google OAuth / Sheets / Drive">
                <Space direction="vertical" size={2}>
                  <Tag color={runtime.integrations.googleOk ? 'success' : 'error'} style={{ borderRadius: 2 }}>
                    {runtime.integrations.googleOk ? 'Đang hoạt động tốt' : 'Cần kiểm tra kết nối'}
                  </Tag>
                  <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>{runtime.integrations.googleDetail}</Typography.Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Hàng đợi Ghi tuần tự (WriteQueue)">
                <Tag color={runtime.integrations.writeQueuePending > 15 ? 'warning' : 'success'} style={{ borderRadius: 2 }}>
                  {runtime.integrations.writeQueuePending} tác vụ đang chờ ghi
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Kết nối Thời gian thực (Socket.IO)">
                <Tag color="blue" style={{ borderRadius: 2 }}>
                  {runtime.integrations.realtimeConnections} thiết bị đang trực tuyến
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Dịch vụ Gửi Email Doanh nghiệp (SMTP)">
                <Space wrap>
                  <Tag color={runtime.integrations.emailEnabled ? 'success' : 'default'} style={{ borderRadius: 2 }}>
                    {runtime.integrations.emailEnabled ? 'Đã kích hoạt' : 'Đang tắt'}
                  </Tag>
                  <Typography.Text style={{ fontSize: 12 }}>
                    Đang chờ: <strong>{runtime.integrations.emailQueue.queuedCount}</strong> · Đã gửi: <strong>{runtime.integrations.emailQueue.sentCount}</strong> · Lỗi: <strong>{runtime.integrations.emailQueue.failedCount}</strong>
                  </Typography.Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Chế độ Bảo trì Hệ thống">
                <Tag color={runtime.integrations.maintenanceEnabled ? 'warning' : 'success'} style={{ borderRadius: 2 }}>
                  {runtime.integrations.maintenanceEnabled ? 'Đang bật khóa bảo trì' : 'Đang mở vận hành bình thường'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Thời gian Máy chủ hiện tại">
                {new Date(runtime.serverTime).toLocaleString('vi-VN')} (Khởi chạy từ {new Date(runtime.startedAt).toLocaleString('vi-VN')})
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
