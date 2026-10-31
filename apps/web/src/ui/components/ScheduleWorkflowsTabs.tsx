'use client';

import { useState } from 'react';
import { App, Card, Select, Tabs } from 'antd';
import { CalendarOutlined, EnvironmentOutlined, FileAddOutlined, FormOutlined, PlusOutlined, ScheduleOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SHIFT_SWAP_KIND_LABELS, SHIFT_SWAP_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { AttendanceEventsTable, type AttendanceEventRow } from './AttendanceEventsTable';
import { SelectableTable } from './BulkActionBar';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { SchedulePlannerPanel } from './SchedulePlannerPanel';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { ScheduleShiftRegistrationsPane } from './ScheduleShiftRegistrationsPane';
import { ScheduleWorkflowModals, type WorkflowAssignmentOption } from './ScheduleWorkflowModals';
import { ShiftSwapApproveModal, submitShiftSwapApproval, type ShiftSwapApprovePayload, type ShiftSwapApproveTarget } from './ShiftSwapApproveModal';
import { buildAdjustmentsBulkActions, buildLeavesBulkActions, buildSwapsBulkActions, exportAdjustmentsExcel, exportLeavesExcel, exportSwapsExcel } from './workflow-bulk-helpers';
import { buildAdjustmentColumns, buildLeaveColumns, buildSwapColumns, type WorkflowColumnCtx } from './workflow-columns';
import { confirmWorkflowShiftOverride, type WorkflowConfirmKind } from './workflow-shift-warning';
import { WorkflowSubFilterBar } from './WorkflowSubFilterBar';

type RowRec = Record<string, unknown>;
interface Props { employees: { value: string; label: string; branchId?: string; canSwapShift?: boolean }[]; assignments: WorkflowAssignmentOption[] }

const ADJ_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'STORE_CONFIRMED', label: 'CH đã xác nhận' }, { value: 'APPROVED', label: 'Đã phê duyệt' }, { value: 'REJECTED', label: 'Đã từ chối' }];
const LEAVE_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING', label: 'Chờ duyệt nghỉ OFF' }, { value: 'APPROVED', label: 'Đã phê duyệt nghỉ OFF' }, { value: 'REJECTED', label: 'Đã từ chối' }];
const SWAP_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...SHIFT_SWAP_STATUS_OPTIONS.map((o) => ({ value: String(o.value), label: String(o.label) }))];
const SWAP_KIND_OPTS = [{ value: 'ALL', label: 'Tất cả loại yêu cầu' }, ...(Object.keys(SHIFT_SWAP_KIND_LABELS) as (keyof typeof SHIFT_SWAP_KIND_LABELS)[]).map((k) => ({ value: k, label: SHIFT_SWAP_KIND_LABELS[k] }))];
const REFRESH_KEYS = ['attendance-adjustments', 'leave-requests', 'shift-swaps', 'shift-registrations', 'attendance-sessions', 'attendance-sessions-count', 'schedules', 'schedule-planner-week', 'schedule-planner-probation', 'my-attendance', 'payroll-periods', 'payroll-snapshots', 'payroll-reconcile'];

export function ScheduleWorkflowsTabs({ employees, assignments }: Props) {
  const qc = useQueryClient(), { message, modal } = App.useApp();
  const canConfirmAtt = usePermissionGuard({ perms: ['attendance.confirm'] }), canApproveAdj = usePermissionGuard({ perms: ['adjustment.approve'] });
  const canApproveLeave = usePermissionGuard({ perms: ['leave.approve'] }), canApproveSwap = usePermissionGuard({ perms: ['swap.approve'] });
  const [activeTab, setActiveTab] = useState('planner'), [leaveModal, setLeaveModal] = useState(false), [swapModal, setSwapModal] = useState(false), [adjModal, setAdjModal] = useState(false);
  const [detailTarget, setDetailTarget] = useState<ScheduleDetailTarget | null>(null), [swapApproveTarget, setSwapApproveTarget] = useState<ShiftSwapApproveTarget | null>(null);
  const [searchInput, setSearchInput] = useState(''), debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL'), [statusFilter, setStatusFilter] = useState('ALL'), [kindFilter, setKindFilter] = useState('ALL');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(10);

  const mkParams = (tabKey: string) => {
    const p = new URLSearchParams({ page: String(activeTab === tabKey ? page : 1), per_page: String(perPage) });
    if (debouncedQ) p.set('q', debouncedQ);
    if (branchFilter !== 'ALL') p.set('branch_id', branchFilter);
    if (activeTab === tabKey && statusFilter !== 'ALL') p.set('status', statusFilter);
    if (tabKey === 'swap' && kindFilter !== 'ALL') p.set('kind', kindFilter);
    return p.toString();
  };

  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100') });
  const adjParams = mkParams('adjustments'), leaveParams = mkParams('leave'), swapParams = mkParams('swap');
  const adjQ = useQuery({ queryKey: ['attendance-adjustments', adjParams], queryFn: () => api.list<RowRec>(`/admin/attendance/adjustments?${adjParams}`) });
  const leavesQ = useQuery({ queryKey: ['leave-requests', leaveParams], queryFn: () => api.list<RowRec>(`/admin/leave-requests?${leaveParams}`) });
  const swapsQ = useQuery({ queryKey: ['shift-swaps', swapParams], queryFn: () => api.list<RowRec>(`/admin/shift-swaps?${swapParams}`) });
  const attCountQ = useQuery({ queryKey: ['attendance-sessions-count', branchFilter], queryFn: () => api.list<AttendanceEventRow>(`/admin/attendance/sessions?page=1&per_page=1${branchFilter !== 'ALL' ? `&branch_id=${branchFilter}` : ''}`) });
  const draftCountQ = useQuery({ queryKey: ['shift-registrations', 'count'], queryFn: () => api.list<RowRec>('/admin/schedules?status=DRAFT&page=1&per_page=1') });
  const draftTotal = draftCountQ.data?.meta.pagination.total ?? 0;

  const refreshAll = () => REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const isRefreshing = adjQ.isFetching || leavesQ.isFetching || swapsQ.isFetching || attCountQ.isFetching;
  const actMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown; successMsg?: string }) => api.post(url, body),
    onSuccess: (_r, { successMsg }) => { message.success(successMsg || 'Đã thực hiện thao tác thành công'); setPage(1); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });
  const swapApproveMut = useMutation({
    mutationFn: ({ target, payload }: { target: ShiftSwapApproveTarget; payload: ShiftSwapApprovePayload }) => submitShiftSwapApproval(target, payload),
    onSuccess: (_res, { target, payload }) => {
      const pcText = payload.allowance_eligible && payload.allowance_amount_vnd > 0 ? `+${payload.allowance_amount_vnd.toLocaleString('vi-VN')} đ/ca` : 'Không tính phụ cấp (0 đ)';
      message.success(target.mode === 'edit-allowance' ? `Đã cập nhật phụ cấp nhận ca (${pcText}) và đồng bộ bảng lương` : `HR đã phê duyệt ${target.rows.length > 1 ? `${target.rows.length} yêu cầu` : 'yêu cầu'} và cập nhật lịch làm việc (${pcText})`);
      setSwapApproveTarget(null); setPage(1); refreshAll();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Phê duyệt yêu cầu thất bại'),
  });
  const runAct = (url: string, body: unknown, successMsg: string, confirmKind?: WorkflowConfirmKind, row?: RowRec) =>
    confirmKind && row ? confirmWorkflowShiftOverride(modal, confirmKind, [row], () => actMut.mutate({ url, body, successMsg })) : actMut.mutate({ url, body, successMsg });
  const batchMut = useMutation({
    mutationFn: async ({ items, buildCall, successMsg }: { items: RowRec[]; buildCall: (r: RowRec) => { url: string; body: unknown } | null; successMsg: string }) => {
      if (items.length === 0) throw new Error('Không có bản ghi nào ở trạng thái hợp lệ để thực hiện thao tác này');
      await Promise.all(items.map((r) => { const c = buildCall(r); return c ? api.post(c.url, c.body) : Promise.resolve(); }));
      return successMsg;
    },
    onSuccess: (msg) => { message.success(msg); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Thao tác hàng loạt thất bại'),
  });
  const bulkOpts = { canConfirmAtt, canApproveAdj, canApproveLeave, canApproveSwap, loading: batchMut.isPending || swapApproveMut.isPending, onOpenApproveSwaps: (rows: RowRec[]) => setSwapApproveTarget({ mode: 'approve', rows }), runBatch: (items: RowRec[], buildCall: (r: RowRec) => { url: string; body: unknown } | null, successMsg: string, confirmKind?: WorkflowConfirmKind) => confirmKind ? confirmWorkflowShiftOverride(modal, confirmKind, items, () => batchMut.mutate({ items, buildCall, successMsg })) : batchMut.mutate({ items, buildCall, successMsg }) };
  const colCtx: WorkflowColumnCtx = {
    loading: actMut.isPending || swapApproveMut.isPending, canConfirmAtt, canApproveAdj, canApproveLeave, canApproveSwap, runAct,
    onDetail: (kind, record) => setDetailTarget({ kind, record }),
    onApproveSwap: (r) => setSwapApproveTarget({ mode: 'approve', rows: [r] }), onEditSwapAllowance: (r) => setSwapApproveTarget({ mode: 'edit-allowance', rows: [r] }),
  };

  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = branchList.length === 1 ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))];
  const adjRows = adjQ.data?.data ?? [], leaveRows = leavesQ.data?.data ?? [], swapRows = swapsQ.data?.data ?? [];
  const mkPag = (total?: number) => ({ current: page, pageSize: perPage, total: total ?? 0, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t: number) => `Tổng ${t} đơn`, onChange: (p: number, ps: number) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } });
  const filterBar = (statusOptions: { value: string; label: string }[], onExport: () => void, actionBtn: React.ReactNode, extraFilters?: React.ReactNode) => (
    <WorkflowSubFilterBar
      searchInput={searchInput} onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
      branchValue={branchFilter} branchOptions={branchOptions} onBranchChange={(v) => { setBranchFilter(v); setPage(1); }}
      statusValue={statusFilter} statusOptions={statusOptions} onStatusChange={(v) => { setStatusFilter(v); setPage(1); }}
      extraFilters={extraFilters} refreshing={isRefreshing} onRefresh={refreshAll} onExport={onExport} actionBtn={actionBtn}
    />
  );

  return (
    <Card size="small" styles={{ body: { padding: '12px 20px 20px' } }}>
      <Tabs activeKey={activeTab} onChange={(k) => { setActiveTab(k); setStatusFilter('ALL'); setPage(1); }} items={[
        { key: 'planner', label: <span><ScheduleOutlined /> Chốt lịch & Sắp ca</span>, children: <SchedulePlannerPanel /> },
        { key: 'registrations', label: <span><FormOutlined /> Đăng ký ca chờ duyệt ({draftTotal})</span>, children: <ScheduleShiftRegistrationsPane branchOptions={branchOptions} onDetail={setDetailTarget} /> },
        { key: 'attendance', label: <span><EnvironmentOutlined /> Lịch sử Điểm danh Vào/Ra ca ({attCountQ.data?.meta.pagination.total ?? 0})</span>, children: <AttendanceEventsTable assignments={assignments as unknown as RowRec[]} /> },
        { key: 'adjustments', label: <span><FileAddOutlined /> Phiếu bổ sung công ({adjQ.data?.meta.pagination.total ?? adjRows.length})</span>, children: (
          <>
            {filterBar(ADJ_STATUS_OPTS, () => exportAdjustmentsExcel(adjRows), <GuardButton type="primary" icon={<FileAddOutlined />} perms={['attendance.confirm', 'adjustment.approve']} onClick={() => setAdjModal(true)}>Tạo phiếu bổ sung công</GuardButton>)}
            <SelectableTable<RowRec> size="small" rowKey="id" loading={adjQ.isLoading} scroll={{ x: 1300 }} pagination={mkPag(adjQ.data?.meta.pagination.total)} dataSource={adjRows} onRowClick={(r) => setDetailTarget({ kind: 'adjustment', record: r })} bulkActions={buildAdjustmentsBulkActions(bulkOpts)} columns={buildAdjustmentColumns(colCtx)} />
          </>
        ) },
        { key: 'leave', label: <span><CalendarOutlined /> Đơn xin nghỉ phép (OFF) ({leavesQ.data?.meta.pagination.total ?? leaveRows.length})</span>, children: (
          <>
            {filterBar(LEAVE_STATUS_OPTS, () => exportLeavesExcel(leaveRows), <GuardButton type="primary" icon={<PlusOutlined />} perms={['leave.approve']} onClick={() => setLeaveModal(true)}>Đăng ký nghỉ OFF</GuardButton>)}
            <SelectableTable<RowRec> size="small" rowKey="id" loading={leavesQ.isLoading} pagination={mkPag(leavesQ.data?.meta.pagination.total)} dataSource={leaveRows} onRowClick={(r) => setDetailTarget({ kind: 'leave', record: r })} bulkActions={buildLeavesBulkActions(bulkOpts)} columns={buildLeaveColumns(colCtx)} />
          </>
        ) },
        { key: 'swap', label: <span><SwapOutlined /> Đổi ca / Nhường ca ({swapsQ.data?.meta.pagination.total ?? swapRows.length})</span>, children: (
          <>
            {filterBar(SWAP_STATUS_OPTS, () => exportSwapsExcel(swapRows), <GuardButton type="primary" icon={<PlusOutlined />} perms={['swap.approve']} onClick={() => setSwapModal(true)}>Tạo yêu cầu đổi / nhường ca</GuardButton>,
              <Select value={kindFilter} onChange={(v) => { setKindFilter(v); setPage(1); }} options={SWAP_KIND_OPTS} style={{ width: 185 }} />)}
            <SelectableTable<RowRec> size="small" rowKey="id" loading={swapsQ.isLoading} scroll={{ x: 1450 }} pagination={mkPag(swapsQ.data?.meta.pagination.total)} dataSource={swapRows} onRowClick={(r) => setDetailTarget({ kind: 'swap', record: r })} bulkActions={buildSwapsBulkActions(bulkOpts)} columns={buildSwapColumns(colCtx)} />
          </>
        ) },
      ]} />
      <ScheduleRequestDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} onApproveSwap={canApproveSwap ? (r) => setSwapApproveTarget({ mode: 'approve', rows: [r] }) : undefined} onEditSwapAllowance={canApproveSwap ? (r) => setSwapApproveTarget({ mode: 'edit-allowance', rows: [r] }) : undefined} />
      <ShiftSwapApproveModal target={swapApproveTarget} loading={swapApproveMut.isPending} onClose={() => setSwapApproveTarget(null)} onConfirm={(payload) => swapApproveTarget && swapApproveMut.mutate({ target: swapApproveTarget, payload })} />
      <ScheduleWorkflowModals employees={employees} assignments={assignments} leaveModal={leaveModal} swapModal={swapModal} adjModal={adjModal} submitting={actMut.isPending} onCloseLeave={() => setLeaveModal(false)} onCloseSwap={() => setSwapModal(false)} onCloseAdj={() => setAdjModal(false)} onSubmitAction={(url, body) => !actMut.isPending && actMut.mutate({ url, body, successMsg: url.includes('shift-swaps') ? 'Đã gửi yêu cầu — chờ đồng nghiệp xác nhận' : undefined })} />
    </Card>
  );
}
