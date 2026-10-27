'use client';

import { App, Button, Card, Flex, Input, Select, Space, Tabs, Tag } from 'antd';
import { AlertOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DownloadOutlined, EnvironmentOutlined, FileAddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { StatusTag } from '../StatusTag';
import { AttendanceEventsTable, type AttendanceEventRow } from './AttendanceEventsTable';
import { SelectableTable } from './BulkActionBar';
import { GuardButton, usePermissionGuard } from './GuardButton';
import { RowActionButtons } from './RowActionButtons';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { ScheduleWorkflowModals, type WorkflowAssignmentOption } from './ScheduleWorkflowModals';
import { buildAdjustmentsBulkActions, buildEmergencyBulkActions, buildLeavesBulkActions, buildSwapsBulkActions, exportAdjustmentsExcel, exportEmergencyExcel, exportLeavesExcel, exportSwapsExcel } from './workflow-bulk-helpers';

interface Props { employees: { value: string; label: string }[]; assignments: WorkflowAssignmentOption[] }
const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtShiftTime = (r: Record<string, unknown>) => `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${r.scheduledHours || r.scheduled_hours}h)` : ''}`;
const fmtDate = (raw: unknown) => (raw ? dayjs(String(raw)).format('DD/MM/YYYY') : '—');

const ADJ_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'STORE_CONFIRMED', label: 'CH đã xác nhận' }, { value: 'APPROVED', label: 'Đã phê duyệt' }, { value: 'REJECTED', label: 'Đã từ chối' }];
const LEAVE_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING', label: 'Chờ duyệt nghỉ OFF' }, { value: 'APPROVED', label: 'Đã phê duyệt nghỉ OFF' }, { value: 'REJECTED', label: 'Đã từ chối' }];
const SWAP_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'PENDING_PEER', label: 'Chờ đồng nghiệp nhận' }, { value: 'PEER_ACCEPTED', label: 'Đồng nghiệp đã nhận' }, { value: 'APPROVED', label: 'Đã phê duyệt đổi ca' }, { value: 'REJECTED', label: 'Đã từ chối' }];
const EMG_STATUS_OPTS = [{ value: 'ALL', label: 'Tất cả trạng thái' }, { value: 'REPORTED', label: 'Mới báo nghỉ khẩn' }, { value: 'RESOLVED', label: 'Đã có người thay ca' }, { value: 'ESCALATED', label: 'Thiếu ca (Cảnh báo HR)' }];

export function ScheduleWorkflowsTabs({ employees, assignments }: Props) {
  const qc = useQueryClient(), { message } = App.useApp();
  const canConfirmAtt = usePermissionGuard({ perms: ['attendance.confirm'] }), canApproveAdj = usePermissionGuard({ perms: ['adjustment.approve'] });
  const canApproveLeave = usePermissionGuard({ perms: ['leave.approve'] }), canApproveSwap = usePermissionGuard({ perms: ['swap.approve'] }), canHandleEmg = usePermissionGuard({ perms: ['emergency.handle'] });
  const [activeTab, setActiveTab] = useState('attendance'), [leaveModal, setLeaveModal] = useState(false), [swapModal, setSwapModal] = useState(false), [emgModal, setEmgModal] = useState(false), [adjModal, setAdjModal] = useState(false);
  const [detailTarget, setDetailTarget] = useState<ScheduleDetailTarget | null>(null);
  const [searchInput, setSearchInput] = useState(''), debouncedQ = useDebouncedValue(searchInput, 400);
  const [branchFilter, setBranchFilter] = useState('ALL'), [statusFilter, setStatusFilter] = useState('ALL'), [page, setPage] = useState(1), [perPage, setPerPage] = useState(10);

  const mkParams = (tabKey: string) => {
    const p = new URLSearchParams({ page: String(activeTab === tabKey ? page : 1), per_page: String(perPage) });
    if (debouncedQ) p.set('q', debouncedQ);
    if (branchFilter !== 'ALL') p.set('branch_id', branchFilter);
    if (activeTab === tabKey && statusFilter !== 'ALL') p.set('status', statusFilter);
    return p.toString();
  };

  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50') });
  const adjParams = mkParams('adjustments'), leaveParams = mkParams('leave'), swapParams = mkParams('swap'), emgParams = mkParams('emergency');
  const adjQ = useQuery({ queryKey: ['attendance-adjustments', adjParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/attendance/adjustments?${adjParams}`) });
  const leavesQ = useQuery({ queryKey: ['leave-requests', leaveParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/leave-requests?${leaveParams}`) });
  const swapsQ = useQuery({ queryKey: ['shift-swaps', swapParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/shift-swaps?${swapParams}`) });
  const emgQ = useQuery({ queryKey: ['emergency-leaves', emgParams], queryFn: () => api.list<Record<string, unknown>>(`/admin/emergency-leaves?${emgParams}`) });
  const attCountQ = useQuery({ queryKey: ['attendance-sessions-count', branchFilter], queryFn: () => api.list<AttendanceEventRow>(`/admin/attendance/sessions?page=1&per_page=1${branchFilter !== 'ALL' ? `&branch_id=${branchFilter}` : ''}`) });

  const refreshAll = () => ['attendance-adjustments', 'leave-requests', 'shift-swaps', 'emergency-leaves', 'attendance-sessions', 'attendance-sessions-count', 'schedules', 'my-attendance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const isRefreshing = adjQ.isFetching || leavesQ.isFetching || swapsQ.isFetching || emgQ.isFetching || attCountQ.isFetching;
  const actMut = useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body), onSuccess: () => { message.success('Đã thực hiện thao tác thành công'); setPage(1); refreshAll(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại') });
  const batchMut = useMutation({
    mutationFn: async ({ items, buildCall, successMsg }: { items: Record<string, unknown>[]; buildCall: (r: Record<string, unknown>) => { url: string; body: unknown } | null; successMsg: string }) => {
      if (items.length === 0) throw new Error('Không có bản ghi nào ở trạng thái hợp lệ để thực hiện thao tác này');
      for (const r of items) { const c = buildCall(r); if (c) await api.post(c.url, c.body); }
      return successMsg;
    },
    onSuccess: (msg) => { message.success(msg); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Thao tác hàng loạt thất bại'),
  });
  const bulkOpts = { canConfirmAtt, canApproveAdj, canApproveLeave, canApproveSwap, canHandleEmg, loading: batchMut.isPending, runBatch: (items: Record<string, unknown>[], buildCall: (r: Record<string, unknown>) => { url: string; body: unknown } | null, successMsg: string) => batchMut.mutate({ items, buildCall, successMsg }) };

  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = branchList.length === 1 ? [{ value: 'ALL', label: `${branchList[0]!.code} — ${branchList[0]!.name}` }] : [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))];
  const filteredAdjustments = adjQ.data?.data ?? [], filteredLeaves = leavesQ.data?.data ?? [], filteredSwaps = swapsQ.data?.data ?? [], filteredEmg = emgQ.data?.data ?? [];
  const mkPag = (total?: number) => ({ current: page, pageSize: perPage, total: total ?? 0, showSizeChanger: true, pageSizeOptions: ['10', '12', '20', '50', '100'], showTotal: (t: number) => `Tổng ${t} đơn`, onChange: (p: number, ps: number) => { setPage(ps !== perPage ? 1 : p); setPerPage(ps); } });

  const renderSubFilterBar = (statusOpts: { value: string; label: string }[], onExport: () => void, actionBtn: React.ReactNode) => (
    <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginTop: 4, marginBottom: 12 }}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space size={10} wrap>
          <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên nhân sự, mã đơn, ngày, lý do..." value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} style={{ width: 245 }} />
          <Select value={branchFilter} onChange={(v) => { setBranchFilter(v); setPage(1); }} style={{ width: 195 }} options={branchOptions} />
          <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} style={{ width: 195 }} options={statusOpts} />
        </Space>
        <Space size={8} wrap><Button icon={<ReloadOutlined />} loading={isRefreshing} onClick={refreshAll}>Làm mới</Button><Button icon={<DownloadOutlined />} onClick={onExport}>Xuất Excel</Button>{actionBtn}</Space>
      </Flex>
    </div>
  );

  return (
    <Card size="small" styles={{ body: { padding: '12px 20px 20px' } }}>
      <Tabs activeKey={activeTab} onChange={(k) => { setActiveTab(k); setStatusFilter('ALL'); setPage(1); }} items={[
          { key: 'attendance', label: <span><EnvironmentOutlined /> Lịch sử Điểm danh Vào/Ra ca ({attCountQ.data?.meta.pagination.total ?? 0})</span>, children: <AttendanceEventsTable assignments={assignments as unknown as Record<string, unknown>[]} /> },
          {
            key: 'adjustments',
            label: <span><FileAddOutlined /> Phiếu bổ sung công ({adjQ.data?.meta.pagination.total ?? filteredAdjustments.length})</span>,
            children: (
              <>
                {renderSubFilterBar(ADJ_STATUS_OPTS, () => exportAdjustmentsExcel(filteredAdjustments), <GuardButton type="primary" icon={<FileAddOutlined />} perms={['attendance.confirm', 'adjustment.approve']} onClick={() => setAdjModal(true)}>Tạo phiếu bổ sung công</GuardButton>)}
                <SelectableTable<Record<string, unknown>>
                  size="small" rowKey="id" loading={adjQ.isLoading} pagination={mkPag(adjQ.data?.meta.pagination.total)} dataSource={filteredAdjustments} bulkActions={buildAdjustmentsBulkActions(bulkOpts)}
                  columns={[
                    { title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 115, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', width: 205, ellipsis: true, render: (_, r) => <strong>{String(r.employeeName || '')}</strong> },
                    { title: 'Ngày công', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 115, render: (v: number) => <strong>{v} giờ</strong> },
                    { title: 'Trạng thái', dataIndex: 'status', width: 165, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
                      render: (_, r) => (
                        <RowActionButtons
                          detailTooltip="Xem chi tiết phiếu bổ sung công" onViewDetail={() => setDetailTarget({ kind: 'adjustment', record: r })} loading={actMut.isPending}
                          menuItems={[
                            ...(r.status === 'PENDING' && canConfirmAtt ? [{ key: 'store-confirm', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Cửa hàng xác nhận thực tế', onClick: () => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'STORE_CONFIRM', decision_reason: 'CH xác nhận có làm thực tế' } }) }] : []),
                            ...((r.status === 'PENDING' || r.status === 'STORE_CONFIRMED') && canApproveAdj ? [{ key: 'hr-approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'HR phê duyệt bổ sung công', onClick: () => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_APPROVE', decision_reason: 'HR duyệt bổ sung công' } }) }, { key: 'hr-reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối phiếu bổ sung công', onClick: () => actMut.mutate({ url: `/admin/attendance/adjustments/${r.id}/decide`, body: { version: r.version, action: 'HR_REJECT', decision_reason: 'Không đủ căn cứ bổ sung công' } }) }] : []),
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'leave',
            label: <span><CalendarOutlined /> Đơn xin nghỉ phép (OFF) ({leavesQ.data?.meta.pagination.total ?? filteredLeaves.length})</span>,
            children: (
              <>
                {renderSubFilterBar(LEAVE_STATUS_OPTS, () => exportLeavesExcel(filteredLeaves), <GuardButton type="primary" icon={<PlusOutlined />} perms={['leave.approve']} onClick={() => setLeaveModal(true)}>Đăng ký nghỉ OFF</GuardButton>)}
                <SelectableTable<Record<string, unknown>>
                  size="small" rowKey="id" loading={leavesQ.isLoading} pagination={mkPag(leavesQ.data?.meta.pagination.total)} dataSource={filteredLeaves} bulkActions={buildLeavesBulkActions(bulkOpts)}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'request_code', width: 110, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', width: 215, ellipsis: true, render: (_, r) => <strong>{String(r.employeeName)} ({String(r.employeeCode)})</strong> },
                    { title: 'Ngày nghỉ', dataIndex: 'leave_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Định mức & Định biên', width: 175, render: (_, r) => <Space size={4} wrap><Tag color="blue" style={{ margin: 0 }}>{String(r.quota_cycle_used)}/{String(r.quota_cycle_limit)} ngày</Tag><Tag color={Number(r.staffing_after_leave ?? 2) >= Number(r.min_staff_required ?? 2) ? 'green' : 'volcano'} style={{ margin: 0 }}>Còn {String(r.staffing_after_leave ?? 2)}/{String(r.min_staff_required ?? 2)} NV</Tag></Space> },
                    { title: 'Trạng thái', dataIndex: 'status', width: 155, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
                      render: (_, r) => (
                        <RowActionButtons
                          detailTooltip="Xem chi tiết đơn nghỉ OFF" onViewDetail={() => setDetailTarget({ kind: 'leave', record: r })} loading={actMut.isPending}
                          menuItems={r.status === 'PENDING' && canApproveLeave ? [{ key: 'approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Phê duyệt đơn nghỉ phép', onClick: () => actMut.mutate({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Đảm bảo đủ định biên ca' } }) }, { key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối đơn nghỉ phép', onClick: () => actMut.mutate({ url: `/admin/leave-requests/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Ca đang thiếu định biên' } }) }] : []}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'swap',
            label: <span><SwapOutlined /> Đơn xin đổi ca ({swapsQ.data?.meta.pagination.total ?? filteredSwaps.length})</span>,
            children: (
              <>
                {renderSubFilterBar(SWAP_STATUS_OPTS, () => exportSwapsExcel(filteredSwaps), <GuardButton type="primary" icon={<PlusOutlined />} perms={['swap.approve']} onClick={() => setSwapModal(true)}>Tạo yêu cầu đổi ca</GuardButton>)}
                <SelectableTable<Record<string, unknown>>
                  size="small" rowKey="id" loading={swapsQ.isLoading} pagination={mkPag(swapsQ.data?.meta.pagination.total)} dataSource={filteredSwaps} bulkActions={buildSwapsBulkActions(bulkOpts)}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'swap_code', width: 110, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Ngày ca', dataIndex: 'from_work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Người xin đổi', dataIndex: 'requesterName', width: 195, ellipsis: true },
                    { title: 'Người nhận thay', dataIndex: 'peerName', width: 195, ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 170, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
                      render: (_, r) => (
                        <RowActionButtons
                          detailTooltip="Xem chi tiết yêu cầu đổi ca" onViewDetail={() => setDetailTarget({ kind: 'swap', record: r })} loading={actMut.isPending}
                          menuItems={canApproveSwap ? [...(r.status === 'PENDING_PEER' ? [{ key: 'peer-accept', icon: <CheckCircleOutlined style={{ color: '#2563EB' }} />, label: 'Xác nhận đồng nghiệp nhận ca', onClick: () => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/peer-respond`, body: { version: r.version, accept: true, peer_note: 'Đồng ý nhận ca thay' } }) }] : []), ...(r.status === 'PEER_ACCEPTED' ? [{ key: 'approve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Phê duyệt đổi ca chính thức', onClick: () => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'APPROVED', decision_reason: 'Hợp lệ, duyệt đổi ca' } }) }] : []), ...(r.status === 'PENDING_PEER' || r.status === 'PEER_ACCEPTED' ? [{ key: 'reject', icon: <CloseCircleOutlined />, danger: true, label: 'Từ chối yêu cầu đổi ca', onClick: () => actMut.mutate({ url: `/admin/shift-swaps/${r.id}/decide`, body: { version: r.version, decision: 'REJECTED', decision_reason: 'Không đạt yêu cầu vị trí' } }) }] : [])] : []}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'emergency',
            label: <span><AlertOutlined /> Báo nghỉ đột xuất ({emgQ.data?.meta.pagination.total ?? filteredEmg.length})</span>,
            children: (
              <>
                {renderSubFilterBar(EMG_STATUS_OPTS, () => exportEmergencyExcel(filteredEmg), <GuardButton danger icon={<AlertOutlined />} perms={['emergency.handle']} onClick={() => setEmgModal(true)}>Báo nghỉ khẩn</GuardButton>)}
                <SelectableTable<Record<string, unknown>>
                  size="small" rowKey="id" loading={emgQ.isLoading} pagination={mkPag(emgQ.data?.meta.pagination.total)} dataSource={filteredEmg} bulkActions={buildEmergencyBulkActions(bulkOpts)}
                  columns={[
                    { title: 'Mã báo cáo', dataIndex: 'emergency_code', width: 115, render: (v: string) => <Tag color="volcano" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Nhân sự', dataIndex: 'employeeName', width: 200, ellipsis: true },
                    { title: 'Ngày ca', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{fmtDate(v)}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Trạng thái & Phủ ca', dataIndex: 'status', width: 185, render: (v: string, r) => <Space size={4} wrap><StatusTag value={v} />{v !== 'REPORTED' && <Tag color={v === 'RESOLVED' ? 'green' : 'red'} style={{ margin: 0 }}>{String(r.shift_coverage_status || (v === 'RESOLVED' ? 'Đã phủ ca' : 'Thiếu ca'))}</Tag>}</Space> },
                    {
                      title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
                      render: (_, r) => (
                        <RowActionButtons
                          detailTooltip="Xem chi tiết báo nghỉ khẩn" onViewDetail={() => setDetailTarget({ kind: 'emergency', record: r })} loading={actMut.isPending}
                          menuItems={r.status === 'REPORTED' && canHandleEmg ? [{ key: 'resolve', icon: <CheckCircleOutlined style={{ color: '#16A34A' }} />, label: 'Xác nhận đã có người thay ca', onClick: () => actMut.mutate({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'RESOLVE', resolution_note: 'Cửa hàng đã bố trí nhân sự thay ca' } }) }, { key: 'escalate', icon: <AlertOutlined />, danger: true, label: 'Báo thiếu ca khẩn cấp lên HR', onClick: () => actMut.mutate({ url: `/admin/emergency-leaves/${r.id}/handle`, body: { version: r.version, action: 'ESCALATE', resolution_note: 'Không có người thay, chuyển cảnh báo lên HR' } }) }] : []}
                        />
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
