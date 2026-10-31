'use client';

import { Alert, App, Button, Card, Flex, Popconfirm, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DatabaseOutlined,
  EnvironmentOutlined, ExportOutlined, FileExcelOutlined, FileTextOutlined, FolderOpenOutlined,
  PlusOutlined, ReloadOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { buildClickableRowProps } from './BulkActionBar';
import {
  DataPartitionRolloverModal, monthKeyLabel, PARTITION_BASE_LABELS,
  PARTITION_MODE_LABELS, partitionBaseKey, partitionTabLabel, type MonthlyPartitionMode,
} from './DataPartitionRolloverModal';
import { useQuickDetail } from './RecordQuickDetailModal';

interface PartitionItem {
  monthKey: string; label: string; isActive: boolean; mode?: MonthlyPartitionMode;
  fileName?: string; spreadsheetId?: string; folderPath?: string; webViewLink?: string; createdAt?: string; tabs: string[];
}
interface PartitionCount { base: string; tab: string; rows: number }
interface PartitionListing { activeMonth: string; activeLabel: string; activeFile?: PartitionItem; items: PartitionItem[]; counts: PartitionCount[] }

const BASE_ICONS: Record<string, ReactNode> = {
  SHIFT_ASSIGNMENTS: <CalendarOutlined />, LEAVE_REQUESTS: <ClockCircleOutlined />, SHIFT_SWAPS: <SwapOutlined />,
  ATTENDANCE_EVENTS: <EnvironmentOutlined />, ATTENDANCE_ADJUSTMENTS: <FileTextOutlined />,
};
const canOpenExternalLink = (item?: PartitionItem) => Boolean(item?.webViewLink && !item.spreadsheetId?.startsWith('mem-'));

export function DataPartitionCard() {
  const qc = useQueryClient();
  const can = useCan();
  const canEdit = can('system.config'), canRead = can('system.config', 'integration.read');
  const { message, modal } = App.useApp();
  const showDetail = useQuickDetail();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['data-partitions'], queryFn: () => api.get<PartitionListing>('/admin/data-partitions'), enabled: canRead, retry: false });

  const switchMut = useMutation({
    mutationFn: (monthKey: string) => api.put<PartitionListing>('/admin/data-partitions/active', { month_key: monthKey }),
    onMutate: (monthKey) => setSwitchingKey(monthKey),
    onSuccess: async (data, monthKey) => {
      qc.setQueryData(['data-partitions'], data);
      message.success(`Đã chuyển hệ thống sang sử dụng ${data.activeLabel || monthKeyLabel(monthKey)}`);
      await qc.invalidateQueries();
    },
    onError: (e: unknown) => message.error(e instanceof ApiClientError ? e.message : 'Không thể chuyển tệp dữ liệu tháng, vui lòng thử lại'),
    onSettled: () => setSwitchingKey(null),
  });

  const d = q.data;
  const countByBase = useMemo(() => new Map((d?.counts ?? []).map((c) => [c.base, Number(c.rows || 0)])), [d?.counts]);
  const totalActiveRows = useMemo(() => (d?.counts ?? []).reduce((sum, c) => sum + Number(c.rows || 0), 0), [d?.counts]);
  const activeItem = useMemo(() => d?.activeFile ?? d?.items.find((i) => i.isActive), [d?.activeFile, d?.items]);

  if (!canRead) return null;

  const confirmSwitch = (targetKey: string, targetLabel: string) => {
    modal.confirm({
      title: `Chuyển hệ thống sang ${targetLabel}?`,
      content: 'Toàn bộ thao tác đọc/ghi Lịch phân ca, Nghỉ OFF, Đổi ca và Chấm công sẽ áp dụng trên tệp Google Sheets này. Quản trị viên có thể chuyển lại tháng khác bất kỳ lúc nào.',
      okText: 'Xác nhận chuyển', cancelText: 'Hủy bỏ', okButtonProps: { icon: <SwapOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> },
      onOk: () => switchMut.mutateAsync(targetKey),
    });
  };

  return (
    <Card
      size="small" title={<span><DatabaseOutlined /> Quản lý dữ liệu theo tháng (Google Sheets)</span>}
      extra={
        <Space size={8} wrap>
          <Button size="small" icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
          {canEdit && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setRolloverOpen(true)}>Tạo tệp tháng mới</Button>}
        </Space>
      }
    >
      {q.isLoading ? <Skeleton active /> : q.isError || !d ? (
        <Alert type="error" showIcon message="Không thể tải thông tin dữ liệu tháng" description={q.error instanceof ApiClientError ? q.error.message : undefined} />
      ) : (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{ border: '1px solid #BFDBFE', background: '#F8FAFC', borderRadius: 4, padding: '12px 14px' }}>
            <Flex align="flex-start" gap={12} style={{ flex: '1 1 380px', minWidth: 0 }}>
              <span style={{ width: 34, height: 34, borderRadius: 4, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#2563EB', display: 'inline-grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>
                <FileExcelOutlined />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Flex align="center" gap={6} wrap="wrap">
                  <Typography.Text strong style={{ color: '#0F172A' }}>Dữ liệu đang vận hành:</Typography.Text>
                  <Tag color="blue" icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>{d.activeLabel || monthKeyLabel(d.activeMonth)}</Tag>
                  <Tag color={activeItem?.mode === 'MONTHLY_FILE' ? 'geekblue' : 'default'} style={{ margin: 0 }}>
                    {PARTITION_MODE_LABELS[activeItem?.mode ?? (d.activeMonth ? 'MONTHLY_FILE' : 'ROOT_FILE')]}
                  </Tag>
                  <Tag style={{ margin: 0, fontWeight: 600 }}>Tổng {totalActiveRows.toLocaleString('vi-VN')} dòng</Tag>
                </Flex>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  <FolderOpenOutlined /> Tách riêng dữ liệu lịch ca, nghỉ OFF, đổi ca và chấm công theo từng tháng trên Google Drive để hệ thống luôn nhanh và gọn nhẹ; có thể chuyển lại tháng cũ bất kỳ lúc nào để tra cứu.
                </Typography.Text>
              </div>
            </Flex>
            <Flex align="center" gap={8} wrap="wrap">
              {canOpenExternalLink(activeItem) && (
                <Button size="small" icon={<ExportOutlined />} href={activeItem!.webViewLink} target="_blank" rel="noreferrer">Mở Google Sheets</Button>
              )}
              {canEdit && (
                <>
                  <Typography.Text style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>Chuyển nhanh:</Typography.Text>
                  <Select
                    style={{ minWidth: 230 }} value={d.activeMonth} loading={switchMut.isPending}
                    options={d.items.map((it) => ({ value: it.monthKey, label: `${it.label || monthKeyLabel(it.monthKey)}${it.isActive ? ' (Đang dùng)' : ''}` }))}
                    onChange={(nextKey) => {
                      if (nextKey === d.activeMonth) return;
                      const found = d.items.find((x) => x.monthKey === nextKey);
                      confirmSwitch(nextKey, found?.label || monthKeyLabel(nextKey));
                    }}
                  />
                </>
              )}
            </Flex>
          </Flex>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {d.counts.map((c) => (
              <div key={c.base} style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF', padding: '10px 12px' }}>
                <Flex align="center" gap={8} style={{ marginBottom: 6 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 4, background: '#EFF6FF', color: '#2563EB', display: 'inline-grid', placeItems: 'center', fontSize: 13, flexShrink: 0 }}>
                    {BASE_ICONS[c.base] ?? <DatabaseOutlined />}
                  </span>
                  <Typography.Text ellipsis style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                    {PARTITION_BASE_LABELS[c.base] ?? partitionTabLabel(c.tab)}
                  </Typography.Text>
                </Flex>
                <Flex align="baseline" gap={6}>
                  <span className="num" style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>{Number(c.rows || 0).toLocaleString('vi-VN')}</span>
                  <span style={{ fontSize: 12, color: '#64748B' }}>dòng dữ liệu</span>
                </Flex>
              </div>
            ))}
          </div>

          <div>
            <Space size={6} style={{ marginBottom: 8 }}>
              <Typography.Text strong style={{ color: '#0F172A' }}>Danh sách tệp dữ liệu theo tháng</Typography.Text>
              <Tag color="geekblue" style={{ margin: 0 }}>{d.items.length} kỳ dữ liệu</Tag>
            </Space>
            <Table<PartitionItem>
              size="small" bordered rowKey={(r) => r.monthKey || 'ROOT'} pagination={false} dataSource={d.items} scroll={{ x: 820 }}
              onRow={(r) => buildClickableRowProps(r, (item) => showDetail('partition', item))}
              columns={[
                { title: 'NO', width: 52, align: 'center', render: (_v, _r, idx) => <span className="mono" style={{ color: '#64748B', fontWeight: 600 }}>{String(idx + 1).padStart(2, '0')}</span> },
                {
                  title: 'Tháng dữ liệu', dataIndex: 'label', width: 245,
                  render: (v: string, r) => (
                    <div>
                      <Flex align="center" gap={6} wrap="wrap">
                        <span style={{ fontWeight: 600, color: '#0F172A' }}>{v || monthKeyLabel(r.monthKey)}</span>
                        <Tag color={r.mode === 'MONTHLY_FILE' ? 'geekblue' : 'default'} style={{ margin: 0, fontSize: 11 }}>
                          {PARTITION_MODE_LABELS[r.mode ?? (r.monthKey ? 'MONTHLY_FILE' : 'ROOT_FILE')]}
                        </Tag>
                      </Flex>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        {r.monthKey ? `Lưu trong thư mục ${v || monthKeyLabel(r.monthKey)} trên Google Drive` : 'Tệp dữ liệu mặc định ban đầu'}
                      </div>
                    </div>
                  ),
                },
                {
                  title: '5 bảng nghiệp vụ trong tệp', dataIndex: 'tabs',
                  render: (tabs: string[], r) => (
                    <Flex gap={4} wrap="wrap">
                      {(tabs ?? []).map((t) => {
                        const base = partitionBaseKey(t), cnt = r.isActive && base ? countByBase.get(base) : undefined;
                        return <Tag key={t} color={r.isActive ? 'blue' : 'default'} style={{ margin: 0 }}>{partitionTabLabel(t)}{cnt !== undefined ? `: ${cnt.toLocaleString('vi-VN')}` : ''}</Tag>;
                      })}
                    </Flex>
                  ),
                },
                { title: 'Tổng dòng', width: 105, align: 'right', render: (_, r) => r.isActive ? <strong className="num">{totalActiveRows.toLocaleString('vi-VN')}</strong> : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Đã lưu trữ</Typography.Text> },
                { title: 'Trạng thái', dataIndex: 'isActive', width: 125, align: 'center', render: (v: boolean) => (v ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>Đang sử dụng</Tag> : <Tag style={{ margin: 0 }}>Lưu trữ</Tag>) },
                {
                  title: 'Thao tác', width: 210, align: 'right',
                  render: (_, r) => (
                    <Space size={6}>
                      {canOpenExternalLink(r) && <Button size="small" icon={<ExportOutlined />} href={r.webViewLink} target="_blank" rel="noreferrer">Mở Sheet</Button>}
                      {r.isActive ? (
                        <Button size="small" disabled icon={<CheckCircleOutlined />}>Đang dùng</Button>
                      ) : canEdit ? (
                        <Popconfirm
                          title={`Chuyển hệ thống sang ${r.label || monthKeyLabel(r.monthKey)}?`}
                          description={<div style={{ maxWidth: 300 }}>Hệ thống sẽ đọc và ghi lịch ca, nghỉ OFF, đổi ca và chấm công trên tệp này. Có thể chuyển lại bất kỳ lúc nào.</div>}
                          okText="Chuyển sang dùng" cancelText="Hủy bỏ" okButtonProps={{ icon: <SwapOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
                          onConfirm={() => switchMut.mutateAsync(r.monthKey).catch(() => undefined)}
                        >
                          <Button size="small" type="primary" ghost icon={<SwapOutlined />} loading={switchingKey === r.monthKey}>Chuyển sang dùng</Button>
                        </Popconfirm>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chỉ xem</Typography.Text>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Space>
      )}
      {canEdit && (
        <DataPartitionRolloverModal open={rolloverOpen} activeMonth={d?.activeMonth ?? ''} existingMonthKeys={(d?.items ?? []).map((i) => i.monthKey).filter(Boolean)} onClose={() => setRolloverOpen(false)} />
      )}
    </Card>
  );
}
