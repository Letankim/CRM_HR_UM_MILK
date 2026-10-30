'use client';

import { Flex, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, DeleteOutlined, EditOutlined, FileAddOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import { isAbsentShiftRecord } from '@/ui/components/QuickAbsentAdjustmentModal';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import type { ScheduleAssignmentItem } from '@/ui/components/ScheduleFormModal';
import { StatusTag } from '@/ui/StatusTag';

/** Xuất bảng phân công lịch làm việc ra file Excel chuẩn doanh nghiệp. */
export function exportScheduleExcel(rows: ScheduleAssignmentItem[]) {
  exportToExcel({
    fileName: `Lich_Lam_Viec_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Bảng Phân Công Lịch Làm Việc Theo Ca & Chi Nhánh',
    columns: [
      { header: 'Ngày làm việc', key: 'workDate' },
      { header: 'Khung ca', key: 'shiftLabel' },
      { header: 'Giờ ca', render: (r) => `${r.startAt} - ${r.endAt}` },
      { header: 'Mã NV', key: 'employeeCode' },
      { header: 'Họ và tên nhân sự', key: 'employeeName' },
      { header: 'Giai đoạn', key: 'employeeStageLabel' },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Số giờ công', key: 'scheduledHours', align: 'right' },
      { header: 'Trạng thái', key: 'statusLabel' },
      { header: 'Ghi chú', key: 'note' },
    ],
    rows,
  });
}

interface BuildScheduleColumnsOptions {
  canEdit: boolean;
  onApprove?: (row: ScheduleAssignmentItem) => void;
  onEdit: (row: ScheduleAssignmentItem) => void;
  onDelete: (row: ScheduleAssignmentItem) => void;
}

/** Cột bảng chi tiết phân công ca làm việc (chế độ xem `Bảng Chi Tiết`). */
export function buildScheduleColumns({ canEdit, onApprove, onEdit, onDelete }: BuildScheduleColumnsOptions): ColumnsType<ScheduleAssignmentItem> {
  return [
    {
      title: 'Ngày & Khung ca',
      key: 'shift',
      width: 200,
      render: (_, r) => (
        <Flex vertical gap={2}>
          <span className="num" style={{ fontWeight: 700, color: '#0F172A' }}>{r.workDate}</span>
          <Space size={4}>
            <Tag color="blue" style={{ margin: 0, borderRadius: 2 }}>{r.shiftLabel}</Tag>
            <span className="num" style={{ fontSize: 11, color: '#64748B' }}>{r.startAt}–{r.endAt}</span>
          </Space>
        </Flex>
      ),
    },
    {
      title: 'Nhân sự phân công',
      key: 'emp',
      width: 215,
      render: (_, r) => (
        <div>
          <Typography.Text strong>{r.employeeName}</Typography.Text>
          <div style={{ marginTop: 2 }}>
            <Space size={6}>
              <Tag color="geekblue" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>{r.employeeCode}</Tag>
              <span style={{ fontSize: 12, color: '#64748B' }}>{r.employeeStageLabel}</span>
            </Space>
          </div>
        </div>
      ),
    },
    { title: 'Chi nhánh', dataIndex: 'branchName', width: 190 },
    { title: 'Giờ công', dataIndex: 'scheduledHours', width: 105, align: 'right', render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v} giờ</span> },
    {
      title: 'Trạng thái & Điểm danh',
      key: 'status',
      width: 215,
      render: (_, r) => (
        <Space direction="vertical" size={3}>
          <StatusTag value={r.status} label={r.statusLabel} />
          {r.attendanceStatusLabel && (
            <Tag color={r.attendanceStatusColor || 'default'} style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>
              {r.attendanceStatusLabel}
            </Tag>
          )}
          {r.isLockedByPayroll && (
            <Tag color="purple" style={{ margin: 0, borderRadius: 2, fontSize: 11 }}>
              Đã chốt lương ({r.lockedByPeriodCode || 'Khóa'})
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 88,
      fixed: 'right',
      align: 'right',
      render: (_, r) => {
        const isAbsent = canEdit && !r.isLockedByPayroll && isAbsentShiftRecord(r as unknown as Record<string, unknown>);
        const isDraft = r.status === 'DRAFT';
        return (
          <RowActionButtons
            detailTooltip={isDraft ? 'Xem & chỉnh sửa phân ca chờ duyệt' : canEdit && !r.isLockedByPayroll ? 'Xem chi tiết & chỉnh sửa ghi chú' : 'Xem chi tiết ca làm việc'}
            onViewDetail={() => onEdit(r)}
            menuItems={
              r.isLockedByPayroll || !canEdit
                ? []
                : [
                    ...(isDraft && onApprove
                      ? [{ key: 'approve', icon: <CheckOutlined style={{ color: '#16A34A' }} />, label: 'Duyệt & Phát hành ca', onClick: () => onApprove(r) }]
                      : []),
                    ...(isAbsent
                      ? [{ key: 'adj', icon: <FileAddOutlined style={{ color: '#DC2626' }} />, label: 'Tạo phiếu bổ sung công', onClick: () => onEdit(r) }]
                      : []),
                    { key: 'edit', icon: <EditOutlined />, label: isDraft ? 'Chỉnh sửa phân ca' : 'Chỉnh sửa ghi chú', onClick: () => onEdit(r) },
                    { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa phân ca', onClick: () => onDelete(r) },
                  ]
            }
          />
        );
      },
    },
  ];
}
