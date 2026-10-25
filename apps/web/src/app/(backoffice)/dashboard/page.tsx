'use client';

import { App, Button, Card, Col, Descriptions, List, Row, Skeleton, Space, Spin, Statistic, Tag, Typography } from 'antd';
import {
  CalendarOutlined, DollarOutlined, NotificationOutlined, ReloadOutlined,
  SafetyCertificateOutlined, TeamOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import dayjs from 'dayjs';
import { ROLE_LABELS, type Health } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { PageHeader } from '@/ui/PageHeader';
import { StatusTag } from '@/ui/StatusTag';

const CHECK_LABELS: Record<string, string> = {
  google: 'Google API',
  sheetsCache: 'Bộ nhớ đệm Google Sheets',
  writeQueue: 'Hàng đợi ghi',
  deadLetters: 'Bản ghi cần đối soát',
  realtime: 'Kết nối thời gian thực',
  backup: 'Sao lưu gần nhất',
};

export default function DashboardPage() {
  const { data: me } = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [refreshing, setRefreshing] = useState(false);

  const accounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => api.list<{ id: string; status: string }>('/admin/accounts?per_page=100'),
    enabled: can('account.read'),
  });
  const employees = useQuery({
    queryKey: ['dashboard-employees'],
    queryFn: () => api.list<{ id: string; stage: string; status: string }>('/admin/employees?per_page=100'),
    enabled: can('employee.read'),
  });
  const schedules = useQuery({
    queryKey: ['dashboard-schedules'],
    queryFn: () => api.list<{ id: string; status: string }>('/admin/schedules?per_page=100'),
    enabled: can('schedule.read'),
  });
  const leaves = useQuery({
    queryKey: ['dashboard-leaves'],
    queryFn: () => api.list<{ id: string; status: string }>('/admin/leave-requests?per_page=50'),
    enabled: can('schedule.read'),
  });
  const payroll = useQuery({
    queryKey: ['dashboard-payroll'],
    queryFn: () => api.get<{ runs: Record<string, unknown>[]; items: Record<string, unknown>[] }>('/admin/payroll/runs'),
    enabled: can('payroll.read'),
  });
  const comms = useQuery({
    queryKey: ['mkt-comms'],
    queryFn: () => api.get<{ announcements: Record<string, unknown>[] }>('/admin/comms'),
    enabled: !!me,
  });
  const health = useQuery({
    queryKey: ['integrations', 'health'],
    queryFn: () => api.get<Health>('/admin/integrations/health'),
    enabled: can('integration.read'),
  });

  const handleRefreshAll = async () => {
    setRefreshing(true);
    const hide = message.loading('Đang đồng bộ số liệu mới nhất từ Google Sheets...', 0);
    try {
      await Promise.all([
        can('account.read') ? api.list('/admin/accounts?per_page=100&refresh=1') : Promise.resolve(),
        can('employee.read') ? api.list('/admin/employees?per_page=100&refresh=1') : Promise.resolve(),
        can('integration.read') ? api.get('/admin/integrations/health?refresh=1') : Promise.resolve(),
      ]);
      await qc.invalidateQueries();
      message.success('Đã cập nhật số liệu tổng quan mới nhất');
    } finally {
      hide();
      setRefreshing(false);
    }
  };

  const countAcc = (s: string) => accounts.data?.data.filter((a) => a.status === s).length ?? 0;
  const empList = employees.data?.data ?? [];
  const probationCount = empList.filter((e) => e.stage === 'PROBATION' || e.stage === 'THU_VIEC').length;
  const officialCount = empList.filter((e) => e.stage === 'OFFICIAL' || e.stage === 'CHINH_THUC').length;
  const publishedShifts = (schedules.data?.data ?? []).filter((s) => s.status === 'PUBLISHED').length;
  const pendingLeaves = (leaves.data?.data ?? []).filter((l) => l.status === 'PENDING').length;
  const isAllBranches = me?.user.branchScope === 'ALL';

  return (
    <>
      <PageHeader
        title={`Xin chào, ${me?.user.displayName ?? ''}`}
        description={`${me ? ROLE_LABELS[me.user.role] : ''} · ${dayjs().format('dddd, DD/MM/YYYY')}`}
        extra={
          <Button icon={<ReloadOutlined />} onClick={handleRefreshAll} loading={refreshing}>
            Làm mới số liệu
          </Button>
        }
      />

      <Spin spinning={refreshing} tip="Đang đồng bộ số liệu mới nhất...">
        <div>
          {can('account.read') && (
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              {[
                { label: 'Tổng tài khoản', value: accounts.data?.meta.pagination.total ?? 0, link: '/admin/accounts', linkText: 'Quản lý tài khoản' },
                { label: 'Chờ kích hoạt', value: countAcc('PENDING_ACTIVATION'), link: '/admin/accounts?status=PENDING_ACTIVATION', linkText: 'Xử lý kích hoạt ngay' },
                { label: 'Đang hoạt động', value: countAcc('ACTIVE') },
                { label: 'Đã thu hồi / khóa', value: countAcc('REVOKED') + countAcc('LOCKED') },
              ].map((s) => (
                <Col xs={12} md={6} key={s.label}>
                  <Card size="small" loading={accounts.isLoading}>
                    <Statistic title={s.label} value={s.value} />
                    {s.link && <Link href={s.link} style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>{s.linkText}</Link>}
                  </Card>
                </Col>
              ))}
            </Row>
          )}

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {can('employee.read') && (
              <>
                <Col xs={12} md={6}>
                  <Card size="small" loading={employees.isLoading}>
                    <Statistic title={isAllBranches ? 'Tổng nhân sự chuỗi' : 'Nhân sự tại chi nhánh'} value={empList.length} prefix={<TeamOutlined />} />
                    <Link href="/admin/employees" style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>Danh sách nhân sự</Link>
                  </Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" loading={employees.isLoading}>
                    <Statistic title="Thử việc / Chính thức" value={`${probationCount} / ${officialCount}`} prefix={<UserSwitchOutlined />} />
                    <Link href={can('candidate.manage', 'interview.manage') ? '/admin/employees?section=recruitment' : '/admin/employees'} style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>
                      {can('candidate.manage', 'interview.manage') ? 'Tuyển dụng & Đánh giá TV' : 'Xem nhân sự theo giai đoạn'}
                    </Link>
                  </Card>
                </Col>
              </>
            )}
            {can('schedule.read') && (
              <>
                <Col xs={12} md={6}>
                  <Card size="small" loading={schedules.isLoading}>
                    <Statistic title="Ca làm việc đã phát hành" value={publishedShifts} prefix={<CalendarOutlined />} />
                    <Link href="/admin/schedules" style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>Mở lịch phân ca</Link>
                  </Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" loading={leaves.isLoading}>
                    <Statistic title="Đơn nghỉ OFF chờ duyệt" value={pendingLeaves} prefix={<SafetyCertificateOutlined />} />
                    <Link href="/admin/schedules?section=workflows" style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>Xử lý đơn nghỉ &amp; đổi ca</Link>
                  </Card>
                </Col>
              </>
            )}
            {can('payroll.read') && (
              <Col xs={12} md={6}>
                <Card size="small" loading={payroll.isLoading}>
                  <Statistic title="Kỳ lương hệ thống" value={payroll.data?.runs.length ?? 0} prefix={<DollarOutlined />} />
                  <Link href="/admin/payroll" style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>Đối soát &amp; Hồ sơ lương</Link>
                </Card>
              </Col>
            )}
            {!!me && (
              <Col xs={12} md={6}>
                <Card size="small" loading={comms.isLoading}>
                  <Statistic title="Bản tin nội bộ" value={comms.data?.announcements.length ?? 0} prefix={<NotificationOutlined />} />
                  <Link href="/admin/integrations?section=comms" style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}>Xem &amp; Quản lý bản tin</Link>
                </Card>
              </Col>
            )}
          </Row>

          {can('integration.read') && (
            <Card title="Tình trạng kết nối & Toàn vẹn dữ liệu" size="small" style={{ marginBottom: 16 }} extra={health.data && <StatusTag value={health.data.status} />}>
              {health.isLoading ? (
                <Skeleton active paragraph={{ rows: 4 }} />
              ) : (
                <List
                  size="small"
                  dataSource={Object.entries(health.data?.checks ?? {})}
                  renderItem={([key, c]) => (
                    <List.Item extra={<StatusTag value={c.status} />}>
                      <List.Item.Meta title={<span style={{ fontWeight: 500 }}>{CHECK_LABELS[key] ?? key}</span>} description={c.detail} />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          )}

          {me && (
            <Card title="Thông tin phiên làm việc & Phạm vi phân quyền" size="small">
              <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="Người dùng hiện tại">{me.user.displayName} (@{me.user.username})</Descriptions.Item>
                <Descriptions.Item label="Vai trò đảm nhiệm"><Tag color="blue" style={{ borderRadius: 2 }}>{ROLE_LABELS[me.user.role]}</Tag></Descriptions.Item>
                <Descriptions.Item label="Phạm vi chi nhánh">{me.user.branchScope === 'ALL' ? 'Toàn chuỗi (4 chi nhánh)' : `${me.user.branchScope.length} chi nhánh được phân công`}</Descriptions.Item>
                <Descriptions.Item label="Trạng thái tài khoản"><StatusTag value={me.user.status} /></Descriptions.Item>
              </Descriptions>
              <Space wrap style={{ marginTop: 10 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Hệ thống tự động hiển thị các mục menu bên trái và điều hướng trang làm việc tương ứng với quyền hạn của vai trò {ROLE_LABELS[me.user.role]}.
                </Typography.Text>
              </Space>
            </Card>
          )}
        </div>
      </Spin>
    </>
  );
}
