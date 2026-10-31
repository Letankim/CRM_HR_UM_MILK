'use client';

import { Space, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DollarOutlined, FileImageOutlined } from '@ant-design/icons';
import { ADJUSTMENT_PUNCH_TYPE_LABELS } from '@umbm/shared';
import dayjs from 'dayjs';
import { StatusTag } from '../StatusTag';
import { FancyboxImage } from './FancyboxPreview';
import { RowActionButtons } from './RowActionButtons';
import type { ScheduleDetailKind } from './ScheduleRequestDetailModal';
import { renderSwapAllowanceTag } from './ShiftSwapApproveModal';
import { renderWorkflowShiftStateTag, type WorkflowConfirmKind } from './workflow-shift-warning';

type RowRec = Record<string, unknown>;
export const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
export const fmtShiftTime = (r: RowRec) => `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${r.scheduledHours || r.scheduled_hours}h)` : ''}`;
export const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');

export interface WorkflowColumnCtx {
  loading: boolean;
  canConfirmAtt: boolean; canApproveAdj: boolean; canApproveLeave: boolean; canApproveSwap: boolean;
  onDetail: (kind: ScheduleDetailKind, r: RowRec) => void;
  runAct: (url: string, body: unknown, successMsg: string, confirmKind?: WorkflowConfirmKind, row?: RowRec) => void;
  onApproveSwap: (r: RowRec) => void;
  onEditSwapAllowance: (r: RowRec) => void;
}

/** Thông báo phê duyệt phiếu bổ sung công theo loại lỗi chấm công (đồng bộ với thông điệp máy chủ). */
export const adjustmentApprovedMessage = (r: RowRec) =>
  r.punch_type === 'CHECK_IN' ? 'Đã phê duyệt minh chứng — ghi nhận Vào ca thành công'
    : r.punch_type === 'CHECK_OUT' ? 'Đã phê duyệt minh chứng — ghi nhận Ra ca, ca làm việc hoàn thành'
      : 'Đã phê duyệt phiếu bổ sung công và cập nhật trạng thái hoàn thành ca làm việc';

const punchLabel = (r: RowRec) => String(r.punchTypeLabel || ADJUSTMENT_PUNCH_TYPE_LABELS[r.punch_type as keyof typeof ADJUSTMENT_PUNCH_TYPE_LABELS] || 'Bổ sung công cả ca');

export function buildAdjustmentColumns(c: WorkflowColumnCtx): ColumnsType<RowRec> {
  const decide = (r: RowRec, action: string, reason: string, msg: string) => c.runAct(`/admin/attendance/adjustments/${r.id}/decide`, { version: r.version, action, decision_reason: reason }, msg);
  return [
    { title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 115, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
    { title: 'Nhân sự', width: 190, ellipsis: true, render: (_, r) => <strong>{String(r.employeeName || '')}</strong> },
    { title: 'Ngày công', dataIndex: 'work_date', width: 110, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
    { title: 'Khung ca & Giờ ca', width: 220, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
    { title: 'Loại lỗi chấm công', width: 170, render: (_, r) => <Tag color={r.punch_type === 'CHECK_IN' ? 'cyan' : r.punch_type === 'CHECK_OUT' ? 'orange' : 'purple'} style={{ margin: 0 }}>{punchLabel(r)}</Tag> },
    {
      title: 'Minh chứng', width: 96, align: 'center',
      render: (_, r) => r.evidencePhotoUrl
        ? <div style={{ width: 64, margin: '0 auto' }}><FancyboxImage src={String(r.evidencePhotoUrl)} alt="Ảnh minh chứng" caption={`Minh chứng ${String(r.adjustment_code || '')} — ${String(r.employeeName || '')}`} height={44} /></div>
        : <Tooltip title="Phiếu không kèm ảnh minh chứng"><FileImageOutlined style={{ color: '#CBD5E1' }} /></Tooltip>,
    },
    { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 105, render: (v: number) => <strong>{v} giờ</strong> },
    { title: 'Trạng thái', dataIndex: 'status', width: 160, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
    {
      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
      render: (_, r) => (
        <RowActionButtons detailTooltip="Xem chi tiết phiếu bổ sung công" onViewDetail={() => c.onDetail('adjustment', r)} loading={c.loading}
          menuItems={[
            ...(r.status === 'PENDING' && c.canConfirmAtt ? [{ key: 'store-confirm', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Cửa hàng xác nhận thực tế', onClick: () => decide(r, 'STORE_CONFIRM', 'CH xác nhận có làm thực tế', 'Cửa hàng đã xác nhận phiếu bổ sung công để chuyển HR duyệt') }] : []),
            ...((r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && c.canApproveAdj ? [
              { key: 'hr-approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Phê duyệt phiếu bổ sung công', onClick: () => decide(r, 'HR_APPROVE', 'HR duyệt bổ sung công', adjustmentApprovedMessage(r)) },
              { key: 'hr-reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối phiếu bổ sung công', onClick: () => decide(r, 'HR_REJECT', 'Không đủ căn cứ bổ sung công', 'Đã từ chối phiếu bổ sung công') },
            ] : []),
          ]}
        />
      ),
    },
  ];
}

export function buildLeaveColumns(c: WorkflowColumnCtx): ColumnsType<RowRec> {
  const decide = (r: RowRec, decision: 'APPROVED' | 'REJECTED', reason: string) =>
    c.runAct(`/admin/leave-requests/${r.id}/decide`, { version: r.version, decision, decision_reason: reason }, decision === 'APPROVED' ? 'Đã phê duyệt đơn nghỉ OFF' : 'Đã từ chối đơn nghỉ OFF', decision === 'APPROVED' ? 'leave' : undefined, r);
  return [
    { title: 'Mã đơn', dataIndex: 'request_code', width: 110, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
    { title: 'Nhân sự', width: 215, ellipsis: true, render: (_, r) => <strong>{String(r.employeeName)} ({String(r.employeeCode)})</strong> },
    { title: 'Ngày nghỉ', dataIndex: 'leave_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
    { title: 'Khung ca & Giờ ca', width: 255, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>{renderWorkflowShiftStateTag(r)}</Space> },
    { title: 'Định mức & Định biên', width: 175, render: (_, r) => <Space size={4} wrap><Tag color="blue" style={{ margin: 0 }}>{String(r.quota_cycle_used ?? 0)}/{String(r.quota_cycle_limit ?? 0)} ngày</Tag><Tag color={Number(r.staffing_after_leave ?? 2) >= Number(r.min_staff_required ?? 2) ? 'green' : 'volcano'} style={{ margin: 0 }}>Còn {String(r.staffing_after_leave ?? 2)}/{String(r.min_staff_required ?? 2)} NV</Tag></Space> },
    { title: 'Trạng thái', dataIndex: 'status', width: 155, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
    {
      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
      render: (_, r) => (
        <RowActionButtons detailTooltip="Xem chi tiết đơn nghỉ OFF" onViewDetail={() => c.onDetail('leave', r)} loading={c.loading}
          menuItems={r.status === 'PENDING' && c.canApproveLeave ? [
            { key: 'approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Phê duyệt đơn nghỉ OFF', onClick: () => decide(r, 'APPROVED', 'Đảm bảo đủ định biên ca') },
            { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối đơn nghỉ OFF', onClick: () => decide(r, 'REJECTED', 'Ca đang thiếu định biên') },
          ] : []}
        />
      ),
    },
  ];
}

export function buildSwapColumns(c: WorkflowColumnCtx): ColumnsType<RowRec> {
  return [
    { title: 'Mã đơn', dataIndex: 'swap_code', width: 105, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
    { title: 'Loại yêu cầu', width: 125, render: (_, r) => <Tag color={r.kind === 'SWAP' ? 'geekblue' : 'cyan'} style={{ margin: 0 }}>{String(r.kindLabel || (r.kind === 'SWAP' ? 'Đổi ca 2 chiều' : 'Nhường ca'))}</Tag> },
    { title: 'Người gửi → Người nhận', width: 230, ellipsis: true, render: (_, r) => <span><strong>{String(r.requesterName || '—')}</strong> → <strong>{String(r.peerName || '—')}</strong></span> },
    { title: 'Ca của người gửi', width: 250, render: (_, r) => <Space size={4} wrap><strong className="num">{fmtDate(r.from_work_date)}</strong><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag>{renderWorkflowShiftStateTag(r)}</Space> },
    {
      title: 'Ca nhận lại (đổi 2 chiều)', width: 230,
      render: (_, r) => {
        const to = r.toShiftDetails as RowRec | null | undefined;
        if (r.kind !== 'SWAP') return <span style={{ color: '#64748B' }}>Không áp dụng</span>;
        return <Space size={4} wrap><strong className="num">{fmtDate(r.to_work_date)}</strong><span style={{ fontWeight: 600 }}>{cleanShiftName(to?.shiftLabel || r.to_shift_code)}</span>{to && <Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{String(to.shiftTimeRange || `${String(to.startAt || '')} – ${String(to.endAt || '')}`)}</Tag>}</Space>;
      },
    },
    { title: 'Phụ cấp đổi ca', width: 135, render: (_, r) => renderSwapAllowanceTag(r) },
    { title: 'Trạng thái', dataIndex: 'status', width: 230, render: (v: string, r) => <Space size={4} wrap><StatusTag value={v} label={String(r.statusLabel || '') || undefined} />{Boolean(r.requiresHrApproval) && <Tag color="volcano" style={{ margin: 0 }}>Vượt 2 ca/ngày — cần HR duyệt</Tag>}</Space> },
    {
      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
      render: (_, r) => (
        <RowActionButtons detailTooltip="Xem chi tiết yêu cầu đổi / nhường ca" onViewDetail={() => c.onDetail('swap', r)} loading={c.loading}
          menuItems={c.canApproveSwap ? [
            ...(r.status === 'PEER_ACCEPTED' ? [
              { key: 'approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'HR phê duyệt & Phụ cấp', onClick: () => c.onApproveSwap(r) },
              { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'HR từ chối yêu cầu', onClick: () => c.runAct(`/admin/shift-swaps/${r.id}/decide`, { version: r.version, decision: 'REJECTED', decision_reason: 'Người nhận vượt số ca cho phép trong ngày' }, 'Đã từ chối yêu cầu nhường ca') },
            ] : []),
            ...(r.status === 'APPROVED' ? [{ key: 'edit-allowance', icon: <DollarOutlined style={{ color: '#7C3AED' }} />, label: 'Điều chỉnh phụ cấp đổi ca', onClick: () => c.onEditSwapAllowance(r) }] : []),
          ] : []}
        />
      ),
    },
  ];
}
