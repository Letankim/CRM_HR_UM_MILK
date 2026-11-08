'use client';

import { Badge, Button, Card, Col, Flex, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  CloudSyncOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  HddOutlined,
  LockOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { formatUptime, type DevSystemStatsResponse } from '@/lib/dev-monitor-api';

interface DevMonitorKpiStripProps {
  stats: DevSystemStatsResponse;
  refreshing: boolean;
  onRefresh: () => void;
  onLockSession: () => void;
}

export function DevMonitorKpiStrip({ stats, refreshing, onRefresh, onLockSession }: DevMonitorKpiStripProps) {
  const { postgres, domain, runtime } = stats;
  const pgStorageColor = postgres.storage.usagePercent >= 85 ? '#DC2626' : postgres.storage.usagePercent >= 65 ? '#D97706' : '#2563EB';
  const pgConnColor = postgres.connections.usagePercent >= 85 ? '#DC2626' : postgres.connections.usagePercent >= 65 ? '#D97706' : '#16A34A';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        style={{ border: '1px solid #E5E7EB', borderRadius: 4 }}
        styles={{ body: { padding: '14px 20px' } }}
      >
        <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
          <Space size={12} wrap>
            <Flex
              align="center"
              justify="center"
              style={{ width: 38, height: 38, borderRadius: 4, background: '#0F172A', color: '#FFFFFF', fontSize: 18 }}
            >
              <DatabaseOutlined />
            </Flex>
            <div>
              <Space size={8} align="center" wrap>
                <Typography.Title level={4} style={{ margin: 0, color: '#0F172A', fontSize: 17 }}>
                  Trung tâm Giám sát & Thống kê Kỹ thuật Hệ thống
                </Typography.Title>
                <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>{SYSTEM_CONFIG.brandName} · {runtime.version}</Tag>
                <Tag color={postgres.alive ? 'success' : postgres.enabled ? 'error' : 'default'} style={{ margin: 0, borderRadius: 2 }}>
                  {postgres.alive ? 'PostgreSQL Đang kết nối' : postgres.enabled ? 'PostgreSQL Đang dự phòng' : 'Chế độ Không PostgreSQL'}
                </Tag>
              </Space>
              <Typography.Text style={{ display: 'block', fontSize: 12, color: '#64748B', marginTop: 2 }}>
                Cập nhật lúc: {new Date(stats.generatedAt).toLocaleString('vi-VN')} · Môi trường: {runtime.envMode} · Nguồn nền: {runtime.dataBackendMode}
              </Typography.Text>
            </div>
          </Space>

          <Space size={8} wrap>
            <Button icon={<ReloadOutlined />} loading={refreshing} type="primary" onClick={onRefresh}>
              Làm mới toàn bộ chỉ số
            </Button>
            <Button icon={<LockOutlined />} onClick={onLockSession}>
              Khóa phiên Giám sát
            </Button>
          </Space>
        </Flex>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>DUNG LƯỢNG POSTGRESQL</Typography.Text>
              <HddOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {postgres.storage.usedMb} / {postgres.storage.quotaMb} MB
            </Typography.Title>
            <Progress percent={postgres.storage.usagePercent} size="small" strokeColor={pgStorageColor} />
            <Typography.Text style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
              Còn trống: {postgres.storage.freeMb} MB ({postgres.storage.freePercent}%)
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>ĐỘ TRỄ & TRẠNG THÁI PG</Typography.Text>
              <ThunderboltOutlined style={{ color: postgres.alive ? '#16A34A' : '#DC2626', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {postgres.pingLatencyMs !== null ? `${postgres.pingLatencyMs} ms` : 'Chưa bật'}
            </Typography.Title>
            <div style={{ margin: '6px 0 4px' }}>
              <Badge status={postgres.alive ? 'success' : postgres.enabled ? 'warning' : 'default'} text={<span style={{ fontSize: 12, color: '#0F172A' }}>{postgres.alive ? 'Phản hồi trực tuyến' : 'Chế độ dự phòng'}</span>} />
            </div>
            <Typography.Text ellipsis style={{ fontSize: 12, color: '#64748B', display: 'block' }}>
              DB: {postgres.database} ({postgres.tables.length} bảng SQL)
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>KẾT NỐI POSTGRESQL</Typography.Text>
              <ApiOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {postgres.connections.serverUsed} / {postgres.connections.serverMax || '-'} slot
            </Typography.Title>
            <Progress percent={postgres.connections.usagePercent} size="small" strokeColor={pgConnColor} />
            <Typography.Text style={{ fontSize: 12, color: '#0F172A' }}>
              Còn trống: <strong>{postgres.connections.serverFree}</strong> · Pool: {postgres.connections.poolTotal}/{postgres.connections.poolMax}
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>HÀNG ĐỢI ĐỒNG BỘ OUTBOX</Typography.Text>
              <CloudSyncOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {postgres.sync.outbox.pending} chờ đẩy
            </Typography.Title>
            <div style={{ margin: '6px 0 4px' }}>
              <Tag color={postgres.sync.outbox.failed > 0 ? 'error' : 'success'} style={{ borderRadius: 2, margin: 0 }}>
                {postgres.sync.outbox.failed > 0 ? `${postgres.sync.outbox.failed} lỗi đồng bộ` : 'Không có lỗi tồn đọng'}
              </Tag>
            </div>
            <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>
              Đã nạp {postgres.sync.hydratedTabs} tab · {postgres.sync.totalPhysicalRows.toLocaleString('vi-VN')} dòng PG
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>DỮ LIỆU NGHIỆP VỤ</Typography.Text>
              <DatabaseOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {domain.totalActiveRows.toLocaleString('vi-VN')} bản ghi
            </Typography.Title>
            <div style={{ margin: '6px 0 4px' }}>
              <Tag color="processing" style={{ borderRadius: 2, margin: 0 }}>
                {domain.totalStores} bảng đang vận hành
              </Tag>
            </div>
            <Typography.Text style={{ fontSize: 12, color: '#64748B' }}>
              Đã xóa mềm: {domain.totalDeletedRows} · Lỗi schema: {domain.totalInvalidRows}
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8} xl={4}>
          <Card style={{ height: '100%', border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: 16 } }}>
            <Flex justify="space-between" align="center">
              <Typography.Text style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>RAM NODE & UPTIME API</Typography.Text>
              <ClusterOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            </Flex>
            <Typography.Title level={4} style={{ margin: '6px 0 2px', color: '#0F172A' }}>
              {runtime.memory.rssMb} MB RSS
            </Typography.Title>
            <Progress percent={runtime.memory.heapUsagePercent} size="small" strokeColor="#2563EB" />
            <Typography.Text ellipsis style={{ fontSize: 12, color: '#64748B', display: 'block' }}>
              Chạy liên tục: {formatUptime(runtime.uptimeSeconds)}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
