'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Flex, Modal, Space, Spin, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, LockOutlined, ReloadOutlined, ScheduleOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { mondayOfWeek } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { PlannerMatrixGrid } from './PlannerMatrixGrid';
import { PlannerIssuesAlert } from './SchedulePlannerShared';
import {
  buildPlannerMatrixItems, fmtDm, fmtTs, fmtYmd,
  type PlannerProbationItem, type PlannerProbationLockResult,
} from './schedule-planner-types';
import { useInvalidatePlanner } from './usePlannerOffDecision';

export interface PlannerProbationPreviewModalProps {
  open: boolean;
  openSeq: number;
  employeeId: string | null;
  branchId: string;
  canPublish: boolean;
  onClose: () => void;
}

/** Popup toàn màn hình xem trước Lưới Lịch Tuần cho chu kỳ thử việc 12 ngày & xác nhận tự động sinh lịch. */
export function PlannerProbationPreviewModal({
  open, openSeq, employeeId, branchId, canPublish, onClose,
}: PlannerProbationPreviewModalProps) {
  const { message, modal } = App.useApp();
  const invalidate = useInvalidatePlanner();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => { setConfirmed(false); }, [open, openSeq, employeeId]);

  const q = useQuery({
    queryKey: ['schedule-planner-probation-preview', openSeq, branchId, employeeId],
    queryFn: () => api.get<PlannerProbationItem[]>(`/admin/schedule-planner/probation?branch_id=${encodeURIComponent(branchId)}`),
    enabled: open && Boolean(employeeId),
    staleTime: 0,
  });

  const item = useMemo(() => (q.data ?? []).find((r) => r.employeeId === employeeId) ?? null, [q.data, employeeId]);
  const isLocked = Boolean(item?.isLocked);

  const matrixItems = useMemo(
    () => (item ? buildPlannerMatrixItems(item.existingShifts ?? [], item.planned ?? [], isLocked) : []),
    [item, isLocked],
  );

  const cycleWeeks = useMemo(() => {
    if (!item) return [];
    const weeks: string[] = [];
    let cur = mondayOfWeek(item.cycleStart);
    while (cur <= item.cycleEnd && weeks.length < 3) {
      weeks.push(cur);
      cur = dayjs(cur).add(7, 'day').format('YYYY-MM-DD');
    }
    return weeks;
  }, [item]);

  const lockMut = useMutation({
    mutationFn: () => api.post<PlannerProbationLockResult>('/admin/schedule-planner/probation/lock', { employee_id: employeeId }),
    onSuccess: (res) => {
      if (res.alreadyLocked) {
        message.info('Chu kỳ thử việc này đã chốt lịch — chỉ xem lại dữ liệu lịch đã chốt.');
        q.refetch();
        return;
      }
      const empName = item?.employeeName ?? 'nhân viên thử việc';
      const summary = `Đã chốt lịch chu kỳ ${fmtDm(res.cycleStart)} – ${fmtDm(res.cycleEnd)} của ${empName}: duyệt ${res.approvedOffCount} ngày OFF, tự động sinh ${res.createdCount} ca.`;
      onClose();
      invalidate();
      if (res.issues.length > 0) {
        modal.warning({
          width: 680, title: 'Đã tự động sinh lịch chu kỳ nhưng còn trường hợp chưa xếp được',
          content: <Space direction="vertical" size={10} style={{ width: '100%' }}><span>{summary}</span><PlannerIssuesAlert issues={res.issues} maxHeight={320} collapsible={false} /></Space>,
          okText: 'Đã hiểu', okButtonProps: { icon: <CheckCircleOutlined /> },
        });
      } else message.success(summary);
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Tự động sinh lịch chu kỳ thử việc thất bại'),
  });

  return (
    <Modal
      open={open} onCancel={onClose} destroyOnHidden centered width="98vw"
      style={{ maxWidth: '98vw', top: 8, paddingBottom: 0 }}
      styles={{ body: { height: 'calc(100vh - 156px)', overflowY: 'auto', paddingTop: 8 } }}
      title={
        <Space size={8} wrap>
          <ScheduleOutlined style={{ color: '#2563EB' }} />
          <span>
            {isLocked ? 'Xem lại Lịch Chu Kỳ Thử Việc Đã Chốt' : 'Xem trước & Tự động sắp ca Chu Kỳ Thử Việc 12 Ngày'}
            {item ? ` — ${item.employeeName} (${item.employeeCode})` : ''}
          </span>
          {item && <Tag color={isLocked ? 'green' : 'blue'} icon={isLocked ? <LockOutlined /> : <UnlockOutlined />} style={{ margin: 0 }}>{isLocked ? `Đã chốt lúc ${fmtTs(item.lockedAt)}` : 'Chưa chốt chu kỳ'}</Tag>}
        </Space>
      }
      footer={
        q.isLoading || !item ? (
          <Flex justify="flex-end"><Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button></Flex>
        ) : isLocked ? (
          <Flex justify="space-between" align="center" wrap gap={10}>
            <span style={{ color: '#15803D', fontSize: 13, fontWeight: 500 }}>Chu kỳ thử việc đã chốt lịch — Chế độ xem trước dữ liệu đã lưu, không cho phép chỉnh sửa hoặc sinh lại lịch.</span>
            <Button type="primary" icon={<CloseOutlined />} onClick={onClose}>Đóng xem trước</Button>
          </Flex>
        ) : (
          <Flex justify="space-between" align="center" wrap gap={12}>
            <Checkbox checked={confirmed} disabled={!canPublish || lockMut.isPending} onChange={(e) => setConfirmed(e.target.checked)}>
              Tôi đã kiểm tra lưới lịch chu kỳ ({fmtDm(item.cycleStart)} – {fmtDm(item.cycleEnd)}) và xác nhận tự động sắp lịch cho <strong>{item.employeeName} ({item.branchName})</strong>
            </Checkbox>
            <Space size={8}>
              <Button icon={<CloseOutlined />} disabled={lockMut.isPending} onClick={onClose}>Hủy bỏ</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} disabled={!confirmed || !canPublish} loading={lockMut.isPending} onClick={() => lockMut.mutate()}>Xác nhận & Tự động sinh lịch</Button>
            </Space>
          </Flex>
        )
      }
    >
      <Spin spinning={q.isLoading}>
        {item && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 14px' }}>
              <Flex justify="space-between" align="center" wrap gap={10}>
                <Space size={8} wrap>
                  <Tag color="geekblue" style={{ margin: 0 }}>{item.branchName}</Tag>
                  <Tag color="blue" style={{ margin: 0 }}>Chu kỳ 12 ngày: {fmtYmd(item.cycleStart)} – {fmtYmd(item.cycleEnd)}</Tag>
                  <Tag color="green" style={{ margin: 0 }}>Ca đã có: {item.existingCount}/{item.workRequired}</Tag>
                  {!isLocked && <Tag color="cyan" style={{ margin: 0 }}>Ca dự kiến tự sinh: {item.planned.length}</Tag>}
                  <Tag color="gold" style={{ margin: 0 }}>Ngày nghỉ OFF: {item.offRequests.length}/{item.offLimit}</Tag>
                </Space>
                <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Tải lại dữ liệu</Button>
              </Flex>
            </div>
            {isLocked && (
              <Alert type="success" showIcon icon={<LockOutlined />} message={`Chu kỳ thử việc đã chốt lịch lúc ${fmtTs(item.lockedAt)}`} description="Lịch chu kỳ 12 ngày của nhân sự này đã được khóa sổ chính thức. Chế độ chỉ xem trước dữ liệu đã lưu." />
            )}
            {!isLocked && <PlannerIssuesAlert issues={item.issues} />}
            {cycleWeeks.map((ws) => (
              <PlannerMatrixGrid
                key={ws} weekStart={ws} selectedBranchId={item.branchId} items={matrixItems}
                offRequests={item.offRequests} isLocked={isLocked} hideStaffingBadge
                validDateRange={{ start: item.cycleStart, end: item.cycleEnd }}
              />
            ))}
          </Space>
        )}
      </Spin>
    </Modal>
  );
}
