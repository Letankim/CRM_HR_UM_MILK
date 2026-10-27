'use client';

import { App } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';
import type { ScheduleAssignmentItem } from '@/ui/components/ScheduleFormModal';
import { exportScheduleExcel } from '@/ui/components/schedule-table-columns';

/**
 * Thao tác hàng loạt trên bảng phân công ca (Phát hành lịch chính thức, Xóa ca, Xuất Excel đã chọn).
 */
export function useScheduleBulkActions({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: 'PUBLISH' | 'DELETE'; rows: ScheduleAssignmentItem[]; clear?: () => void }) =>
      api.post<{ processedCount: number }>('/admin/schedules/bulk-action', {
        action: payload.action,
        items: payload.rows.map((r) => ({ id: r.id, version: r.version })),
      }),
    onSuccess: (res, vars) => {
      message.success(vars.action === 'DELETE' ? `Đã xóa ${res.processedCount} ca làm việc` : `Đã phát hành chính thức ${res.processedCount} ca làm việc`);
      vars.clear?.();
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

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
          eligibleFilter: (r) => r.status === 'DRAFT',
          onClick: (rows, clear) => bulkMutation.mutate({ action: 'PUBLISH', rows, clear }),
        },
        {
          key: 'delete',
          label: 'Xóa ca đã chọn',
          danger: true,
          icon: <DeleteOutlined />,
          loading: bulkMutation.isPending,
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
  }, [bulkMutation, canEdit, modal]);

  return { bulkActions };
}
