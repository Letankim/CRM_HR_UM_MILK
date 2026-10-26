'use client';

import { App, Button, Card, Flex, Input, Select, Space, Table, Tabs, Tag, Tooltip } from 'antd';
import { AlertOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, EyeOutlined, FileAddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { AttendanceEventsTable, groupAttendanceEventsByShift, type AttendanceEventRow } from './AttendanceEventsTable';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { ScheduleWorkflowModals } from './ScheduleWorkflowModals';

interface Props { employees: { value: string; label: string }[]; assignments: { id: string; employeeId: string; employeeName: string; workDate: string; shiftCode: string; shiftLabel: string }[] }
const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtShiftTime = (r: Record<string, unknown>) => `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${r.scheduledHours || r.scheduled_hours}h)` : ''}`;
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');

export function ScheduleWorkflowsTabs({ employees, assignments }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canApproveLeave = usePermissionGuard({ perms: ['leave.approve'] });
  const canApproveSwap = usePermissionGuard({ perms: ['swap.approve'] });
  const canHandleEmg = usePermissionGuard({ perms: ['emergency.handle'] });
  const [leaveModal, setLeaveModal] = useState(false);
  const [swapModal, setSwapModal] = useState(false);
  const [emgModal, setEmgModal] = useState(false);
  const [adjModal, setAdjModal] = useState(false);
  const [detailTarget, setDetailTarget] = useState<ScheduleDetailTarget | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50') });
  const leavesQ = useQuery({ queryKey: ['leave-requests'], queryFn: () => api.list<Record<string, unknown>>('/admin/leave-requests?per_page=50') });
  const swapsQ = useQuery({ queryKey: ['shift-swaps'], queryFn: () => api.list<Record<string, unknown>>('/admin/shift-swaps?per_page=50') });
  const emgQ = useQuery({ queryKey: ['emergency-leaves'], queryFn: () => api.get<Record<string, unknown>[]>('/admin/emergency-leaves') });
  const attQ = useQuery({ queryKey: ['attendance-all'], queryFn: () => api.get<{ events: AttendanceEventRow[]; adjustments: Record<string, unknown>[] }>('/admin/attendance') });

  const refreshAll = () => ['leave-requests', 'shift-swaps', 'emergency-leaves', 'attendance-all', 'schedules', 'my-attendance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const isRefreshing = leavesQ.isFetching || swapsQ.isFetching || emgQ.isFetching || attQ.isFetching;

  const actMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => { message.success('Đã thực hiện thao tác thành công'); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = useMemo(() => branchList.length === 1 ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))], [branchList]);
  const matchRow = (r: Record<string, unknown>) => {
    if (branchFilter !== 'ALL' && r.branch_id !== branchFilter && r.branchId !== branchFilter && r.branchName !== branchFilter) return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    const q = debouncedQ.trim().toLowerCase();
    if (!q) return true;
    const hay = `${r.employeeName || ''} ${r.employeeCode || ''} ${r.requesterName || ''} ${r.peerName || ''} ${r.adjustment_code || ''} ${r.request_code || ''} ${r.swap_code || ''} ${r.emergency_code || ''} ${r.reason || ''} ${r.work_date || ''} ${r.leave_date || ''}`.toLowerCase();
    return hay.includes(q);
  };

  const filteredAdjustments = useMemo(() => (attQ.data?.adjustments ?? []).filter(matchRow), [attQ.data?.adjustments, branchFilter, statusFilter, debouncedQ]);
  const filteredLeaves = useMemo(() => (leavesQ.data?.data ?? []).filter(matchRow), [leavesQ.data?.data, branchFilter, statusFilter, debouncedQ]);
  const filteredSwaps = useMemo(() => (swapsQ.data?.data ?? []).filter(matchRow), [swapsQ.data?.data, branchFilter, statusFilter, debouncedQ]);
  const filteredEmg = useMemo(() => (emgQ.data ?? []).filter(matchRow), [emgQ.data, branchFilter, statusFilter, debouncedQ]);

  const renderSubFilterBar = (actionBtn: React.ReactNode) => (
    <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '14px 16px', marginTop: 4, marginBottom: 16 }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Space size={10} wrap>
          <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên nhân sự, mã đơn, ngày, lý do..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 250 }} />
          <Select value={branchFilter} onChange={setBranchFilter} style={{ width: 200 }} options={branchOptions} />
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 175 }} options={[{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'STORE_CONFIRMED', label: 'CH đã xác nhận' }, { value: 'APPROVED', label: 'Đã phê duyệt' }, { value: 'REJECTED', label: 'Đã từ chối' }]} />
        </Space>
        <Space size={10} wrap>
          <Button icon={<ReloadOutlined />} loading={isRefreshing} onClick={refreshAll}>Làm mới</Button>
          {actionBtn}
        </Space>
      </Flex>
    </div>
  );

  return (
    <Card size="small" styles={{ body: { padding: '12px 20px 20px' } }}>
      <Tabs
        items={[
          {
            key: 'attendance',
            label: <span><EnvironmentOutlined /> Lịch sử Điểm danh Vào/Ra ca ({groupAttendanceEventsByShift(attQ.data?.events ?? []).length})</span>,
            children: <AttendanceEventsTable events={attQ.data?.events ?? []} assignments={assignments as unknown as Record<string, unknown>[]} loading={attQ.isLoading} />,
          },
          {
            key: 'adjustments',
            label: <span><FileAddOutlined /> Phiếu bổ sung công ({filteredAdjustments.length})</span>,
            children: (
              <>
                {renderSubFilterBar(<GuardButton type="primary" icon={<FileAddOutlined />} perms={['attendance.confirm', 'adjustment.approve']} onClick={() => setAdjModal(true)}>Tạo phiếu bổ sung công</GuardButton>)}
                <Table
                  size="small" rowKey="id" pagination={{ pageSize: 12 }} dataSource={filteredAdjustments}
                  columns={[
                    { title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 105, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', ellipsis: true, render: (_, r) => <strong>{String(r.employeeName || '')}</strong> },
                    { title: 'Ngày công', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 100, render: (v: number) => <strong>{v} giờ</strong> },
                    { title: 'Lý do giải trình', dataIndex: 'reason', ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 145, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 270, align: 'right',
                      render: (_, r) => (
                        <Space size={4}>
                          <Tooltip title="Xem chi tiết phiếu bổ sung"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'adjustment', record: r })} /></Tooltip>
                          {r.status === 'PENDING' && <GuardButton size="small" icon={<CheckCircleOutlined />} perms={['attendance.confirm']} onClick={() => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'STORE_CONFIRM', decision_reason: 'CH xác nhận có làm thực tế' } })}>CH xác nhận</GuardButton>}
                          {(r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && <GuardButton size="small" type="primary" icon={<CheckCircleOutlined />} perms={['adjustment.approve']} onClick={() => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_APPROVE', decision_reason: 'HR duyệt bổ sung công' } })}>HR duyệt</GuardButton>}
                          {(r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && <GuardButton size="small" danger icon={<CloseCircleOutlined />} perms={['adjustment.approve']} onClick={() => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_REJECT', decision_reason: 'Không đủ căn cứ bổ sung công' } })}>Từ chối</GuardButton>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'leave',
            label: <span><CalendarOutlined /> Đơn xin nghỉ phép (OFF) ({filteredLeaves.length})</span>,
            children: (
              <>
                {renderSubFilterBar(<GuardButton type="primary" icon={<PlusOutlined />} perms={['leave.approve']} onClick={() => setLeaveModal(true)}>Đăng ký nghỉ OFF</GuardButton>)}
                <Table
                  size="small" rowKey="id" pagination={{ pageSize: 12 }} dataSource={filteredLeaves}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'request_code', width: 105, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', ellipsis: true, render: (_, r) => <strong>{String(r.employeeName)} ({String(r.employeeCode)})</strong> },
                    { title: 'Ngày nghỉ', dataIndex: 'leave_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Định mức', width: 105, render: (_, r) => <Tag color="blue" style={{ margin: 0 }}>{String(r.quota_cycle_used)}/{String(r.quota_cycle_limit)} ngày</Tag> },
                    { title: 'Lý do xin nghỉ', dataIndex: 'reason', ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 210, align: 'right',
                      render: (_, r) => (
                        <Space size={4}>
                          <Tooltip title="Xem chi tiết đơn nghỉ OFF"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'leave', record: r })} /></Tooltip>
                          {r.status === 'PENDING' && canApproveLeave && <><GuardButton size="small" type="primary" icon={<CheckCircleOutlined />} perms={['leave.approve']} onClick={() => actMut.mutate({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Đảm bảo đủ định biên ca' } })}>Duyệt</GuardButton><GuardButton size="small" danger icon={<CloseCircleOutlined />} perms={['leave.approve']} onClick={() => actMut.mutate({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Ca đang thiếu định biên' } })}>Từ chối</GuardButton></>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'swap',
            label: <span><SwapOutlined /> Đơn xin đổi ca ({filteredSwaps.length})</span>,
            children: (
              <>
                {renderSubFilterBar(<GuardButton type="primary" icon={<PlusOutlined />} perms={['swap.approve']} onClick={() => setSwapModal(true)}>Tạo yêu cầu đổi ca</GuardButton>)}
                <Table
                  size="small" rowKey="id" pagination={{ pageSize: 12 }} dataSource={filteredSwaps}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'swap_code', width: 105, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Ngày ca', dataIndex: 'from_work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Người xin đổi', dataIndex: 'requesterName', ellipsis: true },
                    { title: 'Người nhận thay', dataIndex: 'peerName', ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 165, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 245, align: 'right',
                      render: (_, r) => (
                        <Space size={4}>
                          <Tooltip title="Xem chi tiết yêu cầu đổi ca"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'swap', record: r })} /></Tooltip>
                          {canApproveSwap && r.status === 'PENDING_PEER' && <GuardButton size="small" icon={<CheckCircleOutlined />} perms={['swap.approve']} onClick={() => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/peer-respond`, body: { version: r.version, accept: true, peer_note: 'Đồng ý nhận ca thay' } })}>Đồng nghiệp nhận</GuardButton>}
                          {canApproveSwap && r.status === 'PEER_ACCEPTED' && <><GuardButton size="small" type="primary" icon={<CheckCircleOutlined />} perms={['swap.approve']} onClick={() => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Hợp lệ, duyệt đổi ca' } })}>Duyệt đổi ca</GuardButton><GuardButton size="small" danger icon={<CloseCircleOutlined />} perms={['swap.approve']} onClick={() => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Không đạt yêu cầu vị trí' } })}>Từ chối</GuardButton></>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'emergency',
            label: <span><AlertOutlined /> Báo nghỉ đột xuất ({filteredEmg.length})</span>,
            children: (
              <>
                {renderSubFilterBar(<GuardButton danger icon={<AlertOutlined />} perms={['emergency.handle']} onClick={() => setEmgModal(true)}>Báo nghỉ khẩn</GuardButton>)}
                <Table
                  size="small" rowKey="id" pagination={{ pageSize: 12 }} dataSource={filteredEmg}
                  columns={[
                    { title: 'Mã báo cáo', dataIndex: 'emergency_code', width: 110, render: (v: string) => <Tag color="volcano" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', dataIndex: 'employeeName', ellipsis: true },
                    { title: 'Ngày ca', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Lý do khẩn cấp', dataIndex: 'reason', ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Điều phối', width: 270, align: 'right',
                      render: (_, r) => (
                        <Space size={4}>
                          <Tooltip title="Xem chi tiết báo nghỉ khẩn"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'emergency', record: r })} /></Tooltip>
                          {r.status === 'REPORTED' && canHandleEmg ? <><GuardButton size="small" type="primary" icon={<CheckCircleOutlined />} perms={['emergency.handle']} onClick={() => actMut.mutate({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'RESOLVE', resolution_note: 'Cửa hàng đã bố trí nhân sự thay ca' } })}>Đã có người thay</GuardButton><GuardButton size="small" danger icon={<AlertOutlined />} perms={['emergency.handle']} onClick={() => actMut.mutate({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'ESCALATE', resolution_note: 'Không có người thay, chuyển cảnh báo lên HR' } })}>Báo thiếu ca</GuardButton></> : <Tag color={r.status === 'RESOLVED' ? 'green' : 'red'} style={{ margin: 0 }}>{String(r.shift_coverage_status || (r.status === 'RESOLVED' ? 'Đã phủ ca' : 'Đang theo dõi'))}</Tag>}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
      <ScheduleRequestDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />
      <ScheduleWorkflowModals employees={employees} assignments={assignments} leaveModal={leaveModal} swapModal={swapModal} emgModal={emgModal} adjModal={adjModal} onCloseLeave={() => setLeaveModal(false)} onCloseSwap={() => setSwapModal(false)} onCloseEmg={() => setEmgModal(false)} onCloseAdj={() => setAdjModal(false)} onSubmitAction={(url, body) => actMut.mutate({ url, body })} />
    </Card>
  );
}
