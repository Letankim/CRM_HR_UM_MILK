'use client';

import { Spin } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { type Dispatch, type SetStateAction, useState } from 'react';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { ScheduleMonthCalendar } from './ScheduleMonthCalendar';
import { getMonday, ScheduleWeekMatrix } from './ScheduleWeekMatrix';

export interface ScheduleViewsPanelProps {
  mode: 'WEEK_MATRIX' | 'CALENDAR';
  todayDate?: string;
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  loading?: boolean;
  hideStaffingBadge?: boolean;
  onAddAtCell: (dateStr: string, shiftCode?: string) => void;
  onEditItem: (item: ScheduleAssignmentItem) => void;
  weekStart?: Dayjs;
  onWeekStartChange?: Dispatch<SetStateAction<Dayjs>>;
  calMonth?: Dayjs;
  onMonthChange?: Dispatch<SetStateAction<Dayjs>>;
}

export function ScheduleViewsPanel({
  mode,
  todayDate,
  assignments,
  canEdit,
  loading = false,
  hideStaffingBadge = false,
  onAddAtCell,
  onEditItem,
  weekStart: controlledWeekStart,
  onWeekStartChange,
  calMonth: controlledCalMonth,
  onMonthChange,
}: ScheduleViewsPanelProps) {
  const effectiveToday = todayDate || dayjs().format('YYYY-MM-DD');
  const [innerWeekStart, setInnerWeekStart] = useState<Dayjs>(() => getMonday(dayjs(effectiveToday)));
  const [innerCalMonth, setInnerCalMonth] = useState<Dayjs>(() => dayjs(effectiveToday));

  const weekStart = controlledWeekStart ?? innerWeekStart;
  const setWeekStart = onWeekStartChange ?? setInnerWeekStart;
  const calMonth = controlledCalMonth ?? innerCalMonth;
  const setCalMonth = onMonthChange ?? setInnerCalMonth;

  return (
    <Spin spinning={loading} tip="Đang tải dữ liệu lịch làm việc...">
      {mode === 'CALENDAR' ? (
        <ScheduleMonthCalendar
          todayDate={effectiveToday}
          assignments={assignments}
          canEdit={canEdit}
          onAddAtCell={onAddAtCell}
          onEditItem={onEditItem}
          calMonth={calMonth}
          onMonthChange={setCalMonth}
        />
      ) : (
        <ScheduleWeekMatrix
          todayDate={effectiveToday}
          assignments={assignments}
          canEdit={canEdit}
          hideStaffingBadge={hideStaffingBadge}
          onAddAtCell={onAddAtCell}
          onEditItem={onEditItem}
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
        />
      )}
    </Spin>
  );
}
