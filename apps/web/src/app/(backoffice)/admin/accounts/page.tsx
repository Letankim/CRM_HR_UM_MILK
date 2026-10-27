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
import { useAccountsBulkActions } from '@/ui/hooks/useAccountsBulkActions';

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
    queryKey: ['branches-select'],
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
      qc.setQueryData(['accounts', status, role, q, page, perPage], fresh);
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      message.success('Đã cập nhật dữ liệu mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới dữ liệu thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const singleAction = useMutation({
    mutationFn: async (payload: { row: AccountRowItem; kind: 'activate' | 'unlock' }) => {
      setProcessingId(payload.row.id);
      return api.post(`/admin/accounts/${payload.row.id}/${payload.kind}`, { version: payload.row.version });
    },
    onSuccess: (_d, { row, kind }) => {
      message.success(kind === 'activate' ? `Đã kích hoạt tài khoản ${row.displayName}` : `Đã mở khóa đăng nhập cho ${row.displayName}`);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => {
      message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại');
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onSettled: () => setProcessingId(null),
  });

  const deleteSingle = useMutation({
    mutationFn: async (row: AccountRowItem) => {
      setProcessingId(row.id);
      return api.delete(`/admin/accounts/${row.id}`, { version: row.version });
    },
    onSuccess: () => {
      message.success('Đã xóa tài khoản thành công');
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa tài khoản thất bại'),
    onSettled: () => setProcessingId(null),
  });

  const canActivate = can('account.activate');
  const canManage = can('account.manage', 'employee.manage');
  const canCreate = can('account.manage', 'employee.manage');

  const { bulkActions, bulkMutation, revokeTargets, setRevokeTargets } = useAccountsBulkActions({ canActivate, currentUserId: me?.user.id });

  const updateUrlParam = (key: string, val: string) => {
    setPage(1);
    const sp = new URLSearchParams(params);
    if (val === 'ALL') sp.delete(key);
    else sp.set(key, val);
    router.replace(`/admin/accounts${sp.size ? `?${sp}` : ''}`);
  };

  const columns = useMemo(
    () =>
      buildAccountColumns({
        canActivate,
        canManage,
        currentUserId: me?.user.id,
        processingId,
        onViewDetail: (r) => setDetailRow(r),
        onEdit: (r) => { setEditingRow(r); setModalOpen(true); },
        onActivate: (r) => singleAction.mutate({ row: r, kind: 'activate' }),
        onUnlock: (r) => singleAction.mutate({ row: r, kind: 'unlock' }),
        onRevoke: (r) => setRevokeTargets([r]),
        onDelete: (r) =>
          modal.confirm({
            title: `Xóa tài khoản @${r.username} (${r.displayName})?`,
            content: 'Tài khoản sẽ bị đánh dấu xóa và thu hồi phiên đăng nhập.',
            okText: 'Xác nhận xóa',
            okButtonProps: { danger: true, icon: <DeleteOutlined /> },
            cancelText: 'Hủy bỏ',
            cancelButtonProps: { icon: <CloseOutlined /> },
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
        primaryActionLabel={canCreate ? 'Thêm tài khoản mới' : undefined}
        onPrimaryAction={canCreate ? () => { setEditingRow(null); setModalOpen(true); } : undefined}
      />
      <DataTableCard<AccountRowItem>
        columns={columns}
        dataSource={query.data?.data}
        meta={query.data?.meta}
        loading={query.isLoading || query.isFetching || manualRefreshing}
        codeExtractor={(r) => r.employeeId || 'Nội bộ'}
        onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
        bulkActions={bulkActions}
      />
      <AccountCreateModal open={modalOpen} editing={editingRow} onClose={() => { setModalOpen(false); setEditingRow(null); }} />
      <AccountDetailDrawer
        account={detailRow}
        canManage={canManage}
        onEdit={(r) => { setEditingRow(r); setModalOpen(true); }}
        onClose={() => setDetailRow(null)}
      />
      <AccountRevokeModal targets={revokeTargets} loading={bulkMutation.isPending} onConfirm={(reason) => bulkMutation.mutate({ action: 'REVOKE', rows: revokeTargets, reason })} onCancel={() => setRevokeTargets([])} />
    </>
  );
}

export default function AccountsPage() {
  return <Suspense><AccountsView /></Suspense>;
}
