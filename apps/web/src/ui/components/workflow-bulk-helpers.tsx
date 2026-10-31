'use client';

import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, DownloadOutlined, FileAddOutlined } from '@ant-design/icons';
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
      { header: 'Loại lỗi chấm công', render: (r) => String(r.punchTypeLabel || '') },
      { header: 'Giờ đề nghị', key: 'requested_hours', align: 'right' }, { header: 'Lý do giải trình', key: 'reason' },
      { header: 'Ảnh minh chứng', render: (r) => (r.evidencePhotoUrl ? 'Có' : 'Không') },
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
    sheetTitle: 'Danh Sách Yêu Cầu Đổi Ca / Nhường Ca Nội Bộ',
    columns: [
      { header: 'Mã đơn', key: 'swap_code' }, { header: 'Loại yêu cầu', render: (r) => String(r.kindLabel || (r.kind === 'SWAP' ? 'Đổi ca 2 chiều' : 'Nhường ca')) },
      { header: 'Ngày ca', key: 'from_work_date' },
      { header: 'Khung ca', render: (r) => String(r.shiftLabel || r.from_shift_code || '') },
      { header: 'Ca nhận lại (đổi 2 chiều)', render: (r) => (r.kind === 'SWAP' ? `${String(r.to_work_date || '')} ${String((r.toShiftDetails as RowRec | null)?.shiftLabel || r.to_shift_code || '')}`.trim() : '') },
      { header: 'Người gửi', key: 'requesterName' }, { header: 'Người nhận', key: 'peerName' },
      { header: 'Cần HR duyệt', render: (r) => (r.requiresHrApproval ? 'Có (vượt 2 ca/ngày)' : 'Không') },
      { header: 'Phụ cấp đổi ca (VNĐ)', render: (r) => (r.status === 'APPROVED' && Boolean(r.allowance_eligible ?? r.allowanceEligible) ? Number(r.allowance_amount_vnd ?? r.allowanceAmountVnd ?? 0) : 0), isCurrency: true },
      { header: 'Lý do đổi ca', key: 'reason' }, { header: 'Trạng thái', render: (r) => String(r.statusLabel || r.status || '') },
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
  loading?: boolean;
  onOpenApproveSwaps?: (rows: RowRec[]) => void;
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
        key: 'hr-approve', label: 'Phê duyệt đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PENDING' || r.status === 'STORE_CONFIRMED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_APPROVE', decision_reason: 'Phê duyệt bổ sung công hàng loạt' } }), 'Đã phê duyệt các phiếu bổ sung công hợp lệ'),
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
        key: 'approve', label: 'HR duyệt đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PEER_ACCEPTED',
        onClick: (rows: RowRec[]) => opts.onOpenApproveSwaps ? opts.onOpenApproveSwaps(rows) : opts.runBatch(rows, (r) => ({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'HR duyệt nhường ca hàng loạt', allowance_eligible: true } }), 'Đã phê duyệt các yêu cầu nhường ca hợp lệ', 'swap'),
      },
      {
        key: 'reject', label: 'HR từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: opts.loading,
        eligibleFilter: (r: RowRec) => r.status === 'PEER_ACCEPTED',
        onClick: (rows: RowRec[]) => opts.runBatch(rows, (r) => ({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'HR từ chối yêu cầu nhường ca hàng loạt' } }), 'Đã từ chối các yêu cầu nhường ca hợp lệ'),
      },
    ] : []),
    { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportSwapsExcel(rows) },
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
