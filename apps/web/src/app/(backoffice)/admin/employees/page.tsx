'use client';

import { App } from 'antd';
import { CloseOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { EMPLOYEE_STAGE_OPTIONS, EMPLOYEE_STATUS_OPTIONS, type EmployeeStage, type EmployeeStatus } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { EmployeeCreateModal } from '@/ui/components/EmployeeCreateModal';
import { EmployeeDetailDrawer } from '@/ui/components/EmployeeDetailDrawer';
import { PromoteOfficialModal } from '@/ui/components/EmployeeDossierHistoryTab';
import { GuardButton } from '@/ui/components/GuardButton';
import { JobPositionsManagerModal, useJobPositions } from '@/ui/components/JobPositionsManagerModal';
import { RecruitmentAndTestTabs } from '@/ui/components/RecruitmentAndTestTabs';
import { buildEmployeeColumns, exportEmployeesExcel, type EmployeeRowItem } from '@/ui/components/employee-table-columns';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { useEmployeesBulkActions } from '@/ui/hooks/useEmployeesBulkActions';

function EmployeesView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan();

  const section = (params.get('section') as 'employees' | 'recruitment' | 'tests' | null) ?? 'employees';
  const branchId = params.get('branch_id') ?? 'ALL';
  const stage = (params.get('stage') as EmployeeStage | null) ?? 'ALL';
  const staffGroup = params.get('staff_group') ?? 'ALL';
  const status = (params.get('status') as EmployeeStatus | null) ?? 'ALL';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(12);
  const [modalOpen, setModalOpen] = useState(false);
  const [posModalOpen, setPosModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<EmployeeRowItem | null>(null);
  const [detailRow, setDetailRow] = useState<EmployeeRowItem | null>(null);
  const [promotingRow, setPromotingRow] = useState<EmployeeRowItem | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const { options: jobPositionOptions } = useJobPositions();

  const canManage = can('employee.manage');
  const canPromote = can('employee.promote');
  const canSeeSalary = can('payroll.read', 'employee.manage', 'system.config');

  const branchesQuery = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'),
  });

  const buildQueryUrl = (forceRefresh = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (branchId !== 'ALL') sp.set('branch_id', branchId);
    if (stage !== 'ALL') sp.set('stage', stage);
    if (staffGroup !== 'ALL') sp.set('staff_group', staffGroup);
    if (status !== 'ALL') sp.set('status', status);
    if (q.trim()) sp.set('q', q.trim());
    if (forceRefresh) sp.set('refresh', '1');
    return `/admin/employees?${sp}`;
  };

  const query = useQuery({
    queryKey: ['employees', branchId, stage, staffGroup, status, q, page, perPage],
    queryFn: () => api.list<EmployeeRowItem>(buildQueryUrl(false)),
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang làm mới danh sách hồ sơ nhân sự...', 0);
    try {
      const fresh = await api.list<EmployeeRowItem>(buildQueryUrl(true));
      qc.setQueryData(['employees', branchId, stage, staffGroup, status, q, page, perPage], fresh);
      await qc.invalidateQueries({ queryKey: ['employees'], refetchType: 'none' });
      message.success('Đã cập nhật hồ sơ nhân sự mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const promoteSingle = useMutation({
    mutationFn: async (input: { row: EmployeeRowItem; official_from: string; evaluation_summary: string }) => {
      setProcessingId(input.row.id);
      return api.post<EmployeeRowItem>(`/admin/employees/${input.row.id}/promote-official`, { version: input.row.version, official_from: input.official_from, evaluation_summary: input.evaluation_summary });
    },
    onSuccess: (updated) => {
      message.success(`Đã chuyển chính thức cho ${updated.fullName} (Giữ nguyên mã ${updated.employeeCode})`);
      setPromotingRow(null);
      setDetailRow((prev) => (prev?.id === updated.id ? updated : prev));
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chuyển chính thức thất bại'),
    onSettled: () => setProcessingId(null),
  });

  const deleteSingle = useMutation({
    mutationFn: async (row: EmployeeRowItem) => {
      setProcessingId(row.id);
      return api.delete(`/admin/employees/${row.id}`, { version: row.version });
    },
    onSuccess: () => {
      message.success('Đã xóa hồ sơ nhân sự thành công');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa hồ sơ thất bại'),
    onSettled: () => setProcessingId(null),
  });

  const updateUrlParam = (key: string, val: string) => {
    setPage(1);
    const sp = new URLSearchParams(params);
    if (val === 'ALL') sp.delete(key);
    else sp.set(key, val);
    router.replace(`/admin/employees${sp.size ? `?${sp}` : ''}`);
  };

  const { bulkActions } = useEmployeesBulkActions({ canManage, canPromote });

  const columns = useMemo(
    () =>
      buildEmployeeColumns({
        canManage,
        canPromote,
        canSeeSalary,
        processingId,
        onViewDetail: (r) => setDetailRow(r),
        onEdit: (r) => { setEditingRow(r); setModalOpen(true); },
        onPromoteOfficial: (r) => setPromotingRow(r),
        onDelete: (r) =>
          modal.confirm({
            title: `Xóa hồ sơ nhân sự ${r.fullName} (${r.employeeCode})?`,
            content: 'Bản ghi sẽ được đánh dấu xóa và lưu vết vào Nhật ký kiểm toán.',
            okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> },
            cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> },
            onOk: () => deleteSingle.mutateAsync(r),
          }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, canPromote, canSeeSalary, processingId],
  );

  const branchOptions = useMemo(() => (branchesQuery.data?.data ?? []).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })), [branchesQuery.data]);
  const branchSelectOptions = branchOptions.length === 1 ? [{ value: 'ALL', label: branchOptions[0]!.label }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchOptions];
  const existingCodes = useMemo(() => (query.data?.data ?? []).map((e) => e.employeeCode), [query.data]);

  return (
    <>
      {section === 'employees' ? (
        <>
          <FilterToolbar
            searchPlaceholder="Tìm tên nhân viên, mã NV0001, SĐT 09..."
            searchValue={q}
            onSearchChange={(val) => { setPage(1); setQ(val); }}
            selects={[
              { key: 'branch_id', value: branchId, width: 195, options: branchSelectOptions, onChange: (v) => updateUrlParam('branch_id', v) },
              { key: 'stage', value: stage, width: 175, options: [{ value: 'ALL', label: 'Tất cả giai đoạn' }, ...EMPLOYEE_STAGE_OPTIONS], onChange: (v) => updateUrlParam('stage', v) },
              { key: 'staff_group', value: staffGroup, width: 175, options: [{ value: 'ALL', label: 'Tất cả vị trí' }, ...jobPositionOptions], onChange: (v) => updateUrlParam('staff_group', v) },
              { key: 'status', value: status, width: 165, options: [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...EMPLOYEE_STATUS_OPTIONS], onChange: (v) => updateUrlParam('status', v) },
            ]}
            extraRight={
              <GuardButton perms={['employee.manage', 'system.config']} icon={<SettingOutlined />} onClick={() => setPosModalOpen(true)}>
                Cấu hình vị trí
              </GuardButton>
            }
            onExportExcel={() => exportEmployeesExcel(query.data?.data ?? [], canSeeSalary)}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing}
            primaryActionLabel={canManage ? 'Thêm nhân sự mới' : undefined}
            onPrimaryAction={canManage ? () => { setEditingRow(null); setModalOpen(true); } : undefined}
          />
          <DataTableCard<EmployeeRowItem>
            columns={columns}
            dataSource={query.data?.data}
            meta={query.data?.meta}
            loading={query.isLoading || query.isFetching || manualRefreshing}
            codeExtractor={(r) => r.employeeCode}
            onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }}
            bulkActions={bulkActions}
          />
          <EmployeeCreateModal open={modalOpen} editing={editingRow} existingCodes={existingCodes} branches={branchOptions} onClose={() => { setModalOpen(false); setEditingRow(null); }} />
          <JobPositionsManagerModal open={posModalOpen} onClose={() => setPosModalOpen(false)} />
          <PromoteOfficialModal employee={promotingRow} loading={promoteSingle.isPending} onClose={() => setPromotingRow(null)} onConfirm={(v) => promotingRow && promoteSingle.mutate({ row: promotingRow, ...v })} />
          <EmployeeDetailDrawer
            employee={detailRow}
            canManage={canManage}
            canPromote={canPromote}
            canSeeSalary={canSeeSalary}
            promoting={promoteSingle.isPending}
            onEdit={(r) => { setEditingRow(r); setModalOpen(true); }}
            onPromoteOfficial={(r) => setPromotingRow(r)}
            onClose={() => setDetailRow(null)}
          />
        </>
      ) : (
        <RecruitmentAndTestTabs
          activeTab={section === 'tests' ? 'tests' : 'recruitment'}
          onTabChange={(t) => updateUrlParam('section', t)}
          branches={branchOptions}
          employees={(query.data?.data ?? []).map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.fullName}` }))}
        />
      )}
    </>
  );
}

export default function EmployeesPage() {
  return <Suspense><EmployeesView /></Suspense>;
}
