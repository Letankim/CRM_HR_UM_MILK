'use client';

import { useState } from 'react';
import { Alert, App, Button, Card, Col, Flex, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, CameraOutlined, ClockCircleOutlined, DownloadOutlined, EnvironmentOutlined, EyeOutlined, FileAddOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
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
import { EmployeeScheduleAndLeaveCenter } from '@/ui/components/EmployeeScheduleAndLeaveCenter';
import { MyPayslipsView } from '@/ui/components/MyPayslipsView';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from '@/ui/components/ScheduleRequestDetailModal';
import { ShiftAttendanceDetailModal } from '@/ui/components/ShiftAttendanceDetailModal';
import { exportAdjustmentsExcel } from '@/ui/components/workflow-bulk-helpers';
import { useClientPagination } from '@/ui/hooks/useClientPagination';

interface MyShiftRow extends Record<string, unknown> {
  id: string; workDate: string; shiftCode: string; shiftLabel: string; startAt: string; endAt: string; branchName: string;
  isToday?: boolean; isExpiredToday?: boolean; checkInEvent?: AttendanceEventRow | null; checkOutEvent?: AttendanceEventRow | null;
}

interface MyAttendanceResponse {
  todayDate: string;
  nowTimeHm?: string;
  profile: { employeeId: string; employeeCode: string; fullName: string; role: string; roleLabel: string; stage: string; branchId: string; branchName: string; radiusM: number };
  shifts: MyShiftRow[]; events: AttendanceEventRow[]; leaves: Record<string, unknown>[];
  emergencyLeaves?: Record<string, unknown>[]; swaps?: Record<string, unknown>[];
  branchPeers?: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string }[];
  adjustments: Record<string, unknown>[];
}

function cleanShiftName(raw: unknown): string {
  return String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();
}

export default function MyAttendancePage() {
  const qc = useQueryClient(), { message } = App.useApp();
  const [selectedShiftId, setSelectedShiftId] = useState(''), [cameraKind, setCameraKind] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);
  const [detailEvent, setDetailEvent] = useState<AttendanceEventRow | null>(null), [detailReq, setDetailReq] = useState<ScheduleDetailTarget | null>(null);
  const [attShiftId, setAttShiftId] = useState<string | null>(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false), [adjOpen, setAdjOpen] = useState(false), [presetAdjShiftId, setPresetAdjShiftId] = useState<string | undefined>();
  const myEventsPag = useClientPagination(10, 'ca'), myAdjPag = useClientPagination(10, 'phiếu');

  const myQ = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendanceResponse>('/my-attendance') });
  const refreshAll = () => ['my-attendance', 'attendance-all', 'schedules', 'nv-attendance', 'nv-schedules', 'nv-swaps'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const checkMut = useMutation({
    mutationFn: (payload: unknown) => api.post('/attendance/check', payload),
    onSuccess: () => { message.success('Đã ghi nhận điểm danh cá nhân của bạn thành công'); setCameraKind(null); refreshAll(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Điểm danh thất bại'),
  });

  const todayDate = myQ.data?.todayDate || dayjs().format('YYYY-MM-DD'), nowHm = myQ.data?.nowTimeHm || dayjs().format('HH:mm');
  const profile = myQ.data?.profile, shifts = myQ.data?.shifts ?? [], events = myQ.data?.events ?? [], leaves = myQ.data?.leaves ?? [], adjustments = myQ.data?.adjustments ?? [];
  const activeShift = shifts.find((s) => String(s.id) === selectedShiftId) ?? shifts.find((s) => Boolean(s.canCheckOutNow)) ?? shifts.find((s) => s.workDate === todayDate && s.status === 'PUBLISHED' && !s.isAbsentShift && !s.isExpiredToday && !(s.checkInEvent && s.checkOutEvent)) ?? shifts.find((s) => s.workDate === todayDate && s.status === 'PUBLISHED') ?? shifts.find((s) => s.workDate === todayDate) ?? shifts[0] ?? null;
  const isSelectedToday = Boolean(activeShift && activeShift.workDate === todayDate);
  const checkInEvent = activeShift?.checkInEvent ?? null;
  const checkOutEvent = activeShift?.checkOutEvent ?? null;
  const isSelectedDone = Boolean(activeShift && (activeShift.status === 'COMPLETED' || (checkInEvent && checkOutEvent)));
  const isSelectedExpired = Boolean(activeShift && (activeShift.status === 'ABSENT' || activeShift.isAbsentShift || (!checkInEvent && activeShift.status === 'PUBLISHED' && (activeShift.workDate < todayDate || (isSelectedToday && (activeShift.isExpiredToday || nowHm > (activeShift.endAt || '12:00')))))));
  const isSelectedForgotOut = Boolean(activeShift && !isSelectedDone && checkInEvent && !checkOutEvent && Boolean(activeShift.isForgotCheckout));
  const canSelectedCheckOut = Boolean(activeShift && !isSelectedDone && checkInEvent && !checkOutEvent && !isSelectedForgotOut && (Boolean(activeShift.canCheckOutNow) || isSelectedToday));
  const isSelectedApproved = Boolean(activeShift && activeShift.status !== 'DRAFT');

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
            <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký ca làm của bạn</Button>
          </Space>
        }
      >
        {shifts.length === 0 ? (
          <Alert type="warning" showIcon message={`Bạn chưa đăng ký hoặc chưa được phân công ca làm việc nào (Hôm nay: ${dayjs(todayDate).format('DD/MM/YYYY')}).`} description="Khi bạn đăng ký ca làm việc, Quản lý cửa hàng hoặc HR sẽ phê duyệt sang Đã phân ca chính thức để bạn điểm danh Vào/Ra ca." action={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký ca làm việc</Button>} />
        ) : (
          <Row gutter={[16, 12]} align="middle">
            <Col xs={24} md={14}>
              <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.textSecondary, marginBottom: 6 }}>Chọn đúng ca làm việc của bạn (Hôm nay: {dayjs(todayDate).format('DD/MM/YYYY')})</div>
              <Select
                style={{ width: '100%' }} value={activeShift ? String(activeShift.id) : undefined} onChange={setSelectedShiftId}
                options={shifts.map((s) => {
                  const isT = s.workDate === todayDate;
                  const exp = s.status === 'ABSENT' || Boolean(s.isAbsentShift) || (!s.checkInEvent && s.status === 'PUBLISHED' && (s.workDate < todayDate || (isT && (s.isExpiredToday || nowHm > (s.endAt || '12:00')))));
                  const state = s.status === 'DRAFT' ? 'Chờ CH / HR duyệt phân ca' : (s.status === 'COMPLETED' || (s.checkInEvent && s.checkOutEvent)) ? 'Đã hoàn thành ca' : exp ? 'Vắng mặt (Quá giờ ca — Cần bù công)' : (s.checkInEvent && !s.checkOutEvent && Boolean(s.isForgotCheckout)) ? 'Quên Ra ca (Quá 1h — Cần bù công)' : (s.checkInEvent && !s.checkOutEvent && Boolean(s.isWithinCheckoutGrace)) ? `Đã vào ca (Còn hạn Ra ca đến ${String(s.checkoutGraceDeadlineHm || '')})` : s.checkInEvent ? 'Đã vào ca (Chờ Ra ca)' : isT ? 'Hôm nay · Chưa vào ca' : 'Đã duyệt · Chưa tới ngày';
                  return { value: String(s.id), label: `${isT ? '[HÔM NAY] ' : ''}${dayjs(s.workDate).format('DD/MM/YYYY')} · ${cleanShiftName(s.shiftLabel)} (${s.startAt || '07:00'} – ${s.endAt || '12:00'}) · ${state}` };
                })}
              />
              {activeShift && (
                <Space size={8} wrap style={{ marginTop: 8 }}>
                  <StatusTag value={String(isSelectedExpired ? 'ABSENT' : isSelectedDone ? 'COMPLETED' : activeShift.status || 'PUBLISHED')} label={isSelectedExpired ? 'Vắng mặt' : isSelectedDone ? 'Đã hoàn thành' : String(activeShift.statusLabel || '') || undefined} />
                  <Tag color={!isSelectedApproved ? 'gold' : isSelectedExpired ? 'red' : isSelectedDone ? 'green' : isSelectedToday ? 'blue' : 'gold'} style={{ margin: 0 }}>
                    {!isSelectedApproved ? 'Đang chờ Quản lý cửa hàng / HR duyệt phân ca' : isSelectedExpired ? `Quá giờ ca (${activeShift.endAt}) chưa điểm danh — Đã khóa Vào ca` : isSelectedDone ? 'Ca làm việc đã hoàn thành' : isSelectedToday ? 'Đúng ngày hôm nay (Được phép điểm danh)' : `Ca ngày ${dayjs(activeShift.workDate).format('DD/MM/YYYY')}`}
                  </Tag>
                  {checkInEvent && <Tag color={checkInEvent.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0, fontWeight: 600 }}>Vào: {String(checkInEvent.checkTimeFormatted || '').slice(0, 5)} ({checkInEvent.punctualityLabel})</Tag>}
                  {checkOutEvent && <Tag color={checkOutEvent.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0, fontWeight: 600 }}>Ra: {String(checkOutEvent.checkTimeFormatted || '').slice(0, 5)} ({checkOutEvent.punctualityLabel})</Tag>}
                </Space>
              )}
            </Col>
            <Col xs={24} md={10}>
              {!isSelectedApproved ? (
                <Alert type="warning" showIcon message="Ca đăng ký này đang chờ Quản lý cửa hàng hoặc HR phê duyệt. Chỉ được phép chấm công Vào/Ra ca sau khi đã chuyển sang Đã phân ca chính thức." />
              ) : isSelectedDone ? (
                <Alert type="success" showIcon message="Bạn đã hoàn thành đầy đủ ca làm việc này." action={activeShift ? <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => setAttShiftId(String(activeShift.id))}>Xem chi tiết điểm danh</Button> : undefined} />
              ) : (isSelectedExpired || isSelectedForgotOut) ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {(activeShift as unknown as Record<string, unknown>)?.pendingAdjustmentCode ? (
                    <Alert type="warning" showIcon message={`Ca làm việc này đã gửi Phiếu bổ sung công (${String((activeShift as unknown as Record<string, unknown>).pendingAdjustmentCode)}) và đang chờ Cửa hàng / HR phê duyệt.`} />
                  ) : isSelectedForgotOut ? (
                    <>
                      <Alert type="error" showIcon message={`Ca làm việc (${activeShift?.startAt} – ${activeShift?.endAt}) đã quá thời hạn 60 phút sau giờ kết thúc ca mà chưa Ra ca. Vui lòng gửi Phiếu bổ sung công.`} />
                      <Button type="primary" danger block icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(String(activeShift?.id)); setAdjOpen(true); }}>Làm phiếu bổ sung công (Quên Ra ca)</Button>
                    </>
                  ) : (
                    <>
                      <Alert type="error" showIcon message={`Ca làm việc (${activeShift?.startAt} – ${activeShift?.endAt}) đã qua giờ kết thúc ca mà chưa điểm danh nên đã khóa Vào ca và chuyển sang Vắng mặt.`} />
                      <Button type="primary" danger block icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(String(activeShift?.id)); setAdjOpen(true); }}>Làm phiếu bổ sung công bù ca vắng mặt này</Button>
                    </>
                  )}
                </Space>
              ) : canSelectedCheckOut ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {Boolean(activeShift?.isWithinCheckoutGrace) && <Alert type="info" showIcon message={`Ca đã qua giờ kết thúc (${activeShift?.endAt}) nhưng vẫn trong 60 phút cho phép — Bạn có thể Ra ca đến ${String(activeShift?.checkoutGraceDeadlineHm || '')}.`} />}
                  <Button type="primary" size="large" block icon={<CameraOutlined />} onClick={() => setCameraKind('CHECK_OUT')}>Ra ca của bạn (Chụp ảnh Camera &amp; GPS)</Button>
                </Space>
              ) : !isSelectedToday ? (
                <Alert type="warning" showIcon message={`Chỉ được điểm danh đúng ngày đăng ký ca (${dayjs(activeShift?.workDate).format('DD/MM/YYYY')}).`} />
              ) : !checkInEvent ? (
                <Button type="primary" size="large" block icon={<CameraOutlined />} onClick={() => setCameraKind('CHECK_IN')}>Vào ca của bạn (Chụp ảnh Camera &amp; GPS)</Button>
              ) : (
                <Alert type="success" showIcon message="Bạn đã hoàn thành đầy đủ Vào ca & Ra ca cho ca làm việc này." />
              )}
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
                    size="small" rowKey="id" loading={myQ.isLoading || myQ.isFetching} pagination={myEventsPag} dataSource={groupAttendanceEventsByShift(events)} locale={{ emptyText: 'Bạn chưa có lượt điểm danh nào trong kỳ.' }}
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
                  <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}><Typography.Text type="secondary">Danh sách phiếu giải trình / bổ sung công cá nhân của bạn.</Typography.Text><Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setPresetAdjShiftId(undefined); setAdjOpen(true); }}>Gửi phiếu bổ sung công</Button></Flex>
                  <SelectableTable<Record<string, unknown>>
                    size="small" rowKey="id" loading={myQ.isLoading || myQ.isFetching} pagination={myAdjPag} dataSource={adjustments} locale={{ emptyText: 'Bạn chưa có phiếu bổ sung công nào.' }}
                    bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAdjustmentsExcel(rows) }]}
                    columns={[
                      { title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 115, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> },
                      { title: 'Ngày công', dataIndex: 'work_date', width: 120, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> },
                      { title: 'Khung ca & Giờ ca', width: 230, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{String(r.shiftTimeRange || '07:00 – 12:00')}</Tag></Space> },
                      { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 115, render: (v: number) => <strong>{v} giờ</strong> },
                      { title: 'Trạng thái', dataIndex: 'status', width: 155, render: (v: string) => <StatusTag value={v} /> },
                      { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết phiếu bổ sung" onViewDetail={() => setDetailReq({ kind: 'adjustment', record: r })} /> },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'my-schedule', label: <span><CalendarOutlined /> Lịch cá nhân, Nghỉ OFF &amp; Đổi ca ({shifts.length})</span>,
              children: <EmployeeScheduleAndLeaveCenter todayDate={todayDate} empId={profile?.employeeId || ''} empCode={profile?.employeeCode || ''} stage={profile?.stage} shifts={shifts} leaves={leaves} emergencyLeaves={myQ.data?.emergencyLeaves ?? []} swaps={myQ.data?.swaps ?? []} branchPeers={myQ.data?.branchPeers ?? []} refreshing={myQ.isFetching} onRefresh={refreshAll} />,
            },
            {
              key: 'my-payslips', label: <span><FileTextOutlined /> Phiếu lương của bạn</span>,
              children: <MyPayslipsView embedded />,
            },
          ]}
        />
      </Card>

      <MyShiftRegisterModal open={addShiftOpen} todayDate={todayDate} onClose={() => setAddShiftOpen(false)} onCreated={(createdId) => { if (createdId) setSelectedShiftId(createdId); refreshAll(); }} />
      <AttendanceCameraModal open={Boolean(cameraKind)} kind={cameraKind ?? 'CHECK_IN'} shift={activeShift} loading={checkMut.isPending} onClose={() => setCameraKind(null)} onConfirm={(payload) => checkMut.mutate(payload)} />
      <AttendanceEventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
      <ScheduleRequestDetailModal target={detailReq} onClose={() => setDetailReq(null)} />
      <AttendanceAdjustmentModal open={adjOpen} employeeId={profile?.employeeId || ''} shifts={shifts as unknown as Record<string, unknown>[]} initialShiftId={presetAdjShiftId} onClose={() => setAdjOpen(false)} onSuccess={refreshAll} />
    </Space>
  );
}
