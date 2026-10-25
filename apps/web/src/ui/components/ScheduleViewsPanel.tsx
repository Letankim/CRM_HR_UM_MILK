'use client';

import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { ScheduleMonthCalendar } from './ScheduleMonthCalendar';
import { getMonday, ScheduleWeekMatrix } from './ScheduleWeekMatrix';

export interface ScheduleViewsPanelProps {
  mode: 'WEEK_MATRIX' | 'CALENDAR';
  todayDate?: string;
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  onAddAtCell: (dateStr: string, shiftCode?: string) => void;
  onEditItem: (item: ScheduleAssignmentItem) => void;
}

export function ScheduleViewsPanel({
  mode,
  todayDate,
  assignments,
  canEdit,
  onAddAtCell,
  onEditItem,
}: ScheduleViewsPanelProps) {
  const effectiveToday = todayDate || dayjs().format('YYYY-MM-DD');
  const [weekStart, setWeekStart] = useState<Dayjs>(() => getMonday(dayjs(effectiveToday)));
  const [calMonth, setCalMonth] = useState<Dayjs>(() => dayjs(effectiveToday));

  useEffect(() => {
    setWeekStart(getMonday(dayjs(effectiveToday)));
    setCalMonth(dayjs(effectiveToday));
  }, [mode, effectiveToday]);

  if (mode === 'CALENDAR') {
    return (
      <ScheduleMonthCalendar
        todayDate={effectiveToday}
        assignments={assignments}
        canEdit={canEdit}
        onAddAtCell={onAddAtCell}
        onEditItem={onEditItem}
        calMonth={calMonth}
        onMonthChange={setCalMonth}
      />
    );
  }

  return (
    <ScheduleWeekMatrix
      todayDate={effectiveToday}
      assignments={assignments}
      canEdit={canEdit}
      onAddAtCell={onAddAtCell}
      onEditItem={onEditItem}
      weekStart={weekStart}
      onWeekStartChange={setWeekStart}
    />
  );
}
