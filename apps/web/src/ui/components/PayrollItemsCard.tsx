'use client';

import { App, Button, Card, Descriptions, Flex, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { SelectableTable } from './BulkActionBar';
import { fmtVnd, type PayrollItemRow } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';

/** Danh sách khoản Thưởng / Phụ cấp / Khấu trừ đã duyệt trong kỳ lương */
export function PayrollItemsCard({
  periodId,
  canManage,
  isLockedPeriod,
  onAddItem,
  onEditItem,
}: {
  periodId: string;
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const q = useDebouncedValue(searchInput, 400);

  useEffect(() => { setPage(1); }, [periodId, directionFilter, q]);

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams({ period_id: periodId, page: String(page), per_page: String(perPage) });
    if (directionFilter !== 'ALL') sp.set('direction', directionFilter);
    if (q.trim()) sp.set('q', q.trim());
    return sp.toString();
  }, [periodId, page, perPage, directionFilter, q]);

  const itemsQ = useQuery({
    queryKey: ['payroll-items', periodId, queryParams],
    queryFn: () => api.list<PayrollItemRow>(`/admin/payroll/items?${queryParams}`),
    enabled: Boolean(periodId),
  });

  const rows = itemsQ.data?.data ?? [];
  const totalCount = itemsQ.data?.meta.pagination.total ?? rows.length;

  const delItem = useMutation({
    mutationFn: async (items: PayrollItemRow[]) => { for (const i of items) await api.delete(`/admin/payroll/items/${i.id}`, { version: i.version }); },
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
              Tổng cộng <strong>{totalCount}</strong> khoản mục trong kỳ
            </Typography.Text>
          </Flex>
        </div>
        <SelectableTable<PayrollItemRow>
          size="small" rowKey="id" loading={itemsQ.isLoading || itemsQ.isFetching}
          bulkActions={[
            { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportToExcel({ fileName: 'Khoan_muc_thuong_phu_cap_khau_tru.xls', sheetTitle: 'Danh sách Khoản Mục Thưởng / Phụ Cấp / Khấu Trừ', rows: sel, columns: [{ header: 'Mã NV', key: 'employeeCode' }, { header: 'Nhân sự', key: 'employeeName' }, { header: 'Loại khoản mục', key: 'itemTypeLabel' }, { header: 'Nội dung', key: 'title' }, { header: 'Thành tiền', key: 'totalAmountVnd', isCurrency: true }] }) },
            ...(editable ? [{ key: 'del', label: 'Xóa khoản mục đã chọn', danger: true, icon: <DeleteOutlined />, loading: delItem.isPending, confirm: 'Xác nhận xóa các khoản mục đã chọn?', onClick: (sel: PayrollItemRow[]) => delItem.mutate(sel) }] : []),
          ]}
          pagination={{
            current: page, pageSize: perPage, total: totalCount,
            showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'],
            showTotal: (t) => `Tổng ${t} khoản mục`,
            onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); },
          }}
          dataSource={rows}
          locale={{ emptyText: 'Chưa có khoản thưởng, phụ cấp hoặc khấu trừ phù hợp bộ lọc' }}
          columns={[
            { title: 'Nhân sự', key: 'emp', render: (_, i) => <Space size={6}><Tag color="geekblue" style={{ margin: 0, borderRadius: 2 }}>{i.employeeCode}</Tag><Typography.Text strong>{i.employeeName}</Typography.Text></Space> },
            { title: 'Loại khoản mục', dataIndex: 'itemTypeLabel', render: (v: string, i) => <Tag color={i.direction === 'ADD' ? 'green' : 'red'} style={{ borderRadius: 2 }}>{v}</Tag> },
            { title: 'Nội dung', dataIndex: 'title' },
            { title: 'SL x Đơn giá', key: 'qty', align: 'right', render: (_, i) => <span className="num">{i.quantity} x {fmtVnd(i.unitAmountVnd)}</span> },
            { title: 'Thành tiền', dataIndex: 'totalAmountVnd', align: 'right', render: (v: number, i) => <span className="num" style={{ fontWeight: 700, color: i.direction === 'ADD' ? '#15803D' : '#DC2626' }}>{i.direction === 'ADD' ? '+' : '-'}{fmtVnd(v)}</span> },
            {
              title: 'Thao tác', key: 'act', width: 90, align: 'right',
              render: (_, i) => (
                <RowActionButtons
                  detailTooltip="Xem chi tiết khoản mục" onViewDetail={() => setViewing(i)} loading={delItem.isPending}
                  menuItems={editable ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa khoản mục', onClick: () => onEditItem(i) },
                    { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa khoản mục', onClick: () => modal.confirm({ title: 'Xác nhận xóa khoản mục này?', content: 'Khoản mục sẽ bị xóa và bảng lương nháp được tính lại ngay lập tức.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delItem.mutateAsync([i]) }) },
                  ] : []}
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
