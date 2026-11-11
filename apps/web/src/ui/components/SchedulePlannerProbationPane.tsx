'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, Flex, Segmented, Select, Space, Table, Tag, Tooltip } from 'antd';
import {
  BarChartOutlined, CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, LockOutlined,
  ReloadOutlined, ScheduleOutlined, TableOutlined, TrophyOutlined, UnlockOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { buildClickableRowProps } from './BulkActionBar';
import { EmployeePromoteOfficialModal } from './EmployeePromoteOfficialModal';
import { PlannerProbationPreviewModal } from './PlannerProbationPreviewModal';
import { useQuickDetail } from './RecordQuickDetailModal';
import { PlannerIssuesAlert, PlannerOffTable } from './SchedulePlannerShared';
import { SchedulePlannerProbationGantt, sortProbationNewestFirst } from './SchedulePlannerProbationGantt';
import { fmtDm, fmtTs, type PlannerProbationItem } from './schedule-planner-types';
import { useInvalidatePlanner, usePlannerOffDecision } from './usePlannerOffDecision';

interface Props { branchOptions: { value: string; label: string }[] }

/** Chốt lịch chu kỳ thử việc 12 ngày (7 ca làm + tối đa 5 ngày OFF) và duyệt chuyển chính thức khi hoàn thành đủ 7 ca. */
export function SchedulePlannerProbationPane({ branchOptions }: Props) {
  const showDetail = useQuickDetail();
  const can = useCan(), me = useMe().data?.user, isFinance = me?.role === 'FINANCE';
  const canPublish = !isFinance && can('schedule.publish');
  const canPromote = !isFinance && can('employee.promote');
  const canDecideOff = !isFinance && can('leave.approve');
  const [branchId, setBranchId] = useState('ALL');
  const [promoteTarget, setPromoteTarget] = useState<PlannerProbationItem | null>(null);
  const [preview, setPreview] = useState<{ open: boolean; seq: number; employeeId: string | null }>({ open: false, seq: 0, employeeId: null });
  const invalidate = useInvalidatePlanner();
  const offDecision = usePlannerOffDecision();

  const q = useQuery({
    queryKey: ['schedule-planner-probation', branchId],
    queryFn: () => api.get<PlannerProbationItem[]>(`/admin/schedule-planner/probation?branch_id=${encodeURIComponent(branchId)}`),
    staleTime: 30_000,
  });
  const rows = useMemo(() => sortProbationNewestFirst(q.data ?? []), [q.data]);
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table');
  const readyRows = rows.filter((r) => r.readyForOfficial);

  const openPromoteModal = (row: PlannerProbationItem) => {
    setPromoteTarget(row);
  };

  const openProbationDetail = (item: PlannerProbationItem) =>
    showDetail('plannerProbation', item, {
      onPromoteProbation: canPromote ? (rec) => openPromoteModal(rec as unknown as PlannerProbationItem) : undefined,
      onOpenProbationSchedule: !isFinance ? (rec) => setPreview((p) => ({ open: true, seq: p.seq + 1, employeeId: String(rec.employeeId) })) : undefined,
    });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {readyRows.length > 0 && (
        <Alert
          type="success" showIcon
          message={`Có ${readyRows.length} nhân viên thử việc đã hoàn thành đủ 7 ca bắt buộc — sẵn sàng để HR xét duyệt lên Nhân viên chính thức`}
          description={readyRows.map((r) => `${r.employeeName} (${r.employeeCode} · ${r.completedCount}/${r.workRequired} ca hoàn thành)`).join(' · ')}
        />
      )}
      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px' }}>
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={10} wrap>
            <Select value={branchId} onChange={setBranchId} options={branchOptions} style={{ width: 220 }} />
            <span style={{ color: '#64748B', fontSize: 13 }}>Mỗi chu kỳ thử việc 12 ngày gồm 7 ca làm việc và tối đa 5 ngày nghỉ OFF.</span>
          </Space>
          <Space size={8} wrap>
            <Segmented value={viewMode} onChange={(v) => setViewMode(v as 'table' | 'gantt')} options={[{ value: 'table', icon: <TableOutlined />, label: 'Bảng' }, { value: 'gantt', icon: <BarChartOutlined />, label: 'Biểu đồ Gantt' }]} />
            <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
          </Space>
        </Flex>
      </div>
      {viewMode === 'gantt' && (
        q.isLoading ? <Card size="small" loading /> : <SchedulePlannerProbationGantt rows={rows} onSelect={openProbationDetail} />
      )}
      {viewMode === 'table' && <Table<PlannerProbationItem>
        size="small" rowKey="employeeId" loading={q.isLoading} dataSource={rows} scroll={{ x: 1260 }}
        onRow={(r) => buildClickableRowProps(r, openProbationDetail)}
        pagination={rows.length > 10 ? { pageSize: 10, showTotal: (t) => `Tổng ${t} nhân viên thử việc` } : false}
        locale={{ emptyText: 'Không có nhân viên thử việc nào đang hoạt động' }}
        expandable={{
          expandedRowRender: (r) => {
            const allowOff = canDecideOff && !r.isLocked;
            return (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <PlannerIssuesAlert issues={r.issues} />
                <Card size="small" title={`Đơn nghỉ OFF trong chu kỳ (${r.offRequests.length}/${r.offLimit})`}>
                  <PlannerOffTable
                    rows={r.offRequests}
                    onApprove={allowOff ? offDecision.approve : undefined}
                    onReject={allowOff ? offDecision.openReject : undefined}
                    renderActions={allowOff ? (offRow) => (offRow.status === 'PENDING' || offRow.status === 'DRAFT' ? (
                      <Space size={6}>
                        <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} loading={offDecision.busyId === offRow.id} onClick={() => offDecision.approve(offRow)}>Duyệt</Button>
                        <Button size="small" danger icon={<CloseCircleOutlined />} disabled={offDecision.busyId === offRow.id} onClick={() => offDecision.openReject(offRow)}>Từ chối</Button>
                      </Space>
                    ) : null) : undefined}
                  />
                </Card>
              </Space>
            );
          },
        }}
        columns={[
          { title: 'Nhân viên thử việc', width: 230, ellipsis: true, render: (_, r) => <span><strong>{r.employeeName}</strong> <span style={{ color: '#64748B' }}>({r.employeeCode})</span></span> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 170, ellipsis: true },
          { title: 'Chu kỳ', width: 140, render: (_, r) => <strong className="num">{fmtDm(r.cycleStart)} – {fmtDm(r.cycleEnd)}</strong> },
          { title: 'Ca đã xếp', width: 100, render: (_, r) => <Tag color={r.existingCount >= r.workRequired ? 'green' : 'blue'} style={{ margin: 0 }}>{r.existingCount}/{r.workRequired}</Tag> },
          { title: 'Đã làm xong', width: 175, render: (_, r) => <Tag color={r.readyForOfficial ? 'success' : 'processing'} style={{ margin: 0, fontWeight: r.readyForOfficial ? 600 : 400, whiteSpace: 'nowrap' }}>{r.completedCount}/{r.workRequired} ca{r.readyForOfficial ? ' · Đủ điều kiện' : ''}</Tag> },
          { title: 'Ngày OFF', width: 95, render: (_, r) => <Tag color={r.offRequests.length > r.offLimit ? 'red' : 'default'} style={{ margin: 0 }}>{r.offRequests.length}/{r.offLimit}</Tag> },
          {
            title: 'Cảnh báo', width: 110,
            render: (_, r) => r.issues.length === 0 ? <Tag color="green" style={{ margin: 0 }}>Không có</Tag> : (
              <Tooltip title={<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{r.issues.map((i, idx) => <span key={idx}>{i.message}</span>)}</div>}>
                <Tag color="volcano" style={{ margin: 0, cursor: 'help' }}>{r.issues.length} cảnh báo</Tag>
              </Tooltip>
            ),
          },
          { title: 'Đăng ký thêm ca', width: 130, render: (_, r) => r.pendingExtraShifts > 0 ? <Tag color="gold" style={{ margin: 0 }}>{r.pendingExtraShifts} ca chờ duyệt</Tag> : <span style={{ color: '#64748B' }}>Không có</span> },
          { title: 'Trạng thái chốt', width: 185, render: (_, r) => <Tag color={r.isLocked ? 'green' : 'default'} icon={r.isLocked ? <LockOutlined /> : <UnlockOutlined />} style={{ margin: 0 }}>{r.isLocked ? `Đã chốt lúc ${fmtTs(r.lockedAt)}` : 'Chưa chốt'}</Tag> },
          ...(!isFinance ? [{
            title: 'Thao tác', width: canPromote ? 320 : 185, fixed: 'right' as const, align: 'right' as const,
            render: (_: unknown, r: PlannerProbationItem) => (
              <Flex justify="flex-end" align="center" gap={6} wrap={false} style={{ width: '100%', whiteSpace: 'nowrap' }}>
                {canPromote && r.readyForOfficial && (
                  <Button size="small" type="primary" icon={<TrophyOutlined />} loading={promoteTarget?.employeeId === r.employeeId} onClick={() => openPromoteModal(r)}>
                    Duyệt chính thức
                  </Button>
                )}
                {canPublish ? (
                  <Button size="small" type="primary" ghost icon={<ScheduleOutlined />} onClick={() => setPreview((p) => ({ open: true, seq: p.seq + 1, employeeId: r.employeeId }))}>
                    {r.isLocked ? 'Xem lịch chu kỳ' : 'Chốt lịch chu kỳ'}
                  </Button>
                ) : (
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setPreview((p) => ({ open: true, seq: p.seq + 1, employeeId: r.employeeId }))}>
                    Xem lịch chu kỳ
                  </Button>
                )}
              </Flex>
            ),
          }] : []),
        ]}
      />}
      {offDecision.decisionModalElement}
      {promoteTarget && (
        <EmployeePromoteOfficialModal
          open
          employee={{
            id: promoteTarget.employeeId,
            employeeCode: promoteTarget.employeeCode,
            fullName: promoteTarget.employeeName,
            branchId: promoteTarget.branchId,
            branchName: promoteTarget.branchName,
            version: promoteTarget.employeeVersion,
          }}
          onClose={() => setPromoteTarget(null)}
          onSuccess={() => {
            setPromoteTarget(null);
            invalidate();
          }}
        />
      )}
      {preview.open && (
        <PlannerProbationPreviewModal
          open={preview.open} openSeq={preview.seq} employeeId={preview.employeeId}
          branchId={branchId} canPublish={canPublish}
          onClose={() => setPreview((p) => ({ ...p, open: false }))}
        />
      )}
    </Space>
  );
}
