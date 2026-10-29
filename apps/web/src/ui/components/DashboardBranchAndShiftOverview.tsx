'use client';

import { Badge, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag } from 'antd';
import {
  AlertOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DollarOutlined, EnvironmentOutlined, SafetyCertificateOutlined, TeamOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { StatusTag } from '../StatusTag';
import { RowActionButtons } from './RowActionButtons';
import { fmtVnd, type PayPeriodRow } from './payroll-types';

interface Props {
  branchFilter: string;
  stageFilter: string;
  periodFilter: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'ALL';
  pendingAccountsCount: number;
  deadLettersCount: number;
}

export function DashboardBranchAndShiftOverview({
  branchFilter, stageFilter, periodFilter, pendingAccountsCount, deadLettersCount,
}: Props) {
  const router = useRouter();
  const can = useCan();
  const canEmployee = can('employee.read');
  const canSchedule = can('schedule.read', 'attendance.read');
  const canPayroll = can('payroll.read');
  const todayStr = dayjs().format('YYYY-MM-DD');
  const monthStartStr = dayjs().startOf('month').format('YYYY-MM-DD');
  const monthEndStr = dayjs().endOf('month').add(7, 'day').format('YYYY-MM-DD');

  const branchesQ = useQuery({
    queryKey: ['dashboard-branches'],
    queryFn: () => api.list<{ id: string; code: string; name: string; status: string }>('/admin/branches?per_page=50'),
  });
  const employeesQ = useQuery({
    queryKey: ['dashboard-employees-full'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/employees?per_page=100'),
    enabled: can('employee.read'),
  });
  const shiftsQ = useQuery({
    queryKey: ['dashboard-shifts-full', monthStartStr, monthEndStr],
    queryFn: () => api.list<Record<string, unknown>>(`/admin/schedules?from_date=${monthStartStr}&to_date=${monthEndStr}&per_page=1000`),
    enabled: canSchedule,
  });
  const adjustmentsQ = useQuery({
    queryKey: ['dashboard-attendance-adjustments'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/attendance/adjustments?per_page=100'),
    enabled: canSchedule,
  });
  const leavesQ = useQuery({
    queryKey: ['dashboard-leaves-full'],
    queryFn: () => api.list<Record<string, unknown>>('/admin/leave-requests?per_page=100'),
    enabled: canSchedule,
  });
  const payrollQ = useQuery({
    queryKey: ['dashboard-payroll-periods'],
    queryFn: () => api.get<PayPeriodRow[]>('/admin/payroll/periods'),
    enabled: canPayroll,
  });

  const nowHm = dayjs().format('HH:mm');
  const currentShiftLabel = nowHm < '12:00'
    ? 'Ca sáng (07:00–12:00) · Sắp tới: Ca chiều (12:00–17:00)'
    : nowHm < '17:00'
      ? 'Ca chiều (12:00–17:00) · Sắp tới: Ca tối (17:00–22:00)'
      : 'Ca tối (17:00–22:00) · Sắp tới: Ca sáng ngày mai (07:00–12:00)';

  const inPeriod = (dateStr: string) => {
    if (!dateStr || periodFilter === 'ALL') return true;
    if (periodFilter === 'TODAY') return dateStr === todayStr;
    if (periodFilter === 'THIS_WEEK') return dayjs(dateStr).isSame(dayjs(), 'week');
    return dayjs(dateStr).isSame(dayjs(), 'month');
  };

  const { branchRows, totals } = useMemo(() => {
    const branches = (branchesQ.data?.data ?? []).filter((b) => branchFilter === 'ALL' || b.id === branchFilter);
    const emps = (employeesQ.data?.data ?? []).filter((e) => {
      if (branchFilter !== 'ALL' && e.branchId !== branchFilter && e.branch_id !== branchFilter) return false;
      if (stageFilter !== 'ALL' && e.stage !== stageFilter && e.status !== stageFilter) return false;
      return true;
    });
    const allShifts = (shiftsQ.data?.data ?? []).filter((s) => inPeriod(String(s.workDate || '')));
    const todayShifts = (shiftsQ.data?.data ?? []).filter((s) => String(s.workDate || '') === todayStr);
    const leaves = (leavesQ.data?.data ?? []).filter((l) => String(l.leave_date || '') === todayStr && l.status === 'APPROVED');

    let presentTotal = 0, notCheckedInTotal = 0, absentTotal = 0, offTodayTotal = 0, understaffedBranches = 0;

    const rows = branches.map((b) => {
      const bEmps = emps.filter((e) => (e.branchId ?? e.branch_id) === b.id);
      const bProbation = bEmps.filter((e) => e.stage === 'PROBATION' || e.stage === 'THU_VIEC').length;
      const bOfficial = bEmps.filter((e) => e.stage === 'OFFICIAL' || e.stage === 'CHINH_THUC').length;
      const bTodayShifts = todayShifts.filter((s) => (s.branchId ?? s.branch_id) === b.id);
      const bPeriodShifts = allShifts.filter((s) => (s.branchId ?? s.branch_id) === b.id);

      let present = 0, notCheckedIn = 0, absent = 0;
      const presentNames: string[] = [], notCheckedInNames: string[] = [];
      for (const s of bTodayShifts) {
        const empName = String(s.employeeName || s.employeeCode || 'NV');
        const attCol = String(s.attendanceStatusColor || '');
        const hasCheckIn = attCol === 'green' || attCol === 'processing' || attCol === 'volcano' || s.status === 'COMPLETED';
        if (hasCheckIn) { present += 1; presentNames.push(empName); }
        else if (s.status === 'ABSENT' || nowHm > String(s.endAt || '12:00')) absent += 1;
        else { notCheckedIn += 1; notCheckedInNames.push(empName); }
      }
      const offCount = leaves.filter((l) => l.branch_id === b.id).length;
      const isUnderstaffed = bTodayShifts.length < 2 || absent > 0;
      if (isUnderstaffed) understaffedBranches += 1;

      presentTotal += present; notCheckedInTotal += notCheckedIn; absentTotal += absent; offTodayTotal += offCount;
      return {
        id: b.id, code: b.code, name: b.name, totalStaff: bEmps.length, probationCount: bProbation, officialCount: bOfficial,
        todayShiftCount: bTodayShifts.length, periodShiftCount: bPeriodShifts.length, present, notCheckedIn, absent, offCount, isUnderstaffed,
        presentNames, notCheckedInNames,
      };
    });

    const newHireCount = emps.filter((e) => e.stage === 'NEW' || e.status === 'PENDING_ACTIVATION').length + pendingAccountsCount;
    return { branchRows: rows, totals: { totalStaff: emps.length, newHireCount, presentTotal, notCheckedInTotal, absentTotal, offTodayTotal, understaffedBranches } };
  }, [branchesQ.data, employeesQ.data, shiftsQ.data, leavesQ.data, branchFilter, stageFilter, periodFilter, todayStr, nowHm, pendingAccountsCount]);

  const periods = payrollQ.data ?? [];
  const activePeriod = periods[0];
  const unpublishedPeriods = periods.filter((p) => p.status === 'DRAFT' || p.status === 'RECONCILE' || p.status === 'APPROVED');
  const unpublishedPeriodsCount = unpublishedPeriods.length;
  const unpublishedPayslipsCount = unpublishedPeriods.reduce((s, p) => s + Number(p.total_employees || 0), 0);
  const pendingAdjsCount = (adjustmentsQ.data?.data ?? []).filter((a) => a.status === 'PENDING' || a.status === 'STORE_CONFIRMED').length;
  const unreconciledPayrollCount = Number(activePeriod?.unreconciled_records_count ?? 0);
  const showNewHireKpi = can('account.activate', 'candidate.manage');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 16 }}>
      {canSchedule && (
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title={showNewHireKpi ? 'Nhân sự mới / Chờ KH' : 'Tổng nhân sự chi nhánh'} value={showNewHireKpi ? totals.newHireCount : totals.totalStaff} prefix={<TeamOutlined />} /></Card></Col>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Đang có mặt hôm nay" value={totals.presentTotal} formatter={(v) => <span style={{ color: '#16A34A' }}>{v}</span>} prefix={<CheckCircleOutlined style={{ color: '#16A34A' }} />} /></Card></Col>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Chưa Check-in ca" value={totals.notCheckedInTotal} formatter={(v) => <span style={{ color: '#2563EB' }}>{v}</span>} prefix={<ClockCircleOutlined style={{ color: '#2563EB' }} />} /></Card></Col>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Vắng mặt hôm nay" value={totals.absentTotal} formatter={(v) => <span style={{ color: totals.absentTotal > 0 ? '#DC2626' : '#16A34A' }}>{v}</span>} prefix={<WarningOutlined style={{ color: totals.absentTotal > 0 ? '#DC2626' : '#16A34A' }} />} /></Card></Col>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Nghỉ OFF hôm nay" value={totals.offTodayTotal} prefix={<CalendarOutlined />} /></Card></Col>
          <Col xs={12} sm={8} md={4}><Card size="small"><Statistic title="Cảnh báo vận hành" value={deadLettersCount + totals.understaffedBranches} formatter={(v) => <span style={{ color: deadLettersCount + totals.understaffedBranches > 0 ? '#D97706' : '#16A34A' }}>{v}</span>} prefix={<AlertOutlined style={{ color: deadLettersCount + totals.understaffedBranches > 0 ? '#D97706' : '#16A34A' }} />} /></Card></Col>
        </Row>
      )}

      {canPayroll && (
        <Card size="small" title={<span><DollarOutlined /> Tổng quan Quỹ lương, Giờ công &amp; Đối soát Kế toán</span>} extra={<Link href="/admin/payroll"><Button size="small" type="primary" icon={<DollarOutlined />}>Mở Bảng lương &amp; Đối soát</Button></Link>}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={4}><Statistic title="Nhân sự tính lương" value={activePeriod?.total_employees ?? totals.totalStaff} suffix="NV" /></Col>
            <Col xs={12} md={4}><Statistic title="Tổng giờ công kỳ hiện tại" value={activePeriod?.total_approved_hours ?? 0} suffix="giờ" /></Col>
            <Col xs={12} md={5}><Statistic title="Tổng thu nhập dự kiến" value={fmtVnd(activePeriod?.total_gross_vnd ?? 0)} formatter={(v) => <span style={{ fontSize: 16, fontWeight: 700, color: '#2563EB' }}>{v}</span>} /></Col>
            <Col xs={12} md={5}><Statistic title="Thực lĩnh dự kiến" value={fmtVnd(activePeriod?.total_net_vnd ?? 0)} formatter={(v) => <span style={{ fontSize: 16, fontWeight: 700, color: '#16A34A' }}>{v}</span>} /></Col>
            <Col xs={12} md={3}>
              <Statistic title="Công chưa khóa / Lỗi công" value={pendingAdjsCount + unreconciledPayrollCount} suffix="mục" formatter={(v) => <span style={{ color: pendingAdjsCount + unreconciledPayrollCount > 0 ? '#D97706' : '#16A34A' }}>{v}</span>} />
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{pendingAdjsCount} bù công · {unreconciledPayrollCount} lỗi lương</div>
            </Col>
            <Col xs={12} md={3}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>Trạng thái kỳ lương</div>
              {activePeriod ? <StatusTag value={activePeriod.status} label={activePeriod.statusLabel} /> : <Tag>Chưa mở kỳ</Tag>}
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>Chưa phát: {unpublishedPayslipsCount} phiếu ({unpublishedPeriodsCount} kỳ)</div>
            </Col>
          </Row>
        </Card>
      )}

      {canSchedule && (
        <Card
          size="small"
          title={<span><EnvironmentOutlined /> Tình trạng Nhân sự, Điểm danh &amp; Ca đang diễn ra theo Chi nhánh</span>}
          extra={<Tag color="blue" style={{ margin: 0 }}>{currentShiftLabel}</Tag>}
          styles={{ header: { flexWrap: 'wrap', gap: 8 } }}
        >
          <Table
            size="small" rowKey="id" pagination={false} loading={branchesQ.isLoading || shiftsQ.isLoading} dataSource={branchRows} scroll={{ x: 1480 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có chi nhánh phù hợp bộ lọc" /> }}
            columns={[
              { title: 'Chi nhánh', width: 220, fixed: 'left', render: (_, r) => <div><strong style={{ whiteSpace: 'nowrap' }}>{r.name}</strong><div style={{ fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>Mã: {r.code}</div></div> },
              { title: 'Nhân sự (TV / CT)', width: 175, render: (_, r) => <div style={{ whiteSpace: 'nowrap' }}><strong>{r.totalStaff} NV</strong> <span style={{ color: '#64748B', fontSize: 12 }}>({r.probationCount} TV / {r.officialCount} CT)</span></div> },
              { title: 'Số ca hôm nay / Kỳ', width: 215, align: 'center', render: (_, r) => <Tag color="geekblue" style={{ margin: 0, whiteSpace: 'nowrap' }}>{r.todayShiftCount} ca hôm nay ({r.periodShiftCount} ca kỳ)</Tag> },
              { title: 'Đang có mặt', dataIndex: 'present', width: 200, render: (v: number, r) => <div><Tag color="green" style={{ margin: 0, whiteSpace: 'nowrap' }}>{v} có mặt</Tag>{r.presentNames.length > 0 && <div style={{ fontSize: 11, color: '#15803D', marginTop: 4, lineHeight: 1.4 }}>{r.presentNames.join(', ')}</div>}</div> },
              { title: 'Chưa Check-in', dataIndex: 'notCheckedIn', width: 200, render: (v: number, r) => <div><Tag color="blue" style={{ margin: 0, whiteSpace: 'nowrap' }}>{v} chờ vào ca</Tag>{r.notCheckedInNames.length > 0 && <div style={{ fontSize: 11, color: '#1D4ED8', marginTop: 4, lineHeight: 1.4 }}>{r.notCheckedInNames.join(', ')}</div>}</div> },
              { title: 'Nghỉ OFF / Vắng', width: 165, align: 'center', render: (_, r) => <Space size={4} style={{ whiteSpace: 'nowrap' }}><Tag style={{ margin: 0 }}>{r.offCount} OFF</Tag>{r.absent > 0 && <Tag color="red" style={{ margin: 0 }}>{r.absent} vắng</Tag>}</Space> },
              { title: 'Cảnh báo vận hành', width: 215, render: (_, r) => <div style={{ whiteSpace: 'nowrap' }}>{r.isUnderstaffed ? <Badge status="warning" text={<Tag color="volcano" style={{ margin: 0 }}>Thiếu người / Cần bù ca</Tag>} /> : <Badge status="success" text={<Tag color="green" style={{ margin: 0 }}>Đủ định biên ca</Tag>} />}</div> },
              {
                title: 'Thao tác', key: 'actions', width: 84, fixed: 'right', align: 'center',
                render: () => (
                  <RowActionButtons
                    menuItems={[
                      { key: 'schedules', icon: <CalendarOutlined />, label: 'Mở lịch phân ca', onClick: () => router.push('/admin/schedules') },
                      { key: 'workflows', icon: <SafetyCertificateOutlined />, label: 'Điểm danh & Đơn từ', onClick: () => router.push('/admin/schedules?section=workflows') },
                      ...(canEmployee ? [{ key: 'employees', icon: <TeamOutlined />, label: 'Danh sách nhân sự', onClick: () => router.push('/admin/employees') }] : []),
                      ...(canPayroll ? [{ key: 'payroll', icon: <DollarOutlined />, label: 'Bảng lương & Đối soát', onClick: () => router.push('/admin/payroll') }] : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
