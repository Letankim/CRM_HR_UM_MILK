'use client';

import { App, Button, Card, Col, Descriptions, Row, Skeleton, Spin, Table, Tabs, Typography } from 'antd';
import { ApiOutlined, DatabaseOutlined, MailOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import dayjs from 'dayjs';
import { TABLE_DISPLAY_LABELS, type Health } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/ui/PageHeader';
import { StatusTag } from '@/ui/StatusTag';
import { buildClickableRowProps } from '@/ui/components/BulkActionBar';
import { useQuickDetail } from '@/ui/components/RecordQuickDetailModal';
import { ReconciliationAndEmailPanel } from '@/ui/components/ReconciliationAndEmailPanel';
import { SystemGovernanceAndCommsTabs } from '@/ui/components/SystemGovernanceAndCommsTabs';
import { useClientPagination } from '@/ui/hooks/useClientPagination';

interface TableStat {
  table: string;
  rows: number;
  invalidRows: number;
  invalid: { row: number; id: string; issues: string[] }[];
  loadedAt: string | null;
}

interface HealthDetail extends Health {
  data: {
    queue: { pending: number; lastError: { at: string; key: string; message: string } | null };
    tables: TableStat[];
    unresolvedDeadLetters: number;
    lastRefreshError: string | null;
  };
}

const CHECK_LABELS: Record<string, string> = {
  google: 'Kết nối dữ liệu',
  sheetsCache: 'Bộ nhớ dữ liệu',
  writeQueue: 'Hàng đợi xử lý',
  deadLetters: 'Cần đối soát',
  realtime: 'Thời gian thực',
  backup: 'Sao lưu gần nhất',
};

function IntegrationsView() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const can = useCan();
  const { message } = App.useApp();
  const showDetail = useQuickDetail();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'health' | 'reconcile' | 'email'>('health');
  const [healthSubTab, setHealthSubTab] = useState<'tables' | 'queue'>('tables');
  const tablesPagination = useClientPagination(15, 'bảng');

  const section = params.get('section') as 'governance' | 'comms' | null;

  const q = useQuery({
    queryKey: ['integrations', 'health'],
    queryFn: () => api.get<HealthDetail>('/admin/integrations/health'),
    enabled: !section && can('integration.read'),
  });

  const handleManualRefresh = async () => {
    setRefreshing(true);
    const hide = message.loading('Đang kiểm tra kết nối và làm mới dữ liệu hệ thống...', 0);
    try {
      const fresh = await api.get<HealthDetail>('/admin/integrations/health?refresh=1');
      qc.setQueryData(['integrations', 'health'], fresh);
      await qc.invalidateQueries({ queryKey: ['integrations'], predicate: (item) => item.queryKey[1] !== 'health' });
      message.success('Đã cập nhật trạng thái tích hợp mới nhất');
    } finally {
      hide();
      setRefreshing(false);
    }
  };

  if (section === 'governance') {
    return (
      <>
        <PageHeader
          title="Chính sách & Sao lưu Bảo trì"
          description="Quản lý quy định vận hành, chấm công theo phiên bản, chế độ bảo trì và sao lưu khôi phục hệ thống."
        />
        <SystemGovernanceAndCommsTabs mode="governance" />
      </>
    );
  }

  if (section === 'comms') {
    return (
      <>
        <PageHeader
          title="Bản tin Truyền thông Nội bộ"
          description="Soạn thảo, phát hành thông báo và bản tin nội bộ tới toàn bộ nhân sự hệ thống."
        />
        <SystemGovernanceAndCommsTabs mode="comms" />
      </>
    );
  }

  const d = q.data;

  const healthPane = q.isLoading || !d ? (
    <Skeleton active />
  ) : (
    <Tabs
      size="small"
      activeKey={healthSubTab}
      onChange={(k) => setHealthSubTab(k as 'tables' | 'queue')}
      items={[
        {
          key: 'tables',
          label: <span><DatabaseOutlined /> Bảng dữ liệu đã nạp ({d.data.tables.length})</span>,
          children: (
            <Table<TableStat>
              size="small"
              rowKey="table"
              pagination={tablesPagination}
              dataSource={d.data.tables}
              scroll={{ x: 640 }}
              onRow={(r) => buildClickableRowProps(r, (item) => showDetail('sheetTableStat', item))}
              columns={[
                { title: 'Bảng dữ liệu', dataIndex: 'table', render: (v: string) => <span style={{ fontWeight: 500 }}>{TABLE_DISPLAY_LABELS[v] ?? v}</span> },
                { title: 'Số dòng', dataIndex: 'rows', align: 'right', width: 110, render: (v: number) => <span className="num">{v.toLocaleString('vi-VN')}</span> },
                {
                  title: 'Dòng lỗi',
                  dataIndex: 'invalidRows',
                  align: 'right',
                  width: 110,
                  render: (v: number) => <span className="num" style={{ color: v ? '#C62828' : undefined, fontWeight: v ? 600 : 400 }}>{v}</span>,
                },
                { title: 'Nạp lúc', dataIndex: 'loadedAt', width: 170, render: (v: string | null) => <span className="num">{v ? dayjs(v).format('HH:mm:ss DD/MM') : '—'}</span> },
              ]}
              expandable={{
                rowExpandable: (r) => r.invalidRows > 0,
                expandedRowRender: (r) => (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {r.invalid.map((i) => (
                      <li key={`${i.row}-${i.id}`}>
                        Dòng {i.row}: {i.issues.join('; ')}
                      </li>
                    ))}
                  </ul>
                ),
              }}
            />
          ),
        },
        {
          key: 'queue',
          label: <span><SyncOutlined /> Trạng thái Kết nối &amp; Hàng đợi ghi</span>,
          children: (
            <div>
              <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
                {Object.entries(d.checks).map(([key, c]) => (
                  <Col xs={24} sm={12} xl={8} key={key}>
                    <Card size="small">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Typography.Text strong>{CHECK_LABELS[key] ?? key}</Typography.Text>
                        <StatusTag value={c.status} />
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>{c.detail}</Typography.Text>
                    </Card>
                  </Col>
                ))}
              </Row>
              <Descriptions size="small" bordered column={{ xs: 1, md: 3 }}>
                <Descriptions.Item label="Hàng đợi đang chờ">{d.data.queue.pending}</Descriptions.Item>
                <Descriptions.Item label="Cần đối soát">{d.data.unresolvedDeadLetters}</Descriptions.Item>
                <Descriptions.Item label="Lỗi gần nhất">
                  {d.data.queue.lastError ? `${dayjs(d.data.queue.lastError.at).format('HH:mm DD/MM')} — ${d.data.queue.lastError.message}` : 'Không có'}
                </Descriptions.Item>
              </Descriptions>
            </div>
          ),
        },
      ]}
    />
  );

  return (
    <>
      <PageHeader
        title="Tích hợp, Đối soát & Mẫu Email"
        description="Giám sát trạng thái dữ liệu, quét đối soát toàn vẹn và quản lý mẫu Email doanh nghiệp."
        extra={
          <Button icon={<ReloadOutlined />} onClick={handleManualRefresh} loading={refreshing}>
            Kiểm tra &amp; Làm mới
          </Button>
        }
      />

      <Spin spinning={refreshing} tip="Đang đồng bộ trạng thái tích hợp...">
        <Card size="small">
          <Tabs
            activeKey={tab}
            onChange={(v) => setTab(v as 'health' | 'reconcile' | 'email')}
            items={[
              { key: 'health', label: <span><ApiOutlined /> Đồng bộ Dữ liệu &amp; Hàng đợi</span>, children: healthPane },
              { key: 'reconcile', label: <span><SafetyCertificateOutlined /> Đối soát Toàn vẹn Dữ liệu</span>, children: <ReconciliationAndEmailPanel mode="reconcile" /> },
              { key: 'email', label: <span><MailOutlined /> Mẫu Email &amp; Gửi thử Gmail</span>, children: <ReconciliationAndEmailPanel mode="email" /> },
            ]}
          />
        </Card>
      </Spin>
    </>
  );
}

export default function IntegrationsPage() {
  return <Suspense><IntegrationsView /></Suspense>;
}
