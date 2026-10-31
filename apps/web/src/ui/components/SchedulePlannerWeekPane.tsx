'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Flex, Row, Select, Space, Statistic, Tag } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, LockOutlined,
  ReloadOutlined, ScheduleOutlined, UnlockOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { mondayOfWeek } from '@umbm/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PlannerWeekPreviewModal } from './PlannerWeekPreviewModal';
import { OffRejectModal, PlannerIssuesAlert, PlannerOffTable } from './SchedulePlannerShared';
import { fmtDm, fmtTs, fmtYmd, type PlannerWeekData } from './schedule-planner-types';
import { usePlannerOffDecision } from './usePlannerOffDecision';

interface Props { branchOptions: { value: string; label: string }[] }

/** Chốt lịch tuần cho nhân viên chính thức: xem trước Lưới Lịch Tuần toàn màn hình & tự động sắp ca theo chi nhánh. */
export function SchedulePlannerWeekPane({ branchOptions }: Props) {
  const can = useCan(), canPublish = can('schedule.publish'), canDecide = can('leave.approve');
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('ALL');
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [preview, setPreview] = useState<{ open: boolean; seq: number; branchId: string }>({ open: false, seq: 0, branchId: 'ALL' });
  const decision = usePlannerOffDecision();

  const params = new URLSearchParams({ branch_id: branchId });
  if (weekStart) params.set('week_start', weekStart);
  const q = useQuery({ queryKey: ['schedule-planner-week', weekStart, branchId], queryFn: () => api.get<PlannerWeekData>(`/admin/schedule-planner/week?${params.toString()}`) });
  const data = q.data, effWeek = weekStart ?? data?.weekStart ?? null;

  const enrichedBranchOptions = useMemo(() => {
    const statuses = data?.branchStatuses ?? [];
    if (statuses.length === 0) return branchOptions;
    const byId = new Map(statuses.map((s) => [s.branchId, s]));
    return branchOptions.map((opt) => {
      if (opt.value === 'ALL') return opt;
      const st = byId.get(opt.value);
      return { value: opt.value, label: `${opt.label}${st ? (st.isLocked ? ' · Đã chốt' : ' · Chưa chốt') : ''}` };
    });
  }, [branchOptions, data?.branchStatuses]);

  const onPickWeek = (d: Dayjs | null) => setWeekStart(d ? mondayOfWeek(d.format('YYYY-MM-DD')) : null);
  const weekLabel = (d: Dayjs) => { const m = mondayOfWeek(d.format('YYYY-MM-DD')); return `Tuần ${fmtDm(m)} – ${dayjs(m).add(6, 'day').format('DD/MM/YYYY')}`; };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px' }}>
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={10} wrap>
            <DatePicker picker="week" allowClear={false} value={effWeek ? dayjs(effWeek) : null} onChange={onPickWeek} format={weekLabel} style={{ width: 245 }} placeholder="Chọn tuần cần chốt lịch" />
            <Select value={branchId} onChange={setBranchId} options={enrichedBranchOptions} style={{ width: 280 }} />
            {data && <Tag color={data.isLocked ? 'green' : 'default'} icon={data.isLocked ? <LockOutlined /> : <UnlockOutlined />} style={{ margin: 0 }}>{data.isLocked ? `Đã chốt lịch lúc ${fmtTs(data.lockedAt)}` : 'Chưa chốt'}</Tag>}
          </Space>
          <Space size={8} wrap>
            <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
            <Button
              type="primary" icon={<ScheduleOutlined />} disabled={!effWeek}
              onClick={() => setPreview((p) => ({ open: true, seq: p.seq + 1, branchId }))}
            >
              Chốt lịch & Tự động sắp ca
            </Button>
          </Space>
        </Flex>
      </div>

      {data?.offWindow && <Alert type={data.offWindow.isOpen ? 'success' : 'info'} showIcon icon={<CalendarOutlined />} message={data.offWindow.message} />}
      {data?.isLocked && data.lockNote && <Alert type="info" showIcon message={`Biên bản chốt lịch: ${data.lockNote}`} />}

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={data?.isLocked ? 'Ca đã chốt trên lịch' : 'Ca chờ tự động sắp'}
              value={data?.isLocked ? (data.summary.existingCount ?? 0) : (data?.summary.plannedCount ?? 0)}
              prefix={<ScheduleOutlined style={{ color: '#2563EB' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Đơn nghỉ OFF trong tuần" value={data?.summary.offCount ?? 0} prefix={<CalendarOutlined style={{ color: '#16A34A' }} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Đơn OFF chờ duyệt" value={data?.summary.pendingOffCount ?? 0} prefix={<CalendarOutlined style={{ color: '#D97706' }} />} /></Card></Col>
        <Col xs={12} md={6}>
          <Card
            size="small"
            onClick={() => (data?.issues.length ?? 0) > 0 && setIssuesOpen((v) => !v)}
            style={{ cursor: (data?.issues.length ?? 0) > 0 ? 'pointer' : 'default', borderColor: issuesOpen && (data?.issues.length ?? 0) > 0 ? '#FCA5A5' : undefined }}
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
          renderActions={canDecide && !data?.isLocked ? (r) => (r.status === 'PENDING' || r.status === 'DRAFT' ? (
            <Space size={6}>
              <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} loading={decision.busyId === r.id} onClick={() => decision.approve(r)}>Duyệt</Button>
              <Button size="small" danger icon={<CloseCircleOutlined />} disabled={decision.busyId === r.id} onClick={() => decision.openReject(r)}>Từ chối</Button>
            </Space>
          ) : null) : undefined}
        />
      </Card>

      <OffRejectModal target={decision.rejectTarget} loading={decision.pending} onClose={decision.closeReject} onConfirm={decision.reject} />
      <PlannerWeekPreviewModal
        open={preview.open} openSeq={preview.seq} weekStart={effWeek} branchId={preview.branchId}
        branchOptions={branchOptions} canPublish={canPublish}
        onBranchChange={(next) => setPreview((p) => ({ ...p, branchId: next }))}
        onClose={() => setPreview((p) => ({ ...p, open: false }))}
      />
    </Space>
  );
}
