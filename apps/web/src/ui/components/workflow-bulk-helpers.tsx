'use client';

import { AlertOutlined, CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, DownloadOutlined, FileAddOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportToExcel } from '@/lib/export-excel';
import type { BulkActionItem } from './BulkActionBar';
import { isAbsentShiftRecord } from './QuickAbsentAdjustmentModal';
import type { WorkflowConfirmKind } from './workflow-shift-warning';

type RowRec = Record<string, unknown>;
const tsSuffix = () => dayjs().format('YYYYMMDD_HHmm');

export function exportAdjustmentsExcel(rows: RowRec[]) {
  exportToExcel({
    fileName: `Phieu_Bo_Sung_Cong_UmBoMilk_${tsSuffix()}.xls`,
    sheetTitle: 'Danh Sách Phiếu Bổ Sung Công & Giải Trình Chấm Công',
    columns: [
      { header: 'Mã phiếu', key: 'adjustment_code' }, { header: 'Nhân sự', key: 'employeeName' },
      { header: 'Ngày công', key: 'work_date' }, { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.shift_code || '') },
      { header: 'Giờ đề nghị', key: 'requested_hours', align: 'right' }, { header: 'Lý do giải trình', key: 'reason' },
      { header: 'Trạng thái', render: (r) => String(r.statusLabel || r.status || '') },
    ],
    rows,
  });
}

export function exportLeavesExcel(rows: RowRec[]) {
  exportToExcel({
    fileName: `Don_Xin_Nghi_Phep_OFF_UmBoMilk_${tsSuffix()}.xls`,
    sheetTitle: 'Danh Sách Đơn Xin Nghỉ Phép (OFF)',
    columns: [
      { header: 'Mã đơn', key: 'request_code' }, { header: 'Nhân sự', render: (r) => `${String(r.employeeName || '')} (${String(r.employeeCode || '')})` },
      { header: 'Ngày nghỉ', key: 'leave_date' }, { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.shift_code || '') },
      { header: 'Lý do xin nghỉ', key: 'reason' }, { header: 'Trạng thái', render: (r) => String(r.statusLabel || r.status || '') },
    ],
    rows,
  });
}

export function exportSwapsExcel(rows: RowRec[]) {
  exportToExcel({
    fileName: `Yeu_Cau_Doi_Ca_UmBoMilk_${tsSuffix()}.xls`,
    sheetTitle: 'Danh Sách Yêu Cầu Đổi Ca Nội Bộ (Quy Trình 3 Bước)',
    columns: [
      { header: 'Mã đơn', key: 'swap_code' }, { header: 'Ngày ca', key: 'from_work_date' },
      { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.from_shift_code || '') },
      { header: 'Người xin đổi', key: 'requesterName' }, { header: 'Người nhận thay', key: 'peerName' },
      { header: 'Lý do đổi ca', key: 'reason' }, { header: 'Trạng thái', render: (r) => String(r.statusLabel || r.status || '') },
    ],
    rows,
  });
}

export function exportEmergencyExcel(rows: RowRec[]) {
  exportToExcel({
    fileName: `Bao_Nghi_Khan_Cap_UmBoMilk_${tsSuffix()}.xls`,
    sheetTitle: 'Danh Sách Báo Nghỉ Đột Xuất / Khẩn Cấp (<12h)',
    columns: [
      { header: 'Mã báo cáo', key: 'emergency_code' }, { header: 'Nhân sự', key: 'employeeName' },
      { header: 'Ngày ca', key: 'work_date' }, { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.shift_code || '') },
      { header: 'Lý do khẩn cấp', key: 'reason' }, { header: 'Trạng thái', render: (r) => String(r.statusLabel || r.status || '') },
    ],
    rows,
  });
}

export function exportMyShiftsExcel(rows: RowRec[]) {
  exportToExcel({
    fileName: `Lich_Lam_Viec_Ca_Nhan_UmBoMilk_${tsSuffix()}.xls`,
    sheetTitle: 'Danh Sách Ca Làm Việc Cá Nhân',
    columns: [
      { header: 'Ngày làm việc', render: (r) => String(r.workDate || r.work_date || '') },
      { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.shiftCode || r.shift_code || '') },
      { header: 'Giờ ca', render: (r) => `${String(r.startAt || r.start_at || '07:00')} - ${String(r.endAt || r.end_at || '12:00')}` },
      { header: 'Chi nhánh', key: 'branchName' }, { header: 'Trạng thái điểm danh', render: (r) => String(r.attendanceStatusLabel || 'Chưa điểm danh') },
      { header: 'Trạng thái lịch', render: (r) => String(r.statusLabel || r.status || '') },
    ],
    rows,
  });
}

export interface WorkflowBulkRunnerOptions {
  canConfirmAtt?: boolean;
  canApproveAdj?: boolean;
  canApproveLeave?: boolean;
  canApproveSwap?: boolean;
  canHandleEmg?: boolean;
  loading?: boolean;
  runBatch: (items: RowRec[], buildCall: (r: RowRec) => { url: string; body: unknown } | null, successMsg: string, confirmKind?: WorkflowConfirmKind) => void;
}

export function buildAdjustmentsBulkActions(opts: WorkflowBulkRunnerOptions): BulkActionItem<RowRec>[] {
  return [
    ...(opts.canConfirmAtt ? [{
      key: 'store-confirm', label: 'CH xác nhận đã chọn', icon: <CheckCircleOutlined />, loading: opts.loading,
      eligibleFilter: (r: RowRec) => r.status === 'PENDING',
      onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'STORE_CONFIRM', decision_reason: 'CH xác nhận hàng loạt' } }), 'Đã xác nhận cửa hàng cho các phiếu bổ sung công hợp lệ'),
    }] : []),
    ...(opts.canApproveAdj ? [
      {
        key: 'hr-approve', label: 'HR duyệt đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING' || r.status === 'STORE_CONFIRMED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_APPROVE', decision_reason: 'HR phê duyệt bổ sung công hàng loạt' } }), 'Đã phê duyệt các phiếu bổ sung công hợp lệ'),
      },
      {
        key: 'hr-reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING' || r.status === 'STORE_CONFIRMED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_REJECT', decision_reason: 'Từ chối bổ sung công hàng loạt' } }), 'Đã từ chối các phiếu bổ sung công hợp lệ'),
      },
    ] : []),
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAdjustmentsExcel(rows) },
  ];
}

export function buildLeavesBulkActions(opts: WorkflowBulkRunnerOptions): BulkActionItem<RowRec>[] {
  return [
    ...(opts.canApproveLeave ? [
      {
        key: 'approve', label: 'Duyệt đơn đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Duyệt nghỉ phép hàng loạt' } }), 'Đã phê duyệt các đơn xin nghỉ phép hợp lệ', 'leave'),
      },
      {
        key: 'reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Từ chối đơn nghỉ phép hàng loạt' } }), 'Đã từ chối các đơn xin nghỉ phép hợp lệ'),
      },
    ] : []),
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportLeavesExcel(rows) },
  ];
}

export function buildSwapsBulkActions(opts: WorkflowBulkRunnerOptions): BulkActionItem<RowRec>[] {
  return [
    ...(opts.canApproveSwap ? [
      {
        key: 'peer-accept', label: 'Đồng nghiệp nhận đã chọn', icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING_PEER',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/shift-swaps/${r.id}/peer-respond`, body: { version: r.version, accept: true, peer_note: 'Đồng ý nhận ca thay' } }), 'Đã xác nhận đồng nghiệp nhận ca cho các đơn hợp lệ', 'swap'),
      },
      {
        key: 'approve', label: 'Duyệt đổi ca đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PEER_ACCEPTED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Duyệt đổi ca hàng loạt' } }), 'Đã phê duyệt đổi ca cho các đơn hợp lệ', 'swap'),
      },
      {
        key: 'reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING_PEER' || r.status === 'PEER_ACCEPTED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Từ chối yêu cầu đổi ca hàng loạt' } }), 'Đã từ chối các yêu cầu đổi ca hợp lệ'),
      },
    ] : []),
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportSwapsExcel(rows) },
  ];
}

export function buildEmergencyBulkActions(opts: WorkflowBulkRunnerOptions): BulkActionItem<RowRec>[] {
  return [
    ...(opts.canHandleEmg ? [
      {
        key: 'resolve', label: 'Đã có người thay đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'REPORTED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'RESOLVE', resolution_note: 'Cửa hàng đã bố trí nhân sự thay ca' } }), 'Đã cập nhật trạng thái có người thay ca cho các báo cáo hợp lệ', 'emergency'),
      },
      {
        key: 'escalate', label: 'Báo thiếu ca đã chọn', danger: true, icon: <AlertOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'REPORTED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'ESCALATE', resolution_note: 'Chuyển cảnh báo thiếu ca lên HR' } }), 'Đã chuyển cảnh báo thiếu ca cho các báo cáo hợp lệ'),
      },
    ] : []),
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportEmergencyExcel(rows) },
  ];
}

export function buildPortalShiftsBulkActions(opts: {
  loading?: boolean;
  onCancelDrafts: (rows: RowRec[]) => void;
  onCreateAbsentAdj?: (row: RowRec) => void;
}): BulkActionItem<RowRec>[] {
  return [
    ...(opts.onCreateAbsentAdj
      ? [{
          key: 'create-adj', label: 'Tạo phiếu bổ sung công (ca vắng mặt)', type: 'primary' as const, danger: true, icon: <FileAddOutlined />,
          eligibleFilter: (r: RowRec) => isAbsentShiftRecord(r),
          onClick: (rows: RowRec[]) => {
            if (rows[0]) opts.onCreateAbsentAdj!(rows[0]);
          },
        }]
      : []),
    {
      key: 'cancel-draft', label: 'Hủy đăng ký ca chờ duyệt', danger: true, icon: <DeleteOutlined />, loading: opts.loading,
      eligibleFilter: (r: RowRec) => r.status === 'DRAFT' && !r.checkInEvent,
      onClick: (rows) => opts.onCancelDrafts(rows),
    },
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportMyShiftsExcel(rows) },
  ];
}
