'use client';

import { useState } from 'react';
import { Alert, App, Button, Card, Col, Flex, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, DownloadOutlined, EnvironmentOutlined, FileAddOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';
import { AttendanceCameraModal } from '@/ui/components/AttendanceCameraModal';
import { AttendanceEventDetailModal } from '@/ui/components/AttendanceEventDetailModal';
import { exportAttendanceEventsExcel, groupAttendanceEventsByShift, renderShiftCheckInOutSummary, type AttendanceEventRow } from '@/ui/components/AttendanceEventsTable';
import { SelectableTable } from '@/ui/components/BulkActionBar';
import { AttendanceAdjustmentModal, MyShiftRegisterModal } from '@/ui/components/EmployeePortalModals';
import { EmployeeScheduleAndLeaveCenter, OFFICIAL_SCHEDULE_INFO } from '@/ui/components/EmployeeScheduleAndLeaveCenter';
import { MyAdjustmentsTable } from '@/ui/components/MyAdjustmentsTable';
import { MyPayslipsView } from '@/ui/components/MyPayslipsView';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from '@/ui/components/ScheduleRequestDetailModal';
import { SelfShiftActionPanel } from '@/ui/components/SelfShiftActionPanel';
import { buildSelfShiftOptions, cleanShiftName, pickActiveSelfShift, useCheckoutLateHours, useNowHm, type BranchPeerItem, type SelfAttendanceExtras } from '@/ui/components/self-attendance-shared';
import { ShiftAttendanceDetailModal } from '@/ui/components/ShiftAttendanceDetailModal';
import { useClientPagination } from '@/ui/hooks/useClientPagination';

interface MyShiftRow extends Record<string, unknown> {
  id: string; workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; branchName: string;
  isToday?: boolean; isExpiredToday?: boolean; checkInEvent?: AttendanceEventRow | null; checkOutEvent?: AttendanceEventRow | null;
}

interface MyAttendanceResponse extends SelfAttendanceExtras {
  todayDate: string;
  nowTimeHm?: string;
  profile: { employeeId: string; employeeCode: string; fullName: string; role: string; roleLabel: string; stage: string; branchId: string; branchName: string; radiusM: number };
  shifts: MyShiftRow[]; events: AttendanceEventRow[]; leaves: Record<string, unknown>[];
  swaps?: Record<string, unknown>[]; branchPeers?: BranchPeerItem[];
  adjustments: Record<string, unknown>[];
}

export default function MyAttendancePage() {
  const qc = useQueryClient(), { message } = App.useApp();
  const [selectedShiftId, setSelectedShiftId] = useState(''), [cameraKind, setCameraKind] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);
  const [detailEvent, setDetailEvent] = useState<AttendanceEventRow | null>(null), [detailReq, setDetailReq] = useState<ScheduleDetailTarget | null>(null);
  const [attShiftId, setAttShiftId] = useState<string | null>(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false), [adjOpen, setAdjOpen] = useState(false), [presetAdjShiftId, setPresetAdjShiftId] = useState<string | undefined>();
  const myEventsPag = useClientPagination(10, 'ca');
  const nowHm = useNowHm(), lateHours = useCheckoutLateHours();

  const myQ = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendanceResponse>('/my-attendance') });
  const refreshAll = () => ['my-attendance', 'attendance-all', 'schedules', 'nv-attendance', 'nv-schedules', 'nv-swaps', 'off-window'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const checkMut = useMutation({
    mutationFn: (payload: unknown) => api.post('/attendance/check', payload),
    onSuccess: () => { message.success('Đã ghi nhận điểm danh cá nhân của bạn thành công'); setCameraKind(null); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Điểm danh thất bại'),
  });

  const todayDate = myQ.data?.todayDate || dayjs().format('YYYY-MM-DD');
  const profile = myQ.data?.profile, shifts = myQ.data?.shifts ?? [], events = myQ.data?.events ?? [], leaves = myQ.data?.leaves ?? [], adjustments = myQ.data?.adjustments ?? [];
  const canRegisterShift = Boolean(myQ.data?.canRegisterShift);
  const activeShift = pickActiveSelfShift(shifts, selectedShiftId, todayDate);
  const checkInEvent = activeShift?.checkInEvent ?? null, checkOutEvent = activeShift?.checkOutEvent ?? null;
  const openAdjust = (shiftId?: string) => { setPresetAdjShiftId(shiftId); setAdjOpen(true); };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        size="small" styles={{ header: { padding: '10px 16px' }, body: { padding: 16 } }}
        title={
          <Flex align="center" wrap gap={10}>
            <Typography.Text strong style={{ marginRight: 4 }}>Điểm danh &amp; Ca làm việc của bạn</Typography.Text>
            {profile && <Tag color="blue" style={{ margin: 0, padding: '1px 8px' }}>{profile.fullName} ({profile.employeeCode})</Tag>}
            {profile && profile.fullName !== profile.roleLabel && <Tag color="geekblue" style={{ margin: 0, padding: '1px 8px' }}>{profile.roleLabel}</Tag>}
            {profile && <Tag icon={<EnvironmentOutlined />} style={{ margin: 0, padding: '1px 8px' }}>{profile.branchName} · Bán kính {profile.radiusM}m</Tag>}
          </Flex>
        }
        extra={
          <Space size={8}>
            <Button size="small" icon={<ReloadOutlined />} loading={myQ.isFetching} onClick={() => myQ.refetch()}>Làm mới</Button>
            {canRegisterShift && <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký làm thêm ca</Button>}
          </Space>
        }
      >
        {shifts.length === 0 ? (
          <Alert
            type="warning" showIcon message={`Bạn chưa được phân công ca làm việc nào (Hôm nay: ${dayjs(todayDate).format('DD/MM/YYYY')}).`}
            description={canRegisterShift ? 'Bạn có thể đăng ký làm thêm ca trong chu kỳ thử việc; HR sẽ duyệt sang Đã phân ca chính thức để bạn điểm danh Vào/Ra ca.' : OFFICIAL_SCHEDULE_INFO}
            action={canRegisterShift ? <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký làm thêm ca</Button> : undefined}
          />
        ) : (
          <Row gutter={[16, 12]} align="middle">
            <Col xs={24} md={14}>
              <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.textSecondary, marginBottom: 6 }}>Chọn đúng ca làm việc của bạn (Hôm nay: {dayjs(todayDate).format('DD/MM/YYYY')})</div>
              <Select style={{ width: '100%' }} value={activeShift ? String(activeShift.id) : undefined} onChange={setSelectedShiftId} options={buildSelfShiftOptions(shifts, todayDate, nowHm, lateHours)} />
              {activeShift && (
                <Space size={8} wrap style={{ marginTop: 8 }}>
                  <StatusTag value={String(activeShift.status || 'PUBLISHED')} label={String(activeShift.statusLabel || '') || undefined} />
                  <Tag color={String(activeShift.attendanceStatusColor || 'default')} style={{ margin: 0 }}>{String(activeShift.attendanceStatusLabel || 'Chưa điểm danh')}</Tag>
                  {checkInEvent && <Tag color={checkInEvent.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0, fontWeight: 600 }}>Vào: {String(checkInEvent.checkTimeFormatted || '').slice(0, 5)} ({checkInEvent.punctualityLabel})</Tag>}
                  {checkOutEvent && <Tag color={checkOutEvent.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0, fontWeight: 600 }}>Ra: {String(checkOutEvent.checkTimeFormatted || '').slice(0, 5)} ({checkOutEvent.punctualityLabel})</Tag>}
                </Space>
              )}
            </Col>
            <Col xs={24} md={10}>
              <SelfShiftActionPanel shift={activeShift} todayDate={todayDate} onCamera={setCameraKind} onAdjust={openAdjust} onViewAttendance={setAttShiftId} />
            </Col>
          </Row>
        )}
      </Card>

      <Card size="small">
        <Tabs
          tabBarExtraContent={<Button size="small" icon={<ReloadOutlined />} loading={myQ.isFetching} onClick={refreshAll}>Làm mới</Button>}
          items={[
            {
              key: 'my-events',
              label: <span><EnvironmentOutlined /> Lịch sử Điểm danh của bạn ({groupAttendanceEventsByShift(events).length})</span>,
              children: (
                <>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}><Typography.Text type="secondary">Danh sách điểm danh Vào ca &amp; Ra ca theo từng ca làm việc của riêng bạn.</Typography.Text><Button size="small" icon={<DownloadOutlined />} onClick={() => exportAttendanceEventsExcel(events)}>Xuất Excel Điểm danh của bạn</Button></Flex>
                  <SelectableTable<AttendanceEventRow>
                    size="small" rowKey="id" loading={myQ.isLoading} pagination={myEventsPag} dataSource={groupAttendanceEventsByShift(events)} onRowClick={setDetailEvent} locale={{ emptyText: 'Bạn chưa có lượt điểm danh nào trong kỳ.' }}
                    bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAttendanceEventsExcel(rows) }]}
                    columns={[
                      { title: 'Ngày & Ca làm việc', width: 220, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)} ({r.shiftTimeRange || '07:00 – 12:00'})</div><div className="num" style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày: {r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '—'}</div></div> },
                      { title: 'Vào ca / Ra ca', width: 340, render: (_, r) => renderShiftCheckInOutSummary(r) },
                      { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết điểm danh" onViewDetail={() => setDetailEvent(r)} /> },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'my-adjustments',
              label: <span><FileAddOutlined /> Phiếu bổ sung công của bạn ({adjustments.length})</span>,
              children: (
                <>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}><Typography.Text type="secondary">Phiếu lỗi chấm công Vào ca / Ra ca và bù công cả ca kèm ảnh minh chứng.</Typography.Text><Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openAdjust(undefined)}>Gửi phiếu bổ sung công</Button></Flex>
                  <MyAdjustmentsTable adjustments={adjustments} loading={myQ.isLoading} onViewDetail={(r) => setDetailReq({ kind: 'adjustment', record: r })} />
                </>
              ),
            },
            {
              key: 'my-schedule', label: <span><CalendarOutlined /> {myQ.data?.canSwapShift ? `Lịch cá nhân, Nghỉ OFF & Nhường / Đổi ca (${shifts.length})` : `Lịch cá nhân & Nghỉ OFF (${shifts.length})`}</span>,
              children: <EmployeeScheduleAndLeaveCenter todayDate={todayDate} empId={profile?.employeeId || ''} empCode={profile?.employeeCode || ''} stage={profile?.stage} canRegisterShift={canRegisterShift} canSwapShift={myQ.data?.canSwapShift} shifts={shifts} leaves={leaves} swaps={myQ.data?.swaps ?? []} branchPeers={myQ.data?.branchPeers ?? []} refreshing={myQ.isFetching} onRefresh={refreshAll} />,
            },
            {
              key: 'my-payslips', label: <span><FileTextOutlined /> Phiếu lương của bạn</span>,
              children: <MyPayslipsView embedded />,
            },
          ]}
        />
      </Card>

      {canRegisterShift && <MyShiftRegisterModal open={addShiftOpen} todayDate={todayDate} onClose={() => setAddShiftOpen(false)} onCreated={(createdId) => { if (createdId) setSelectedShiftId(createdId); refreshAll(); }} />}
      <AttendanceCameraModal open={Boolean(cameraKind)} kind={cameraKind ?? 'CHECK_IN'} shift={activeShift} loading={checkMut.isPending} onClose={() => setCameraKind(null)} onConfirm={(payload) => checkMut.mutate({ ...payload, enforce_shift_state: true })} />
      <AttendanceEventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
      <ScheduleRequestDetailModal target={detailReq} onClose={() => setDetailReq(null)} />
      <AttendanceAdjustmentModal open={adjOpen} employeeId={profile?.employeeId || ''} shifts={shifts as unknown as Record<string, unknown>[]} initialShiftId={presetAdjShiftId} onClose={() => setAdjOpen(false)} onSuccess={refreshAll} />
    </Space>
  );
}
