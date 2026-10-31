'use client';

import { useState } from 'react';
import { Alert, App, Button, Card, Col, DatePicker, Flex, Popconfirm, Row, Select, Space, Statistic, Tag } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, LockOutlined, ReloadOutlined, ScheduleOutlined, UnlockOutlined, WarningOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { mondayOfWeek } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { OffRejectModal, PlannerIssuesAlert, PlannerOffTable, PlannerShiftTable } from './SchedulePlannerShared';
import { fmtDm, fmtTs, fmtYmd, type PlannerWeekData, type PlannerWeekLockResult } from './schedule-planner-types';
import { useInvalidatePlanner, usePlannerOffDecision } from './usePlannerOffDecision';

interface Props { branchOptions: { value: string; label: string }[] }

/** Chốt lịch tuần cho nhân viên chính thức: duyệt đơn OFF + tự động sắp ca theo ca mặc định. */
export function SchedulePlannerWeekPane({ branchOptions }: Props) {
  const { message, modal } = App.useApp();
  const can = useCan(), canPublish = can('schedule.publish'), canDecide = can('leave.approve');
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('ALL');
  const [issuesOpen, setIssuesOpen] = useState(false);
  const invalidate = useInvalidatePlanner();
  const decision = usePlannerOffDecision();

  const params = new URLSearchParams({ branch_id: branchId });
  if (weekStart) params.set('week_start', weekStart);
  const q = useQuery({ queryKey: ['schedule-planner-week', weekStart, branchId], queryFn: () => api.get<PlannerWeekData>(`/admin/schedule-planner/week?${params.toString()}`) });
  const data = q.data, effWeek = weekStart ?? data?.weekStart ?? null;

  const lockMut = useMutation({
    mutationFn: (ws: string) => api.post<PlannerWeekLockResult>('/admin/schedule-planner/week/lock', { week_start: ws, branch_id: branchId }),
    onSuccess: (res) => {
      const summary = `Đã chốt lịch tuần ${fmtDm(res.weekStart)}: duyệt ${res.approvedOffCount} đơn OFF và tự động sắp ${res.createdCount} ca theo ca mặc định.`;
      if (res.issues.length > 0) {
        modal.warning({ width: 680, title: 'Đã chốt lịch nhưng còn trường hợp chưa xếp được', content: <Space direction="vertical" size={10} style={{ width: '100%' }}><span>{summary}</span><PlannerIssuesAlert issues={res.issues} maxHeight={320} collapsible={false} /></Space>, okText: 'Đã hiểu' });
      } else message.success(summary);
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chốt lịch tuần thất bại'),
  });

  const onPickWeek = (d: Dayjs | null) => setWeekStart(d ? mondayOfWeek(d.format('YYYY-MM-DD')) : null);
  const weekLabel = (d: Dayjs) => { const m = mondayOfWeek(d.format('YYYY-MM-DD')); return `Tuần ${fmtDm(m)} – ${dayjs(m).add(6, 'day').format('DD/MM/YYYY')}`; };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px' }}>
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={10} wrap>
            <DatePicker picker="week" allowClear={false} value={effWeek ? dayjs(effWeek) : null} onChange={onPickWeek} format={weekLabel} style={{ width: 245 }} placeholder="Chọn tuần cần chốt lịch" />
            <Select value={branchId} onChange={setBranchId} options={branchOptions} style={{ width: 220 }} />
            {data && <Tag color={data.isLocked ? 'green' : 'default'} icon={data.isLocked ? <LockOutlined /> : <UnlockOutlined />} style={{ margin: 0 }}>{data.isLocked ? `Đã chốt lịch lúc ${fmtTs(data.lockedAt)}` : 'Chưa chốt'}</Tag>}
          </Space>
          <Space size={8} wrap>
            <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
            <Popconfirm
              title="Chốt lịch & Tự động sắp ca"
              description={<div style={{ maxWidth: 360 }}>Hệ thống sẽ duyệt toàn bộ đơn OFF đang chờ duyệt trong tuần và xếp ca mặc định cho nhân viên chính thức (mỗi khung ca 1 người theo định biên). Bạn có thể chốt lại để xếp bổ sung.</div>}
              okText="Xác nhận chốt lịch" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
              disabled={!canPublish || !effWeek} onConfirm={() => effWeek && lockMut.mutate(effWeek)}
            >
              <Button type="primary" icon={<ScheduleOutlined />} loading={lockMut.isPending} disabled={!canPublish || !effWeek}>Chốt lịch & Tự động sắp ca</Button>
            </Popconfirm>
          </Space>
        </Flex>
      </div>

      {data?.offWindow && <Alert type={data.offWindow.isOpen ? 'success' : 'info'} showIcon icon={<CalendarOutlined />} message={data.offWindow.message} />}
      {data?.isLocked && data.lockNote && <Alert type="info" showIcon message={`Biên bản chốt lịch: ${data.lockNote}`} />}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Ca dự kiến sắp" value={data?.summary.plannedCount ?? 0} prefix={<ScheduleOutlined style={{ color: '#2563EB' }} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Đơn nghỉ OFF trong tuần" value={data?.summary.offCount ?? 0} prefix={<CalendarOutlined style={{ color: '#16A34A' }} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Đơn OFF chờ duyệt" value={data?.summary.pendingOffCount ?? 0} prefix={<CalendarOutlined style={{ color: '#D97706' }} />} /></Card></Col>
        <Col xs={12} md={6}>
          <Card
            size="small"
            onClick={() => (data?.issues.length ?? 0) > 0 && setIssuesOpen((v) => !v)}
            style={{
              cursor: (data?.issues.length ?? 0) > 0 ? 'pointer' : 'default',
              borderColor: issuesOpen && (data?.issues.length ?? 0) > 0 ? '#FCA5A5' : undefined,
            }}
          >
            <Statistic
              title={(data?.issues.length ?? 0) > 0 ? `Cảnh báo / Không xếp được (${issuesOpen ? 'Ẩn' : 'Xem'})` : 'Cảnh báo / Không xếp được'}
              value={data?.summary.issueCount ?? 0}
              prefix={<WarningOutlined style={{ color: '#DC2626' }} />}
            />
          </Card>
        </Col>
      </Row>

      <PlannerIssuesAlert issues={data?.issues ?? []} expanded={issuesOpen} onExpandedChange={setIssuesOpen} />

      <Card size="small" title={`Đơn nghỉ OFF tuần ${data ? `${fmtYmd(data.weekStart)} – ${fmtYmd(data.weekEnd)}` : ''}`}>
        <PlannerOffTable
          rows={data?.offRequests ?? []} loading={q.isLoading}
          renderActions={canDecide ? (r) => (r.status === 'PENDING' || r.status === 'DRAFT' ? (
            <Space size={6}>
              <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} loading={decision.busyId === r.id} onClick={() => decision.approve(r)}>Duyệt</Button>
              <Button size="small" danger icon={<CloseCircleOutlined />} disabled={decision.busyId === r.id} onClick={() => decision.openReject(r)}>Từ chối</Button>
            </Space>
          ) : null) : undefined}
        />
      </Card>

      <Card size="small" title={`Dự kiến sắp ca (${data?.planned.length ?? 0} ca)`}>
        <PlannerShiftTable rows={data?.planned ?? []} />
      </Card>

      <OffRejectModal target={decision.rejectTarget} loading={decision.pending} onClose={decision.closeReject} onConfirm={decision.reject} />
    </Space>
  );
}
