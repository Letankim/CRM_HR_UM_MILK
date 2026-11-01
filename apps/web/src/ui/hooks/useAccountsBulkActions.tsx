'use client';

import { App } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, FileExcelOutlined, LockOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { AccountRowItem } from '@/ui/components/AccountDetailDrawer';
import { exportAccountsExcel } from '@/ui/components/account-table-columns';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';
import { useWorkflowDecisionModal } from '@/ui/components/WorkflowDecisionModal';

export type AccountBulkAction = 'ACTIVATE' | 'LOCK' | 'UNLOCK' | 'REVOKE' | 'DELETE';
export type SingleAccountActionKind = 'activate' | 'lock' | 'unlock';

const LOCK_SUGGESTIONS = [
  'Tạm khóa theo yêu cầu rà soát nhân sự / phân quyền',
  'Nhân sự tạm ngưng công việc dài ngày theo đơn được duyệt',
  'Phát hiện phiên đăng nhập bất thường cần kiểm tra bảo mật',
];

interface UseAccountsBulkActionsOptions {
  canActivate: boolean;
  currentUserId?: string;
}

/**
 * Quản lý thao tác hàng loạt & hộp thoại xác nhận quyết định trên danh sách tài khoản
 * (Kích hoạt, Khóa tạm thời, Mở khóa, Thu hồi, Xóa, Xuất Excel).
 */
export function useAccountsBulkActions({ canActivate, currentUserId }: UseAccountsBulkActionsOptions) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [revokeTargets, setRevokeTargets] = useState<AccountRowItem[]>([]);
  const [clearBulkFn, setClearBulkFn] = useState<(() => void) | null>(null);
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();

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
      qc.invalidateQueries({ queryKey: ['account-audit-history'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác hàng loạt thất bại'),
  });

  const promptSingleAccountDecision = useCallback(
    (
      row: AccountRowItem,
      kind: SingleAccountActionKind,
      onExecute: (payload: { row: AccountRowItem; kind: SingleAccountActionKind; reason?: string }) => Promise<unknown>,
    ) => {
      if (kind === 'lock') {
        promptDecision({
          title: `Khóa tạm thời tài khoản: ${row.displayName} (@${row.username})`,
          subtitle: 'Phiên đăng nhập hiện tại của tài khoản sẽ bị ngắt ngay lập tức trên mọi thiết bị.',
          required: true,
          danger: true,
          noteLabel: 'Lý do khóa tạm thời tài khoản',
          okText: 'Xác nhận khóa tạm thời',
          suggestions: LOCK_SUGGESTIONS,
          onConfirm: async (note) => {
            await onExecute({ row, kind: 'lock', reason: note });
          },
        });
        return;
      }
      const isActivate = kind === 'activate';
      promptDecision({
        title: isActivate
          ? `Kích hoạt tài khoản: ${row.displayName} (@${row.username})`
          : `Mở khóa đăng nhập: ${row.displayName} (@${row.username})`,
        subtitle: isActivate
          ? 'Tài khoản sẽ chuyển sang trạng thái Hoạt động và hệ thống sẽ gửi thông báo kích hoạt tới người dùng.'
          : 'Đặt lại bộ đếm đăng nhập sai về 0 và khôi phục quyền truy cập cho tài khoản.',
        required: false,
        noteLabel: 'Ghi chú phê duyệt / xử lý',
        okText: isActivate ? 'Xác nhận kích hoạt' : 'Xác nhận mở khóa',
        onConfirm: async (note) => {
          await onExecute({ row, kind, reason: note || undefined });
        },
      });
    },
    [promptDecision],
  );

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
          eligibleFilter: (r) => r.status === 'PENDING_ACTIVATION',
          onClick: (rows, clear) =>
            promptDecision({
              title: `Kích hoạt tài khoản hàng loạt (${rows.length} tài khoản)`,
              subtitle: 'Các tài khoản được chọn sẽ chuyển sang trạng thái Hoạt động và nhận thông báo kích hoạt.',
              required: false,
              noteLabel: 'Ghi chú phê duyệt / xử lý',
              okText: 'Xác nhận kích hoạt',
              onConfirm: async (note) => {
                await bulkMutation.mutateAsync({ action: 'ACTIVATE', rows, reason: note || undefined, clear });
              },
            }),
        },
        {
          key: 'bulk-lock',
          label: 'Khóa tạm thời đã chọn',
          icon: <LockOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'LOCK',
          eligibleFilter: (r) => r.status === 'ACTIVE' && r.id !== currentUserId && r.username !== 'admin',
          onClick: (rows, clear) =>
            promptDecision({
              title: `Khóa tạm thời hàng loạt (${rows.length} tài khoản)`,
              subtitle: 'Các tài khoản đang chọn sẽ bị ngắt phiên đăng nhập ngay lập tức trên mọi thiết bị.',
              required: true,
              danger: true,
              noteLabel: 'Lý do khóa tạm thời tài khoản',
              okText: 'Xác nhận khóa tạm thời',
              suggestions: LOCK_SUGGESTIONS,
              onConfirm: async (note) => {
                await bulkMutation.mutateAsync({ action: 'LOCK', rows, reason: note, clear });
              },
            }),
        },
        {
          key: 'bulk-unlock',
          label: 'Mở khóa đăng nhập',
          icon: <UnlockOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'UNLOCK',
          eligibleFilter: (r) => r.status === 'LOCKED' || Number(r.failedLoginCount ?? 0) > 0,
          onClick: (rows, clear) =>
            promptDecision({
              title: `Mở khóa đăng nhập hàng loạt (${rows.length} tài khoản)`,
              subtitle: 'Đặt lại số lần đăng nhập sai về 0 và khôi phục quyền truy cập cho các tài khoản đã chọn.',
              required: false,
              noteLabel: 'Ghi chú phê duyệt / xử lý',
              okText: 'Xác nhận mở khóa',
              onConfirm: async (note) => {
                await bulkMutation.mutateAsync({ action: 'UNLOCK', rows, reason: note || undefined, clear });
              },
            }),
        },
        {
          key: 'bulk-revoke',
          label: 'Thu hồi đã chọn',
          danger: true,
          icon: <StopOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'REVOKE',
          eligibleFilter: (r) => r.id !== currentUserId && r.status !== 'REVOKED',
          onClick: (rows, clear) => {
            if (rows.length === 0) {
              message.warning('Các tài khoản đang chọn không thể thu hồi');
              return;
            }
            setClearBulkFn(() => clear);
            setRevokeTargets(rows);
          },
        },
        {
          key: 'bulk-delete',
          label: 'Xóa đã chọn',
          danger: true,
          icon: <DeleteOutlined />,
          loading: bulkMutation.isPending && bulkMutation.variables?.action === 'DELETE',
          eligibleFilter: (r) => r.id !== currentUserId && r.username !== 'admin',
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
  }, [bulkMutation, canActivate, currentUserId, message, modal, promptDecision]);

  return { bulkActions, bulkMutation, revokeTargets, setRevokeTargets, promptSingleAccountDecision, decisionModalElement };
}
