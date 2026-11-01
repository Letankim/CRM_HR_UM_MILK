'use client';

import { useState } from 'react';
import { Alert, App } from 'antd';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatAdjustmentProposal } from './AdjustmentEvidenceFields';
import { usePermissionGuard } from './GuardButton';
import type { ScheduleRequestDetailActions } from './ScheduleRequestDetailFooter';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';
import { renderWorkflowDecisionAlert } from './workflow-shift-warning';

type RowRec = Record<string, unknown>;
export type AdjustmentDecisionAction = 'STORE_CONFIRM' | 'HR_APPROVE' | 'HR_REJECT';

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');

export const adjustmentApprovedMessage = (r: RowRec) =>
  r.punch_type === 'CHECK_IN' ? 'Đã phê duyệt minh chứng — ghi nhận Vào ca thành công'
    : r.punch_type === 'CHECK_OUT' ? 'Đã phê duyệt minh chứng — ghi nhận Ra ca, ca làm việc hoàn thành'
      : 'Đã phê duyệt phiếu bổ sung công và cập nhật trạng thái hoàn thành ca làm việc';

export function useWorkflowDecisions({ onSuccess }: { onSuccess: () => void }) {
  const { message } = App.useApp();
  const can = useCan();
  const canConfirmAtt = usePermissionGuard({ perms: ['attendance.confirm'] });
  const canApproveAdj = usePermissionGuard({ perms: ['adjustment.approve'] });
  const canApproveLeave = usePermissionGuard({ perms: ['leave.approve'] });
  const canApproveSwap = usePermissionGuard({ perms: ['swap.approve'] });
  const canPublishShift = can('schedule.publish', 'schedule.propose');
  const [busy, setBusy] = useState(false);
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const runApi = async (task: () => Promise<void>, successText: string, clear?: () => void) => {
    setBusy(true);
    try {
      await task();
      message.success(successText);
      clear?.();
      onSuccess();
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Thao tác thất bại');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const decideAdjustments = (rows: RowRec[], action: AdjustmentDecisionAction, clear?: () => void) => {
    const eligible = rows.filter((r) => action === 'STORE_CONFIRM' ? r.status === 'PENDING' : r.status === 'PENDING' || r.status === 'STORE_CONFIRMED');
    if (eligible.length === 0) { message.warning('Không có phiếu bổ sung công nào ở trạng thái hợp lệ'); return; }
    const isBulk = eligible.length > 1, first = eligible[0]!;
    const isReject = action === 'HR_REJECT', isStore = action === 'STORE_CONFIRM';
    promptDecision({
      title: isStore ? (isBulk ? `Cửa hàng xác nhận thực tế (${eligible.length} phiếu)` : 'Cửa hàng xác nhận phiếu bổ sung công')
        : isReject ? (isBulk ? `Từ chối phiếu bổ sung công (${eligible.length} phiếu)` : 'Từ chối phiếu bổ sung công')
          : (isBulk ? `HR phê duyệt phiếu bổ sung công (${eligible.length} phiếu)` : 'HR phê duyệt phiếu bổ sung công'),
      subtitle: isBulk
        ? `Áp dụng cho ${eligible.length} phiếu bổ sung công đã chọn.`
        : `${String(first.adjustment_code || '')} · ${String(first.employeeName || '')} · Ngày ${fmtDate(first.work_date)} (${formatAdjustmentProposal(first)})`,
      noteLabel: isStore ? 'Ghi chú xác nhận thực tế của Cửa hàng' : isReject ? 'Lý do từ chối phiếu bổ sung công' : 'Ghi chú phê duyệt của HR',
      required: isReject,
      danger: isReject,
      okText: isStore ? 'Xác nhận thực tế' : isReject ? 'Xác nhận từ chối' : 'Phê duyệt phiếu',
      suggestions: isStore
        ? ['Cửa hàng đã đối chiếu camera và xác nhận nhân sự có làm thực tế', 'Xác nhận nhân sự có mặt trực đúng giờ ca tại chi nhánh']
        : isReject
          ? ['Ảnh minh chứng không rõ thời gian hoặc vị trí tại cửa hàng', 'Giờ đề nghị không khớp dữ liệu thực tế tại chi nhánh', 'Chưa đủ căn cứ xác nhận giờ làm việc thực tế']
          : ['Minh chứng hợp lệ, đồng ý ghi nhận công thực tế', 'Đã đối chiếu xác nhận của cửa hàng và ảnh minh chứng'],
      onConfirm: (note) => runApi(
        async () => { await Promise.all(eligible.map((r) => api.post(`/admin/attendance/adjustments/${r.id}/decide`, { version: r.version, action, decision_reason: note }))); },
        isStore ? (isBulk ? `Cửa hàng đã xác nhận ${eligible.length} phiếu bổ sung công` : 'Cửa hàng đã xác nhận phiếu bổ sung công để chuyển HR duyệt')
          : isReject ? (isBulk ? `Đã từ chối ${eligible.length} phiếu bổ sung công` : 'Đã từ chối phiếu bổ sung công')
            : (isBulk ? `Đã phê duyệt ${eligible.length} phiếu bổ sung công` : adjustmentApprovedMessage(first)),
        clear,
      ),
    });
  };

  const decideLeaves = (rows: RowRec[], decision: 'APPROVED' | 'REJECTED', clear?: () => void) => {
    const eligible = rows.filter((r) => r.status === 'PENDING' || r.status === 'DRAFT');
    if (eligible.length === 0) { message.warning('Không có đơn xin nghỉ OFF nào ở trạng thái chờ duyệt'); return; }
    const isApprove = decision === 'APPROVED', isBulk = eligible.length > 1, first = eligible[0]!;
    promptDecision({
      title: isApprove ? (isBulk ? `Phê duyệt đơn nghỉ OFF (${eligible.length} đơn)` : 'Phê duyệt đơn xin nghỉ phép (OFF)')
        : (isBulk ? `Từ chối đơn nghỉ OFF (${eligible.length} đơn)` : 'Từ chối đơn xin nghỉ phép (OFF)'),
      subtitle: isBulk
        ? `${isApprove ? 'Phê duyệt' : 'Từ chối'} ${eligible.length} đơn xin nghỉ phép OFF đang chờ duyệt.`
        : `${String(first.request_code || '')} · ${String(first.employeeName || '')} (${String(first.employeeCode || '')}) · Ngày ${fmtDate(first.leave_date)}`,
      alertNode: isApprove ? renderWorkflowDecisionAlert('leave', eligible) : undefined,
      noteLabel: isApprove ? 'Ghi chú phê duyệt đơn nghỉ OFF' : 'Lý do từ chối đơn nghỉ OFF',
      required: !isApprove,
      danger: !isApprove,
      okText: isApprove ? 'Phê duyệt đơn nghỉ' : 'Xác nhận từ chối',
      suggestions: isApprove
        ? ['Đảm bảo đủ định biên nhân sự trực ca tại chi nhánh', 'Đồng ý cho nghỉ OFF theo định mức chu kỳ']
        : ['Khung ca ngày này đang thiếu định biên nhân sự trực', 'Trùng lịch nghỉ với các đồng nghiệp khác cùng chi nhánh', 'Đã sử dụng hết định mức ngày OFF trong chu kỳ'],
      onConfirm: (note) => runApi(
        async () => { await Promise.all(eligible.map((r) => api.post(`/admin/leave-requests/${r.id}/decide`, { version: r.version, decision, decision_reason: note }))); },
        isApprove ? (isBulk ? `Đã phê duyệt ${eligible.length} đơn nghỉ OFF` : 'Đã phê duyệt đơn nghỉ OFF')
          : (isBulk ? `Đã từ chối ${eligible.length} đơn nghỉ OFF` : 'Đã từ chối đơn nghỉ OFF'),
        clear,
      ),
    });
  };

  const rejectSwaps = (rows: RowRec[], clear?: () => void) => {
    const eligible = rows.filter((r) => r.status === 'PEER_ACCEPTED');
    if (eligible.length === 0) { message.warning('Không có yêu cầu đổi / nhường ca nào đang chờ HR duyệt'); return; }
    const isBulk = eligible.length > 1, first = eligible[0]!;
    promptDecision({
      title: isBulk ? `HR từ chối yêu cầu đổi / nhường ca (${eligible.length} đơn)` : 'HR từ chối yêu cầu đổi / nhường ca',
      subtitle: isBulk
        ? `Từ chối ${eligible.length} yêu cầu đổi / nhường ca đang chờ HR duyệt.`
        : `${String(first.swap_code || '')} · ${String(first.requesterName || '—')} → ${String(first.peerName || '—')} · Ngày ${fmtDate(first.from_work_date)}`,
      noteLabel: 'Lý do từ chối yêu cầu đổi / nhường ca',
      required: true,
      danger: true,
      okText: 'Xác nhận từ chối',
      suggestions: ['Người nhận vượt quá số ca làm việc an toàn trong ngày', 'Không phù hợp bố trí định biên ca trực tại chi nhánh'],
      onConfirm: (note) => runApi(
        async () => { await Promise.all(eligible.map((r) => api.post(`/admin/shift-swaps/${r.id}/decide`, { version: r.version, decision: 'REJECTED', decision_reason: note }))); },
        isBulk ? `Đã từ chối ${eligible.length} yêu cầu đổi / nhường ca` : 'Đã từ chối yêu cầu đổi / nhường ca',
        clear,
      ),
    });
  };

  const decideDraftShifts = (rows: RowRec[], action: 'PUBLISH' | 'DELETE', clear?: () => void) => {
    const eligible = rows.filter((r) => r.status === 'DRAFT');
    if (eligible.length === 0) { message.warning('Không có ca đăng ký nào ở trạng thái chờ duyệt'); return; }
    const isApprove = action === 'PUBLISH', isBulk = eligible.length > 1, first = eligible[0]!;
    const hasLinked = eligible.some((r) => Boolean(r.linkedAssignmentId));
    promptDecision({
      title: isApprove ? (isBulk ? `Duyệt ca đăng ký (${eligible.length} ca)` : 'Duyệt ca đăng ký làm việc')
        : (isBulk ? `Từ chối ca đăng ký (${eligible.length} ca)` : 'Từ chối ca đăng ký làm việc'),
      subtitle: isBulk
        ? `${isApprove ? 'Duyệt và phát hành chính thức' : 'Từ chối và gỡ bỏ'} ${eligible.length} ca đăng ký chờ duyệt.`
        : `${String(first.employeeName || '')} (${String(first.employeeCode || '')}) · Ngày ${fmtDate(first.workDate || first.work_date)} · ${cleanShiftName(first.shiftLabel || first.shiftCode)}`,
      alertNode: isApprove && hasLinked
        ? <Alert type="info" showIcon message="Lưu ý: Ca thử việc đăng ký làm thêm này sẽ tự động dời ca cuối chu kỳ thử việc tương ứng khi được duyệt." />
        : undefined,
      noteLabel: isApprove ? 'Ghi chú phê duyệt ca đăng ký' : 'Lý do từ chối ca đăng ký',
      required: !isApprove,
      danger: !isApprove,
      okText: isApprove ? 'Duyệt ca đăng ký' : 'Từ chối ca đăng ký',
      suggestions: isApprove
        ? ['Đồng ý duyệt ca đăng ký làm thêm', 'Phù hợp định biên nhân sự trực tại cửa hàng']
        : ['Khung ca này tại cửa hàng đã đủ nhân sự trực', 'Trùng lịch hoặc không phù hợp kế hoạch phân ca tuần này'],
      onConfirm: (note) => runApi(
        async () => { await api.post('/admin/schedules/bulk-action', { action, items: eligible.map((r) => ({ id: r.id, version: r.version })), note }); },
        isApprove
          ? `Đã duyệt ${eligible.length} ca đăng ký${hasLinked ? ' và dời ca cuối chu kỳ thử việc tương ứng' : ''}`
          : `Đã từ chối ${eligible.length} ca đăng ký`,
        clear,
      ),
    });
  };

  const detailActions: ScheduleRequestDetailActions = {
    onApproveLeave: canApproveLeave ? (r) => decideLeaves([r], 'APPROVED') : undefined,
    onRejectLeave: canApproveLeave ? (r) => decideLeaves([r], 'REJECTED') : undefined,
    onStoreConfirmAdjustment: canConfirmAtt ? (r) => decideAdjustments([r], 'STORE_CONFIRM') : undefined,
    onApproveAdjustment: canApproveAdj ? (r) => decideAdjustments([r], 'HR_APPROVE') : undefined,
    onRejectAdjustment: canApproveAdj ? (r) => decideAdjustments([r], 'HR_REJECT') : undefined,
    onRejectSwap: canApproveSwap ? (r) => rejectSwaps([r]) : undefined,
    onApproveDraftShift: canPublishShift ? (r) => decideDraftShifts([r], 'PUBLISH') : undefined,
    onRejectDraftShift: canPublishShift ? (r) => decideDraftShifts([r], 'DELETE') : undefined,
  };

  return {
    busy, canConfirmAtt, canApproveAdj, canApproveLeave, canApproveSwap, canPublishShift,
    decideAdjustments, decideLeaves, rejectSwaps, decideDraftShifts, detailActions, decisionModalElement,
  };
}
