'use client';

import { Button, Card, Col, List, Row, Space, Statistic, Tag } from 'antd';
import {
  AlertOutlined, ArrowRightOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, SolutionOutlined, TeamOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';

export function HrDashboardActionPanel() {
  const can = useCan();
  const canRecruit = can('candidate.manage', 'interview.manage');
  const canPromote = can('employee.promote');
  const showHrPanel = can('candidate.manage', 'schedule.propose', 'leave.approve');

  const candQ = useQuery({
    queryKey: ['dashboard-candidates'],
    queryFn: () => api.list<{ id: string; status: string; full_name: string }>('/admin/candidates?per_page=100'),
    enabled: can('candidate.manage'),
  });
  const ivQ = useQuery({
    queryKey: ['dashboard-interviews'],
    queryFn: () => api.get<{ id: string; start_at: string; decision: string; status: string; reschedule_requested?: boolean }[]>('/admin/interviews'),
    enabled: can('interview.manage'),
  });
  const empQ = useQuery({
    queryKey: ['dashboard-employees'],
    queryFn: () => api.list<{ id: string; fullName: string; employeeCode: string; stage: string; probationEnd: string | null }>('/admin/employees?per_page=100'),
    enabled: can('employee.read'),
  });
  const schedQ = useQuery({
    queryKey: ['dashboard-schedules'],
    queryFn: () => api.list<{ id: string; work_date: string; status: string }>('/admin/schedules?per_page=100'),
    enabled: can('schedule.read'),
  });
  const leaveQ = useQuery({
    queryKey: ['dashboard-leaves'],
    queryFn: () => api.list<{ id: string; leave_date: string; status: string }>('/admin/leave-requests?per_page=50'),
    enabled: can('schedule.read'),
  });
  const swapQ = useQuery({
    queryKey: ['dashboard-swaps'],
    queryFn: () => api.list<{ id: string; status: string }>('/admin/shift-swaps?per_page=50'),
    enabled: can('schedule.read'),
  });
  const emgQ = useQuery({
    queryKey: ['dashboard-emergencies'],
    queryFn: () => api.get<{ id: string; work_date: string; status: string; shift_coverage_status: string }[]>('/admin/emergency-leaves'),
    enabled: can('schedule.read'),
  });
  const adjQ = useQuery({
    queryKey: ['dashboard-attendance-adjustments'],
    queryFn: () => api.list<{ id: string; status: string }>('/admin/attendance/adjustments?per_page=50'),
    enabled: can('attendance.read', 'schedule.read'),
  });

  if (!showHrPanel) return null;

  const todayStr = dayjs().format('YYYY-MM-DD');
  const soonCutoff = dayjs().add(3, 'day').format('YYYY-MM-DD');

  const candidates = candQ.data?.data ?? [];
  const newCandidatesCount = candidates.filter((c) => c.status === 'NEW').length;

  const interviews = ivQ.data ?? [];
  const todayInterviewsCount = interviews.filter((i) => String(i.start_at).slice(0, 10) === todayStr || i.decision === 'PENDING').length;
  const rescheduleInterviewsCount = interviews.filter((i) => i.reschedule_requested || i.status === 'RESCHEDULE_NEEDED').length;

  const employees = empQ.data?.data ?? [];
  const probationEmployees = employees.filter((e) => e.stage === 'PROBATION');
  const endingProbationList = probationEmployees.filter((e) => !e.probationEnd || e.probationEnd <= soonCutoff);

  const shifts = schedQ.data?.data ?? [];
  const draftShiftsCount = shifts.filter((s) => s.status === 'DRAFT').length;
  const absentShiftsCount = shifts.filter((s) => s.status === 'ABSENT').length;

  const leaves = leaveQ.data?.data ?? [];
  const pendingLeavesCount = leaves.filter((l) => l.status === 'PENDING').length;
  const todayOffCount = leaves.filter((l) => l.leave_date === todayStr && l.status === 'APPROVED').length;

  const swaps = swapQ.data?.data ?? [];
  const pendingSwapsCount = swaps.filter((s) => s.status === 'PEER_ACCEPTED' || s.status === 'PENDING_PEER').length;

  const emergencies = emgQ.data ?? [];
  const uncoveredEmergenciesCount = emergencies.filter((e) => e.status === 'REPORTED' || e.status === 'ESCALATED' || e.shift_coverage_status !== 'COVERED').length;

  const pendingAdjustmentsCount = (adjQ.data?.data ?? []).filter((a) => a.status === 'PENDING' || a.status === 'STORE_CONFIRMED').length;
  const abnormalEventsCount = absentShiftsCount + pendingAdjustmentsCount;

  const actionItems = [
    ...(uncoveredEmergenciesCount > 0 ? [{ key: 'emg', priority: 'KHẨN CẤP', color: 'error', title: `${uncoveredEmergenciesCount} ca báo nghỉ đột xuất / thiếu ca cần điều phối khẩn`, desc: 'Kiểm tra người thay thế hoặc điều phối nhân sự chi nhánh, không ép nhân viên nghỉ khẩn đi làm.', link: '/admin/schedules?section=workflows', btn: 'Xử lý thiếu ca' }] : []),
    ...(pendingLeavesCount > 0 || pendingSwapsCount > 0 ? [{ key: 'leave-swap', priority: 'CẦN DUYỆT', color: 'warning', title: `${pendingLeavesCount} đơn nghỉ OFF & ${pendingSwapsCount} yêu cầu đổi ca đang chờ phê duyệt`, desc: 'Kiểm tra định biên sau khi nghỉ và phê duyệt đổi ca 3 bước.', link: '/admin/schedules?section=workflows', btn: 'Duyệt đơn từ' }] : []),
    ...(pendingAdjustmentsCount > 0 || absentShiftsCount > 0 ? [{ key: 'att', priority: 'ĐỐI SOÁT CÔNG', color: 'warning', title: `${pendingAdjustmentsCount} phiếu bổ sung công chờ duyệt & ${absentShiftsCount} ca vắng mặt quá giờ`, desc: 'Đối soát chấm công bất thường và xử lý phiếu bù công trước kỳ lương.', link: '/admin/schedules?section=workflows', btn: 'Mở đối soát công' }] : []),
    ...(canPromote && endingProbationList.length > 0 ? [{ key: 'promote', priority: 'NHÂN SỰ', color: 'processing', title: `${endingProbationList.length} nhân viên thử việc sắp hết hạn / đủ điều kiện xét Chuyển Chính thức`, desc: 'Xem công thử việc, điểm bài kiểm tra nghiệp vụ và quyết định chuyển chính thức.', link: '/admin/employees?stage=PROBATION', btn: 'Xét chuyển chính thức' }] : []),
    ...(canRecruit && (newCandidatesCount > 0 || todayInterviewsCount > 0 || rescheduleInterviewsCount > 0) ? [{ key: 'rec', priority: 'TUYỂN DỤNG', color: 'processing', title: `${newCandidatesCount} ứng viên mới & ${todayInterviewsCount} lịch phỏng vấn cần xử lý`, desc: 'Liên hệ ứng viên mới, theo dõi xác nhận và chấm điểm phỏng vấn.', link: '/admin/employees?section=recruitment', btn: 'Mở Tuyển dụng & PV' }] : []),
    ...(draftShiftsCount > 0 ? [{ key: 'draft', priority: 'LỊCH TUẦN', color: 'default', title: `${draftShiftsCount} ca đăng ký đang ở trạng thái Chờ duyệt phân ca`, desc: 'Kiểm tra định biên và nhấn Duyệt & Phát hành lịch để ca có hiệu lực chấm công.', link: '/admin/schedules', btn: 'Duyệt lịch phân ca' }] : []),
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 16 }}>
      <Row gutter={[12, 12]}>
        {canRecruit && (
          <>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Ứng viên mới" value={newCandidatesCount} prefix={<SolutionOutlined style={{ color: '#2563EB' }} />} /><Link href="/admin/employees?section=recruitment" style={{ fontSize: 12 }}>Xem hồ sơ ứng viên</Link></Card>
            </Col>
            <Col xs={12} md={4}>
              <Card size="small"><Statistic title="Lịch phỏng vấn" value={todayInterviewsCount} prefix={<CalendarOutlined style={{ color: '#0284C7' }} />} /><Link href="/admin/employees?section=recruitment&sub=interviews" style={{ fontSize: 12 }}>Xem lịch phỏng vấn</Link></Card>
            </Col>
          </>
        )}
        {canPromote && (
          <Col xs={12} md={4}>
            <Card size="small"><Statistic title="NV sắp hết thử việc" value={`${endingProbationList.length} / ${probationEmployees.length}`} prefix={<TeamOutlined style={{ color: '#D97706' }} />} /><Link href="/admin/employees?stage=PROBATION" style={{ fontSize: 12 }}>Xét chuyển chính thức</Link></Card>
          </Col>
        )}
        <Col xs={12} md={canRecruit ? 4 : 8}>
          <Card size="small"><Statistic title="Nghỉ hôm nay / Chờ duyệt" value={`${todayOffCount} / ${pendingLeavesCount}`} prefix={<ClockCircleOutlined style={{ color: '#16A34A' }} />} /><Link href="/admin/schedules?section=workflows" style={{ fontSize: 12 }}>Đơn nghỉ OFF</Link></Card>
        </Col>
        <Col xs={12} md={canRecruit ? 4 : 8}>
          <Card size="small"><Statistic title="Thiếu ca / Nghỉ khẩn" value={uncoveredEmergenciesCount} prefix={<AlertOutlined style={{ color: '#DC2626' }} />} /><Link href="/admin/schedules?section=workflows" style={{ fontSize: 12 }}>Điều phối thiếu ca</Link></Card>
        </Col>
        <Col xs={12} md={canRecruit ? 4 : 8}>
          <Card size="small"><Statistic title="Chấm công bất thường" value={abnormalEventsCount} prefix={<WarningOutlined style={{ color: '#B45309' }} />} /><Link href="/admin/schedules?section=workflows" style={{ fontSize: 12 }}>Phiếu bổ sung công</Link></Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={<Space><ExclamationCircleOutlined style={{ color: '#2563EB' }} /><span>Danh sách Hành động ưu tiên cần xử lý ngay ({actionItems.length} đầu việc)</span></Space>}
        extra={<Tag color="blue">Ưu tiên xử lý vận hành</Tag>}
      >
        {actionItems.length === 0 ? (
          <Space><CheckCircleOutlined style={{ color: '#16A34A' }} /><span>Toàn bộ hồ sơ ứng viên, lịch phỏng vấn, đơn nghỉ OFF, đổi ca và phiếu bổ sung công đều đã được xử lý hoàn tất.</span></Space>
        ) : (
          <List
            size="small"
            dataSource={actionItems}
            renderItem={(item) => (
              <List.Item
                extra={
                  <Link href={item.link}>
                    <Button size="small" type="primary" icon={<ArrowRightOutlined />}>{item.btn}</Button>
                  </Link>
                }
              >
                <List.Item.Meta
                  title={<div style={{ lineHeight: 1.45 }}><Tag color={item.color} style={{ margin: '0 8px 2px 0', verticalAlign: 'text-top' }}>{item.priority}</Tag><span style={{ fontWeight: 600 }}>{item.title}</span></div>}
                  description={item.desc}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  );
}
