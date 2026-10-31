'use client';

import { App, Space, Tag } from 'antd';
import { ClockCircleOutlined, DeleteOutlined, EyeOutlined, FileAddOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { SelectableTable } from './BulkActionBar';
import { isAbsentShiftRecord } from './QuickAbsentAdjustmentModal';
import { RowActionButtons } from './RowActionButtons';
import { cleanShiftName } from './self-attendance-shared';
import { canViewShiftAttendanceDetail } from './ShiftAttendanceDetailModal';
import { buildPortalShiftsBulkActions } from './workflow-bulk-helpers';

type Row = Record<string, unknown>;

export const fmtShiftTime = (r: Row) =>
  `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${String(r.scheduledHours || r.scheduled_hours)}h)` : ''}`;

export interface EmployeeShiftsTableProps {
  shifts: Row[]; empId: string; refreshing?: boolean;
  onViewDetail: (record: Row) => void; onViewAttendance: (shiftId: string) => void; onRefresh: () => void;
}

/** Bảng danh sách ca làm việc của chính nhân viên (chế độ xem Bảng chi tiết). */
export function EmployeeShiftsTable({ shifts, empId, refreshing = false, onViewDetail, onViewAttendance, onRefresh }: EmployeeShiftsTableProps) {
  const { message } = App.useApp();
  const pag = useClientPagination(10, 'ca');
  const cancelShiftMut = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`/my-attendance/shifts/${id}`); },
    onSuccess: () => { message.success('Đã hủy đăng ký ca làm việc'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể hủy ca'),
  });
  const withEmp = (r: Row) => ({ ...r, employeeId: empId });

  return (
    <SelectableTable<Row>
      size="small" rowKey="id" loading={refreshing} pagination={pag} dataSource={shifts}
      bulkActions={buildPortalShiftsBulkActions({ loading: cancelShiftMut.isPending, onCancelDrafts: (rows) => cancelShiftMut.mutate(rows.map((r) => String(r.id))), onCreateAbsentAdj: (row) => onViewDetail(withEmp(row)) })}
      locale={{ emptyText: 'Bạn chưa có ca làm việc nào được phân công trong kỳ này.' }}
      columns={[
        { title: 'Ngày & Phân loại', dataIndex: 'workDate', width: 175, render: (v: string, r) => <Space size={4} wrap><span className="num" style={{ fontWeight: 600 }}>{dayjs(v).format('DD/MM/YYYY')}</span><Tag color={r.dayType === 'OFF' || r.status === 'ON_LEAVE' ? 'gold' : 'blue'} style={{ margin: 0 }}>{r.dayType === 'OFF' || r.status === 'ON_LEAVE' ? 'Nghỉ OFF' : 'Làm việc'}</Tag></Space> },
        { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
        { title: 'Chi nhánh', dataIndex: 'branchName', width: 185, ellipsis: true },
        { title: 'Điểm danh', width: 185, render: (_, r) => <Tag color={String(r.attendanceStatusColor || 'default')} style={{ margin: 0 }}>{String(r.attendanceStatusLabel || 'Chưa điểm danh')}</Tag> },
        { title: 'Trạng thái lịch', dataIndex: 'status', width: 150, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
        {
          title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
          render: (_, r) => (
            <RowActionButtons
              detailTooltip="Xem chi tiết ca làm việc" onViewDetail={() => onViewDetail(withEmp(r))} loading={cancelShiftMut.isPending}
              menuItems={[
                ...(canViewShiftAttendanceDetail(r as { status?: string; attendanceStatusLabel?: string; checkInEvent?: unknown; checkOutEvent?: unknown }) ? [{ key: 'view-att', icon: <EyeOutlined style={{ color: '#16A34A' }} />, label: 'Xem chi tiết điểm danh', onClick: () => onViewAttendance(String(r.id)) }] : []),
                ...(isAbsentShiftRecord(r) ? [{ key: 'adj', icon: <FileAddOutlined style={{ color: '#DC2626' }} />, label: 'Gửi phiếu bổ sung công', onClick: () => onViewDetail(withEmp(r)) }] : []),
                ...(r.status === 'DRAFT' && !r.checkInEvent ? [{ key: 'cancel', icon: <DeleteOutlined />, danger: true, label: 'Hủy đăng ký ca chờ duyệt', onClick: () => cancelShiftMut.mutate([String(r.id)]) }] : []),
              ]}
            />
          ),
        },
      ]}
    />
  );
}
