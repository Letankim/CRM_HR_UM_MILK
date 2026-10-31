'use client';

import { useState } from 'react';
import { App, Space, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { RowActionButtons } from './RowActionButtons';
import type { ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { exportMyShiftsExcel } from './workflow-bulk-helpers';
import { cleanShiftName, fmtDate, fmtShiftTime } from './workflow-columns';
import { WorkflowSubFilterBar } from './WorkflowSubFilterBar';

type RowRec = Record<string, unknown>;
const SOURCE_OPTS = [{ value: 'ALL', label: 'Tất cả nguồn đăng ký' }, { value: 'PROBATION_EXTRA', label: 'Thử việc đăng ký thêm ca' }, { value: 'OTHER', label: 'Đăng ký / phân ca khác' }];
const RELATED_KEYS = ['schedules', 'shift-registrations', 'schedule-planner-probation', 'schedule-planner-week', 'dashboard-schedules', 'my-attendance', 'notifications', 'payroll-snapshots'];

/** Tag nhận diện ca thử việc đăng ký thêm (và ca cuối chu kỳ sẽ bị dời khi duyệt). */
export function renderProbationExtraTags(r: RowRec) {
  if (r.source !== 'PROBATION_EXTRA' && !r.linkedAssignmentId) return null;
  return (
    <Space size={4} wrap>
      {r.source === 'PROBATION_EXTRA' && <Tag color="gold" style={{ margin: 0 }}>Thử việc đăng ký thêm ca</Tag>}
      {Boolean(r.linkedAssignmentId) && <Tag color="volcano" style={{ margin: 0 }}>Sẽ dời ca cuối chu kỳ</Tag>}
    </Space>
  );
}

/** Danh sách ca đăng ký đang chờ duyệt (DRAFT) — HR duyệt để ca có hiệu lực chấm công. */
export function ScheduleShiftRegistrationsPane({ branchOptions, onDetail }: { branchOptions: { value: string; label: string }[]; onDetail: (t: ScheduleDetailTarget) => void }) {
  const qc = useQueryClient(), { message } = App.useApp();
  const canPublish = useCan()('schedule.publish', 'schedule.propose');
  const [searchInput, setSearchInput] = useState(''), debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchId, setBranchId] = useState('ALL'), [source, setSource] = useState('ALL'), [page, setPage] = useState(1), [perPage, setPerPage] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);

  const params = new URLSearchParams({ status: 'DRAFT', page: String(page), per_page: String(perPage), sort_by: 'workDate', sort_order: 'asc' });
  if (debouncedQ) params.set('q', debouncedQ);
  if (branchId !== 'ALL') params.set('branch_id', branchId);
  const q = useQuery({ queryKey: ['shift-registrations', params.toString()], queryFn: () => api.list<RowRec>(`/admin/schedules?${params.toString()}`) });
  const rows = (q.data?.data ?? []).filter((r) => source === 'ALL' || (source === 'PROBATION_EXTRA' ? r.source === 'PROBATION_EXTRA' : r.source !== 'PROBATION_EXTRA'));
  const refresh = () => RELATED_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const actMut = useMutation({
    mutationFn: async ({ action, items }: { action: 'PUBLISH' | 'DELETE'; items: RowRec[] }) => {
      if (items.length === 0) throw new Error('Không có ca đăng ký nào ở trạng thái chờ duyệt');
      if (items.length === 1) setBusyId(String(items[0]!.id));
      await api.post('/admin/schedules/bulk-action', { action, items: items.map((r) => ({ id: r.id, version: r.version })) });
      return { action, count: items.length, hasLinked: items.some((r) => Boolean(r.linkedAssignmentId)) };
    },
    onSuccess: ({ action, count, hasLinked }) => {
      message.success(action === 'PUBLISH' ? `Đã duyệt ${count} ca đăng ký${hasLinked ? ' và dời ca cuối chu kỳ thử việc tương ứng' : ''}` : `Đã từ chối ${count} ca đăng ký`);
      refresh();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Xử lý ca đăng ký thất bại'),
    onSettled: () => setBusyId(null),
  });

  return (
    <>
      <WorkflowSubFilterBar
        searchInput={searchInput} onSearchChange={(v) => { setSearchInput(v); setPage(1); }} searchPlaceholder="Tìm tên nhân sự, mã NV, ngày, ghi chú..."
        branchValue={branchId} branchOptions={branchOptions} onBranchChange={(v) => { setBranchId(v); setPage(1); }}
        statusValue={source} statusOptions={SOURCE_OPTS} onStatusChange={setSource}
        refreshing={q.isFetching && !q.isLoading} onRefresh={refresh} onExport={() => exportMyShiftsExcel(rows)}
      />
      <SelectableTable<RowRec>
        size="small" rowKey="id" loading={q.isLoading} dataSource={rows} scroll={{ x: 1050 }} onRowClick={(r) => onDetail({ kind: 'shift', record: r })}
        pagination={{ current: page, pageSize: perPage, total: q.data?.meta.pagination.total ?? 0, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: (t) => `Tổng ${t} ca chờ duyệt`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        bulkActions={[
          ...(canPublish ? [
            { key: 'publish', label: 'Duyệt ca đã chọn', type: 'primary' as const, icon: <CheckCircleOutlined />, loading: actMut.isPending, eligibleFilter: (r: RowRec) => r.status === 'DRAFT', onClick: (sel: RowRec[]) => actMut.mutate({ action: 'PUBLISH', items: sel }) },
            { key: 'reject', label: 'Từ chối đã chọn', danger: true, icon: <CloseCircleOutlined />, loading: actMut.isPending, confirm: 'Từ chối và xóa các ca đăng ký đã chọn?', eligibleFilter: (r: RowRec) => r.status === 'DRAFT', onClick: (sel: RowRec[]) => actMut.mutate({ action: 'DELETE', items: sel }) },
          ] : []),
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel: RowRec[]) => exportMyShiftsExcel(sel) },
        ]}
        columns={[
          { title: 'Nhân sự', width: 220, ellipsis: true, render: (_, r) => <span><strong>{String(r.employeeName || '')}</strong> <span style={{ color: '#64748B' }}>({String(r.employeeCode || '')})</span></span> },
          { title: 'Ngày làm việc', dataIndex: 'workDate', width: 120, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
          { title: 'Khung ca & Giờ ca', width: 240, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shiftCode)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
          { title: 'Nguồn đăng ký', width: 240, render: (_, r) => renderProbationExtraTags(r) ?? <span style={{ color: '#64748B' }}>{String(r.employeeStageLabel || 'Đăng ký ca')}</span> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 160, ellipsis: true },
          { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons detailTooltip="Xem chi tiết ca đăng ký" onViewDetail={() => onDetail({ kind: 'shift', record: r })} loading={busyId === String(r.id)}
                menuItems={canPublish && r.status === 'DRAFT' ? [
                  { key: 'publish', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: r.linkedAssignmentId ? 'Duyệt ca & dời ca cuối chu kỳ' : 'Duyệt ca đăng ký', onClick: () => actMut.mutate({ action: 'PUBLISH', items: [r] }) },
                  { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối ca đăng ký', onClick: () => actMut.mutate({ action: 'DELETE', items: [r] }) },
                ] : []}
              />
            ),
          },
        ]}
      />
    </>
  );
}
