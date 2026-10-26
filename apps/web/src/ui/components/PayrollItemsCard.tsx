'use client';

import { App, Button, Card, Descriptions, Flex, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClientPagination } from '../hooks/useClientPagination';
import { fmtVnd, type PayrollItemRow } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';

/** Danh sách khoản Thưởng / Phụ cấp / Khấu trừ đã duyệt trong kỳ lương */
export function PayrollItemsCard({
  items,
  loading,
  canManage,
  isLockedPeriod,
  onAddItem,
  onEditItem,
}: {
  items: PayrollItemRow[];
  loading?: boolean;
  canManage: boolean;
  isLockedPeriod: boolean;
  onAddItem: () => void;
  onEditItem: (i: PayrollItemRow) => void;
}) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<PayrollItemRow | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const q = useDebouncedValue(searchInput, 400);
  const pagination = useClientPagination(12, 'khoản mục');

  const filteredItems = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return items.filter((i) => {
      if (directionFilter !== 'ALL' && i.direction !== directionFilter) return false;
      if (keyword) {
        const hay = [i.employeeCode, i.employeeName, i.itemTypeLabel, i.title, i.note].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    });
  }, [items, q, directionFilter]);

  const delItem = useMutation({
    mutationFn: (i: PayrollItemRow) => api.delete(`/admin/payroll/items/${i.id}`, { version: i.version }),
    onSuccess: () => {
      message.success('Đã xóa khoản mục và tính lại bảng lương');
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
      qc.invalidateQueries({ queryKey: ['payroll-snapshots'] });
      qc.invalidateQueries({ queryKey: ['payroll-periods'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const editable = canManage && !isLockedPeriod;

  return (
    <>
      <Card
        size="small"
        styles={{ body: { padding: 16 } }}
        title="Khoản Thưởng (KPI / Doanh số / Chuyên cần), Phụ cấp & Khấu trừ đã duyệt trong kỳ"
        extra={editable && <Button type="primary" icon={<PlusOutlined />} onClick={onAddItem}>Thêm khoản mục</Button>}
      >
        {isLockedPeriod && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Kỳ lương đã phê duyệt / phát hành nên khoản mục bị khóa. Sau khi phát hành, sai lệch được xử lý bằng phiếu lương điều chỉnh.
          </Typography.Paragraph>
        )}
        <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginBottom: 14 }}>
          <Flex wrap="wrap" gap={12} align="center" justify="space-between">
            <Space wrap size={10}>
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
                placeholder="Tìm nhân sự, mã NV, nội dung khoản mục..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: 260 }}
              />
              <Select
                value={directionFilter}
                onChange={setDirectionFilter}
                style={{ width: 220 }}
                options={[
                  { label: 'Tất cả khoản mục', value: 'ALL' },
                  { label: 'Khoản cộng (Thưởng / Phụ cấp)', value: 'ADD' },
                  { label: 'Khoản trừ (Khấu trừ)', value: 'DEDUCT' },
                ]}
              />
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Hiển thị <strong>{filteredItems.length}</strong> / {items.length} khoản mục
            </Typography.Text>
          </Flex>
        </div>
        <Table<PayrollItemRow>
          size="small"
          rowKey="id"
          loading={loading}
          pagination={pagination}
          dataSource={filteredItems}
          locale={{ emptyText: 'Chưa có khoản thưởng, phụ cấp hoặc khấu trừ phù hợp bộ lọc' }}
          columns={[
            { title: 'Nhân sự', key: 'emp', render: (_, i) => <Space size={6}><Tag color="geekblue" style={{ margin: 0, borderRadius: 2 }}>{i.employeeCode}</Tag><Typography.Text strong>{i.employeeName}</Typography.Text></Space> },
            { title: 'Loại khoản mục', dataIndex: 'itemTypeLabel', render: (v: string, i) => <Tag color={i.direction === 'ADD' ? 'green' : 'red'} style={{ borderRadius: 2 }}>{v}</Tag> },
            { title: 'Nội dung', dataIndex: 'title' },
            { title: 'SL x Đơn giá', key: 'qty', align: 'right', render: (_, i) => <span className="num">{i.quantity} x {fmtVnd(i.unitAmountVnd)}</span> },
            { title: 'Thành tiền', dataIndex: 'totalAmountVnd', align: 'right', render: (v: number, i) => <span className="num" style={{ fontWeight: 700, color: i.direction === 'ADD' ? '#15803D' : '#DC2626' }}>{i.direction === 'ADD' ? '+' : '-'}{fmtVnd(v)}</span> },
            {
              title: 'Thao tác',
              key: 'act',
              width: 90,
              align: 'right',
              render: (_, i) => (
                <RowActionButtons
                  detailTooltip="Xem chi tiết khoản mục"
                  onViewDetail={() => setViewing(i)}
                  loading={delItem.isPending && delItem.variables?.id === i.id}
                  menuItems={
                    editable
                      ? [
                          { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa khoản mục', onClick: () => onEditItem(i) },
                          {
                            key: 'delete',
                            icon: <DeleteOutlined />,
                            danger: true,
                            label: 'Xóa khoản mục',
                            onClick: () =>
                              modal.confirm({
                                title: 'Xác nhận xóa khoản mục này?',
                                content: 'Khoản mục sẽ bị xóa và bảng lương nháp được tính lại ngay lập tức.',
                                okText: 'Xác nhận xóa',
                                cancelText: 'Hủy bỏ',
                                okButtonProps: { danger: true, icon: <DeleteOutlined /> },
                                cancelButtonProps: { icon: <CloseOutlined /> },
                                onOk: () => delItem.mutateAsync(i),
                              }),
                          },
                        ]
                      : []
                  }
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={viewing ? `Chi tiết Khoản mục — ${viewing.employeeName} (${viewing.employeeCode})` : 'Chi tiết khoản mục'}
        open={!!viewing}
        onCancel={() => setViewing(null)}
        width={600}
        destroyOnHidden
        footer={
          <Space>
            {viewing && editable && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => { const cur = viewing; setViewing(null); onEditItem(cur); }}>
                Chỉnh sửa khoản mục
              </Button>
            )}
            <Button icon={<CloseOutlined />} onClick={() => setViewing(null)}>Đóng</Button>
          </Space>
        }
      >
        {viewing && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Nhân sự áp dụng">
              <strong>{viewing.employeeName}</strong> ({viewing.employeeCode})
            </Descriptions.Item>
            <Descriptions.Item label="Nhóm khoản mục">
              <Tag color={viewing.direction === 'ADD' ? 'green' : 'red'} style={{ borderRadius: 2, margin: 0 }}>{viewing.itemTypeLabel}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Nội dung khoản mục">{viewing.title}</Descriptions.Item>
            <Descriptions.Item label="Số lượng & Đơn giá"><span className="num">{viewing.quantity} x {fmtVnd(viewing.unitAmountVnd)}</span></Descriptions.Item>
            <Descriptions.Item label="Tổng thành tiền">
              <span className="num" style={{ fontWeight: 700, color: viewing.direction === 'ADD' ? '#15803D' : '#DC2626' }}>
                {viewing.direction === 'ADD' ? '+' : '-'}{fmtVnd(viewing.totalAmountVnd)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="Ghi chú / Căn cứ phê duyệt">{viewing.note || 'Không có ghi chú bổ sung'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </>
  );
}
