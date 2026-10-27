'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Flex, Popconfirm, Segmented, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  AppstoreOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined,
  CloseOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SwapOutlined, TableOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { SYSTEM_CONFIG } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '../StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { LeaveRequestModal, MyShiftRegisterModal, ShiftSwapRequestModal } from './EmployeePortalModals';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { ScheduleViewsPanel } from './ScheduleViewsPanel';

type ScheduleViewMode = 'WEEK_MATRIX' | 'CALENDAR' | 'TABLE';

export interface EmployeeScheduleAndLeaveCenterProps {
  todayDate: string; empId: string; empCode: string; stage?: string;
  initialTab?: 'shifts' | 'leaves' | 'swaps';
  shifts: Record<string, unknown>[]; leaves: Record<string, unknown>[]; emergencyLeaves?: Record<string, unknown>[]; swaps: Record<string, unknown>[];
  branchPeers: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string; busyShiftsByDate?: Record<string, string> }[];
  refreshing?: boolean; onRefresh: () => void;
}

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
const fmtShiftTime = (r: Record<string, unknown>) => `${String(r.startAt || r.start_at || '07:00')} – ${String(r.endAt || r.end_at || '12:00')}${r.scheduledHours || r.scheduled_hours ? ` (${r.scheduledHours || r.scheduled_hours}h)` : ''}`;

export function EmployeeScheduleAndLeaveCenter({
  todayDate, empId, empCode, stage, initialTab = 'shifts', shifts, leaves, emergencyLeaves = [], swaps, branchPeers, refreshing = false, onRefresh,
}: EmployeeScheduleAndLeaveCenterProps) {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<'shifts' | 'leaves' | 'swaps'>(initialTab);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('WEEK_MATRIX');
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<ScheduleDetailTarget | null>(null);
  const shiftsPag = useClientPagination(10, 'ca');
  const leavesPag = useClientPagination(10, 'đơn');
  const emgPag = useClientPagination(10, 'báo cáo');
  const swapsPag = useClientPagination(10, 'yêu cầu');

  const peerRespondMut = useMutation({
    mutationFn: ({ id, version, accept }: { id: string; version: number; accept: boolean }) =>
      api.post(`/admin/shift-swaps/${id}/peer-respond`, { version, accept, peer_note: accept ? 'Đồng ý nhận ca' : 'Bận lịch cá nhân, không thể nhận ca' }),
    onSuccess: (_, vars) => { message.success(vars.accept ? 'Đã xác nhận đồng ý nhận ca (Bước 2/3: Chờ Quản lý duyệt)' : 'Đã từ chối yêu cầu đổi ca'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const cancelShiftMut = useMutation({
    mutationFn: (id: string) => api.delete(`/my-attendance/shifts/${id}`),
    onSuccess: () => { message.success('Đã hủy đăng ký ca làm việc'); onRefresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể hủy ca'),
  });

  const usedOffCount = leaves.filter((l) => l.status !== 'REJECTED' && l.status !== 'CANCELLED').length;
  const offQuotaLimit = stage === 'PROBATION' ? SYSTEM_CONFIG.defaults.probationOffDays : 4;

  return (
    <>
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'shifts' | 'leaves' | 'swaps')}
        tabBarExtraContent={
          <Space size={6} wrap>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>Làm mới</Button>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký ca</Button>
            <Button size="small" icon={<SwapOutlined />} onClick={() => setSwapOpen(true)}>Đổi ca</Button>
            <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={() => setLeaveOpen(true)}>Đăng ký nghỉ OFF</Button>
          </Space>
        }
        items={[
          {
            key: 'shifts',
            label: <span><CalendarOutlined /> Lịch làm việc ({shifts.length})</span>,
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {shifts.some((s) => s.status === 'DRAFT') && (
                  <Alert type="warning" showIcon message="Bạn có ca đăng ký đang Chờ Quản lý cửa hàng / HR duyệt phân ca. Chỉ những ca đã được phê duyệt sang Đã phân ca chính thức mới được phép chấm công Vào/Ra ca và Đổi ca." />
                )}
                {shifts.some((s) => s.status === 'ABSENT' || Boolean(s.isAbsentShift)) && (
                  <Alert type="error" showIcon message="Bạn có ca làm việc ở trạng thái Vắng mặt (do quá giờ kết thúc ca chưa điểm danh). Để bù công cho ca vắng mặt, vui lòng gửi Phiếu bổ sung công." />
                )}
                <Flex justify="space-between" align="center" wrap gap={8}>
                  <Typography.Text type="secondary">Chuyển đổi chế độ xem Lưới Tuần, Lịch Tháng hoặc Bảng chi tiết ca làm việc của bạn.</Typography.Text>
                  <Segmented value={viewMode} onChange={(v) => setViewMode(v as ScheduleViewMode)} options={[{ value: 'WEEK_MATRIX', icon: <AppstoreOutlined />, label: 'Lưới Lịch Tuần' }, { value: 'CALENDAR', icon: <CalendarOutlined />, label: 'Lịch Tháng' }, { value: 'TABLE', icon: <TableOutlined />, label: 'Bảng Danh Sách' }]} />
                </Flex>

                {viewMode !== 'TABLE' ? (
                  <ScheduleViewsPanel mode={viewMode} todayDate={todayDate} assignments={shifts as unknown as ScheduleAssignmentItem[]} canEdit={false} onAddAtCell={() => setAddShiftOpen(true)} onEditItem={(item) => setDetailTarget({ kind: 'shift', record: item as unknown as Record<string, unknown> })} />
                ) : (
                  <Table
                    size="small" rowKey="id" pagination={shiftsPag} dataSource={shifts} scroll={{ x: 'max-content' }}
                    locale={{ emptyText: 'Bạn chưa có ca làm việc nào được phân công trong kỳ này.' }}
                    columns={[
                      { title: 'Ngày làm việc', dataIndex: 'workDate', width: 145, render: (v: string) => <Space size={6}><span className="num" style={{ fontWeight: 600 }}>{dayjs(v).format('DD/MM/YYYY')}</span>{v === todayDate && <Tag color="blue" style={{ margin: 0 }}>Hôm nay</Tag>}</Space> },
                      { title: 'Khung ca & Giờ ca', width: 225, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                      { title: 'Chi nhánh', dataIndex: 'branchName', ellipsis: true },
                      { title: 'Điểm danh', width: 185, render: (_, r) => <Tag color={String(r.attendanceStatusColor || 'default')} style={{ margin: 0 }}>{String(r.attendanceStatusLabel || 'Chưa điểm danh')}</Tag> },
                      { title: 'Trạng thái lịch', dataIndex: 'status', width: 145, render: (v: string, r) => <StatusTag value={v} label={String(r.statusLabel || '') || undefined} /> },
                      {
                        title: 'Thao tác', width: 145, align: 'right',
                        render: (_, r) => (
                          <Space size={6}>
                            <Tooltip title="Xem chi tiết ca làm việc"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'shift', record: r })} /></Tooltip>
                            {r.status === 'DRAFT' && !r.checkInEvent && (
                              <Popconfirm title="Hủy đăng ký ca đang chờ duyệt này?" okText="Hủy đăng ký" cancelText="Đóng" okButtonProps={{ danger: true, icon: <DeleteOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onConfirm={() => cancelShiftMut.mutate(String(r.id))}><Button size="small" danger icon={<DeleteOutlined />}>Hủy</Button></Popconfirm>
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </Space>
            ),
          },
          {
            key: 'leaves',
            label: <span><CalendarOutlined /> Đơn nghỉ OFF ({leaves.length + emergencyLeaves.length})</span>,
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={8} wrap>
                  <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>Định mức nghỉ OFF đã đăng ký: {usedOffCount} / {offQuotaLimit} ngày trong chu kỳ</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Bấm biểu tượng con mắt ở từng dòng để xem chi tiết lý do và thời gian phê duyệt.</Typography.Text>
                </Space>
                <Table
                  size="small" rowKey="id" pagination={leavesPag} dataSource={leaves} scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'Bạn chưa có đơn đăng ký nghỉ phép (OFF) nào trong kỳ.' }}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'request_code', width: 105, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Ngày xin nghỉ', dataIndex: 'leave_date', width: 120, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 225, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Lý do xin nghỉ', dataIndex: 'reason', ellipsis: true },
                    { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> },
                    { title: 'Chi tiết', width: 75, align: 'center', render: (_, r) => <Tooltip title="Xem chi tiết đơn nghỉ OFF"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'leave', record: r })} /></Tooltip> },
                  ]}
                />
                {emergencyLeaves.length > 0 && (
                  <Table
                    size="small" rowKey="id" pagination={emgPag} dataSource={emergencyLeaves} scroll={{ x: 'max-content' }}
                    title={() => <span style={{ fontWeight: 600, fontSize: 13 }}>Báo cáo nghỉ khẩn cấp sát giờ ca (&lt;12h)</span>}
                    columns={[
                      { title: 'Mã báo cáo', dataIndex: 'emergency_code', width: 110, render: (v: string) => <Tag color="volcano" style={{ margin: 0 }}>{v}</Tag> },
                      { title: 'Ngày nghỉ', dataIndex: 'work_date', width: 120, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
                      { title: 'Khung ca & Giờ ca', width: 225, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                      { title: 'Lý do khẩn cấp', dataIndex: 'reason', ellipsis: true },
                      { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> },
                      { title: 'Chi tiết', width: 75, align: 'center', render: (_, r) => <Tooltip title="Xem chi tiết báo nghỉ khẩn"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'emergency', record: r })} /></Tooltip> },
                    ]}
                  />
                )}
              </Space>
            ),
          },
          {
            key: 'swaps',
            label: <span><SwapOutlined /> Yêu cầu đổi ca ({swaps.length})</span>,
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert type="info" showIcon message="Quy trình đổi ca 3 bước: (1) Bạn tạo yêu cầu -> (2) Đồng nghiệp xác nhận nhận ca -> (3) Quản lý duyệt cập nhật lịch chính thức. Bấm nút con mắt để xem đầy đủ chi tiết & thời gian." />
                <Table
                  size="small" rowKey="id" pagination={swapsPag} dataSource={swaps} scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'Bạn chưa có yêu cầu đổi ca nội bộ nào. Bấm nút "Đổi ca" phía trên để gửi đề nghị đổi ca với đồng nghiệp.' }}
                  columns={[
                    { title: 'Mã đơn', dataIndex: 'swap_code', width: 100, render: (v: string) => <Tag color="purple" style={{ margin: 0 }}>{v}</Tag> },
                    { title: 'Ngày ca', dataIndex: 'from_work_date', width: 110, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> },
                    { title: 'Khung ca & Giờ ca', width: 220, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.from_shift_code)}</span><Tag color="geekblue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{fmtShiftTime(r)}</Tag></Space> },
                    { title: 'Người xin đổi', ellipsis: true, render: (_, r) => <Space size={4}><span>{String(r.requesterName || '')}</span>{(r.requester_id === empId || r.requesterCode === empCode) && <Tag color="blue" style={{ margin: 0 }}>Bạn</Tag>}</Space> },
                    { title: 'Người nhận ca', ellipsis: true, render: (_, r) => <Space size={4}><span>{String(r.peerName || '')}</span>{(r.peer_id === empId || r.peerCode === empCode) && <Tag color="cyan" style={{ margin: 0 }}>Bạn</Tag>}</Space> },
                    { title: 'Trạng thái', dataIndex: 'status', width: 165, render: (v: string) => <StatusTag value={v} /> },
                    {
                      title: 'Thao tác', width: 215, align: 'right',
                      render: (_, r) => {
                        const isPeer = r.peer_id === empId || r.peerCode === empCode;
                        return (
                          <Space size={6}>
                            <Tooltip title="Xem chi tiết yêu cầu đổi ca"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTarget({ kind: 'swap', record: r })} /></Tooltip>
                            {r.status === 'PENDING_PEER' && isPeer && (
                              <>
                                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={peerRespondMut.isPending} onClick={() => peerRespondMut.mutate({ id: String(r.id), version: Number(r.version), accept: true })}>Đồng ý</Button>
                                <Button size="small" danger icon={<CloseCircleOutlined />} loading={peerRespondMut.isPending} onClick={() => peerRespondMut.mutate({ id: String(r.id), version: Number(r.version), accept: false })}>Từ chối</Button>
                              </>
                            )}
                          </Space>
                        );
                      },
                    },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />

      <ScheduleRequestDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />
      <MyShiftRegisterModal open={addShiftOpen} todayDate={todayDate} onClose={() => setAddShiftOpen(false)} onCreated={onRefresh} />
      <LeaveRequestModal open={leaveOpen} employeeId={empId} onClose={() => setLeaveOpen(false)} onSuccess={onRefresh} />
      <ShiftSwapRequestModal open={swapOpen} employeeId={empId} shifts={shifts} peers={branchPeers} onClose={() => setSwapOpen(false)} onSuccess={onRefresh} />
    </>
  );
}
