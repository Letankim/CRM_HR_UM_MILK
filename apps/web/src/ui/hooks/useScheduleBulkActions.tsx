'use client';

import { App } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';
import type { ScheduleAssignmentItem } from '@/ui/components/ScheduleFormModal';
import { useWorkflowDecisionModal } from '@/ui/components/WorkflowDecisionModal';
import { exportScheduleExcel } from '@/ui/components/schedule-table-columns';

/**
 * Thao tác duyệt / phát hành & hàng loạt trên bảng phân công ca (Phát hành lịch chính thức, Xóa ca, Xuất Excel đã chọn).
 */
export function useScheduleBulkActions({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: 'PUBLISH' | 'DELETE'; rows: ScheduleAssignmentItem[]; note?: string; clear?: () => void }) =>
      api.post<{ processedCount: number }>('/admin/schedules/bulk-action', {
        action: payload.action,
        items: payload.rows.map((r) => ({ id: r.id, version: r.version })),
        ...(payload.note ? { note: payload.note } : {}),
      }),
    onSuccess: (res, vars) => {
      message.success(
        vars.action === 'DELETE'
          ? `Đã xóa ${res.processedCount} ca làm việc`
          : `Đã duyệt và phát hành chính thức ${res.processedCount} ca làm việc — nhân sự đã có thể chấm công Vào/Ra ca`,
      );
      vars.clear?.();
      ['schedules', 'my-attendance', 'attendance-sessions', 'attendance-sessions-count', 'payroll-periods', 'payroll-snapshots', 'payroll-reconcile', 'schedule-planner-week', 'schedule-planner-probation'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const promptPublishShifts = useCallback((rows: ScheduleAssignmentItem[], clear?: () => void) => {
    const eligible = rows.filter((r) => r.status === 'DRAFT' && !r.isLockedByPayroll);
    if (eligible.length === 0) return;
    const single = eligible.length === 1 ? eligible[0] : null;
    promptDecision({
      title: single ? `Duyệt & Phát hành phân ca — ${single.employeeName}` : `Duyệt & Phát hành chính thức ${eligible.length} ca chờ duyệt`,
      subtitle: single
        ? `Ngày ${single.workDate} · ${single.shiftLabel} (${single.branchName})`
        : `Sau khi xác nhận, ${eligible.length} ca chờ duyệt sẽ chuyển sang Đã phân ca chính thức để nhân sự điểm danh Vào/Ra ca.`,
      noteLabel: 'Ghi chú phê duyệt / phát hành ca',
      placeholder: 'Nhập ghi chú phê duyệt hoặc lưu ý phân ca (không bắt buộc)...',
      required: false,
      maxLength: 300,
      suggestions: ['Đã kiểm tra định biên ca, đồng ý phát hành', 'Phê duyệt bổ sung nhân sự trực ca'],
      okText: single ? 'Duyệt & Phát hành ca' : `Phát hành (${eligible.length} ca)`,
      onConfirm: async (note) => {
        await bulkMutation.mutateAsync({ action: 'PUBLISH', rows: eligible, note, clear });
      },
    });
  }, [bulkMutation, promptDecision]);

  const bulkActions: BulkActionItem<ScheduleAssignmentItem>[] = useMemo(() => {
    const items: BulkActionItem<ScheduleAssignmentItem>[] = [];
    if (canEdit) {
      items.push(
        {
          key: 'publish',
          label: 'Phát hành Lịch chính thức',
          type: 'primary',
          icon: <CheckOutlined />,
          loading: bulkMutation.isPending,
          eligibleFilter: (r) => r.status === 'DRAFT' && !r.isLockedByPayroll,
          onClick: (rows, clear) => promptPublishShifts(rows, clear),
        },
        {
          key: 'delete',
          label: 'Xóa ca đã chọn',
          danger: true,
          icon: <DeleteOutlined />,
          loading: bulkMutation.isPending,
          eligibleFilter: (r) => !r.isLockedByPayroll,
          onClick: (rows, clear) => {
            modal.confirm({
              title: `Xóa ${rows.length} phân công ca đã chọn?`,
              okText: 'Xác nhận xóa',
              okButtonProps: { danger: true, icon: <DeleteOutlined /> },
              cancelText: 'Hủy bỏ',
              cancelButtonProps: { icon: <CloseOutlined /> },
              onOk: () => bulkMutation.mutateAsync({ action: 'DELETE', rows, clear }),
            });
          },
        },
      );
    }
    items.push({
      key: 'export',
      label: 'Xuất Excel đã chọn',
      icon: <FileExcelOutlined style={{ color: '#15803D' }} />,
      onClick: (rows) => exportScheduleExcel(rows),
    });
    return items;
  }, [bulkMutation, canEdit, modal, promptPublishShifts]);

  return { bulkActions, promptPublishShifts, publishing: bulkMutation.isPending, decisionModalElement };
}
