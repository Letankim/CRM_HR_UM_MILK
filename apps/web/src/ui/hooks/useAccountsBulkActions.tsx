'use client';

import { App } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, FileExcelOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { AccountRowItem } from '@/ui/components/AccountDetailDrawer';
import { exportAccountsExcel } from '@/ui/components/account-table-columns';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';

export type AccountBulkAction = 'ACTIVATE' | 'UNLOCK' | 'REVOKE' | 'DELETE';

interface UseAccountsBulkActionsOptions {
  canActivate: boolean;
  currentUserId?: string;
}

/**
 * Quản lý thao tác hàng loạt trên danh sách tài khoản (Kích hoạt, Mở khóa, Thu hồi, Xóa, Xuất Excel)
 * kèm danh sách tài khoản đang chờ xác nhận thu hồi.
 */
export function useAccountsBulkActions({ canActivate, currentUserId }: UseAccountsBulkActionsOptions) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [revokeTargets, setRevokeTargets] = useState<AccountRowItem[]>([]);
  const [clearBulkFn, setClearBulkFn] = useState<(() => void) | null>(null);

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: AccountBulkAction; rows: AccountRowItem[]; reason?: string; clear?: () => void }) =>
      api.post<{ processedCount: number; skippedCount: number }>('/admin/accounts/bulk-action', {
        action: payload.action,
        items: payload.rows.map((r) => ({ id: r.id, version: r.version })),
        reason: payload.reason || undefined,
      }),
    onSuccess: (res, vars) => {
      message.success(`Đã xử lý thành công ${res.processedCount}/${vars.rows.length} tài khoản đã chọn`);
      setRevokeTargets([]);
      vars.clear?.();
      clearBulkFn?.();
      setClearBulkFn(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác hàng loạt thất bại'),
  });

  const bulkActions: BulkActionItem<AccountRowItem>[] = useMemo(() => {
    const items: BulkActionItem<AccountRowItem>[] = [];
    if (canActivate) {
      items.push(
        {
          key: 'bulk-activate',
          label: 'Kích hoạt đã chọn',
          type: 'primary',
          icon: <CheckOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'ACTIVATE',
          onClick: (rows, clear) => bulkMutation.mutate({ action: 'ACTIVATE', rows, clear }),
        },
        {
          key: 'bulk-unlock',
          label: 'Mở khóa đăng nhập',
          icon: <UnlockOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'UNLOCK',
          onClick: (rows, clear) => bulkMutation.mutate({ action: 'UNLOCK', rows, clear }),
        },
        {
          key: 'bulk-revoke',
          label: 'Thu hồi đã chọn',
          danger: true,
          icon: <StopOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'REVOKE',
          onClick: (rows, clear) => {
            const eligible = rows.filter((r) => r.id !== currentUserId && r.status !== 'REVOKED');
            if (eligible.length === 0) {
              message.warning('Các tài khoản đang chọn không thể thu hồi');
              return;
            }
            setClearBulkFn(() => clear);
            setRevokeTargets(eligible);
          },
        },
        {
          key: 'bulk-delete',
          label: 'Xóa đã chọn',
          danger: true,
          icon: <DeleteOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'DELETE',
          onClick: (rows, clear) => {
            modal.confirm({
              title: `Xóa ${rows.length} tài khoản đã chọn?`,
              content: 'Các tài khoản sẽ bị xóa khỏi hệ thống và ngắt phiên đăng nhập ngay lập tức.',
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
      key: 'bulk-export',
      label: 'Xuất Excel đã chọn',
      icon: <FileExcelOutlined style={{ color: '#15803D' }} />,
      onClick: (rows) => {
        exportAccountsExcel(rows);
        message.success(`Đã xuất ${rows.length} bản ghi ra file Excel`);
      },
    });
    return items;
  }, [bulkMutation, canActivate, currentUserId, message, modal]);

  return { bulkActions, bulkMutation, revokeTargets, setRevokeTargets };
}
