'use client';

import { useEffect, useState } from 'react';
import { notFound, useParams, useRouter } from 'next/navigation';
import { Alert, App, Button, Card, Col, Empty, Grid, List, Row, Select, Space, Spin, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  BookOutlined, CameraOutlined, CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined,
  EyeOutlined, FileAddOutlined, FileProtectOutlined, FileTextOutlined, KeyOutlined, NotificationOutlined, PaperClipOutlined, ReloadOutlined, RightOutlined, UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useClientPagination } from '@/ui/hooks/useClientPagination';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';
import { AttendanceCameraModal } from '@/ui/components/AttendanceCameraModal';
import { AttendanceEventDetailModal } from '@/ui/components/AttendanceEventDetailModal';
import { exportAttendanceEventsExcel, groupAttendanceEventsByShift, renderShiftCheckInOutSummary, type AttendanceEventRow } from '@/ui/components/AttendanceEventsTable';
import { SelectableTable } from '@/ui/components/BulkActionBar';
import { AttendanceAdjustmentModal } from '@/ui/components/EmployeePortalModals';
import { EmployeeScheduleAndLeaveCenter } from '@/ui/components/EmployeeScheduleAndLeaveCenter';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from '@/ui/components/ScheduleRequestDetailModal';
import { ShiftAttendanceDetailModal } from '@/ui/components/ShiftAttendanceDetailModal';
import { EmployeeTestCenterView } from '@/ui/components/ExamTestCenter';
import { GovernanceDetailDrawer, POLICY_CATEGORY_LABELS } from '@/ui/components/GovernanceAndCommsModals';
import { NotificationsCenterView } from '@/ui/components/NotificationsCenterView';
import { UserProfileModal } from '@/ui/components/UserProfileModal';
import { exportAdjustmentsExcel } from '@/ui/components/workflow-bulk-helpers';

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

interface MyAttendanceData {
  todayDate: string; profile: { employeeId: string; employeeCode: string; fullName: string; stage?: string };
  shifts: Record<string, unknown>[]; events: AttendanceEventRow[]; leaves: Record<string, unknown>[];
  emergencyLeaves?: Record<string, unknown>[]; swaps?: Record<string, unknown>[]; adjustments: Record<string, unknown>[];
  branchPeers?: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string }[];
}
const SECTIONS: Record<string, string> = {
  lich: 'Lịch làm việc & Đăng ký ca của bạn', 'nghi-phep': 'Đăng ký Nghỉ phép OFF & Báo nghỉ khẩn cấp',
  'doi-ca': 'Yêu cầu Đổi ca nội bộ (Quy trình 3 bước)', 'diem-danh': 'Điểm danh GPS & Camera trực tiếp của bạn',
  cong: 'Bảng công cá nhân & Phiếu bổ sung công', 'bai-kiem-tra': 'Bài kiểm tra Nghiệp vụ (TEST)',
  'ban-tin': 'Bản tin Nội bộ & Chính sách Quy định Công ty', 'thong-bao': 'Trung tâm Thông báo & Hộp thư Cá nhân', them: 'Tiện ích mở rộng của bạn',
};
const SECTION_ALIASES: Record<string, string> = { 'cong-cua-toi': 'cong', 'bang-cong': 'cong', 'cham-cong': 'diem-danh', 'lich-lam-viec': 'lich', 'don-nghi': 'nghi-phep', 'kiem-tra': 'bai-kiem-tra' };

export default function EmployeeSection() {
  const { section: rawSection } = useParams<{ section: string }>();
  const section = SECTION_ALIASES[rawSection] ?? rawSection;
  const router = useRouter();
  const isDesktop = Boolean(Grid.useBreakpoint().md);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const session = useMe();
  const title = SECTIONS[section];
  if (!title) notFound();

  const [adjOpen, setAdjOpen] = useState(false), [presetAdjShiftId, setPresetAdjShiftId] = useState<string | undefined>();
  const [congPeriod, setCongPeriod] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL'), [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);
  const [cameraModalKind, setCameraModalKind] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null), [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [detailEvent, setDetailEvent] = useState<AttendanceEventRow | null>(null), [detailReq, setDetailReq] = useState<ScheduleDetailTarget | null>(null);
  const [attShiftId, setAttShiftId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<{ kind: 'policy' | 'announcement'; record: Record<string, unknown> } | null>(null);
  const attPag = useClientPagination(10, 'ca'), adjPag = useClientPagination(10, 'phiếu');

  const myQ = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendanceData>('/my-attendance'), enabled: !!session.data });
  const testsQ = useQuery({ queryKey: ['nv-tests'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank'), enabled: section === 'bai-kiem-tra' });
  const commsQ = useQuery({ queryKey: ['nv-comms'], queryFn: () => api.get<{ announcements: Record<string, unknown>[]; policies: Record<string, unknown>[]; mediaAssets?: Record<string, unknown>[] }>('/announcements'), enabled: section === 'ban-tin' });

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => { message.success('Đã ghi nhận điểm danh thành công'); setCameraModalKind(null); ['my-attendance', 'nv-schedules', 'nv-swaps', 'nv-attendance', 'nv-tests', 'attendance-all'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const todayDate = myQ.data?.todayDate || dayjs().format('YYYY-MM-DD');
  useEffect(() => { if (section === 'diem-danh') setSelectedShiftId(''); }, [section, todayDate]);
  const empId = myQ.data?.profile.employeeId || session.data?.user.employeeId || '', empCode = myQ.data?.profile.employeeCode || session.data?.user.employeeId || '';
  const publishedShifts = myQ.data?.shifts ?? [], allEvents = myQ.data?.events ?? [];
  const activeShift = publishedShifts.find((s) => String(s.id) === selectedShiftId) ?? publishedShifts.find((s) => Boolean(s.canCheckOutNow)) ?? publishedShifts.find((s) => String(s.workDate) === todayDate && s.status === 'PUBLISHED' && !s.isAbsentShift && !s.isExpiredToday && !(s.checkInEvent && s.checkOutEvent)) ?? publishedShifts.find((s) => String(s.workDate) === todayDate && s.status === 'PUBLISHED') ?? publishedShifts.find((s) => String(s.workDate) === todayDate) ?? publishedShifts[0] ?? null;
  const isSelectedToday = Boolean(activeShift && String(activeShift.workDate) === todayDate), isSelectedApproved = Boolean(activeShift && activeShift.status !== 'DRAFT');
  const shiftEvents = allEvents.filter((e) => activeShift && String(e.assignment_id) === String(activeShift.id));
  const checkInEvent = shiftEvents.find((e) => e.type === 'CHECK_IN'), checkOutEvent = shiftEvents.find((e) => e.type === 'CHECK_OUT');
  const isSelectedDone = Boolean(activeShift && (activeShift.status === 'COMPLETED' || (checkInEvent && checkOutEvent)));
  const isSelectedAbsent = Boolean(activeShift && (activeShift.status === 'ABSENT' || activeShift.isAbsentShift || (!checkInEvent && activeShift.status === 'PUBLISHED' && (String(activeShift.workDate) < todayDate || Boolean(activeShift.isExpiredToday)))));
  const isSelectedForgotOut = Boolean(activeShift && !isSelectedDone && checkInEvent && !checkOutEvent && Boolean(activeShift.isForgotCheckout));
  const canSelectedCheckOut = Boolean(activeShift && !isSelectedDone && checkInEvent && !checkOutEvent && !isSelectedForgotOut && (Boolean(activeShift.canCheckOutNow) || isSelectedToday));
  const myAdjustments = myQ.data?.adjustments ?? [], mySwaps = myQ.data?.swaps ?? [];
  const filteredCongShifts = publishedShifts.filter((s) => { const wd = String(s.workDate || ''); return congPeriod === 'TODAY' ? wd === todayDate : congPeriod === 'WEEK' ? dayjs(wd).isAfter(dayjs(todayDate).subtract(7, 'day')) && dayjs(wd).isBefore(dayjs(todayDate).add(7, 'day')) : congPeriod === 'MONTH' ? wd.slice(0, 7) === todayDate.slice(0, 7) : true; });
  const totalCongHours = filteredCongShifts.reduce((acc, s) => acc + Number(s.workedHours ?? s.scheduledHours ?? 0), 0), totalOtHours = filteredCongShifts.reduce((acc, s) => acc + Number(s.otHours ?? 0), 0);
  const myTests = (testsQ.data?.assignments ?? []).filter((a) => Boolean(a.isMine) || Boolean(empId && (a.employee_id === empId || a.employeeCode === empCode)));
  const myAttempts = (testsQ.data?.attempts ?? []).filter((att) => Boolean(att.isMine) || Boolean(empId && (att.employee_id === empId || att.employeeCode === empCode)));

  const moreOptionCards = [
    { title: 'Phiếu lương cá nhân', desc: 'Xem chi tiết bảng lương & xác nhận thực lĩnh', icon: <FileTextOutlined />, action: () => router.push('/nv/phieu-luong') },
    { title: 'Bài kiểm tra Nghiệp vụ', desc: 'Làm bài kiểm tra quy chuẩn pha chế SOP & nội quy', icon: <BookOutlined />, action: () => router.push('/nv/bai-kiem-tra') },
    { title: 'Bản tin truyền thông nội bộ', desc: 'Xem thông báo vận hành & chiến dịch mới', icon: <NotificationOutlined />, action: () => router.push('/nv/ban-tin') },
    { title: 'Hồ sơ cá nhân & Ngân hàng', desc: 'Cập nhật họ tên, SĐT, Email, địa chỉ và tài khoản nhận lương', icon: <UserOutlined />, action: () => setProfileTab('info') },
    { title: 'Đổi mật khẩu / Mã PIN bảo mật', desc: 'Thay đổi mật khẩu hoặc mã PIN 6 chữ số của bạn', icon: <KeyOutlined />, action: () => setProfileTab('password') },
  ];

  const refreshSection = () => ['my-attendance', 'schedules', 'nv-swaps', 'nv-tests', 'nv-comms', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const isRefreshing = myQ.isFetching || testsQ.isFetching || commsQ.isFetching;
  const isSchedSection = section === 'lich' || section === 'nghi-phep' || section === 'doi-ca';
  const schedMode = section === 'nghi-phep' ? 'leaves' : section === 'doi-ca' ? 'swaps' : 'shifts';
  const schedCenter = <EmployeeScheduleAndLeaveCenter todayDate={todayDate} empId={empId} empCode={empCode} stage={myQ.data?.profile.stage} mode={schedMode} initialTab={schedMode} shifts={publishedShifts} leaves={myQ.data?.leaves ?? []} emergencyLeaves={myQ.data?.emergencyLeaves ?? []} swaps={mySwaps} branchPeers={myQ.data?.branchPeers ?? []} refreshing={myQ.isFetching} onRefresh={refreshSection} />;

  return (
    <div style={{ padding: isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Card size="small" title={title} extra={isSchedSection || section === 'them' ? undefined : <Button size="small" icon={<ReloadOutlined />} loading={isRefreshing} onClick={refreshSection}>Làm mới</Button>} style={{ marginBottom: 12 }}>
        <Spin spinning={section !== 'them' && section !== 'thong-bao' && isRefreshing} tip="Đang tải dữ liệu...">
        {isSchedSection && schedCenter}
        {section === 'diem-danh' && (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={isDesktop ? 9 : 24}>
              <div style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.textSecondary, marginBottom: 6 }}>Chọn ca làm việc của bạn để điểm danh</div>
                {publishedShifts.length === 0 ? <Alert type="info" showIcon message="Bạn chưa có ca làm việc nào được phân công trong kỳ này để điểm danh." /> : (
                  <>
                    <Select style={{ width: '100%', marginBottom: 10 }} value={String(activeShift?.id ?? '')} onChange={setSelectedShiftId} options={publishedShifts.map((s) => { const sEvs = allEvents.filter((e) => String(e.assignment_id) === String(s.id)); const isAbs = s.status === 'ABSENT' || Boolean(s.isAbsentShift); const isT = String(s.workDate) === todayDate; const hasIn = sEvs.some((e) => e.type === 'CHECK_IN'), hasOut = sEvs.some((e) => e.type === 'CHECK_OUT'); const stateTag = s.status === 'DRAFT' ? 'Chờ CH / HR duyệt ca' : (s.status === 'COMPLETED' || (hasIn && hasOut)) ? 'Hoàn thành' : isAbs ? 'Vắng mặt (Cần bù công)' : (hasIn && !hasOut && Boolean(s.isForgotCheckout)) ? 'Quên Ra ca (Quá 1h — Cần bù công)' : (hasIn && !hasOut && Boolean(s.isWithinCheckoutGrace)) ? `Đã vào ca (Còn hạn Ra ca đến ${String(s.checkoutGraceDeadlineHm || '')})` : hasIn ? 'Đã vào ca (Chờ Ra ca)' : isT ? 'Hôm nay · Chưa vào ca' : 'Đã duyệt · Chưa tới ngày'; return { value: String(s.id), label: `${isT ? '[HÔM NAY] ' : ''}${dayjs(String(s.workDate)).format('DD/MM/YYYY')} · ${cleanShiftName(s.shiftLabel)} (${s.startAt || '07:00'}–${s.endAt || '12:00'}) · ${stateTag}` }; })} />
                    {activeShift && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{cleanShiftName(activeShift.shiftLabel)} ({String(activeShift.startAt || '07:00')} – {String(activeShift.endAt || '12:00')})</span>
                        <Space size={4} wrap>
                          <StatusTag value={String(isSelectedAbsent ? 'ABSENT' : isSelectedDone ? 'COMPLETED' : activeShift.status)} label={isSelectedAbsent ? 'Vắng mặt' : isSelectedDone ? 'Đã hoàn thành' : String(activeShift.statusLabel || '') || undefined} />
                          {isSelectedApproved && !isSelectedAbsent && !checkInEvent && <Tag style={{ margin: 0 }}>Chưa vào ca</Tag>}
                          {checkInEvent && <Tag color={checkInEvent.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0 }}>Vào: {String(checkInEvent.checkTimeFormatted || '').slice(0, 5)} ({String(checkInEvent.punctualityLabel)})</Tag>}
                          {checkOutEvent && <Tag color={checkOutEvent.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0 }}>Ra: {String(checkOutEvent.checkTimeFormatted || '').slice(0, 5)} ({String(checkOutEvent.punctualityLabel)})</Tag>}
                        </Space>
                      </div>
                    )}
                    {!isSelectedApproved ? <Alert type="warning" showIcon message="Ca đăng ký này đang chờ Quản lý cửa hàng hoặc HR duyệt phân ca. Chỉ được phép chấm công Vào/Ra ca sau khi ca đã chuyển sang Đã phân ca chính thức." /> : isSelectedDone ? <Alert type="success" showIcon message="Đã hoàn thành đầy đủ ca làm việc này." action={activeShift ? <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => setAttShiftId(String(activeShift.id))}>Chi tiết điểm danh</Button> : undefined} /> : (isSelectedAbsent || isSelectedForgotOut) ? (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {activeShift?.pendingAdjustmentCode ? <Alert type="warning" showIcon message={`Ca làm việc này đã gửi Phiếu bổ sung công (${String(activeShift.pendingAdjustmentCode)}) và đang chờ Cửa hàng / HR phê duyệt.`} /> : isSelectedForgotOut ? <><Alert type="error" showIcon message={`Ca làm việc ngày ${dayjs(String(activeShift?.workDate)).format('DD/MM/YYYY')} đã quá thời hạn 60 phút sau giờ kết thúc ca mà chưa Ra ca. Vui lòng gửi Phiếu bổ sung công để bù giờ Ra ca.`} /><Button type="primary" danger block icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(String(activeShift?.id)); setAdjOpen(true); }}>Làm phiếu bổ sung công (Quên chấm công Ra ca)</Button></> : <><Alert type="error" showIcon message={`Ca làm việc (${String(activeShift?.startAt || '07:00')} – ${String(activeShift?.endAt || '12:00')}) đã qua giờ kết thúc ca mà chưa điểm danh nên đã khóa Vào ca và chuyển sang Vắng mặt.`} /><Button type="primary" danger block icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(String(activeShift?.id)); setAdjOpen(true); }}>Làm phiếu bổ sung công bù ca vắng mặt này</Button></>}
                      </Space>
                    ) : canSelectedCheckOut ? <Space direction="vertical" size={8} style={{ width: '100%' }}>{Boolean(activeShift?.isWithinCheckoutGrace) && <Alert type="info" showIcon message={`Ca đã qua giờ kết thúc (${String(activeShift?.endAt || '12:00')}) nhưng vẫn trong 60 phút cho phép — Bạn có thể chấm công Ra ca đến ${String(activeShift?.checkoutGraceDeadlineHm || '')}.`} />}<Button type="primary" block icon={<CameraOutlined />} onClick={() => setCameraModalKind('CHECK_OUT')}>Ra ca (Chụp ảnh Camera &amp; GPS)</Button></Space> : !isSelectedToday ? <Alert type="warning" showIcon message={`Ca đang chọn thuộc ngày ${dayjs(String(activeShift?.workDate)).format('DD/MM/YYYY')}. Chỉ được điểm danh đúng ngày đăng ký ca (Hôm nay: ${dayjs(todayDate).format('DD/MM/YYYY')}).`} /> : !checkInEvent ? <Button type="primary" block icon={<CameraOutlined />} disabled={!activeShift} onClick={() => setCameraModalKind('CHECK_IN')}>Vào ca (Chụp ảnh Camera &amp; GPS)</Button> : <Alert type="success" showIcon message="Đã hoàn thành đầy đủ Vào ca & Ra ca cho ca làm việc này." />}
                    {activeShift && !activeShift.pendingAdjustmentCode && <Button size="small" block icon={<FileAddOutlined />} style={{ marginTop: 8 }} onClick={() => { setPresetAdjShiftId(String(activeShift.id)); setAdjOpen(true); }}>Báo sự cố GPS / Camera hoặc Quên chấm công</Button>}
                  </>
                )}
              </div>
            </Col>
            <Col xs={24} lg={isDesktop ? 15 : 24}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lịch sử điểm danh Vào ca &amp; Ra ca của bạn</div>
              <SelectableTable<AttendanceEventRow> size="small" rowKey="id" pagination={attPag} dataSource={groupAttendanceEventsByShift(allEvents)} bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAttendanceEventsExcel(rows) }]} locale={{ emptyText: 'Bạn chưa có lượt điểm danh nào trong kỳ.' }} columns={[{ title: 'Ngày & Ca làm việc', width: 185, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)} ({String(r.shiftTimeRange || '07:00 – 12:00')})</div><div className="num" style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày: {r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '—'}</div></div> }, { title: 'Vào ca / Ra ca', width: 340, render: (_, r) => renderShiftCheckInOutSummary(r) }, { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết điểm danh" onViewDetail={() => setDetailEvent(r)} /> }]} />
            </Col>
          </Row>
        )}

        {section === 'cong' && (
          <Tabs items={[
            {
              key: 'timesheet', label: <span><ClockCircleOutlined /> Công của tôi theo ca ({filteredCongShifts.length})</span>,
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <Space size={8} wrap>
                      <Select size="small" style={{ width: 190 }} value={congPeriod} onChange={setCongPeriod} options={[{ value: 'ALL', label: 'Kỳ xem: Toàn bộ kỳ' }, { value: 'TODAY', label: 'Kỳ xem: Hôm nay' }, { value: 'WEEK', label: 'Kỳ xem: Theo tuần (±7 ngày)' }, { value: 'MONTH', label: 'Kỳ xem: Theo tháng hiện tại' }]} />
                      <Tag color="blue" style={{ margin: 0 }}>Tổng giờ ca: <strong>{totalCongHours}h</strong> · Tăng ca (OT): <strong>{totalOtHours}h</strong></Tag>
                    </Space>
                    <Button size="small" type="primary" icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(undefined); setAdjOpen(true); }}>Yêu cầu bổ sung công</Button>
                  </div>
                  <SelectableTable<Record<string, unknown>> size="small" rowKey="id" pagination={attPag} dataSource={filteredCongShifts} bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAdjustmentsExcel(rows) }]} columns={[{ title: 'Ngày làm', dataIndex: 'workDate', width: 115, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> }, { title: 'Ca & Tổng giờ / OT', width: 225, render: (_, r) => <Space size={4} wrap><strong>{cleanShiftName(r.shiftLabel)}</strong><Tag color="blue" style={{ margin: 0 }}>{String(r.startAt || '07:00')}–{String(r.endAt || '12:00')} ({String(r.scheduledHours || 5)}h{Number(r.otHours || 0) > 0 ? ` + OT ${r.otHours}h` : ''})</Tag></Space> }, { title: 'Check-in / Check-out & Cờ sự cố', render: (_, r) => { const inEv = r.checkInEvent as Record<string, unknown> | null; const outEv = r.checkOutEvent as Record<string, unknown> | null; return <Space size={4} wrap>{inEv ? <Tag color={inEv.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0 }}>Vào: {String(inEv.checkTimeFormatted || '').slice(0, 5)} ({String(inEv.punctualityLabel)})</Tag> : <Tag style={{ margin: 0 }}>Chưa Check-in</Tag>}{outEv ? <Tag color={outEv.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0 }}>Ra: {String(outEv.checkTimeFormatted || '').slice(0, 5)} ({String(outEv.punctualityLabel)})</Tag> : inEv ? <Tag color="orange" style={{ margin: 0 }}>Thiếu Check-out</Tag> : null}</Space>; } }, { title: 'Trạng thái công', width: 195, render: (_, r) => <Tag color={String(r.attendanceStatusColor || 'default')} style={{ margin: 0 }}>{String(r.attendanceStatusLabel || 'Chưa điểm danh')}</Tag> }, { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết ca công" onViewDetail={() => setDetailReq({ kind: 'shift', record: { ...r, employeeId: empId } })} /> }]} />
                </>
              ),
            },
            {
              key: 'adjustments', label: <span><FileAddOutlined /> Phiếu bổ sung công ({myAdjustments.length})</span>,
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 10 }}>
                    <Button size="small" type="primary" icon={<FileAddOutlined />} onClick={() => { setPresetAdjShiftId(undefined); setAdjOpen(true); }}>Gửi phiếu bổ sung công</Button>
                  </div>
                  <SelectableTable<Record<string, unknown>> size="small" rowKey="id" pagination={adjPag} dataSource={myAdjustments} bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportAdjustmentsExcel(rows) }]} columns={[{ title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 115, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> }, { title: 'Ngày công', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> }, { title: 'Khung ca & Giờ ca', width: 220, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{String(r.shiftTimeRange || '07:00 – 12:00')}</Tag></Space> }, { title: 'Loại sự cố, Lý do & Quyết định xử lý', render: (_, r) => <div><Tag color="orange" style={{ margin: '0 6px 0 0' }}>{r.kind === 'FORGOT_CHECK_IN' ? 'Quên Check-in' : r.kind === 'FORGOT_CHECK_OUT' ? 'Quên Check-out' : r.kind === 'GPS_ERROR' ? 'Lỗi GPS' : r.kind === 'CAMERA_ERROR' ? 'Lỗi Camera' : 'Sự cố khác'}</Tag><span>{String(r.reason || '')}</span>{Boolean(r.decision_reason) && <div style={{ fontSize: 11, color: r.status === 'REJECTED' ? '#DC2626' : '#15803D', marginTop: 2 }}>{r.status === 'REJECTED' ? 'Lý do từ chối: ' : 'Quyết định xử lý: '}{String(r.decision_reason)}</div>}</div> }, { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 105, render: (v: number) => <strong>{v} giờ</strong> }, { title: 'Trạng thái xử lý', dataIndex: 'status', width: 155, render: (v: string) => <StatusTag value={v} /> }, { title: 'Thao tác', width: 88, fixed: 'right', align: 'right', render: (_, r) => <RowActionButtons detailTooltip="Xem chi tiết phiếu bổ sung" onViewDetail={() => setDetailReq({ kind: 'adjustment', record: r })} /> }]} />
                </>
              ),
            },
          ]} />
        )}

        {section === 'bai-kiem-tra' && <EmployeeTestCenterView assignments={myTests} attempts={myAttempts} tests={testsQ.data?.tests ?? []} onRefresh={() => qc.invalidateQueries({ queryKey: ['nv-tests'] })} />}
        {section === 'thong-bao' && <NotificationsCenterView portal="employee" />}
        {section === 'ban-tin' && (
          <Tabs items={[
            { key: 'announcements', label: <span><NotificationOutlined /> Bản tin Truyền thông Nội bộ ({(commsQ.data?.announcements ?? []).length})</span>, children: (commsQ.data?.announcements ?? []).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có bản tin truyền thông nội bộ nào mới" /> : (
              <List size="small" bordered dataSource={commsQ.data?.announcements ?? []} renderItem={(a) => (
                <List.Item extra={<Space size={4}><Button size="small" icon={<CheckCircleOutlined />} onClick={() => postMut.mutate({ url: `/announcements/${a.id}/ack`, body: {} })}>Đã đọc</Button><Tooltip title="Xem chi tiết bản tin"><Button size="small" icon={<EyeOutlined />} onClick={() => setViewingDoc({ kind: 'announcement', record: a })} /></Tooltip></Space>}>
                  <List.Item.Meta title={<div style={{ lineHeight: 1.45 }}><Tag color="geekblue" style={{ margin: '0 6px 2px 0', verticalAlign: 'text-top' }}>{String(a.code || a.announcement_code || 'BẢN TIN')}</Tag><Tag color={a.priority === 'URGENT' || a.priority === 'HIGH' ? 'red' : 'blue'} style={{ margin: '0 6px 2px 0', verticalAlign: 'text-top' }}>{a.priority === 'URGENT' ? 'Khẩn cấp' : a.priority === 'HIGH' ? 'Quan trọng' : 'Thông thường'}</Tag><Typography.Link strong onClick={() => setViewingDoc({ kind: 'announcement', record: a })}>{String(a.title)}</Typography.Link>{Array.isArray(a.mediaAttachments) && a.mediaAttachments.length > 0 && <Tag color="cyan" icon={<PaperClipOutlined />} style={{ margin: '0 0 2px 6px', verticalAlign: 'text-top' }}>{a.mediaAttachments.length} đính kèm</Tag>}</div>} description={<div><div>{String(a.summary || '')}</div>{a.sent_at ? <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 2 }}>Phát hành lúc: {dayjs(String(a.sent_at)).format('HH:mm DD/MM/YYYY')}</div> : null}</div>} />
                </List.Item>
              )} />
            ) },
            { key: 'policies', label: <span><FileProtectOutlined /> Chính sách &amp; Quy định Công ty ({(commsQ.data?.policies ?? []).length})</span>, children: (commsQ.data?.policies ?? []).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có chính sách quy định nào được phổ biến" /> : (
              <List size="small" bordered dataSource={commsQ.data?.policies ?? []} renderItem={(p) => { const polVal = String(p.value_json ?? p.value ?? '').trim(); return (
                <List.Item extra={<Tooltip title="Xem chi tiết chính sách"><Button size="small" icon={<EyeOutlined />} onClick={() => setViewingDoc({ kind: 'policy', record: p })} /></Tooltip>}>
                  <List.Item.Meta title={<div style={{ lineHeight: 1.45 }}><Tag color="blue" style={{ margin: '0 6px 2px 0', verticalAlign: 'text-top' }}>{POLICY_CATEGORY_LABELS[String(p.category || 'GENERAL')] ?? String(p.category || 'Quy định chung')}</Tag><Typography.Link strong onClick={() => setViewingDoc({ kind: 'policy', record: p })}>{String(p.title || p.description || p.key)}</Typography.Link>{Boolean(polVal && polVal !== 'undefined') && <Tag color="cyan" style={{ margin: '0 0 2px 6px', verticalAlign: 'text-top' }}>{polVal}</Tag>}</div>} description={<div style={{ fontSize: 12, color: BRAND.textSecondary }}>Phiên bản {String(p.policy_version || 'v5.1')} · Hiệu lực từ {String(p.effective_from || '—')} · Ban hành bởi {String(p.creatorName || p.approved_by || 'Hệ thống')}</div>} />
                </List.Item>
              ); }} />
            ) },
          ]} />
        )}
        {section === 'them' && (
          <Row gutter={[12, 12]}>
            {moreOptionCards.map((opt) => (
              <Col xs={24} md={12} key={opt.title}><div onClick={opt.action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#F8FAFC', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 36, height: 36, borderRadius: 4, background: '#EFF6FF', color: BRAND.primary, display: 'grid', placeItems: 'center', fontSize: 18 }}>{opt.icon}</span><div><div style={{ fontWeight: 600, fontSize: 14, color: BRAND.text }}>{opt.title}</div><div style={{ fontSize: 12, color: BRAND.textSecondary }}>{opt.desc}</div></div></div><RightOutlined style={{ color: BRAND.textSecondary }} /></div></Col>
            ))}
          </Row>
        )}
        </Spin>
      </Card>

      <AttendanceCameraModal open={Boolean(cameraModalKind)} kind={cameraModalKind ?? 'CHECK_IN'} shift={activeShift} loading={postMut.isPending} onClose={() => setCameraModalKind(null)} onConfirm={(payload) => postMut.mutate({ url: '/attendance/check', body: payload })} />
      <AttendanceEventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
      <ScheduleRequestDetailModal target={detailReq} onClose={() => setDetailReq(null)} />
      <AttendanceAdjustmentModal open={adjOpen} employeeId={empId} shifts={publishedShifts} initialShiftId={presetAdjShiftId} onClose={() => setAdjOpen(false)} onSuccess={() => qc.invalidateQueries({ queryKey: ['my-attendance'] })} />
      <GovernanceDetailDrawer record={viewingDoc?.record ?? null} kind={viewingDoc?.kind ?? 'announcement'} mediaPool={commsQ.data?.mediaAssets} onClose={() => setViewingDoc(null)} />
      <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
    </div>
  );
}
