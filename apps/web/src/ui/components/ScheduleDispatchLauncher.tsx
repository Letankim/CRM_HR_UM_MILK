'use client';

import { useState } from 'react';
import { App, Button, Space, Tooltip } from 'antd';
import { BankOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { WorkflowAssignmentOption } from './ScheduleWorkflowModals';
import { WorkflowSwapCreateModal } from './WorkflowSwapCreateModal';

type PresetKind = 'HR_DISPATCH' | 'HR_SUPPORT';
interface Props {
  employees: { value: string; label: string; branchId?: string; canSwapShift?: boolean }[];
  assignments: WorkflowAssignmentOption[];
}

const REFRESH_KEYS = ['shift-swaps', 'schedules', 'schedule-planner-week', 'my-attendance', 'payroll-periods', 'payroll-snapshots', 'payroll-reconcile', 'announcements'];
const SUCCESS_MSG: Record<PresetKind, string> = {
  HR_DISPATCH: 'Đã phát lệnh điều phối khẩn cấp lên bảng tin chi nhánh (+30.000đ)',
  HR_SUPPORT: 'Đã điều động hỗ trợ liên chi nhánh và tự động tạo ca tại chi nhánh đích',
};

/** Hai nút "Điều phối khẩn cấp" và "Hỗ trợ chi nhánh" ngay trên màn Lịch làm việc, mở thẳng popup tạo phiếu đúng loại. */
export function ScheduleDispatchLauncher({ employees, assignments }: Props) {
  const can = useCan(), qc = useQueryClient(), { message } = App.useApp();
  const [kind, setKind] = useState<PresetKind | null>(null);
  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100') });
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/admin/shift-swaps', body),
    onSuccess: (_r, body) => { message.success(SUCCESS_MSG[(body.kind as PresetKind) ?? 'HR_DISPATCH']); REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể tạo phiếu điều phối'),
  });
  if (!can('swap.approve')) return null;

  return (
    <>
      <Space size={8} wrap>
        <Tooltip title="Phát lệnh lên bảng tin chi nhánh, nhân viên nhận ca được cộng +30.000đ/ca">
          <Button danger icon={<ThunderboltOutlined />} onClick={() => setKind('HR_DISPATCH')}>Điều phối khẩn cấp</Button>
        </Tooltip>
        <Tooltip title="Điều nhân sự sang tăng cường chi nhánh khác, tự tạo ca tại chi nhánh đích">
          <Button icon={<BankOutlined />} onClick={() => setKind('HR_SUPPORT')}>Hỗ trợ chi nhánh</Button>
        </Tooltip>
      </Space>
      <WorkflowSwapCreateModal
        open={kind !== null} presetKind={kind ?? undefined} employees={employees} assignments={assignments}
        branches={branchesQ.data?.data ?? []} submitting={createMut.isPending}
        onClose={() => setKind(null)} onSubmit={(body) => !createMut.isPending && createMut.mutate(body)}
      />
    </>
  );
}
