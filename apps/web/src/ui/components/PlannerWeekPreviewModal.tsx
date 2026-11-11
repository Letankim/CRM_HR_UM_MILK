'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Flex, Input, Modal, Select, Space, Spin, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, FormOutlined, LockOutlined, ReloadOutlined, ScheduleOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { PlannerEmployeeLoadStrip } from './PlannerEmployeeLoadStrip';
import { PlannerMatrixGrid } from './PlannerMatrixGrid';
import { PlannerIssuesAlert, PlannerOffConflictsAlert } from './SchedulePlannerShared';
import {
  buildPlannerMatrixItems, fmtDm, fmtTs, fmtYmd,
  type PlannerBranchStatus, type PlannerWeekData, type PlannerWeekLockResult,
} from './schedule-planner-types';
import { useInvalidatePlanner } from './usePlannerOffDecision';

export interface PlannerWeekPreviewModalProps {
  open: boolean;
  openSeq: number;
  weekStart: string | null;
  branchId: string;
  branchOptions: { value: string; label: string }[];
  canPublish: boolean;
  onBranchChange: (branchId: string) => void;
  onConfirmLock?: (note: string) => void;
  onClose: () => void;
}

/** Popup toàn màn hình xem trước Lưới Lịch Tuần (Ca × Ngày) theo chi nhánh & xác nhận tự động sinh lịch. */
export function PlannerWeekPreviewModal({
  open, openSeq, weekStart, branchId, branchOptions, canPublish, onBranchChange, onConfirmLock, onClose,
}: PlannerWeekPreviewModalProps) {
  const { message, modal } = App.useApp();
  const invalidate = useInvalidatePlanner();
  const [confirmed, setConfirmed] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [lockNote, setLockNote] = useState('');
  const [lastStatuses, setLastStatuses] = useState<PlannerBranchStatus[]>([]);

  useEffect(() => { setConfirmed(false); setIssuesOpen(false); setLockNote(''); }, [open, openSeq, weekStart, branchId]);

  const q = useQuery({
    queryKey: ['schedule-planner-week-preview', openSeq, weekStart, branchId],
    queryFn: () => {
      const p = new URLSearchParams({ branch_id: branchId });
      if (weekStart) p.set('week_start', weekStart);
      return api.get<PlannerWeekData>(`/admin/schedule-planner/week?${p.toString()}`);
    },
    enabled: open && Boolean(weekStart),
    staleTime: 30_000,
  });

  useEffect(() => { if (q.data?.branchStatuses?.length) setLastStatuses(q.data.branchStatuses); }, [q.data?.branchStatuses]);

  const data = q.data, statuses = data?.branchStatuses ?? lastStatuses, isLocked = Boolean(data?.isLocked);
  const matrixItems = useMemo(
    () => buildPlannerMatrixItems(data?.existingShifts ?? [], data?.planned ?? [], isLocked),
    [data?.existingShifts, data?.planned, isLocked],
  );

  const enrichedBranchOptions = useMemo(() => {
    const byId = new Map(statuses.map((s) => [s.branchId, s]));
    const lockedCount = statuses.filter((s) => s.isLocked).length;
    return branchOptions.map((opt) => {
      if (opt.value === 'ALL') {
        const suffix = statuses.length > 0 ? ` (${lockedCount}/${statuses.length} chi nhánh đã chốt)` : '';
        return { value: opt.value, label: `${opt.label}${suffix}` };
      }
      const st = byId.get(opt.value);
      return { value: opt.value, label: `${opt.label}${st ? (st.isLocked ? ' · Đã chốt lịch' : ' · Chưa chốt') : ''}` };
    });
  }, [branchOptions, statuses]);

  const targetBranchLabel = useMemo(() => {
    if (branchId !== 'ALL') return branchOptions.find((o) => o.value === branchId)?.label ?? 'chi nhánh đã chọn';
    const unlocked = statuses.filter((s) => !s.isLocked);
    if (unlocked.length > 0 && unlocked.length < statuses.length) {
      return `${unlocked.length} chi nhánh chưa chốt (${unlocked.map((u) => u.branchCode || u.branchName).join(', ')})`;
    }
    return 'tất cả chi nhánh';
  }, [branchId, branchOptions, statuses]);

  const lockMut = useMutation({
    mutationFn: () => api.post<PlannerWeekLockResult>('/admin/schedule-planner/week/lock', { week_start: data?.weekStart ?? weekStart, branch_id: branchId, note: lockNote.trim() }),
    onSuccess: (res) => {
      if (res.alreadyLocked) {
        message.info('Chi nhánh đã chốt lịch cho tuần này — chỉ xem lại dữ liệu lịch đã chốt.');
        q.refetch();
        return;
      }
      onConfirmLock?.(lockNote.trim());
      const summary = `Đã chốt lịch tuần ${fmtDm(res.weekStart)} cho ${targetBranchLabel}: duyệt ${res.approvedOffCount} đơn OFF và tự động sinh ${res.createdCount} ca (1 người/ca).`;
      onClose();
      invalidate();
      if (res.issues.length > 0) {
        modal.warning({
          width: 680, title: 'Đã tự động sinh lịch nhưng còn ca chưa đủ định biên 1 người/ca',
          content: <Space direction="vertical" size={10} style={{ width: '100%' }}><span>{summary}</span><PlannerIssuesAlert issues={res.issues} maxHeight={320} collapsible={false} /></Space>,
          okText: 'Đã hiểu', okButtonProps: { icon: <CheckCircleOutlined /> },
        });
      } else message.success(summary);
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Tự động sinh lịch tuần thất bại'),
  });

  const isGateOpen = Boolean(data?.offWindow?.isOpen) && !isLocked;
  const lockedInAll = branchId === 'ALL' ? statuses.filter((s) => s.isLocked) : [];
  const readOnlyView = isLocked || !canPublish || isGateOpen;

  return (
    <Modal
      open={open} onCancel={onClose} destroyOnHidden centered width="98vw"
      style={{ maxWidth: '98vw', margin: '0 auto' }}
      styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', paddingTop: 8 } }}
      title={
        <Space size={8} wrap>
          <ScheduleOutlined style={{ color: '#2563EB' }} />
          <span>{readOnlyView ? 'Xem trước Lưới Lịch Tuần' : 'Xem trước & Tự động sắp ca Lưới Lịch Tuần'}{data ? ` (${fmtYmd(data.weekStart)} – ${fmtYmd(data.weekEnd)})` : ''}</span>
          {data && <Tag color={isLocked ? 'green' : 'blue'} icon={isLocked ? <LockOutlined /> : <UnlockOutlined />} style={{ margin: 0 }}>{isLocked ? `Đã chốt lúc ${fmtTs(data.lockedAt)}` : 'Chưa chốt lịch'}</Tag>}
        </Space>
      }
      footer={
        q.isLoading || !data ? (
          <Flex justify="flex-end"><Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button></Flex>
        ) : readOnlyView ? (
          <Flex justify="space-between" align="center" wrap gap={10} style={{ width: '100%' }}>
            <span style={{ color: isLocked ? '#15803D' : isGateOpen ? '#D97706' : '#64748B', fontSize: 13, fontWeight: 500 }}>
              {isLocked
                ? 'Chi nhánh đã chốt lịch tuần này — Chế độ xem trước dữ liệu đã lưu, không cho phép chỉnh sửa hoặc sinh lại lịch.'
                : isGateOpen
                ? 'Cổng đăng ký nghỉ OFF đang mở — Chế độ xem trước, chỉ được phép chốt lịch và tự động sắp ca sau khi cổng đóng.'
                : 'Chế độ xem trước lưới lịch tuần dự kiến — Chỉ bộ phận Nhân sự (HR) thực hiện chốt lịch & tự động sinh lịch.'}
            </span>
            <Button type="primary" icon={<CloseOutlined />} onClick={onClose}>Đóng xem trước</Button>
          </Flex>
        ) : (
          <Flex justify="space-between" align="center" wrap gap={12} style={{ width: '100%' }}>
            <Checkbox checked={confirmed} disabled={lockMut.isPending} onChange={(e) => setConfirmed(e.target.checked)} style={{ textAlign: 'left' }}>
              Tôi đã kiểm tra lưới lịch tuần dự kiến và xác nhận tự động sắp lịch cho <strong>{targetBranchLabel}</strong>
            </Checkbox>
            <Space size={8}>
              <Button icon={<CloseOutlined />} disabled={lockMut.isPending} onClick={onClose}>Hủy bỏ</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} disabled={!confirmed} loading={lockMut.isPending} onClick={() => lockMut.mutate()}>
                Xác nhận &amp; Tự động sinh lịch
              </Button>
            </Space>
          </Flex>
        )
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 14px' }}>
          <Flex justify="space-between" align="center" wrap gap={10}>
            <Space size={10} wrap>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Chi nhánh xem lịch:</span>
              <Select value={branchId} onChange={onBranchChange} options={enrichedBranchOptions} style={{ width: 340 }} />
              {data && (
                <Space size={6} wrap>
                  <Tag color="green" style={{ margin: 0 }}>Ca đã có trên lịch: {data.summary.existingCount ?? 0}</Tag>
                  {!isLocked && <Tag color="blue" style={{ margin: 0 }}>Ca dự kiến tự sinh: {data.summary.plannedCount}</Tag>}
                  <Tag color="gold" style={{ margin: 0 }}>Đơn nghỉ OFF: {data.summary.offCount}</Tag>
                </Space>
              )}
            </Space>
            <Button icon={<ReloadOutlined />} loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()}>Tải lại dữ liệu</Button>
          </Flex>
          {!readOnlyView && (
            <Flex align="center" gap={10} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E5E7EB' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A', whiteSpace: 'nowrap' }}>
                <FormOutlined style={{ color: '#2563EB', marginRight: 6 }} />
                Ghi chú biên bản chốt lịch:
              </span>
              <Input
                allowClear
                maxLength={300}
                showCount
                disabled={lockMut.isPending}
                value={lockNote}
                onChange={(e) => setLockNote(e.target.value)}
                placeholder="Nhập ghi chú lưu biên bản chốt lịch tuần (không bắt buộc, ví dụ: Đã điều phối đủ 1 người/ca cho toàn bộ chi nhánh)..."
                style={{ flex: 1 }}
              />
            </Flex>
          )}
        </div>

        {isGateOpen && (
          <Alert
            type="warning" showIcon
            message="Cổng đăng ký nghỉ OFF đang mở — Chỉ xem trước dữ liệu"
            description="Nút xác nhận & tự động sinh lịch tạm khóa cho đến khi cổng đăng ký nghỉ OFF đóng lại, đảm bảo dữ liệu đăng ký của nhân viên được tập hợp đầy đủ."
          />
        )}
        {isLocked && (
          <Alert
            type="success" showIcon icon={<LockOutlined />}
            message={`Dữ liệu lịch tuần đã chốt${data?.lockedAt ? ` lúc ${fmtTs(data.lockedAt)}` : ''}${data?.lockNote ? ` — ${data.lockNote}` : ''}`}
            description="Lịch của chi nhánh trong tuần này đã được khóa sổ chính thức. Bạn chỉ có thể xem lại lưới ca đã chốt, không thể sinh lại hoặc thao tác chỉnh sửa tại đây."
          />
        )}
        {!isLocked && lockedInAll.length > 0 && (
          <Alert type="info" showIcon message={`Có ${lockedInAll.length} chi nhánh đã chốt lịch trước đó (${lockedInAll.map((b) => b.branchCode || b.branchName).join(', ')}) sẽ được giữ nguyên dữ liệu cũ; hệ thống chỉ tự động sinh lịch cho các chi nhánh chưa chốt.`} />
        )}
        {!isLocked && <PlannerOffConflictsAlert conflicts={data?.offConflicts} />}
        {!isLocked && <PlannerIssuesAlert issues={data?.issues ?? []} expanded={issuesOpen} onExpandedChange={setIssuesOpen} />}
        {data?.employeeLoads && data.employeeLoads.length > 0 && (
          <PlannerEmployeeLoadStrip loads={data.employeeLoads} selectedBranchId={branchId} />
        )}

        <Spin spinning={q.isLoading}>
          {data && <PlannerMatrixGrid weekStart={data.weekStart} selectedBranchId={branchId} branchStatuses={statuses} items={matrixItems} offRequests={data.offRequests} isLocked={isLocked} />}
        </Spin>
      </Space>
    </Modal>
  );
}
