'use client';

import { Alert, App, Button, Flex, Segmented, Space } from 'antd';
import { AppstoreOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EnvironmentOutlined, TableOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { SHIFT_ASSIGNMENT_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ATTENDANCE_SESSION_STATUS_OPTIONS, AttendanceEventsTable, exportAttendanceEventsExcel, type AttendanceEventRow } from '@/ui/components/AttendanceEventsTable';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { ScheduleFormModal, type ScheduleAssignmentItem } from '@/ui/components/ScheduleFormModal';
import { ScheduleSurplusAlertBanner, ScheduleViewsPanel } from '@/ui/components/ScheduleViewsPanel';
import { getMonday } from '@/ui/components/ScheduleWeekMatrix';
import { ScheduleWorkflowsTabs } from '@/ui/components/ScheduleWorkflowsTabs';
import { buildScheduleColumns, exportScheduleExcel } from '@/ui/components/schedule-table-columns';
import { useScheduleBulkActions } from '@/ui/hooks/useScheduleBulkActions';
import { useShiftTemplates } from '@/ui/hooks/useShiftTemplates';

type ViewMode = 'WEEK_MATRIX' | 'CALENDAR' | 'TABLE' | 'ATTENDANCE';

function SchedulesView() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan(), canEdit = can('schedule.propose', 'schedule.publish'), canPublish = can('schedule.publish');

  const section = (params.get('section') as 'schedules' | 'workflows' | null) ?? 'schedules';
  const [viewMode, setViewMode] = useState<ViewMode>('WEEK_MATRIX');
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('ALL');
  const [shiftCode, setShiftCode] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(15);
  const [weekStart, setWeekStart] = useState<Dayjs>(() => getMonday(dayjs()));
  const [calMonth, setCalMonth] = useState<Dayjs>(() => dayjs());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ScheduleAssignmentItem | null>(null);
  const [presetDate, setPresetDate] = useState<string | undefined>();
  const [presetShift, setPresetShift] = useState<string | undefined>();
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'),
  });
  const employeesQuery = useQuery({
    queryKey: ['employees', 'select-all'],
    queryFn: () => api.list<{ id: string; employeeCode: string; fullName: string; branchId: string; branchName: string }>('/admin/employees?per_page=100'),
  });
  const { options: shiftFilterOptions } = useShiftTemplates(branchId);

  const attCountQ = useQuery({
    queryKey: ['attendance-sessions-count', branchId],
    queryFn: () => api.list<AttendanceEventRow>(`/admin/attendance/sessions?page=1&per_page=1${branchId !== 'ALL' ? `&branch_id=${branchId}` : ''}`),
  });

  const dateRangeParams = useMemo(() => {
    if (viewMode === 'WEEK_MATRIX') return { from: weekStart.format('YYYY-MM-DD'), to: weekStart.add(6, 'day').format('YYYY-MM-DD'), limit: 1000 };
    if (viewMode === 'CALENDAR') return { from: calMonth.startOf('month').subtract(7, 'day').format('YYYY-MM-DD'), to: calMonth.endOf('month').add(7, 'day').format('YYYY-MM-DD'), limit: 1000 };
    return { from: '', to: '', limit: perPage };
  }, [viewMode, weekStart, calMonth, perPage]);

  const buildUrl = (force = false) => {
    const sp = new URLSearchParams({
      page: viewMode === 'TABLE' ? String(page) : '1',
      per_page: String(dateRangeParams.limit),
    });
    if (branchId !== 'ALL') sp.set('branch_id', branchId);
    if (shiftCode !== 'ALL') sp.set('shift_code', shiftCode);
    if (status !== 'ALL' && viewMode !== 'ATTENDANCE') sp.set('status', status);
    if (dateRangeParams.from) sp.set('from_date', dateRangeParams.from);
    if (dateRangeParams.to) sp.set('to_date', dateRangeParams.to);
    if (q.trim()) sp.set('q', q.trim());
    if (force) sp.set('refresh', '1');
    return `/admin/schedules?${sp}`;
  };

  const query = useQuery({
    queryKey: ['schedules', viewMode, branchId, shiftCode, status, q, page, dateRangeParams.from, dateRangeParams.to, dateRangeParams.limit],
    queryFn: () => api.list<ScheduleAssignmentItem>(buildUrl(false)),
    enabled: viewMode !== 'ATTENDANCE',
  });
  const needFullScope = viewMode !== 'ATTENDANCE' && (viewMode === 'TABLE' || Boolean(q.trim()) || status !== 'ALL');
  const scopeFrom = dateRangeParams.from || weekStart.format('YYYY-MM-DD'), scopeTo = dateRangeParams.to || weekStart.add(6, 'day').format('YYYY-MM-DD');
  const staffingScopeQ = useQuery({ queryKey: ['schedules', 'STAFFING_SCOPE', branchId, scopeFrom, scopeTo], queryFn: () => api.list<ScheduleAssignmentItem>(`/admin/schedules?page=1&per_page=1000&from_date=${scopeFrom}&to_date=${scopeTo}${branchId !== 'ALL' ? `&branch_id=${branchId}` : ''}`), enabled: needFullScope, staleTime: 15_000 });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang đồng bộ lịch phân ca và điểm danh...', 0);
    try {
      if (viewMode === 'ATTENDANCE') {
        await api.list<AttendanceEventRow>('/admin/attendance/sessions?page=1&per_page=15&refresh=1');
      } else {
        const fresh = await api.list<ScheduleAssignmentItem>(buildUrl(true));
        qc.setQueryData(['schedules', viewMode, branchId, shiftCode, status, q, page, dateRangeParams.from, dateRangeParams.to, dateRangeParams.limit], fresh);
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['attendance-sessions'] }), qc.invalidateQueries({ queryKey: ['attendance-sessions-count'] }), qc.invalidateQueries({ queryKey: ['staffing-rules'] }), qc.invalidateQueries({ queryKey: ['shift-templates'] })]);
      message.success('Đã cập nhật lịch làm việc và dữ liệu điểm danh mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Làm mới thất bại');
    } finally {
      hide();
      setManualRefreshing(false);
    }
  };

  const deleteSingle = useMutation({
    mutationFn: (r: ScheduleAssignmentItem) => api.delete(`/admin/schedules/${r.id}`, { version: r.version }),
    onSuccess: () => { message.success('Đã xóa phân công ca làm việc'); ['schedules', 'attendance-sessions', 'attendance-sessions-count', 'payroll-periods', 'payroll-snapshots', 'payroll-reconcile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
  const approveSingle = useMutation({
    mutationFn: (r: ScheduleAssignmentItem) => api.put(`/admin/schedules/${r.id}`, { version: r.version, status: 'PUBLISHED' }),
    onSuccess: () => { message.success('Đã duyệt và phát hành phân ca chính thức — nhân sự đã có thể chấm công Vào/Ra ca'); qc.invalidateQueries({ queryKey: ['schedules'] }); qc.invalidateQueries({ queryKey: ['my-attendance'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Duyệt phân ca thất bại'),
  });
  const approveBulkMut = useMutation({
    mutationFn: (rows: ScheduleAssignmentItem[]) => api.post<{ processedCount: number }>('/admin/schedules/bulk-action', { action: 'PUBLISH', items: rows.map((r) => ({ id: r.id, version: r.version })) }),
    onSuccess: (res) => { message.success(`Đã duyệt và phát hành chính thức ${res.processedCount} ca làm việc`); qc.invalidateQueries({ queryKey: ['schedules'] }); qc.invalidateQueries({ queryKey: ['my-attendance'] }); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Duyệt hàng loạt thất bại'),
  });

  const { bulkActions } = useScheduleBulkActions({ canEdit });
  const employeeOptions = useMemo(() => (employeesQuery.data?.data ?? []).map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.fullName} (${e.branchName})`, branchId: e.branchId })), [employeesQuery.data]);
  const items = query.data?.data ?? [], scopeAssignments = needFullScope ? (staffingScopeQ.data?.data ?? items) : items;
  const draftItems = useMemo(() => items.filter((i) => i.status === 'DRAFT'), [items]);
  const totalDraftCount = Number(query.data?.meta.filters?.draft_count ?? draftItems.length);
  const attTotalSessions = attCountQ.data?.meta.pagination.total ?? 0;

  const branchList = branchesQuery.data?.data ?? [];
  const branchSelectOptions = branchList.length === 1
    ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }]
    : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))];
  const openEdit = (r: ScheduleAssignmentItem) => { setEditingRow(r); setModalOpen(true); };
  const statusOptions = viewMode === 'ATTENDANCE' ? [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...ATTENDANCE_SESSION_STATUS_OPTIONS] : [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...SHIFT_ASSIGNMENT_STATUS_OPTIONS];

  return (
    <>
      {section === 'schedules' ? (
        <>
          <FilterToolbar
            searchPlaceholder="Tìm tên nhân viên, mã NV, ngày 2026-10-26..."
            searchValue={q}
            onSearchChange={(val) => { setPage(1); setQ(val); }}
            selects={[
              { key: 'branch', value: branchId, width: 195, options: branchSelectOptions, onChange: (v) => { setPage(1); setBranchId(v); } },
              { key: 'shift', value: shiftCode, width: 185, options: [{ value: 'ALL', label: 'Tất cả khung ca' }, ...shiftFilterOptions], onChange: (v) => { setPage(1); setShiftCode(v); } },
              { key: 'status', value: status, width: 185, options: statusOptions, onChange: (v) => { setPage(1); setStatus(v); } },
            ]}
            extraRight={
              <Segmented
                value={viewMode}
                onChange={(v) => { setStatus('ALL'); setPage(1); setViewMode(v as ViewMode); }}
                options={[
                  { value: 'WEEK_MATRIX', icon: <AppstoreOutlined />, label: 'Lưới Lịch Tuần' },
                  { value: 'CALENDAR', icon: <CalendarOutlined />, label: 'Lịch Tháng' },
                  { value: 'TABLE', icon: <TableOutlined />, label: 'Bảng Phân Ca' },
                  { value: 'ATTENDANCE', icon: <EnvironmentOutlined />, label: `Danh Sách Điểm Danh (${attTotalSessions})` },
                ]}
              />
            }
            onExportExcel={async () => {
              if (viewMode === 'ATTENDANCE') {
                const res = await api.list<AttendanceEventRow>(`/admin/attendance/sessions?page=1&per_page=100${branchId !== 'ALL' ? `&branch_id=${branchId}` : ''}`);
                exportAttendanceEventsExcel(res.data);
              } else exportScheduleExcel(items);
            }}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing || query.isFetching}
            primaryActionLabel={canEdit ? 'Phân ca mới' : undefined}
            onPrimaryAction={canEdit ? () => { setEditingRow(null); setPresetDate(undefined); setPresetShift(undefined); setModalOpen(true); } : undefined}
          />

          {canEdit && totalDraftCount > 0 && viewMode !== 'ATTENDANCE' && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message={
                <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
                  <span>Có <strong>{totalDraftCount} ca làm việc</strong> đang ở trạng thái <strong>Chờ duyệt phân ca</strong>. {canPublish ? 'Nhấn Duyệt & Phát hành để lịch có hiệu lực chấm công.' : 'Quản lý cửa hàng kiểm tra định biên, đề xuất điều chỉnh và xác nhận dữ liệu vận hành.'}</span>
                  <Space wrap size={8}>
                    <Button size="small" onClick={() => { setStatus('DRAFT'); setViewMode('TABLE'); }}>Xem danh sách chờ duyệt</Button>
                    {draftItems.length > 0 && <Button size="small" type="primary" icon={<CheckOutlined />} loading={approveBulkMut.isPending} onClick={() => approveBulkMut.mutate(draftItems)}>{canPublish ? `Duyệt & Phát hành (${draftItems.length} ca)` : `Xác nhận vận hành & Duyệt (${draftItems.length} ca)`}</Button>}
                  </Space>
                </Flex>
              }
            />
          )}

          <ScheduleSurplusAlertBanner assignments={scopeAssignments} selectedBranchId={branchId} enabled={viewMode !== 'ATTENDANCE'} />
          {viewMode === 'ATTENDANCE' ? (
            <AttendanceEventsTable externalFilters={{ q, branchId, shiftCode, status }} />
          ) : viewMode !== 'TABLE' ? (
            <ScheduleViewsPanel mode={viewMode} selectedBranchId={branchId} assignments={items} canEdit={canEdit} loading={query.isLoading || query.isFetching || manualRefreshing} isPartialFilter={Boolean(q.trim() || status !== 'ALL')} weekStart={weekStart} onWeekStartChange={setWeekStart} calMonth={calMonth} onMonthChange={setCalMonth} onAddAtCell={(dateStr, sCode) => { setEditingRow(null); setPresetDate(dateStr); setPresetShift(sCode); setModalOpen(true); }} onEditItem={openEdit} />
          ) : (
            <DataTableCard<ScheduleAssignmentItem>
              columns={buildScheduleColumns({
                canEdit, onApprove: (r) => approveSingle.mutate(r), onEdit: openEdit,
                onDelete: (r) => modal.confirm({ title: `Xác nhận xóa phân công ca của ${r.employeeName}?`, content: `Ca ${r.shiftLabel} ngày ${r.workDate} sẽ bị xóa khỏi lịch làm việc.`, okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => deleteSingle.mutateAsync(r) }),
              })}
              dataSource={items} meta={query.data?.meta} loading={query.isLoading || query.isFetching || manualRefreshing}
              codeExtractor={(r) => r.employeeCode} onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }} bulkActions={bulkActions}
            />
          )}
          <ScheduleFormModal open={modalOpen} editing={editingRow} presetDate={presetDate} presetShiftCode={presetShift} employees={employeeOptions} existingAssignments={scopeAssignments} canEdit={canEdit} onClose={() => { setModalOpen(false); setEditingRow(null); }} />
        </>
      ) : (
        <ScheduleWorkflowsTabs employees={employeeOptions} assignments={items} />
      )}
    </>
  );
}

export default function SchedulesPage() {
  return <Suspense><SchedulesView /></Suspense>;
}
