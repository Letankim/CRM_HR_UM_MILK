'use client';

import { useEffect, useMemo, useState } from 'react';
import { App, Button, Flex, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { BRAND } from '../theme';
import { AttendanceEventDetailModal, AttendanceEventEditModal } from './AttendanceEventDetailModal';
import { SelectableTable } from './BulkActionBar';
import { RowActionButtons } from './RowActionButtons';

export interface AttendanceEventRow {
  id: string; version?: number; assignment_id?: string; employeeId?: string; employeeCode?: string; employeeName?: string;
  branch_id?: string; branchName?: string; branchLat?: number | null; branchLng?: number | null; branchRadiusM?: number;
  work_date?: string; shift_code?: string; type?: 'CHECK_IN' | 'CHECK_OUT'; kindLabel?: string;
  shiftLabel?: string; shiftTimeRange?: string; checkTimeHm?: string; checkTimeFormatted?: string;
  punctualityStatus?: 'ON_TIME' | 'LATE' | 'EARLY_LEAVE'; punctualityLabel?: string;
  distance_m?: number; lat?: number; lng?: number; device_info?: string; photoUrl?: string;
  photo_drive_file_id?: string; photo_sha256?: string; note?: string;
  checkInEvent?: AttendanceEventRow | null; checkOutEvent?: AttendanceEventRow | null;
}

export const ATTENDANCE_SESSION_STATUS_OPTIONS = [
  { value: 'COMPLETED', label: 'Hoàn thành Vào & Ra ca' },
  { value: 'IN_PROGRESS', label: 'Đang trong ca (Chưa ra)' },
  { value: 'LATE_EARLY', label: 'Vào trễ / Ra sớm' },
];

export function groupAttendanceEventsByShift(events: AttendanceEventRow[]): AttendanceEventRow[] {
  const map = new Map<string, { inEv: AttendanceEventRow | null; outEv: AttendanceEventRow | null }>();
  for (const ev of events) {
    if (ev.checkInEvent !== undefined || ev.checkOutEvent !== undefined) {
      map.set(`ses_${ev.id}`, { inEv: ev.checkInEvent ?? null, outEv: ev.checkOutEvent ?? null });
      continue;
    }
    const key = ev.assignment_id ? `asg_${ev.assignment_id}` : `emp_${ev.employeeId || ev.employeeCode || ev.employeeName || ''}_${ev.work_date || ''}_${ev.shift_code || ''}`;
    const cur = map.get(key) ?? { inEv: null, outEv: null };
    if (ev.type === 'CHECK_OUT') { if (!cur.outEv) cur.outEv = ev; }
    else if (!cur.inEv) { cur.inEv = ev; }
    map.set(key, cur);
  }
  const result: AttendanceEventRow[] = [];
  for (const [, { inEv, outEv }] of map.entries()) {
    const base = inEv ?? outEv;
    if (base) result.push({ ...base, id: inEv?.id ?? outEv!.id, checkInEvent: inEv, checkOutEvent: outEv });
  }
  return result;
}

export function exportAttendanceEventsExcel(rows: AttendanceEventRow[]) {
  const grouped = groupAttendanceEventsByShift(rows);
  exportToExcel({
    fileName: `Lich_Su_Diem_Danh_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Danh Sách Điểm Danh Vào Ca & Ra Ca (GPS & Camera)',
    columns: [
      { header: 'Nhân sự', key: 'employeeName' }, { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Ngày làm việc', key: 'work_date' }, { header: 'Ca làm việc', key: 'shiftLabel' },
      { header: 'Khung giờ quy định', key: 'shiftTimeRange' }, { header: 'Giờ Vào ca', key: 'checkInTime' },
      { header: 'Đánh giá Vào ca', key: 'checkInPunctuality' }, { header: 'Giờ Ra ca', key: 'checkOutTime' },
      { header: 'Đánh giá Ra ca', key: 'checkOutPunctuality' }, { header: 'Khoảng cách GPS (m)', key: 'distance_m', align: 'right' },
    ],
    rows: grouped.map((r) => ({ ...r, checkInTime: r.checkInEvent?.checkTimeHm || '—', checkInPunctuality: r.checkInEvent?.punctualityLabel || 'Chưa vào ca', checkOutTime: r.checkOutEvent?.checkTimeHm || '—', checkOutPunctuality: r.checkOutEvent?.punctualityLabel || 'Chưa ra ca' })),
  });
}

export function renderShiftCheckInOutSummary(r: AttendanceEventRow) {
  const inEv = r.checkInEvent ?? (r.type === 'CHECK_IN' ? r : null);
  const outEv = r.checkOutEvent ?? (r.type === 'CHECK_OUT' ? r : null);
  return (
    <Space direction="vertical" size={4}>
      <Space size={6} wrap>
        <Tag color="blue" style={{ margin: 0, minWidth: 54, textAlign: 'center' }}>Vào ca</Tag>
        {inEv ? (
          <>
            <span className="num" style={{ fontWeight: 600 }}>{inEv.checkTimeHm || String(inEv.checkTimeFormatted || '').slice(0, 5)}</span>
            <Tag color={inEv.punctualityStatus === 'LATE' ? 'volcano' : 'green'} icon={inEv.punctualityStatus === 'LATE' ? <ClockCircleOutlined /> : <CheckCircleOutlined />} style={{ margin: 0 }}>{inEv.punctualityLabel || 'Vào đúng giờ'}</Tag>
          </>
        ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa vào ca</Typography.Text>}
      </Space>
      <Space size={6} wrap>
        <Tag color="purple" style={{ margin: 0, minWidth: 54, textAlign: 'center' }}>Ra ca</Tag>
        {outEv ? (
          <>
            <span className="num" style={{ fontWeight: 600 }}>{outEv.checkTimeHm || String(outEv.checkTimeFormatted || '').slice(0, 5)}</span>
            <Tag color={outEv.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} icon={outEv.punctualityStatus === 'EARLY_LEAVE' ? <ClockCircleOutlined /> : <CheckCircleOutlined />} style={{ margin: 0 }}>{outEv.punctualityLabel || 'Ra đúng giờ'}</Tag>
          </>
        ) : <Tag color="default" style={{ margin: 0 }}>Chưa ra ca</Tag>}
      </Space>
    </Space>
  );
}

interface Props { events?: AttendanceEventRow[]; assignments?: Record<string, unknown>[]; loading?: boolean; externalFilters?: { q: string; branchId: string; shiftCode: string; status: string } }

export function AttendanceEventsTable({ externalFilters }: Props) {
  const qc = useQueryClient(), can = useCan(), canManageEvents = can('system.config'), { message, modal } = App.useApp();
  const [detailRow, setDetailRow] = useState<AttendanceEventRow | null>(null), [editRow, setEditRow] = useState<AttendanceEventRow | null>(null);
  const [searchInput, setSearchInput] = useState(''), debouncedLocalQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL'), [shiftFilter, setShiftFilter] = useState('ALL'), [stateFilter, setStateFilter] = useState('ALL');
  const [page, setPage] = useState(1), [perPage, setPerPage] = useState(15);

  const effQ = externalFilters ? externalFilters.q : debouncedLocalQ;
  const effBranch = externalFilters ? externalFilters.branchId : branchFilter;
  const effShift = externalFilters ? externalFilters.shiftCode : shiftFilter;
  const effState = externalFilters ? externalFilters.status : stateFilter;
  const { options: shiftOptions } = useShiftTemplates(effBranch);
  useEffect(() => { setPage(1); }, [effQ, effBranch, effShift, effState]);

  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100'), enabled: !externalFilters });
  const sessionsUrl = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (effBranch && effBranch !== 'ALL') sp.set('branch_id', effBranch);
    if (effShift && effShift !== 'ALL') sp.set('shift_code', effShift);
    if (effState && effState !== 'ALL') sp.set('status', effState);
    if (effQ.trim()) sp.set('q', effQ.trim());
    return `/admin/attendance/sessions?${sp}`;
  }, [page, perPage, effBranch, effShift, effState, effQ]);

  const sessionsQ = useQuery({
    queryKey: ['attendance-sessions', effBranch, effShift, effState, effQ, page, perPage],
    queryFn: () => api.list<AttendanceEventRow>(sessionsUrl),
  });

  const refreshAttendance = () => {
    ['attendance-sessions', 'attendance-all', 'nv-attendance', 'my-attendance', 'schedules', 'nv-schedules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const deleteMut = useMutation({
    mutationFn: async (items: AttendanceEventRow[]) => {
      for (const r of items) {
        const targets = [r.checkInEvent, r.checkOutEvent].filter((x): x is AttendanceEventRow => Boolean(x));
        if (targets.length === 0) targets.push(r);
        for (const t of targets) await api.delete(`/admin/attendance/events/${t.id}`, { version: t.version ?? 1 });
      }
    },
    onSuccess: () => { message.success('Đã xóa bản ghi điểm danh của ca làm việc'); refreshAttendance(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const handleExportExcel = async () => {
    const sp = new URLSearchParams({ page: '1', per_page: '100' });
    if (effBranch && effBranch !== 'ALL') sp.set('branch_id', effBranch);
    if (effShift && effShift !== 'ALL') sp.set('shift_code', effShift);
    if (effState && effState !== 'ALL') sp.set('status', effState);
    if (effQ.trim()) sp.set('q', effQ.trim());
    const res = await api.list<AttendanceEventRow>(`/admin/attendance/sessions?${sp}`);
    exportAttendanceEventsExcel(res.data);
  };

  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = useMemo(() => branchList.length === 1 ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))], [branchList]);
  const rows = sessionsQ.data?.data ?? [];
  const totalCount = sessionsQ.data?.meta.pagination.total ?? rows.length;
  const completedCount = Number(sessionsQ.data?.meta.filters?.completed_count ?? 0);
  const inProgressCount = Number(sessionsQ.data?.meta.filters?.in_progress_count ?? 0);
  const lateEarlyCount = Number(sessionsQ.data?.meta.filters?.late_early_count ?? 0);

  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: externalFilters ? '12px 16px' : 0 }}>
      <div style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: '10px 14px', marginBottom: 12 }}>
        <Flex justify="space-between" align="center" wrap gap={10}>
          {!externalFilters ? (
            <Space size={10} wrap>
              <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên nhân sự, mã NV, ngày..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 230 }} />
              <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 190 }} options={branchOptions} />
              <Select value={shiftFilter} onChange={setShiftFilter} style={{ width: 170 }} options={[{ value: 'ALL', label: 'Tất cả khung ca' }, ...shiftOptions]} />
              <Select value={stateFilter} onChange={setStateFilter} style={{ width: 175 }} options={[{ value: 'ALL', label: 'Tất cả trạng thái' }, ...ATTENDANCE_SESSION_STATUS_OPTIONS]} />
            </Space>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>Danh sách phiên điểm danh Vào/Ra ca theo bộ lọc hiện tại:</Typography.Text>
          )}
          <Space size={8} wrap>
            <Tag color="blue" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Tổng: {totalCount} ca</Tag>
            <Tag color="green" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Hoàn thành: {completedCount}</Tag>
            {inProgressCount > 0 && <Tag color="gold" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Đang trong ca: {inProgressCount}</Tag>}
            {lateEarlyCount > 0 && <Tag color="volcano" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Vào trễ / Ra sớm: {lateEarlyCount}</Tag>}
            {!externalFilters && <Button icon={<ReloadOutlined />} loading={sessionsQ.isFetching} onClick={refreshAttendance}>Làm mới</Button>}
            {!externalFilters && <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>Xuất Excel</Button>}
          </Space>
        </Flex>
      </div>
      <SelectableTable<AttendanceEventRow>
        size="small" rowKey="id" loading={sessionsQ.isLoading || sessionsQ.isFetching}
        bulkActions={[
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (sel) => exportAttendanceEventsExcel(sel) },
          ...(canManageEvents ? [{ key: 'delete', label: 'Xóa điểm danh đã chọn', danger: true, icon: <DeleteOutlined />, loading: deleteMut.isPending, confirm: 'Xác nhận xóa các bản ghi điểm danh đã chọn?', onClick: (sel: AttendanceEventRow[]) => deleteMut.mutate(sel) }] : []),
        ]}
        pagination={{ current: page, pageSize: perPage, total: totalCount, showSizeChanger: true, pageSizeOptions: ['10', '12', '15', '20', '50', '100'], showTotal: (t) => `Tổng ${t} ca điểm danh`, onChange: (p, ps) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } }}
        dataSource={rows} locale={{ emptyText: 'Chưa có dữ liệu điểm danh Vào ca / Ra ca phù hợp bộ lọc.' }}
        columns={[
          { title: 'Nhân sự điểm danh', width: 215, render: (_, r) => <div><Typography.Text strong>{r.employeeName}</Typography.Text>{r.branchName && <div style={{ fontSize: 11, color: BRAND.textSecondary }}>{r.branchName}</div>}</div> },
          { title: 'Ngày & Khung ca', width: 195, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{r.shiftLabel || 'Ca làm việc'} ({r.shiftTimeRange || '07:00 – 12:00'})</div><div className="num" style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày: {r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '—'}</div></div> },
          { title: 'Vào ca / Ra ca', width: 340, render: (_, r) => renderShiftCheckInOutSummary(r) },
          { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết điểm danh Vào/Ra ca" onViewDetail={() => setDetailRow(r)} menuItems={canManageEvents ? [{ key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa điểm danh', onClick: () => setEditRow(r) }, { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa bản ghi điểm danh', onClick: () => modal.confirm({ title: `Xác nhận xóa điểm danh ca của ${r.employeeName}?`, content: `Toàn bộ lượt Vào ca / Ra ca thuộc ${r.shiftLabel} ngày ${r.work_date} sẽ bị xóa.`, okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => deleteMut.mutateAsync([r]) }) }] : []} /> },
        ]}
      />
      <AttendanceEventDetailModal event={detailRow} onClose={() => setDetailRow(null)} />
      <AttendanceEventEditModal event={editRow} onClose={() => setEditRow(null)} onSuccess={refreshAttendance} />
    </div>
  );
}
