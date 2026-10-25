'use client';

import { Alert, App, Button, Flex, Segmented, Space } from 'antd';
import { AppstoreOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EnvironmentOutlined, TableOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { DEFAULT_SHIFT_OPTIONS, SHIFT_ASSIGNMENT_STATUS_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { AttendanceEventsTable, groupAttendanceEventsByShift, type AttendanceEventRow } from '@/ui/components/AttendanceEventsTable';
import { DataTableCard } from '@/ui/components/DataTableCard';
import { FilterToolbar } from '@/ui/components/FilterToolbar';
import { ScheduleFormModal, type ScheduleAssignmentItem } from '@/ui/components/ScheduleFormModal';
import { ScheduleViewsPanel } from '@/ui/components/ScheduleViewsPanel';
import { ScheduleWorkflowsTabs } from '@/ui/components/ScheduleWorkflowsTabs';
import { buildScheduleColumns, exportScheduleExcel } from '@/ui/components/schedule-table-columns';
import { useScheduleBulkActions } from '@/ui/hooks/useScheduleBulkActions';

type ViewMode = 'WEEK_MATRIX' | 'CALENDAR' | 'TABLE' | 'ATTENDANCE';

function SchedulesView() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan();
  const canEdit = can('schedule.propose', 'schedule.publish');

  const section = (params.get('section') as 'schedules' | 'workflows' | null) ?? 'schedules';
  const [viewMode, setViewMode] = useState<ViewMode>('WEEK_MATRIX');
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('ALL');
  const [shiftCode, setShiftCode] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
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
    queryFn: () => api.list<{ id: string; employeeCode: string; fullName: string; branchName: string }>('/admin/employees?per_page=100'),
  });

  const attQ = useQuery({
    queryKey: ['attendance-all'],
    queryFn: () => api.get<{ events: AttendanceEventRow[]; adjustments: Record<string, unknown>[] }>('/admin/attendance'),
  });

  const buildUrl = (force = false) => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (branchId !== 'ALL') sp.set('branch_id', branchId);
    if (shiftCode !== 'ALL') sp.set('shift_code', shiftCode);
    if (status !== 'ALL') sp.set('status', status);
    if (q.trim()) sp.set('q', q.trim());
    if (force) sp.set('refresh', '1');
    return `/admin/schedules?${sp}`;
  };

  const query = useQuery({
    queryKey: ['schedules', branchId, shiftCode, status, q, page, perPage],
    queryFn: () => api.list<ScheduleAssignmentItem>(buildUrl(false)),
  });

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    const hide = message.loading('Đang đồng bộ lịch phân ca và điểm danh...', 0);
    try {
      const fresh = await api.list<ScheduleAssignmentItem>(buildUrl(true));
      qc.setQueryData(['schedules', branchId, shiftCode, status, q, page, perPage], fresh);
      await qc.invalidateQueries({ queryKey: ['attendance-all'] });
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
    onSuccess: () => { message.success('Đã xóa phân công ca làm việc'); qc.invalidateQueries({ queryKey: ['schedules'] }); },
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

  const employeeOptions = useMemo(
    () => (employeesQuery.data?.data ?? []).map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.fullName} (${e.branchName})` })),
    [employeesQuery.data],
  );

  const attEvents = attQ.data?.events ?? [];
  const items = useMemo(() => {
    return (query.data?.data ?? []).map((item) => {
      if (item.status !== 'PUBLISHED') {
        return { ...item, attendanceStatusLabel: 'Chờ CH / HR duyệt phân ca', attendanceStatusColor: 'gold' };
      }
      const sEvs = attEvents.filter((e) => String(e.assignment_id) === String(item.id));
      const inEv = sEvs.find((e) => e.type === 'CHECK_IN');
      const outEv = sEvs.find((e) => e.type === 'CHECK_OUT');
      const attendanceStatusLabel = inEv && outEv ? 'Đã hoàn thành ca' : inEv ? `Đã vào ca (${String(inEv.checkTimeFormatted || '').slice(0, 5)} · ${inEv.punctualityLabel || 'Đúng giờ'})` : 'Chưa điểm danh';
      const attendanceStatusColor = inEv && outEv ? 'green' : inEv ? (inEv.punctualityStatus === 'LATE' ? 'volcano' : 'processing') : 'default';
      return { ...item, attendanceStatusLabel, attendanceStatusColor };
    });
  }, [query.data, attEvents]);
  const draftItems = useMemo(() => items.filter((i) => i.status === 'DRAFT'), [items]);

  const branchList = branchesQuery.data?.data ?? [];
  const branchSelectOptions = branchList.length === 1
    ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }]
    : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))];
  const openEdit = (r: ScheduleAssignmentItem) => { setEditingRow(r); setModalOpen(true); };

  return (
    <>
      {section === 'schedules' ? (
        <>
          <FilterToolbar
            searchPlaceholder="Tìm tên nhân viên, mã NV, ngày 2026-10-24..."
            searchValue={q}
            onSearchChange={(val) => { setPage(1); setQ(val); }}
            selects={[
              { key: 'branch', value: branchId, width: 195, options: branchSelectOptions, onChange: (v) => { setPage(1); setBranchId(v); } },
              { key: 'shift', value: shiftCode, width: 165, options: [{ value: 'ALL', label: 'Tất cả khung ca' }, ...DEFAULT_SHIFT_OPTIONS], onChange: (v) => { setPage(1); setShiftCode(v); } },
              { key: 'status', value: status, width: 175, options: [{ value: 'ALL', label: 'Tất cả trạng thái' }, ...SHIFT_ASSIGNMENT_STATUS_OPTIONS], onChange: (v) => { setPage(1); setStatus(v); } },
            ]}
            extraRight={
              <Segmented
                value={viewMode}
                onChange={(v) => setViewMode(v as ViewMode)}
                options={[
                  { value: 'WEEK_MATRIX', icon: <AppstoreOutlined />, label: 'Lưới Lịch Tuần' },
                  { value: 'CALENDAR', icon: <CalendarOutlined />, label: 'Lịch Tháng' },
                  { value: 'TABLE', icon: <TableOutlined />, label: 'Bảng Phân Ca' },
                  { value: 'ATTENDANCE', icon: <EnvironmentOutlined />, label: `Danh Sách Điểm Danh (${groupAttendanceEventsByShift(attEvents).length})` },
                ]}
              />
            }
            onExportExcel={() => exportScheduleExcel(items)}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing}
            primaryActionLabel={canEdit ? 'Phân ca mới' : undefined}
            onPrimaryAction={canEdit ? () => { setEditingRow(null); setPresetDate(undefined); setPresetShift(undefined); setModalOpen(true); } : undefined}
          />

          {canEdit && draftItems.length > 0 && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message={
                <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
                  <span>Có <strong>{draftItems.length} ca làm việc</strong> đang ở trạng thái <strong>Chờ duyệt phân ca</strong>. Nhân sự chỉ có thể chấm công Vào/Ra ca sau khi Quản lý cửa hàng hoặc HR duyệt sang Đã phân ca chính thức.</span>
                  <Space wrap size={8}>
                    <Button size="small" onClick={() => { setStatus('DRAFT'); setViewMode('TABLE'); }}>Xem danh sách chờ duyệt</Button>
                    <Button size="small" type="primary" icon={<CheckOutlined />} loading={approveBulkMut.isPending} onClick={() => approveBulkMut.mutate(draftItems)}>Duyệt &amp; Phát hành tất cả ({draftItems.length} ca)</Button>
                  </Space>
                </Flex>
              }
            />
          )}

          {viewMode === 'ATTENDANCE' ? (
            <AttendanceEventsTable events={attEvents} assignments={items as unknown as Record<string, unknown>[]} loading={attQ.isLoading} />
          ) : viewMode !== 'TABLE' ? (
            <ScheduleViewsPanel mode={viewMode} assignments={items} canEdit={canEdit} onAddAtCell={(dateStr, sCode) => { setEditingRow(null); setPresetDate(dateStr); setPresetShift(sCode); setModalOpen(true); }} onEditItem={openEdit} />
          ) : (
            <DataTableCard<ScheduleAssignmentItem>
              columns={buildScheduleColumns({
                canEdit, onApprove: (r) => approveSingle.mutate(r), onEdit: openEdit,
                onDelete: (r) => modal.confirm({
                  title: `Xác nhận xóa phân công ca của ${r.employeeName}?`, content: `Ca ${r.shiftLabel} ngày ${r.workDate} sẽ bị xóa khỏi lịch làm việc.`,
                  okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> },
                  onOk: () => deleteSingle.mutateAsync(r),
                }),
              })}
              dataSource={items} meta={query.data?.meta} loading={query.isLoading || query.isFetching || manualRefreshing}
              codeExtractor={(r) => r.employeeCode} onPageChange={(nextPage, nextSize) => { setPage(nextPage); setPerPage(nextSize); }} bulkActions={bulkActions}
            />
          )}

          <ScheduleFormModal open={modalOpen} editing={editingRow} presetDate={presetDate} presetShiftCode={presetShift} employees={employeeOptions} canEdit={canEdit} onClose={() => { setModalOpen(false); setEditingRow(null); }} />
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
