'use client';

import { App } from 'antd';
import { CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ACCOUNT_STATUS_OPTIONS, ROLE_OPTIONS, type AccountStatus, type Role } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { AccountCreateModal } from '@/ui/components/AccountCreateModal';
import { AccountDetailDrawer, type AccountRowItem } from '@/ui/components/AccountDetailDrawer';
import { AccountRevokeModal } from '@/ui/components/AccountRevokeModal';
import { buildAccountColumns, exportAccountsExcel } from '@/ui/components/account-table-columns';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { useAccountsBulkActions, type SingleAccountActionKind } from '@/ui/hooks/useAccountsBulkActions';

function AccountsView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan();
  const { data: me } = useMe();

  const status = (params.get('status') as AccountStatus | null) ?? 'ALL';
  const role = (params.get('role') as Role | null) ?? 'ALL';
  const branchId = params.get('branch_id') ?? 'ALL';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AccountRowItem | null>(null);
  const [detailRow, setDetailRow] = useState<AccountRowItem | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });
  const branchOptions = useMemo(
    () => [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...(branchesQuery.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))],
    [branchesQuery.data?.data],
  );

  const buildQueryUrl = (forceRefresh = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (status !== 'ALL') sp.set('status', status);
    if (role !== 'ALL') sp.set('role', role);
    if (branchId !== 'ALL') sp.set('branch_id', branchId);
    if (q.trim()) sp.set('q', q.trim());
    if (forceRefresh) sp.set('refresh', '1');
    return `/admin/accounts?${sp}`;
  };

  const query = useQuery({
    queryKey: ['accounts', status, role, branchId, q, page, perPage],
    queryFn: () => api.list<AccountRowItem>(buildQueryUrl(false)),
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang làm mới danh sách tài khoản...', 0);
    try {
      const fresh = await api.list<AccountRowItem>(buildQueryUrl(true));
      qc.setQueryData(['accounts', status, role, branchId, q, page, perPage], fresh);
      await qc.invalidateQueries({ queryKey: ['accounts'], refetchType: 'none' });
      message.success('Đã cập nhật dữ liệu mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới dữ liệu thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const singleAction = useMutation({
    mutationFn: async (p: { row: AccountRowItem; kind: SingleAccountActionKind; reason?: string }) => {
      setProcessingId(p.row.id);
      return api.post<{ version: number }>(`/admin/accounts/${p.row.id}/${p.kind}`, { version: p.row.version, reason: p.reason || undefined });
    },
    onSuccess: (res, { row, kind }) => {
      const nextStatus: AccountStatus = kind === 'activate' ? 'ACTIVE' : kind === 'lock' ? 'LOCKED' : row.status === 'LOCKED' ? 'ACTIVE' : row.status;
      setDetailRow((prev) => (prev?.id === row.id ? { ...prev, status: nextStatus, version: res.version, ...(kind !== 'lock' ? { failedLoginCount: 0 } : {}) } : prev));
      message.success(
        kind === 'activate' ? `Đã kích hoạt tài khoản ${row.displayName}` : kind === 'lock' ? `Đã khóa tạm thời tài khoản ${row.displayName}` : `Đã mở khóa đăng nhập cho ${row.displayName}`,
      );
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['account-audit-history'] });
    },
    onError: (e) => {
      message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại');
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onSettled: () => setProcessingId(null),
  });

  const deleteSingle = useMutation({
    mutationFn: async (row: AccountRowItem) => { setProcessingId(row.id); return api.delete(`/admin/accounts/${row.id}`, { version: row.version }); },
    onSuccess: () => { message.success('Đã xóa tài khoản thành công'); qc.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa tài khoản thất bại'),
    onSettled: () => setProcessingId(null),
  });

  const canActivate = can('account.activate');
  const canManage = can('account.manage', 'employee.manage');

  const { bulkActions, bulkMutation, revokeTargets, setRevokeTargets, promptSingleAccountDecision, decisionModalElement } =
    useAccountsBulkActions({ canActivate, currentUserId: me?.user.id });

  const liveDetailRow = useMemo(
    () => (detailRow ? (query.data?.data.find((x) => x.id === detailRow.id) ?? detailRow) : null),
    [detailRow, query.data?.data],
  );

  const updateUrlParam = (key: string, val: string) => {
    setPage(1);
    const sp = new URLSearchParams(params);
    if (val === 'ALL') sp.delete(key);
    else sp.set(key, val);
    router.replace(`/admin/accounts${sp.size ? `?${sp}` : ''}`);
  };

  const triggerSingle = (r: AccountRowItem, kind: SingleAccountActionKind) =>
    promptSingleAccountDecision(r, kind, (p) => singleAction.mutateAsync(p));

  const columns = useMemo(
    () =>
      buildAccountColumns({
        canActivate, canManage, currentUserId: me?.user.id, processingId,
        onViewDetail: setDetailRow,
        onEdit: (r) => { setEditingRow(r); setModalOpen(true); },
        onActivate: (r) => triggerSingle(r, 'activate'),
        onLock: (r) => triggerSingle(r, 'lock'),
        onUnlock: (r) => triggerSingle(r, 'unlock'),
        onRevoke: (r) => setRevokeTargets([r]),
        onDelete: (r) =>
          modal.confirm({
            title: `Xóa tài khoản @${r.username} (${r.displayName})?`,
            content: 'Tài khoản sẽ bị đánh dấu xóa và thu hồi phiên đăng nhập.',
            okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> },
            cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> },
            onOk: () => deleteSingle.mutateAsync(r),
          }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canActivate, canManage, me?.user.id, processingId],
  );

  return (
    <>
      <FilterToolbar
        searchPlaceholder="Tìm tên, tên đăng nhập, mã NV, SĐT..."
        searchValue={q}
        onSearchChange={(val) => { setPage(1); setQ(val); }}
        selects={[
          { key: 'branch_id', value: branchId, width: 210, options: branchOptions, onChange: (val) => updateUrlParam('branch_id', val) },
          { key: 'status', value: status, width: 190, options: [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...ACCOUNT_STATUS_OPTIONS], onChange: (val) => updateUrlParam('status', val) },
          { key: 'role', value: role, width: 200, options: [{ value: 'ALL', label: 'Tất cả vai trò' }, ...ROLE_OPTIONS], onChange: (val) => updateUrlParam('role', val) },
        ]}
        onExportExcel={() => exportAccountsExcel(query.data?.data ?? [])}
        onRefresh={handleManualRefresh}
        refreshing={manualRefreshing}
        primaryActionLabel={canManage ? 'Thêm tài khoản mới' : undefined}
        onPrimaryAction={canManage ? () => { setEditingRow(null); setModalOpen(true); } : undefined}
      />
      <DataTableCard<AccountRowItem>
        columns={columns} dataSource={query.data?.data} meta={query.data?.meta}
        loading={query.isLoading || query.isFetching || manualRefreshing}
        codeExtractor={(r) => r.employeeId || 'Nội bộ'}
        onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
        onRowClick={setDetailRow} bulkActions={bulkActions}
      />
      <AccountCreateModal open={modalOpen} editing={editingRow} onClose={() => { setModalOpen(false); setEditingRow(null); }} />
      <AccountDetailDrawer
        account={liveDetailRow} canManage={canManage} canActivate={canActivate} currentUserId={me?.user.id}
        actionLoading={Boolean(liveDetailRow && processingId === liveDetailRow.id) || bulkMutation.isPending}
        onEdit={(r) => { setEditingRow(r); setModalOpen(true); }}
        onActivate={(r) => triggerSingle(r, 'activate')}
        onLock={(r) => triggerSingle(r, 'lock')}
        onUnlock={(r) => triggerSingle(r, 'unlock')}
        onRevoke={(r) => setRevokeTargets([r])}
        onClose={() => setDetailRow(null)}
      />
      <AccountRevokeModal
        targets={revokeTargets} loading={bulkMutation.isPending} onCancel={() => setRevokeTargets([])}
        onConfirm={(reason) =>
          bulkMutation.mutate(
            { action: 'REVOKE', rows: revokeTargets, reason },
            { onSuccess: () => setDetailRow((prev) => (prev && revokeTargets.some((t) => t.id === prev.id) ? { ...prev, status: 'REVOKED', revokeReason: reason, version: prev.version + 1 } : prev)) },
          )
        }
      />
      {decisionModalElement}
    </>
  );
}

export default function AccountsPage() {
  return <Suspense><AccountsView /></Suspense>;
}
