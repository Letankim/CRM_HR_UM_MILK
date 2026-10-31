'use client';

import { useState } from 'react';
import { App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { PlannerOffItem } from './schedule-planner-types';

const PLANNER_RELATED_KEYS = ['schedule-planner-week', 'schedule-planner-probation', 'leave-requests', 'schedules', 'dashboard-leaves', 'notifications'];

/** Làm mới toàn bộ dữ liệu liên quan sau khi chốt lịch / duyệt đơn OFF. */
export function useInvalidatePlanner() {
  const qc = useQueryClient();
  return () => PLANNER_RELATED_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Duyệt / từ chối từng đơn OFF ngay trên màn hình chốt lịch (từ chối bắt buộc nhập lý do). */
export function usePlannerOffDecision() {
  const { message } = App.useApp();
  const invalidate = useInvalidatePlanner();
  const [rejectTarget, setRejectTarget] = useState<PlannerOffItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: ({ row, decision, reason }: { row: PlannerOffItem; decision: 'APPROVED' | 'REJECTED'; reason: string }) =>
      api.post(`/admin/leave-requests/${row.id}/decide`, { version: row.version, decision, decision_reason: reason }),
    onMutate: ({ row }) => setBusyId(row.id),
    onSuccess: (_res, { row, decision }) => {
      message.success(decision === 'APPROVED' ? `Đã duyệt đơn nghỉ OFF ${row.requestCode} của ${row.employeeName}` : `Đã từ chối đơn nghỉ OFF ${row.requestCode} của ${row.employeeName}`);
      setRejectTarget(null);
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xử lý đơn nghỉ OFF thất bại'),
    onSettled: () => setBusyId(null),
  });
  return {
    busyId,
    pending: mut.isPending,
    rejectTarget,
    openReject: (row: PlannerOffItem) => setRejectTarget(row),
    closeReject: () => setRejectTarget(null),
    approve: (row: PlannerOffItem) => mut.mutate({ row, decision: 'APPROVED', reason: 'Đồng ý nghỉ OFF, đảm bảo định biên ca' }),
    reject: (reason: string) => rejectTarget && mut.mutate({ row: rejectTarget, decision: 'REJECTED', reason }),
  };
}
