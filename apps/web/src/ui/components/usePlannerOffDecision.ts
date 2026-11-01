'use client';

import { useState } from 'react';
import { App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { fmtYmd, type PlannerOffItem } from './schedule-planner-types';
import { useWorkflowDecisionModal } from './WorkflowDecisionModal';
import { renderWorkflowDecisionAlert } from './workflow-shift-warning';

const PLANNER_RELATED_KEYS = ['schedule-planner-week', 'schedule-planner-probation', 'leave-requests', 'schedules', 'dashboard-leaves', 'notifications'];

/** Làm mới toàn bộ dữ liệu liên quan sau khi chốt lịch / duyệt đơn OFF. */
export function useInvalidatePlanner() {
  const qc = useQueryClient();
  return () => PLANNER_RELATED_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Duyệt / từ chối từng đơn OFF ngay trên màn hình chốt lịch thông qua hộp thoại nhập ghi chú / lý do. */
export function usePlannerOffDecision() {
  const { message } = App.useApp();
  const invalidate = useInvalidatePlanner();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const mut = useMutation({
    mutationFn: ({ row, decision, reason }: { row: PlannerOffItem; decision: 'APPROVED' | 'REJECTED'; reason: string }) =>
      api.post(`/admin/leave-requests/${row.id}/decide`, { version: row.version, decision, decision_reason: reason }),
    onMutate: ({ row }) => setBusyId(row.id),
    onSuccess: (_res, { row, decision }) => {
      message.success(decision === 'APPROVED' ? `Đã duyệt đơn nghỉ OFF ${row.requestCode} của ${row.employeeName}` : `Đã từ chối đơn nghỉ OFF ${row.requestCode} của ${row.employeeName}`);
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xử lý đơn nghỉ OFF thất bại'),
    onSettled: () => setBusyId(null),
  });

  const approve = (row: PlannerOffItem) =>
    promptDecision({
      title: 'Phê duyệt đơn xin nghỉ phép (OFF)',
      subtitle: `${row.requestCode} · ${row.employeeName} (${row.employeeCode}) · Nghỉ ngày ${fmtYmd(row.leaveDate)}${row.shiftLabel ? ` (${row.shiftLabel})` : ''}`,
      alertNode: renderWorkflowDecisionAlert('leave', [row as unknown as Record<string, unknown>]),
      noteLabel: 'Ghi chú phê duyệt đơn nghỉ OFF',
      required: false,
      okText: 'Phê duyệt nghỉ OFF',
      suggestions: ['Đảm bảo đủ định biên nhân sự trực ca tại chi nhánh', 'Đồng ý cho nghỉ OFF theo định mức chu kỳ'],
      onConfirm: async (note) => {
        await mut.mutateAsync({ row, decision: 'APPROVED', reason: note });
      },
    });

  const openReject = (row: PlannerOffItem) =>
    promptDecision({
      title: 'Từ chối đơn xin nghỉ phép (OFF)',
      subtitle: `${row.requestCode} · ${row.employeeName} (${row.employeeCode}) · Ngày ${fmtYmd(row.leaveDate)}${row.shiftLabel ? ` (${row.shiftLabel})` : ''}`,
      noteLabel: 'Lý do từ chối đơn nghỉ OFF',
      required: true,
      danger: true,
      okText: 'Xác nhận từ chối',
      suggestions: [
        'Ngày này các đồng nghiệp cùng ca đã xin nghỉ, cửa hàng thiếu định biên',
        'Trùng lịch nghỉ với nhân sự khác trong chi nhánh',
        'Đã sử dụng hết định mức ngày OFF trong chu kỳ',
      ],
      onConfirm: async (note) => {
        await mut.mutateAsync({ row, decision: 'REJECTED', reason: note });
      },
    });

  return { busyId, pending: mut.isPending, approve, openReject, decisionModalElement };
}
