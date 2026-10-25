'use client';

import { useMemo, useState } from 'react';
import { App, Button, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { DEFAULT_SHIFT_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { exportToExcel } from '@/lib/export-excel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { BRAND } from '../theme';
import { AttendanceEventDetailModal, AttendanceEventEditModal } from './AttendanceEventDetailModal';
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

export function groupAttendanceEventsByShift(events: AttendanceEventRow[]): AttendanceEventRow[] {
  const map = new Map<string, { inEv: AttendanceEventRow | null; outEv: AttendanceEventRow | null }>();
    for (const ev of events) {
      const key = ev.assignment_id ? `asg_${ev.assignment_id}` : `emp_${ev.employeeId || ev.employeeCode || ev.employeeName || ''}_${ev.work_date || ''}_${ev.shift_code || ''}`;
      const cur = map.get(key) ?? { inEv: null, outEv: null };
      if (ev.type === 'CHECK_OUT') { if (!cur.outEv) cur.outEv = ev; }
      else if (!cur.inEv) { cur.inEv = ev; }
      map.set(key, cur);
    }
  const result: AttendanceEventRow[] = [];
  for (const [, { inEv, outEv }] of map.entries()) {
    const base = inEv ?? outEv;
    if (!base) continue;
    result.push({ ...base, id: inEv?.id ?? outEv!.id, checkInEvent: inEv, checkOutEvent: outEv });
  }
  return result;
}

export function exportAttendanceEventsExcel(rows: AttendanceEventRow[]) {
  const grouped = groupAttendanceEventsByShift(rows);
  exportToExcel({
    fileName: `Lich_Su_Diem_Danh_UmBoMilk_${dayjs().format('YYYYMMDD_HHmm')}.xls`,
    sheetTitle: 'Danh Sách Điểm Danh Vào Ca & Ra Ca (GPS & Camera)',
    columns: [
      { header: 'Nhân sự', key: 'employeeName' },
      { header: 'Chi nhánh', key: 'branchName' },
      { header: 'Ngày làm việc', key: 'work_date' },
      { header: 'Ca làm việc', key: 'shiftLabel' },
      { header: 'Khung giờ quy định', key: 'shiftTimeRange' },
      { header: 'Giờ Vào ca', key: 'checkInTime' },
      { header: 'Đánh giá Vào ca', key: 'checkInPunctuality' },
      { header: 'Giờ Ra ca', key: 'checkOutTime' },
      { header: 'Đánh giá Ra ca', key: 'checkOutPunctuality' },
      { header: 'Khoảng cách GPS (m)', key: 'distance_m', align: 'right' },
    ],
    rows: grouped.map((r) => ({
      ...r,
      checkInTime: r.checkInEvent?.checkTimeHm || '—',
      checkInPunctuality: r.checkInEvent?.punctualityLabel || 'Chưa vào ca',
      checkOutTime: r.checkOutEvent?.checkTimeHm || '—',
      checkOutPunctuality: r.checkOutEvent?.punctualityLabel || 'Chưa ra ca',
    })),
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
            <Tag color={inEv.punctualityStatus === 'LATE' ? 'volcano' : 'green'} icon={inEv.punctualityStatus === 'LATE' ? <ClockCircleOutlined /> : <CheckCircleOutlined />} style={{ margin: 0 }}>
              {inEv.punctualityLabel || 'Vào đúng giờ'}
            </Tag>
          </>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chưa vào ca</Typography.Text>
        )}
      </Space>
      <Space size={6} wrap>
        <Tag color="purple" style={{ margin: 0, minWidth: 54, textAlign: 'center' }}>Ra ca</Tag>
        {outEv ? (
          <>
            <span className="num" style={{ fontWeight: 600 }}>{outEv.checkTimeHm || String(outEv.checkTimeFormatted || '').slice(0, 5)}</span>
            <Tag color={outEv.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} icon={outEv.punctualityStatus === 'EARLY_LEAVE' ? <ClockCircleOutlined /> : <CheckCircleOutlined />} style={{ margin: 0 }}>
              {outEv.punctualityLabel || 'Ra đúng giờ'}
            </Tag>
          </>
        ) : (
          <Tag color="default" style={{ margin: 0 }}>Chưa ra ca</Tag>
        )}
      </Space>
    </Space>
  );
}

interface Props {
  events: AttendanceEventRow[];
  assignments?: Record<string, unknown>[];
  loading?: boolean;
}

export function AttendanceEventsTable({ events, loading }: Props) {
  const qc = useQueryClient();
  const can = useCan();
  const canManageEvents = can('system.config');
  const { message, modal } = App.useApp();
  const [detailRow, setDetailRow] = useState<AttendanceEventRow | null>(null);
  const [editRow, setEditRow] = useState<AttendanceEventRow | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');

  const branchesQ = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'),
  });

  const allGrouped = useMemo(() => groupAttendanceEventsByShift(events), [events]);

  const filteredRows = useMemo(() => {
    const qLower = debouncedQ.trim().toLowerCase();
    return allGrouped.filter((r) => {
      if (branchFilter !== 'ALL' && r.branch_id !== branchFilter && r.branchName !== branchFilter) return false;
      if (shiftFilter !== 'ALL' && r.shift_code !== shiftFilter) return false;
      if (stateFilter === 'COMPLETED' && (!r.checkInEvent || !r.checkOutEvent)) return false;
      if (stateFilter === 'IN_PROGRESS' && (!r.checkInEvent || Boolean(r.checkOutEvent))) return false;
      if (stateFilter === 'LATE_EARLY' && r.checkInEvent?.punctualityStatus !== 'LATE' && r.checkOutEvent?.punctualityStatus !== 'EARLY_LEAVE') return false;
      if (qLower) {
        const hay = `${r.employeeName || ''} ${r.employeeCode || ''} ${r.branchName || ''} ${r.work_date || ''} ${r.shiftLabel || ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [allGrouped, branchFilter, shiftFilter, stateFilter, debouncedQ]);

  const refreshAttendance = () => {
    ['attendance-all', 'nv-attendance', 'my-attendance', 'schedules', 'nv-schedules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const deleteMut = useMutation({
    mutationFn: async (r: AttendanceEventRow) => {
      const targets = [r.checkInEvent, r.checkOutEvent].filter((x): x is AttendanceEventRow => Boolean(x));
      if (targets.length === 0) targets.push(r);
      for (const t of targets) {
        await api.delete(`/admin/attendance/events/${t.id}`, { version: t.version ?? 1 });
      }
    },
    onSuccess: () => { message.success('Đã xóa bản ghi điểm danh của ca làm việc'); refreshAttendance(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa thất bại'),
  });

  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = useMemo(
    () => branchList.length === 1 ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))],
    [branchList],
  );
  const completedCount = filteredRows.filter((r) => r.checkInEvent && r.checkOutEvent).length;
  const inProgressCount = filteredRows.filter((r) => r.checkInEvent && !r.checkOutEvent).length;

  return (
    <>
      <div style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: '14px 16px', marginTop: 4, marginBottom: 16 }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space size={10} wrap>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên nhân sự, mã NV, ngày..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 240 }} />
            <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 195 }} options={branchOptions} />
            <Select value={shiftFilter} onChange={setShiftFilter} style={{ width: 155 }} options={[{ value: 'ALL', label: 'Tất cả khung ca' }, ...DEFAULT_SHIFT_OPTIONS]} />
            <Select value={stateFilter} onChange={setStateFilter} style={{ width: 175 }} options={[{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'COMPLETED', label: 'Hoàn thành Vào & Ra ca' }, { value: 'IN_PROGRESS', label: 'Đang trong ca (Chưa ra)' }, { value: 'LATE_EARLY', label: 'Vào trễ / Ra sớm' }]} />
          </Space>
          <Space size={10} wrap>
            <Tag color="blue" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Tổng: {filteredRows.length} ca</Tag>
            <Tag color="green" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Hoàn thành: {completedCount}</Tag>
            {inProgressCount > 0 && <Tag color="gold" style={{ margin: 0, padding: '3px 10px', fontSize: 12 }}>Đang trong ca: {inProgressCount}</Tag>}
            <Button icon={<ReloadOutlined />} onClick={refreshAttendance}>Làm mới</Button>
            <Button icon={<DownloadOutlined />} onClick={() => exportAttendanceEventsExcel(filteredRows)}>Xuất Excel</Button>
          </Space>
        </Flex>
      </div>
      <Table<AttendanceEventRow>
        size="small" rowKey="id" loading={loading} pagination={{ pageSize: 15, showSizeChanger: false }}
        dataSource={filteredRows} locale={{ emptyText: 'Chưa có dữ liệu điểm danh Vào ca / Ra ca phù hợp bộ lọc.' }}
        columns={[
          { title: 'Nhân sự điểm danh', width: 205, render: (_, r) => <div><Typography.Text strong>{r.employeeName}</Typography.Text>{r.branchName && <div style={{ fontSize: 11, color: BRAND.textSecondary }}>{r.branchName}</div>}</div> },
          { title: 'Ngày & Khung ca', width: 185, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{r.shiftLabel || 'Ca làm việc'} ({r.shiftTimeRange || '07:00 – 12:00'})</div><div className="num" style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày: {r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '—'}</div></div> },
          { title: 'Vào ca / Ra ca', render: (_, r) => renderShiftCheckInOutSummary(r) },
          {
            title: 'Thao tác', width: 90, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết điểm danh Vào/Ra ca"
                onViewDetail={() => setDetailRow(r)}
                menuItems={canManageEvents ? [
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa điểm danh', onClick: () => setEditRow(r) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa bản ghi điểm danh', onClick: () => modal.confirm({ title: `Xác nhận xóa điểm danh ca của ${r.employeeName}?`, content: `Toàn bộ lượt Vào ca / Ra ca thuộc ${r.shiftLabel} ngày ${r.work_date} sẽ bị xóa.`, okText: 'Xác nhận xóa', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelText: 'Hủy bỏ', cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => deleteMut.mutateAsync(r) }) },
                ] : []}
              />
            ),
          },
        ]}
      />
      <AttendanceEventDetailModal event={detailRow} onClose={() => setDetailRow(null)} />
      <AttendanceEventEditModal event={editRow} onClose={() => setEditRow(null)} onSuccess={refreshAttendance} />
    </>
  );
}
