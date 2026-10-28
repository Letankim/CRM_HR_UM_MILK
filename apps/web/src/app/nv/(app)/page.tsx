'use client';

import { useState } from 'react';
import { Avatar, Badge, Button, Card, Col, Dropdown, Grid, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  BookOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DownOutlined, EnvironmentOutlined, FieldTimeOutlined, FileTextOutlined, KeyOutlined,
  LogoutOutlined, NotificationOutlined, ReloadOutlined, SwapOutlined, UserOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, ROLE_SHORT_LABELS, SYSTEM_CONFIG } from '@umbm/shared';
import { api } from '@/lib/api';
import { useLogout, useMe } from '@/lib/auth';
import { StatusTag } from '@/ui/StatusTag';
import { BRAND } from '@/ui/theme';
import { UserProfileModal } from '@/ui/components/UserProfileModal';

interface MyAttendanceData {
  todayDate: string;
  profile: { employeeId: string; employeeCode: string; fullName: string; stage?: string; branchName?: string; probationStart?: string; probationEnd?: string; probationCycleDays?: number; probationDaysPassed?: number; probationDaysRemaining?: number };
  shifts: Record<string, unknown>[]; events: Record<string, unknown>[]; leaves: Record<string, unknown>[];
  emergencyLeaves?: Record<string, unknown>[]; swaps?: Record<string, unknown>[];
  branchPeers?: { id: string; employeeCode: string; fullName: string; positionTitle?: string; branchName?: string; busyShiftsByDate?: Record<string, string> }[];
}

export default function EmployeeHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useMe();
  const logout = useLogout('employee');
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.md);
  const [profileTab, setProfileTab] = useState<'info' | 'password' | null>(null);

  const myQ = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendanceData>('/my-attendance'), enabled: !!data });
  const swapsQ = useQuery({ queryKey: ['nv-swaps'], queryFn: () => api.list<Record<string, unknown>>('/admin/shift-swaps?per_page=50'), enabled: !!data });
  const testsQ = useQuery({ queryKey: ['nv-tests'], queryFn: () => api.get<{ tests: Record<string, unknown>[]; assignments: Record<string, unknown>[] }>('/admin/tests/bank'), enabled: !!data });
  const commsQ = useQuery({ queryKey: ['nv-comms'], queryFn: () => api.get<{ announcements: Record<string, unknown>[] }>('/announcements'), enabled: !!data });

  if (!data) return null;
  const u = data.user;
  const isProbation = u.role === 'THU_VIEC';
  const isInternal = !['THU_VIEC', 'CHINH_THUC'].includes(u.role);
  const empCode = myQ.data?.profile.employeeCode || u.employeeId || 'NV0001';
  const empId = myQ.data?.profile.employeeId || u.employeeId || '';
  const todayDate = myQ.data?.todayDate || dayjs().format('YYYY-MM-DD');
  const displayShifts = myQ.data?.shifts ?? [];
  const myEvents = myQ.data?.events ?? [];
  const myLeaves = myQ.data?.leaves ?? [];
  const pendingSwaps = (swapsQ.data?.data ?? []).filter((s) => (s.requester_id === empId || s.requesterCode === empCode || s.peer_id === empId || s.peerCode === empCode) && (s.status === 'PENDING_PEER' || s.status === 'PEER_ACCEPTED'));
  const myTests = (testsQ.data?.assignments ?? []).filter((a) => !empId || a.employee_id === empId || a.employeeCode === empCode);
  const probationDaysTotal = myQ.data?.profile.probationCycleDays || SYSTEM_CONFIG.defaults.probationCycleDays;
  const probationDaysPassed = myQ.data?.profile.probationDaysPassed ?? 7;
  const probationOffLimit = SYSTEM_CONFIG.defaults.probationOffDays;
  const usedOffCount = myLeaves.filter((l) => l.status !== 'REJECTED').length;
  const branchName = myQ.data?.profile.branchName || 'Chi nhánh Ụm Bò Milk';
  const tomorrowDate = dayjs(todayDate).add(1, 'day').format('YYYY-MM-DD');
  const todayShifts = displayShifts.filter((s) => String(s.workDate) === todayDate);
  const tomorrowShifts = displayShifts.filter((s) => String(s.workDate) === tomorrowDate);
  const abnormalShiftsCount = displayShifts.filter((s) => s.status === 'ABSENT' || Boolean(s.isAbsentShift)).length;

  const summaryCard = (
    <Card size="small" style={{ marginBottom: isDesktop ? 0 : 12, background: '#EFF6FF', borderColor: '#BFDBFE', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px 12px' }}>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: BRAND.textSecondary, marginBottom: 2 }}>Nhân sự &amp; Mã NV</div><div className="mono" style={{ fontSize: 13, fontWeight: 700, color: BRAND.primary, lineHeight: '20px' }}>{u.displayName} ({empCode})</div></div>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: BRAND.textSecondary, marginBottom: 2 }}>Chi nhánh</div><div style={{ fontSize: 12, fontWeight: 600 }}>{branchName}</div></div>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: BRAND.textSecondary, marginBottom: 2 }}>Giai đoạn</div><Tag color={isProbation ? 'gold' : 'blue'} style={{ margin: 0, fontWeight: 600 }}>{ROLE_LABELS[u.role]}</Tag></div>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: BRAND.textSecondary, marginBottom: 2 }}>Tài khoản &amp; OFF</div><Space size={4}><StatusTag value={u.status} /><Tag color="cyan" style={{ margin: 0 }}>OFF: {usedOffCount} ngày</Tag></Space></div>
      </div>
    </Card>
  );

  const probationCard = isProbation ? (
    <Card size="small" title={<span><ClockCircleOutlined /> Tiến độ Chu kỳ Thử việc ({probationDaysTotal} ngày)</span>} style={{ marginBottom: isDesktop ? 0 : 12 }}>
      <Progress percent={Math.round((probationDaysPassed / probationDaysTotal) * 100)} size="small" strokeColor={BRAND.primary} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: BRAND.textSecondary, marginTop: 4 }}>
        <span>Đã qua: <strong>{probationDaysPassed} ngày</strong> · Còn lại: <strong>{probationDaysTotal - probationDaysPassed} ngày</strong></span>
        <span>Nghỉ OFF: <strong>{usedOffCount}/{probationOffLimit} ngày</strong></span>
      </div>
    </Card>
  ) : (
    <Card size="small" title={<span><CalendarOutlined /> Tóm tắt Ca hôm nay, Lịch ngày mai &amp; Nghỉ OFF tuần</span>} style={{ marginBottom: isDesktop ? 0 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, fontSize: 12 }}>
        <span>Ca hôm nay: <strong>{todayShifts.length > 0 ? `${todayShifts.length} ca (${String(todayShifts[0]?.startAt || '07:00')}–${String(todayShifts[0]?.endAt || '12:00')})` : 'Không có ca'}</strong></span>
        <span>Ngày mai ({dayjs(tomorrowDate).format('DD/MM')}): <strong>{tomorrowShifts.length > 0 ? `${tomorrowShifts.length} ca (${String(tomorrowShifts[0]?.startAt || '07:00')}–${String(tomorrowShifts[0]?.endAt || '12:00')})` : 'Trống lịch / OFF'}</strong></span>
        <span>OFF đã đăng ký: <strong>{usedOffCount} ngày</strong></span>
      </div>
    </Card>
  );

  const shiftsCard = (
    <Card size="small" title={<span><CalendarOutlined /> Ca làm việc đã phát hành của bạn</span>} extra={<Space size={8}><Button size="small" icon={<ReloadOutlined />} loading={myQ.isFetching} onClick={() => { myQ.refetch(); swapsQ.refetch(); }}>Làm mới</Button><Link href="/nv/lich" style={{ fontSize: 12 }}>Xem tất cả</Link></Space>} style={{ marginBottom: isDesktop ? 0 : 12 }}>
      {displayShifts.length === 0 ? (
        <Typography.Text type="secondary">Chưa có ca làm việc nào được phân công cho bạn trong kỳ này.</Typography.Text>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {displayShifts.slice(0, isDesktop ? 6 : 4).map((s) => {
            const sEvs = myEvents.filter((e) => String(e.assignment_id) === String(s.id));
            const inEv = sEvs.find((e) => e.type === 'CHECK_IN');
            const outEv = sEvs.find((e) => e.type === 'CHECK_OUT');
            const isTodayShift = String(s.workDate) === todayDate;
            return (
              <div key={String(s.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 10px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{String(s.shiftLabel || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim()} ({String(s.startAt || '07:00')} – {String(s.endAt || '12:00')})</div>
                  <div style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày {String(s.workDate)} · {String(s.branchName)}</div>
                  {(inEv || outEv) && (
                    <Space size={4} wrap style={{ marginTop: 4 }}>
                      {inEv && <Tag color={inEv.punctualityStatus === 'LATE' ? 'volcano' : 'green'} style={{ margin: 0, fontSize: 11 }}>Vào: {String(inEv.checkTimeFormatted || '').slice(0, 5)} ({String(inEv.punctualityLabel)})</Tag>}
                      {outEv && <Tag color={outEv.punctualityStatus === 'EARLY_LEAVE' ? 'orange' : 'green'} style={{ margin: 0, fontSize: 11 }}>Ra: {String(outEv.checkTimeFormatted || '').slice(0, 5)} ({String(outEv.punctualityLabel)})</Tag>}
                    </Space>
                  )}
                </div>
                {s.status === 'DRAFT' ? (
                  <Tag color="gold" style={{ margin: 0 }}>Chờ CH / HR duyệt ca</Tag>
                ) : (s.status === 'COMPLETED' || (inEv && outEv)) ? (
                  <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>Đã hoàn thành ca</Tag>
                ) : (s.status === 'ABSENT' || Boolean(s.isAbsentShift)) ? (
                  <Space size={6}><Tag color="red" style={{ margin: 0 }}>Vắng mặt (Quá giờ ca)</Tag><Link href="/nv/cong"><Button size="small" danger>Bổ sung công</Button></Link></Space>
                ) : !isTodayShift ? (
                  <Tag color="gold" style={{ margin: 0 }}>Ca ngày {dayjs(String(s.workDate)).format('DD/MM')}</Tag>
                ) : !inEv ? (
                  <Link href="/nv/diem-danh"><Button size="small" type="primary" icon={<CheckCircleOutlined />}>Vào ca</Button></Link>
                ) : (
                  <Space size={6}><Tag color="green" style={{ margin: 0 }}>Đã vào ca</Tag><Link href="/nv/diem-danh"><Button size="small" type="primary" icon={<CheckCircleOutlined />}>Ra ca</Button></Link></Space>
                )}
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );

  const tasksCard = (
    <Card size="small" title="Việc cần chú ý, Yêu cầu chờ duyệt & Cảnh báo xử lý">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><FieldTimeOutlined /> Cảnh báo công / Ca cần bổ sung</span><Link href="/nv/cong"><Badge count={abnormalShiftsCount} showZero color="#DC2626" /></Link></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><ClockCircleOutlined /> Đơn nghỉ OFF đang chờ duyệt</span><Link href="/nv/nghi-phep"><Badge count={myLeaves.filter((l) => l.status === 'PENDING').length} showZero color="#D97706" /></Link></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><SwapOutlined /> Yêu cầu đổi ca đang xử lý</span><Link href="/nv/doi-ca"><Badge count={pendingSwaps.length} showZero color={BRAND.primary} /></Link></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><BookOutlined /> Bài kiểm tra TEST / Đào tạo</span><Link href="/nv/bai-kiem-tra"><Tag color="blue" style={{ margin: 0 }}>{myTests.length} bài được giao</Tag></Link></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span><NotificationOutlined /> Bản tin truyền thông nội bộ</span><Link href="/nv/ban-tin"><Tag color="geekblue" style={{ margin: 0 }}>{(commsQ.data?.announcements ?? []).length} bản tin · Xem ngay</Tag></Link></div>
      </Space>
    </Card>
  );

  if (isDesktop) {
    return (
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            {[
              { href: '/nv/diem-danh', label: 'Điểm danh GPS', icon: <EnvironmentOutlined />, primary: true },
              { href: '/nv/lich', label: 'Xem lịch & Đăng ký ca', icon: <CalendarOutlined /> },
              { href: '/nv/nghi-phep', label: 'Đăng ký Nghỉ OFF', icon: <ClockCircleOutlined /> },
              { href: '/nv/bai-kiem-tra', label: 'Thi TEST Nghiệp vụ', icon: <BookOutlined /> },
              { href: '/nv/cong', label: 'Công của tôi & Bù công', icon: <FieldTimeOutlined /> },
              { href: '/nv/phieu-luong', label: 'Phiếu lương cá nhân', icon: <FileTextOutlined /> },
            ].map((btn) => (
              <Col span={8} key={btn.href}><Link href={btn.href} style={{ display: 'block' }}><Button type={btn.primary ? 'primary' : 'default'} icon={btn.icon} block style={{ height: 40, justifyContent: 'flex-start', fontWeight: 600 }}>{btn.label}</Button></Link></Col>
            ))}
          </Row>
          {shiftsCard}
        </Col>
        <Col xs={24} lg={8}><Space direction="vertical" size={12} style={{ width: '100%' }}>{summaryCard}{probationCard}{tasksCard}</Space></Col>
      </Row>
    );
  }

  return (
    <div style={{ padding: '10px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{dayjs().format('DD/MM/YYYY')} · Cổng Nhân viên {SYSTEM_CONFIG.brandName}</Typography.Text>
          <Typography.Title level={5} style={{ margin: 0, fontWeight: 700 }}>{u.displayName}</Typography.Title>
        </div>
        <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [{ key: 'role', icon: <UserSwitchOutlined />, label: `${u.displayName} (${ROLE_LABELS[u.role]})`, disabled: true }, { type: 'divider' }, { key: 'profile', icon: <UserOutlined />, label: 'Hồ sơ cá nhân & Cập nhật thông tin', onClick: () => setProfileTab('info') }, { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu / Mã PIN bảo mật', onClick: () => setProfileTab('password') }, ...(isInternal ? [{ key: 'admin', icon: <UserSwitchOutlined />, label: 'Về trang Quản trị', onClick: () => router.push('/admin/my-attendance') }] : []), { type: 'divider' }, { key: 'logout', icon: <LogoutOutlined />, danger: true, label: 'Đăng xuất hệ thống', onClick: logout }] }}>
          <div className="umbm-header-pill" style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 6px', border: `1px solid ${BRAND.headerControlBorder}`, borderRadius: 8, cursor: 'pointer', background: '#F8FAFC', flexShrink: 0 }}>
            <Avatar size={22} style={{ background: BRAND.primaryBg, color: BRAND.primary, border: '1px solid #93C5FD', fontWeight: 700, fontSize: 11 }}>{(u.displayName || u.username).charAt(0).toUpperCase()}</Avatar>
            <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontSize: 11, lineHeight: '18px', paddingInline: 6, fontWeight: 600 }}>{ROLE_SHORT_LABELS[u.role]}</Tag>
            <DownOutlined style={{ fontSize: 10, color: '#64748B' }} />
          </div>
        </Dropdown>
      </div>
      {summaryCard}{probationCard}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        {[
          { href: '/nv/diem-danh', label: 'Điểm danh GPS', icon: <EnvironmentOutlined />, primary: true },
          { href: '/nv/lich', label: 'Xem lịch & Ca', icon: <CalendarOutlined /> },
          { href: '/nv/nghi-phep', label: 'Đăng ký Nghỉ OFF', icon: <ClockCircleOutlined /> },
          { href: '/nv/bai-kiem-tra', label: 'Thi TEST', icon: <BookOutlined /> },
          { href: '/nv/cong', label: 'Công & Bù công', icon: <FieldTimeOutlined /> },
          { href: '/nv/phieu-luong', label: 'Phiếu lương', icon: <FileTextOutlined /> },
        ].map((btn) => (
          <Col span={12} key={btn.href}><Link href={btn.href} style={{ display: 'block' }}><Button type={btn.primary ? 'primary' : 'default'} icon={btn.icon} block style={{ height: 40, justifyContent: 'flex-start', fontWeight: 600 }}>{btn.label}</Button></Link></Col>
        ))}
      </Row>
      {shiftsCard}{tasksCard}
      <UserProfileModal open={profileTab !== null} initialTab={profileTab ?? 'info'} onClose={() => setProfileTab(null)} />
    </div>
  );
}
