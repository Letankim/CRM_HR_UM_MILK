'use client';

import { Tabs } from 'antd';
import { ScheduleOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SchedulePlannerProbationPane } from './SchedulePlannerProbationPane';
import { SchedulePlannerWeekPane } from './SchedulePlannerWeekPane';

/** Khu vực Chốt lịch & Tự động sắp ca: tuần cho NV chính thức và chu kỳ 12 ngày cho NV thử việc. */
export function SchedulePlannerPanel() {
  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=100') });
  const probationQ = useQuery({ queryKey: ['schedule-planner-probation', 'count'], queryFn: () => api.list<Record<string, unknown>>('/admin/schedule-planner/probation?branch_id=ALL'), staleTime: 30_000 });
  const branchList = branchesQ.data?.data ?? [];
  const branchOptions = [{ value: 'ALL', label: 'Tất cả chi nhánh' }, ...branchList.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))];
  const probCount = probationQ.data?.data?.length ?? 0;
  return (
    <Tabs
      destroyInactiveTabPane
      type="card" size="small"
      items={[
        { key: 'week', label: <span><ScheduleOutlined /> Chốt lịch tuần (NV chính thức)</span>, children: <SchedulePlannerWeekPane branchOptions={branchOptions} /> },
        { key: 'probation', label: <span><TeamOutlined /> Chu kỳ thử việc 12 ngày ({probCount})</span>, children: <SchedulePlannerProbationPane branchOptions={branchOptions} /> },
      ]}
    />
  );
}
