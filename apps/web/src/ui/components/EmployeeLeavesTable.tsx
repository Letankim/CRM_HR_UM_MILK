'use client';

import { App, Space, Tag } from 'antd';
import { ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { SelectableTable } from './BulkActionBar';
import { RowActionButtons } from './RowActionButtons';
import { fmtShiftTime } from './EmployeeShiftsTable';
import { cleanShiftName } from './self-attendance-shared';
import { exportLeavesExcel } from './workflow-bulk-helpers';
import { renderWorkflowShiftStateTag } from './workflow-shift-warning';

type Row = Record<string, unknown>;
const isCancellable = (r: Row) => r.status === 'PENDING' || r.status === 'DRAFT';

export interface EmployeeLeavesTableProps {
  leaves: Row[]; quotaText?: string; refreshing?: boolean; onViewDetail: (record: Row) => void; onRefresh: () => void;
}

/** Bảng đơn nghỉ OFF của chính nhân viên; cho phép tự hủy đơn còn chờ duyệt. */
export function EmployeeLeavesTable({ leaves, quotaText, refreshing = false, onViewDetail, onRefresh }: EmployeeLeavesTableProps) {
  const { message, modal } = App.useApp();
  const pag = useClientPagination(10, 'đơn');
  const cancelMut = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.post(`/admin/leave-requests/${id}/cancel`, {}); },
    onSuccess: (_d, ids) => { message.success(`Đã hủy ${ids.length} đơn nghỉ OFF`); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể hủy đơn nghỉ OFF'),
  });
  const confirmCancel = (rows: Row[]) => modal.confirm({
    title: 'Hủy đơn nghỉ OFF',
    content: `Bạn chắc chắn muốn hủy ${rows.length} đơn nghỉ OFF đang chờ duyệt?`,
    okText: 'Hủy đơn', okButtonProps: { danger: true, icon: <CloseCircleOutlined /> }, cancelText: 'Đóng', cancelButtonProps: { icon: <CloseOutlined /> },
    onOk: () => cancelMut.mutateAsync(rows.map((r) => String(r.id))),
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {quotaText && <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>{quotaText}</Tag>}
      <SelectableTable<Row>
        size="small" rowKey="id" loading={refreshing} pagination={pag} dataSource={leaves}
        bulkActions={[
          { key: 'cancel', label: 'Hủy đơn đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: cancelMut.isPending, eligibleFilter: isCancellable, onClick: (rows) => confirmCancel(rows) },
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportLeavesExcel(rows) },
        ]}
        locale={{ emptyText: 'Bạn chưa có đơn đăng ký nghỉ OFF nào trong kỳ.' }}
        columns={[
          { title: 'Mã đơn', dataIndex: 'request_code', width: 110, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
          { title: 'Ngày xin nghỉ', dataIndex: 'leave_date', width: 120, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
          { title: 'Khung ca & Giờ ca', width: 235, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>{renderWorkflowShiftStateTag(r)}</Space> },
          { title: 'Lý do & Phản hồi', render: (_, r) => <div><div>{String(r.reason || '—')}</div>{Boolean(r.decision_reason) && <div style={{ fontSize: 11, color: r.status === 'REJECTED' ? '#DC2626' : '#15803D', marginTop: 2 }}>{r.status === 'REJECTED' ? 'Lý do từ chối: ' : 'Phản hồi: '}{String(r.decision_reason)}</div>}</div> },
          { title: 'Trạng thái', dataIndex: 'status', width: 145, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết đơn nghỉ OFF" onViewDetail={() => onViewDetail(r)} loading={cancelMut.isPending}
                menuItems={isCancellable(r) ? [{ key: 'cancel', icon: <CloseCircleOutlined />, danger: true, label: 'Hủy đơn nghỉ OFF', onClick: () => confirmCancel([r]) }] : []}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
