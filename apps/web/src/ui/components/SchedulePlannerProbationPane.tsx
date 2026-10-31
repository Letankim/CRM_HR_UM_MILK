'use client';

import { useState } from 'react';
import { Alert, App, Button, Card, Flex, Popconfirm, Select, Space, Table, Tag, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseOutlined, LockOutlined, ReloadOutlined, ScheduleOutlined, TrophyOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PlannerIssuesAlert, PlannerOffTable, PlannerShiftTable } from './SchedulePlannerShared';
import { fmtDm, fmtTs, type PlannerProbationItem, type PlannerProbationLockResult } from './schedule-planner-types';
import { useInvalidatePlanner } from './usePlannerOffDecision';

interface Props { branchOptions: { value: string; label: string }[] }

/** Chốt lịch chu kỳ thử việc 12 ngày (7 ca làm + tối đa 5 ngày OFF) và duyệt chuyển chính thức khi hoàn thành đủ 7 ca. */
export function SchedulePlannerProbationPane({ branchOptions }: Props) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const canPublish = can('schedule.publish');
  const canPromote = can('employee.promote');
  const [branchId, setBranchId] = useState('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promoteBusyId, setPromoteBusyId] = useState<string | null>(null);
  const invalidate = useInvalidatePlanner();
  const q = useQuery({ queryKey: ['schedule-planner-probation', branchId], queryFn: () => api.get<PlannerProbationItem[]>(`/admin/schedule-planner/probation?branch_id=${encodeURIComponent(branchId)}`) });
  const rows = q.data ?? [];
  const readyRows = rows.filter((r) => r.readyForOfficial);

  const promoteMut = useMutation({
    mutationFn: (row: PlannerProbationItem) => api.post(`/admin/employees/${row.employeeId}/promote-official`, {
      version: row.employeeVersion,
      evaluation_summary: `Hoàn thành đủ ${row.completedCount}/${row.workRequired} ca thử việc bắt buộc — HR duyệt chuyển Chính thức`,
    }),
    onMutate: (row) => setPromoteBusyId(row.employeeId),
    onSuccess: (_, row) => {
      message.success(`Đã duyệt chuyển Nhân viên chính thức cho ${row.employeeName} (${row.employeeCode})`);
      invalidate();
      ['employees', 'dashboard-employees', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Duyệt chuyển chính thức thất bại'),
    onSettled: () => setPromoteBusyId(null),
  });

  const lockMut = useMutation({
    mutationFn: (row: PlannerProbationItem) => api.post<PlannerProbationLockResult>('/admin/schedule-planner/probation/lock', { employee_id: row.employeeId }),
    onMutate: (row) => setBusyId(row.employeeId),
    onSuccess: (res, row) => {
      const summary = `Đã chốt lịch chu kỳ ${fmtDm(res.cycleStart)} – ${fmtDm(res.cycleEnd)} của ${row.employeeName}: duyệt ${res.approvedOffCount} ngày OFF, xếp ${res.createdCount} ca.`;
      if (res.issues.length > 0) {
        modal.warning({ width: 680, title: 'Đã chốt lịch chu kỳ nhưng còn trường hợp chưa xếp được', content: <Space direction="vertical" size={10} style={{ width: '100%' }}><span>{summary}</span><PlannerIssuesAlert issues={res.issues} maxHeight={320} collapsible={false} /></Space>, okText: 'Đã hiểu', okButtonProps: { icon: <CheckCircleOutlined /> } });
      } else message.success(summary);
      invalidate();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Chốt lịch chu kỳ thử việc thất bại'),
    onSettled: () => setBusyId(null),
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
          <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Làm mới</Button>
        </Flex>
      </div>
      <Table<PlannerProbationItem>
        size="small" rowKey="employeeId" loading={q.isLoading} dataSource={rows} scroll={{ x: 1340 }}
        pagination={rows.length > 10 ? { pageSize: 10, showTotal: (t) => `Tổng ${t} nhân viên thử việc` } : false}
        locale={{ emptyText: 'Không có nhân viên thử việc nào đang hoạt động' }}
        expandable={{
          expandedRowRender: (r) => (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <PlannerIssuesAlert issues={r.issues} />
              <Card size="small" title={`Đơn nghỉ OFF trong chu kỳ (${r.offRequests.length}/${r.offLimit})`}><PlannerOffTable rows={r.offRequests} /></Card>
              <Card size="small" title={`Ca dự kiến sắp thêm (${r.planned.length} ca)`}><PlannerShiftTable rows={r.planned} showEmployee={false} /></Card>
            </Space>
          ),
        }}
        columns={[
          { title: 'Nhân viên thử việc', width: 230, ellipsis: true, render: (_, r) => <span><strong>{r.employeeName}</strong> <span style={{ color: '#64748B' }}>({r.employeeCode})</span></span> },
          { title: 'Chi nhánh', dataIndex: 'branchName', width: 170, ellipsis: true },
          { title: 'Chu kỳ', width: 140, render: (_, r) => <strong className="num">{fmtDm(r.cycleStart)} – {fmtDm(r.cycleEnd)}</strong> },
          { title: 'Ca đã xếp', width: 100, render: (_, r) => <Tag color={r.existingCount >= r.workRequired ? 'green' : 'blue'} style={{ margin: 0 }}>{r.existingCount}/{r.workRequired}</Tag> },
          { title: 'Đã làm xong', width: 130, render: (_, r) => <Tag color={r.readyForOfficial ? 'success' : 'processing'} style={{ margin: 0, fontWeight: r.readyForOfficial ? 600 : 400 }}>{r.completedCount}/{r.workRequired} ca{r.readyForOfficial ? ' · Đủ ĐK' : ''}</Tag> },
          { title: 'Ngày OFF', width: 95, render: (_, r) => <Tag color={r.offRequests.length > r.offLimit ? 'red' : 'default'} style={{ margin: 0 }}>{r.offRequests.length}/{r.offLimit}</Tag> },
          { title: 'Dự kiến sắp', width: 105, render: (_, r) => <strong>{r.planned.length} ca</strong> },
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
          {
            title: 'Thao tác', width: 320, fixed: 'right', align: 'right',
            render: (_, r) => (
              <Flex justify="flex-end" align="center" gap={6} wrap={false} style={{ width: '100%', whiteSpace: 'nowrap' }}>
                {r.readyForOfficial && (
                  <Popconfirm
                    title="Duyệt chuyển Nhân viên chính thức"
                    description={<div style={{ maxWidth: 340 }}>{r.employeeName} đã hoàn thành {r.completedCount}/{r.workRequired} ca thử việc bắt buộc. Xác nhận duyệt chuyển sang Nhân viên chính thức?</div>}
                    okText="Duyệt chính thức" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
                    disabled={!canPromote} onConfirm={() => promoteMut.mutate(r)}
                  >
                    <Button size="small" type="primary" icon={<TrophyOutlined />} disabled={!canPromote} loading={promoteBusyId === r.employeeId}>Duyệt chính thức</Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title="Chốt lịch chu kỳ thử việc"
                  description={<div style={{ maxWidth: 340 }}>Duyệt toàn bộ ngày OFF đang chờ duyệt trong chu kỳ và xếp ca mặc định cho đủ {r.workRequired} ca làm việc của {r.employeeName}.</div>}
                  okText="Xác nhận chốt" cancelText="Hủy bỏ" okButtonProps={{ icon: <CheckCircleOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
                  disabled={!canPublish} onConfirm={() => lockMut.mutate(r)}
                >
                  <Button size="small" type="primary" ghost icon={<ScheduleOutlined />} disabled={!canPublish} loading={busyId === r.employeeId}>Chốt lịch chu kỳ</Button>
                </Popconfirm>
              </Flex>
            ),
          },
        ]}
      />
    </Space>
  );
}
