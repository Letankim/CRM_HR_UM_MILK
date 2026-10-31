'use client';

import { Alert, App, Button, Card, Col, Popconfirm, Row, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, DatabaseOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { DataPartitionRolloverModal, monthKeyLabel, PARTITION_BASE_LABELS, partitionTabLabel } from './DataPartitionRolloverModal';

interface PartitionItem {
  monthKey: string;
  label: string;
  isActive: boolean;
  tabs: string[];
}

interface PartitionCount {
  base: string;
  tab: string;
  rows: number;
}

interface PartitionListing {
  activeMonth: string;
  activeLabel: string;
  items: PartitionItem[];
  counts: PartitionCount[];
}

export function DataPartitionCard() {
  const qc = useQueryClient();
  const can = useCan();
  const canEdit = can('system.config');
  const canRead = can('system.config', 'integration.read');
  const { message } = App.useApp();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['data-partitions'],
    queryFn: () => api.get<PartitionListing>('/admin/data-partitions'),
    enabled: canRead,
    retry: false,
  });

  const switchMut = useMutation({
    mutationFn: (monthKey: string) => api.put<PartitionListing>('/admin/data-partitions/active', { month_key: monthKey }),
    onMutate: (monthKey) => setSwitchingKey(monthKey),
    onSuccess: async (data, monthKey) => {
      qc.setQueryData(['data-partitions'], data);
      message.success(`Hệ thống đã chuyển sang dùng ${data.activeLabel || (monthKey ? monthKeyLabel(monthKey) : 'sheet gốc')}`);
      await qc.invalidateQueries();
    },
    onError: (e: unknown) => message.error(e instanceof ApiClientError ? e.message : 'Không thể chuyển sheet dữ liệu, vui lòng thử lại'),
    onSettled: () => setSwitchingKey(null),
  });

  if (!canRead) return null;
  const d = q.data;

  return (
    <Card
      size="small"
      title={<span><DatabaseOutlined /> Phân vùng dữ liệu theo tháng (Google Sheets)</span>}
      extra={
        <Space size={6}>
          <Button size="small" icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
          {canEdit && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setRolloverOpen(true)}>Tạo sheet tháng mới</Button>}
        </Space>
      }
    >
      {q.isLoading ? (
        <Skeleton active />
      ) : q.isError || !d ? (
        <Alert type="error" showIcon message="Không thể tải thông tin phân vùng dữ liệu" description={q.error instanceof ApiClientError ? q.error.message : undefined} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={<span>Sheet đang dùng: <Tag color="blue" style={{ marginLeft: 4 }}>{d.activeLabel || monthKeyLabel(d.activeMonth)}</Tag></span>}
            description="Lịch phân ca, đơn nghỉ OFF, đổi ca / nhường ca, chấm công và phiếu bổ sung công được tách theo từng tháng để bảng tính luôn gọn nhẹ. Nên chốt kỳ lương tháng cũ trước khi chuyển sheet."
          />
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>Số dòng dữ liệu trong sheet đang dùng</Typography.Text>
              <Table<PartitionCount>
                size="small"
                rowKey="base"
                pagination={false}
                dataSource={d.counts}
                columns={[
                  { title: 'Bảng dữ liệu', dataIndex: 'base', render: (v: string) => <span style={{ fontWeight: 500 }}>{PARTITION_BASE_LABELS[v] ?? partitionTabLabel(v)}</span> },
                  { title: 'Số dòng', dataIndex: 'rows', align: 'right', width: 120, render: (v: number) => <span className="num">{Number(v || 0).toLocaleString('vi-VN')}</span> },
                ]}
              />
            </Col>
            <Col xs={24} xl={14}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>Các sheet dữ liệu theo tháng</Typography.Text>
              <Table<PartitionItem>
                size="small"
                rowKey={(r) => r.monthKey || 'ROOT'}
                pagination={false}
                dataSource={d.items}
                scroll={{ x: 560 }}
                columns={[
                  { title: 'Tháng dữ liệu', dataIndex: 'label', width: 150, render: (v: string, r) => <span style={{ fontWeight: 500 }}>{v || monthKeyLabel(r.monthKey)}</span> },
                  {
                    title: 'Bảng đã tạo',
                    dataIndex: 'tabs',
                    render: (tabs: string[]) => (
                      <Space size={[4, 4]} wrap>
                        {(tabs ?? []).map((t) => <Tag key={t} style={{ margin: 0 }}>{partitionTabLabel(t)}</Tag>)}
                      </Space>
                    ),
                  },
                  { title: 'Trạng thái', dataIndex: 'isActive', width: 120, render: (v: boolean) => (v ? <Tag color="green" icon={<CheckCircleOutlined />}>Đang dùng</Tag> : <Tag>Lưu trữ</Tag>) },
                  {
                    title: 'Thao tác',
                    width: 140,
                    align: 'right',
                    render: (_, r) =>
                      canEdit && !r.isActive ? (
                        <Popconfirm
                          title={`Chuyển hệ thống sang ${r.label || monthKeyLabel(r.monthKey)}?`}
                          description={
                            <div style={{ maxWidth: 320 }}>
                              Toàn bộ hệ thống (lịch phân ca, nghỉ OFF, đổi ca, chấm công) sẽ đọc và ghi vào sheet của tháng này. Dùng để rà soát hoặc xử lý dữ liệu các tháng trước; nhớ chuyển lại sheet tháng hiện tại sau khi hoàn tất.
                            </div>
                          }
                          okText="Dùng sheet này"
                          cancelText="Hủy bỏ"
                          onConfirm={() => switchMut.mutateAsync(r.monthKey).catch(() => undefined)}
                        >
                          <Button size="small" icon={<SwapOutlined />} loading={switchingKey === r.monthKey}>Dùng sheet này</Button>
                        </Popconfirm>
                      ) : null,
                  },
                ]}
              />
            </Col>
          </Row>
        </Space>
      )}
      {canEdit && <DataPartitionRolloverModal open={rolloverOpen} onClose={() => setRolloverOpen(false)} />}
    </Card>
  );
}
