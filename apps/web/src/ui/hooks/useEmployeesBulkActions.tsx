'use client';

import { App } from 'antd';
import { CloseOutlined, DeleteOutlined, FileExcelOutlined, RiseOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';
import { exportEmployeesExcel, type EmployeeRowItem } from '@/ui/components/employee-table-columns';

interface UseEmployeesBulkActionsOptions {
  canManage: boolean;
  canPromote: boolean;
}

/**
 * Thao tác hàng loạt trên danh sách hồ sơ nhân sự (Chuyển chính thức, Xóa mềm, Xuất Excel đã chọn).
 */
export function useEmployeesBulkActions({ canManage, canPromote }: UseEmployeesBulkActionsOptions) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const bulkAction = useMutation({
    mutationFn: (payload: { action: 'PROMOTE_OFFICIAL' | 'DELETE'; rows: EmployeeRowItem[]; clear?: () => void }) =>
      api.post<{ processedCount: number }>('/admin/employees/bulk-action', {
        action: payload.action,
        items: payload.rows.map((r) => ({ id: r.id, version: r.version })),
      }),
    onSuccess: (res, vars) => {
      message.success(
        vars.action === 'DELETE'
          ? `Đã xóa ${res.processedCount}/${vars.rows.length} hồ sơ nhân sự`
          : `Đã chuyển chính thức ${res.processedCount}/${vars.rows.length} nhân sự đã chọn`,
      );
      vars.clear?.();
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác hàng loạt thất bại'),
  });

  const bulkActions: BulkActionItem<EmployeeRowItem>[] = useMemo(() => {
    const items: BulkActionItem<EmployeeRowItem>[] = [];
    if (canPromote) {
      items.push({
        key: 'bulk-promote',
        label: 'Chuyển Chính thức đã chọn',
        type: 'primary',
        icon: <RiseOutlined />,
        loading: bulkAction.isPending,
        eligibleFilter: (r) => r.stage === 'PROBATION',
        onClick: (rows, clear) => bulkAction.mutate({ action: 'PROMOTE_OFFICIAL', rows, clear }),
      });
    }
    if (canManage) {
      items.push({
        key: 'bulk-delete',
        label: 'Xóa đã chọn',
        danger: true,
        icon: <DeleteOutlined />,
        loading: bulkAction.isPending,
        onClick: (rows, clear) => {
          modal.confirm({
            title: `Xác nhận xóa ${rows.length} hồ sơ nhân sự?`,
            content: 'Các hồ sơ nhân sự đã chọn sẽ được xóa khỏi danh sách đang làm việc.',
            okText: 'Xác nhận xóa',
            okButtonProps: { danger: true, icon: <DeleteOutlined /> },
            cancelText: 'Hủy bỏ',
            cancelButtonProps: { icon: <CloseOutlined /> },
            onOk: () => bulkAction.mutateAsync({ action: 'DELETE', rows, clear }),
          });
        },
      });
    }
    items.push({
      key: 'bulk-export',
      label: 'Xuất Excel đã chọn',
      icon: <FileExcelOutlined style={{ color: '#15803D' }} />,
      onClick: (rows) => {
        exportEmployeesExcel(rows);
        message.success(`Đã xuất ${rows.length} hồ sơ nhân sự ra file Excel`);
      },
    });
    return items;
  }, [bulkAction, canManage, canPromote, message, modal]);

  return { bulkActions };
}
