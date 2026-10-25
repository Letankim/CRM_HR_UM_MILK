'use client';

import { useState } from 'react';
import { notFound, useParams, useRouter } from 'next/navigation';
import { Alert, App, Button, Card, Col, Empty, Grid, List, Row, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import {
  BookOutlined, CalendarOutlined, CameraOutlined, CheckCircleOutlined, ClockCircleOutlined,
  EyeOutlined, FileAddOutlined, FileProtectOutlined, FileTextOutlined, KeyOutlined, NotificationOutlined, ReloadOutlined, RightOutlined, SwapOutlined, UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';
import { AttendanceCameraModal } from '@/ui/components/AttendanceCameraModal';
import { AttendanceEventDetailModal } from '@/ui/components/AttendanceEventDetailModal';
import { groupAttendanceEventsByShift, renderShiftCheckInOutSummary, type AttendanceEventRow } from '@/ui/components/AttendanceEventsTable';
import { AttendanceAdjustmentModal } from '@/ui/components/EmployeePortalModals';
import { EmployeeScheduleAndLeaveCenter } from '@/ui/components/EmployeeScheduleAndLeaveCenter';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from '@/ui/components/ScheduleRequestDetailModal';
import { EmployeeTestCenterView } from '@/ui/components/ExamTestCenter';
import { GovernanceDetailDrawer, POLICY_CATEGORY_LABELS } from '@/ui/components/GovernanceAndCommsModals';
import { NotificationsCenterView } from '@/ui/components/NotificationsCenterView';
import { UserProfileModal } from '@/ui/components/UserProfileModal';

const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

interface MyAttendanceData {
  todayDate: string; profile: { employeeId: string; employeeCode: string; fullName: string; stage?: string };
  shifts: Record<string, unknown>[]; events: AttendanceEventRow[]; leaves: Record<string, unknown>[];
  emergencyLeaves?: Record<string, unknown>[]; swaps?: Record<string, unknown>[];
  branchPeers?: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string }[];
  adjustments: Record<string, unknown>[];
}

const SECTIONS: Record<string, string> = {
  lich: 'Lịch làm việc & Đăng ký nghỉ phép / Đổi ca', 'diem-danh': 'Điểm danh GPS & Camera trực tiếp của bạn',
  cong: 'Bảng công cá nhân & Phiếu bổ sung công', 'bai-kiem-tra': 'Bài kiểm tra Nghiệp vụ (TEST)',
  'ban-tin': 'Bản tin Nội bộ & Chính sách Quy định Công ty', 'thong-bao': 'Trung tâm Thông báo & Hộp thư Cá nhân', them: 'Tiện ích mở rộng của bạn',
};

export default function EmployeeSection() {
  const { section } = useParams<{ section: string }>();
  const router = useRouter();
  const isDesktop = Boolean(Grid.useBreakpoint().md);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const session = useMe();
  const title = SECTIONS[section];
  if (!title) notFound();

  const [adjOpen, setAdjOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);
  const [cameraModalKind, setCameraModalKind] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [detailEvent, setDetailEvent] = useState<AttendanceEventRow | null>(null);
  const [detailReq, setDetailReq] = useState<ScheduleDetailTarget | null>(null);
  const [viewingDoc, setViewingDoc] = useState<{ kind: 'policy' | 'announcement'; record: Record<string, unknown> } | null>(null);

  const myQ = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendanceData>('/my-attendance'), enabled: !!session.data });
  const testsQ = useQuery({ queryKey: ['nv-tests'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[] }>('/admin/tests/bank'), enabled: section === 'bai-kiem-tra' });
  const commsQ = useQuery({ queryKey: ['nv-comms'], queryFn: () => api.get<{ announcements: Record<string, unknown>[]; policies: Record<string, unknown>[] }>('/announcements'), enabled: section === 'ban-tin' });

  const postMut = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => api.post(url, body),
    onSuccess: () => {
      message.success('Đã ghi nhận điểm danh thành công'); setCameraModalKind(null);
      ['my-attendance', 'nv-schedules', 'nv-swaps', 'nv-attendance', 'nv-tests', 'attendance-all'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác thất bại'),
  });

  const todayDate = myQ.data?.todayDate || dayjs().format('YYYY-MM-DD');
  const empId = myQ.data?.profile.employeeId || session.data?.user.employeeId || '';
  const empCode = myQ.data?.profile.employeeCode || session.data?.user.employeeId || '';
  const publishedShifts = myQ.data?.shifts ?? [];
  const activeShift = publishedShifts.find((s) => String(s.id) === selectedShiftId) ?? publishedShifts.find((s) => String(s.workDate) === todayDate && s.status === 'PUBLISHED') ?? publishedShifts.find((s) => String(s.workDate) === todayDate) ?? publishedShifts[0] ?? null;
  const isSelectedToday = Boolean(activeShift && String(activeShift.workDate) === todayDate);
  const isSelectedApproved = Boolean(activeShift && activeShift.status === 'PUBLISHED');
  const allEvents = myQ.data?.events ?? [];
  const shiftEvents = allEvents.filter((e) => activeShift && String(e.assignment_id) === String(activeShift.id));
  const checkInEvent = shiftEvents.find((e) => e.type === 'CHECK_IN');
  const checkOutEvent = shiftEvents.find((e) => e.type === 'CHECK_OUT');
  const myAdjustments = myQ.data?.adjustments ?? [];
  const mySwaps = myQ.data?.swaps ?? [];
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

  return (
    <div style={{ padding: isDesktop ? 0 : 16 }}>
      <Card size="small" title={title} extra={section === 'lich' || section === 'them' ? undefined : <Button size="small" icon={<ReloadOutlined />} loading={isRefreshing} onClick={refreshSection}>Làm mới</Button>} style={{ marginBottom: 12 }}>
        {section === 'lich' && (
          <EmployeeScheduleAndLeaveCenter
            todayDate={todayDate} empId={empId} empCode={empCode} stage={myQ.data?.profile.stage}
            shifts={publishedShifts} leaves={myQ.data?.leaves ?? []} emergencyLeaves={myQ.data?.emergencyLeaves ?? []}
            swaps={mySwaps} branchPeers={myQ.data?.branchPeers ?? []} refreshing={myQ.isFetching} onRefresh={refreshSection}
          />
        )}

        {section === 'diem-danh' && (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={isDesktop ? 9 : 24}>
              <div style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.textSecondary, marginBottom: 6 }}>Chọn ca làm việc của bạn để điểm danh</div>
                {publishedShifts.length === 0 ? (
                  <Alert type="info" showIcon message="Bạn chưa có ca làm việc nào được phân công trong kỳ này để điểm danh." />
                ) : (
                  <>
                    <Select style={{ width: '100%', marginBottom: 10 }} value={String(activeShift?.id ?? '')} onChange={setSelectedShiftId} options={publishedShifts.map((s) => { const sEvs = allEvents.filter((e) => String(e.assignment_id) === String(s.id)); const stateTag = s.status !== 'PUBLISHED' ? 'Chờ CH / HR duyệt ca' : sEvs.some((e) => e.type === 'CHECK_IN') && sEvs.some((e) => e.type === 'CHECK_OUT') ? 'Hoàn thành' : sEvs.some((e) => e.type === 'CHECK_IN') ? 'Đã vào ca' : 'Đã duyệt · Chưa vào ca'; return { value: String(s.id), label: `${dayjs(String(s.workDate)).format('DD/MM/YYYY')} · ${cleanShiftName(s.shiftLabel)} (${s.startAt || '07:00'}–${s.endAt || '12:00'}) · ${stateTag}` }; })} />
                    {activeShift && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{cleanShiftName(activeShift.shiftLabel)} ({String(activeShift.startAt || '07:00')} – {String(activeShift.endAt || '12:00')})</span>
                        <Space size={4} wrap>
                          <StatusTag value={String(activeShift.status)} label={String(activeShift.statusLabel || '') || undefined} />
                          {isSelectedApproved && !checkInEvent && <Tag style={{ margin: 0 }}>Chưa vào ca</Tag>}
                          {checkInEvent && <Tag color={checkInEvent.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0 }}>Vào: {String(checkInEvent.checkTimeFormatted || '').slice(0, 5)} ({String(checkInEvent.punctualityLabel)})</Tag>}
                          {checkOutEvent && <Tag color={checkOutEvent.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0 }}>Ra: {String(checkOutEvent.checkTimeFormatted || '').slice(0, 5)} ({String(checkOutEvent.punctualityLabel)})</Tag>}
                        </Space>
                      </div>
                    )}
                    {!isSelectedApproved ? (
                      <Alert type="warning" showIcon message="Ca đăng ký này đang chờ Quản lý cửa hàng hoặc HR duyệt phân ca. Chỉ được phép chấm công Vào/Ra ca sau khi ca đã chuyển sang Đã phân ca chính thức." />
                    ) : !isSelectedToday ? (
                      <Alert type="warning" showIcon message={`Ca đang chọn thuộc ngày ${dayjs(String(activeShift?.workDate)).format('DD/MM/YYYY')}. Chỉ được điểm danh đúng ngày đăng ký ca (Hôm nay: ${dayjs(todayDate).format('DD/MM/YYYY')}).`} />
                    ) : !checkInEvent ? (
                      <Button type="primary" block icon={<CameraOutlined />} disabled={!activeShift} onClick={() => setCameraModalKind('CHECK_IN')}>Vào ca (Chụp ảnh Camera &amp; GPS)</Button>
                    ) : !checkOutEvent ? (
                      <Button type="primary" block icon={<CameraOutlined />} onClick={() => setCameraModalKind('CHECK_OUT')}>Ra ca (Chụp ảnh Camera &amp; GPS)</Button>
                    ) : (
                      <Alert type="success" showIcon message="Đã hoàn thành đầy đủ Vào ca & Ra ca cho ca làm việc này." />
                    )}
                  </>
                )}
              </div>
            </Col>
            <Col xs={24} lg={isDesktop ? 15 : 24}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lịch sử điểm danh Vào ca &amp; Ra ca của bạn</div>
              <Table<AttendanceEventRow>
                size="small" rowKey="id" pagination={false} dataSource={groupAttendanceEventsByShift(allEvents)} locale={{ emptyText: 'Bạn chưa có lượt điểm danh nào trong kỳ.' }}
                columns={[
                  { title: 'Ngày & Ca làm việc', width: 165, render: (_, r) => <div><div style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel)} ({String(r.shiftTimeRange || '07:00 – 12:00')})</div><div className="num" style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày: {r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '—'}</div></div> },
                  { title: 'Vào ca / Ra ca', render: (_, r) => renderShiftCheckInOutSummary(r) },
                  { title: 'Thao tác', width: 64, align: 'center', render: (_, r) => <Tooltip title="Xem chi tiết điểm danh"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailEvent(r)} /></Tooltip> },
                ]}
              />
            </Col>
          </Row>
        )}

        {section === 'cong' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <Typography.Text type="secondary">Nếu quên chấm công ra ca, vui lòng gửi Phiếu bổ sung công. Bấm nút con mắt để xem chi tiết.</Typography.Text>
              <Button size="small" type="primary" icon={<FileAddOutlined />} onClick={() => setAdjOpen(true)}>Gửi phiếu bổ sung công</Button>
            </div>
            <Table size="small" rowKey="id" pagination={false} dataSource={myAdjustments} columns={[{ title: 'Mã phiếu', dataIndex: 'adjustment_code', width: 105, render: (v: string) => <Tag color="geekblue" style={{ margin: 0 }}>{v}</Tag> }, { title: 'Ngày công', dataIndex: 'work_date', width: 115, render: (v: string) => <strong className="num">{v ? dayjs(v).format('DD/MM/YYYY') : '—'}</strong> }, { title: 'Khung ca & Giờ ca', width: 215, render: (_, r) => <Space size={6} wrap><span style={{ fontWeight: 600 }}>{cleanShiftName(r.shiftLabel || r.shift_code)}</span><Tag color="blue" icon={<ClockCircleOutlined />} style={{ margin: 0 }}>{String(r.shiftTimeRange || '07:00 – 12:00')}</Tag></Space> }, { title: 'Giờ đề nghị', dataIndex: 'requested_hours', width: 105, render: (v: number) => <strong>{v} giờ</strong> }, { title: 'Lý do giải trình', dataIndex: 'reason', ellipsis: true }, { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag value={v} /> }, { title: 'Chi tiết', width: 70, align: 'center', render: (_, r) => <Tooltip title="Xem chi tiết phiếu bổ sung"><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailReq({ kind: 'adjustment', record: r })} /></Tooltip> }]} />
          </>
        )}

        {section === 'bai-kiem-tra' && <EmployeeTestCenterView assignments={myTests} attempts={myAttempts} tests={testsQ.data?.tests ?? []} onRefresh={() => qc.invalidateQueries({ queryKey: ['nv-tests'] })} />}
        {section === 'thong-bao' && <NotificationsCenterView portal="employee" />}
        {section === 'ban-tin' && (
          <Tabs
            items={[
              {
                key: 'announcements',
                label: <span><NotificationOutlined /> Bản tin Truyền thông Nội bộ ({(commsQ.data?.announcements ?? []).length})</span>,
                children: (commsQ.data?.announcements ?? []).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có bản tin truyền thông nội bộ nào mới" /> : (
                  <List size="small" bordered dataSource={commsQ.data?.announcements ?? []} renderItem={(a) => (
                    <List.Item extra={<Space size={4}><Button size="small" icon={<CheckCircleOutlined />} onClick={() => postMut.mutate({ url: `/announcements/${a.id}/ack`, body: {} })}>Đã đọc</Button><Tooltip title="Xem chi tiết bản tin"><Button size="small" icon={<EyeOutlined />} onClick={() => setViewingDoc({ kind: 'announcement', record: a })} /></Tooltip></Space>}>
                      <List.Item.Meta title={<Space size={6} wrap><Tag color="geekblue" style={{ margin: 0 }}>{String(a.code || a.announcement_code || 'BẢN TIN')}</Tag><Tag color={a.priority === 'URGENT' || a.priority === 'HIGH' ? 'red' : 'blue'} style={{ margin: 0 }}>{a.priority === 'URGENT' ? 'Khẩn cấp' : a.priority === 'HIGH' ? 'Quan trọng' : 'Thông thường'}</Tag><Typography.Link strong onClick={() => setViewingDoc({ kind: 'announcement', record: a })}>{String(a.title)}</Typography.Link></Space>} description={<div><div>{String(a.summary || '')}</div>{a.sent_at ? <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 2 }}>Phát hành lúc: {dayjs(String(a.sent_at)).format('HH:mm DD/MM/YYYY')}</div> : null}</div>} />
                    </List.Item>
                  )} />
                ),
              },
              {
                key: 'policies',
                label: <span><FileProtectOutlined /> Chính sách &amp; Quy định Công ty ({(commsQ.data?.policies ?? []).length})</span>,
                children: (commsQ.data?.policies ?? []).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có chính sách quy định nào được phổ biến" /> : (
                  <List size="small" bordered dataSource={commsQ.data?.policies ?? []} renderItem={(p) => (
                    <List.Item extra={<Tooltip title="Xem chi tiết chính sách"><Button size="small" icon={<EyeOutlined />} onClick={() => setViewingDoc({ kind: 'policy', record: p })} /></Tooltip>}>
                      <List.Item.Meta title={<Space size={6} wrap><Tag color="blue" style={{ margin: 0 }}>{POLICY_CATEGORY_LABELS[String(p.category || 'GENERAL')] ?? String(p.category || 'Quy định chung')}</Tag><Typography.Link strong onClick={() => setViewingDoc({ kind: 'policy', record: p })}>{String(p.title || p.key)}</Typography.Link><Tag color="cyan" style={{ margin: 0 }}>{String(p.value)}</Tag></Space>} description={<div>{String(p.description || '')}</div>} />
                    </List.Item>
                  )} />
                ),
              },
            ]}
          />
        )}
        {section === 'them' && (
          <Row gutter={[12, 12]}>
            {moreOptionCards.map((opt) => (
              <Col xs={24} md={12} key={opt.title}><div onClick={opt.action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#F8FAFC', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 36, height: 36, borderRadius: 4, background: '#EFF6FF', color: BRAND.primary, display: 'grid', placeItems: 'center', fontSize: 18 }}>{opt.icon}</span><div><div style={{ fontWeight: 600, fontSize: 14, color: BRAND.text }}>{opt.title}</div><div style={{ fontSize: 12, color: BRAND.textSecondary }}>{opt.desc}</div></div></div><RightOutlined style={{ color: BRAND.textSecondary }} /></div></Col>
            ))}
          </Row>
        )}
      </Card>

      <AttendanceCameraModal open={Boolean(cameraModalKind)} kind={cameraModalKind ?? 'CHECK_IN'} shift={activeShift} loading={postMut.isPending} onClose={() => setCameraModalKind(null)} onConfirm={(payload) => postMut.mutate({ url: '/attendance/check', body: payload })} />
      <AttendanceEventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      <ScheduleRequestDetailModal target={detailReq} onClose={() => setDetailReq(null)} />
      <AttendanceAdjustmentModal open={adjOpen} employeeId={empId} onClose={() => setAdjOpen(false)} onSuccess={() => qc.invalidateQueries({ queryKey: ['my-attendance'] })} />
      <GovernanceDetailDrawer record={viewingDoc?.record ?? null} kind={viewingDoc?.kind ?? 'announcement'} onClose={() => setViewingDoc(null)} />
      <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
    </div>
  );
}
