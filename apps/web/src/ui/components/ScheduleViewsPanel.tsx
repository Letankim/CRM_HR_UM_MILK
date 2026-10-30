'use client';

import { Alert, Flex, Space, Spin, Tag, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import { collectSurplusBranchAlerts, useStaffingRules } from '../hooks/useStaffingRules';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { ScheduleMonthCalendar } from './ScheduleMonthCalendar';
import { getMonday, ScheduleWeekMatrix } from './ScheduleWeekMatrix';

export function ScheduleSurplusAlertBanner({
  assignments,
  selectedBranchId = 'ALL',
  enabled = true,
}: {
  assignments: ScheduleAssignmentItem[];
  selectedBranchId?: string;
  enabled?: boolean;
}) {
  const { rules, branchCodeById } = useStaffingRules(enabled);
  const surplusList = useMemo(
    () => (enabled ? collectSurplusBranchAlerts({ assignments, rules, branchCodeById, selectedBranchId }) : []),
    [enabled, assignments, rules, branchCodeById, selectedBranchId],
  );
  if (!enabled || surplusList.length === 0) return null;

  const visible = surplusList.slice(0, 8);
  const hiddenCount = surplusList.length - visible.length;
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message={
        <Flex vertical gap={6}>
          <span>
            Cảnh báo dư định biên theo chi nhánh: Phát hiện <strong>{surplusList.length} khung ca</strong> đang vượt số nhân sự tối đa đã cấu hình.
          </span>
          <Space wrap size={[6, 6]}>
            {visible.map((s) => {
              const rangeText = s.minStaff === s.maxStaff ? `${s.maxStaff}` : `${s.minStaff}–${s.maxStaff}`;
              const shortShift = (s.shiftLabel || s.shiftCode).replace(/\s*\([^)]*\)\s*/g, '').trim();
              const detail = s.draftCount > 0 ? ` (${s.approvedCount} đã duyệt, ${s.draftCount} chờ duyệt)` : '';
              return (
                <Tooltip key={s.key} title={`${s.branchName} · Ngày ${dayjs(s.workDate).format('DD/MM/YYYY')} · ${s.shiftLabel}: Hiện có ${s.count} nhân sự${detail}, vượt tối đa ${s.maxStaff} người (định biên ${rangeText}).`}>
                  <Tag color="red" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>
                    {s.branchCode} · {dayjs(s.workDate).format('DD/MM')} · {shortShift}: Dư +{s.surplusDiff} ({s.count}/{rangeText})
                  </Tag>
                </Tooltip>
              );
            })}
            {hiddenCount > 0 && (
              <Tag color="red" style={{ margin: 0, borderRadius: 2 }}>+{hiddenCount} ca dư khác</Tag>
            )}
          </Space>
        </Flex>
      }
    />
  );
}

export interface ScheduleViewsPanelProps {
  mode: 'WEEK_MATRIX' | 'CALENDAR';
  todayDate?: string;
  selectedBranchId?: string;
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  loading?: boolean;
  hideStaffingBadge?: boolean;
  isPartialFilter?: boolean;
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
  selectedBranchId,
  assignments,
  canEdit,
  loading = false,
  hideStaffingBadge = false,
  isPartialFilter = false,
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
          selectedBranchId={selectedBranchId}
          assignments={assignments}
          canEdit={canEdit}
          hideStaffingBadge={hideStaffingBadge}
          isPartialFilter={isPartialFilter}
          onAddAtCell={onAddAtCell}
          onEditItem={onEditItem}
          calMonth={calMonth}
          onMonthChange={setCalMonth}
        />
      ) : (
        <ScheduleWeekMatrix
          todayDate={effectiveToday}
          selectedBranchId={selectedBranchId}
          assignments={assignments}
          canEdit={canEdit}
          hideStaffingBadge={hideStaffingBadge}
          isPartialFilter={isPartialFilter}
          onAddAtCell={onAddAtCell}
          onEditItem={onEditItem}
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
        />
      )}
    </Spin>
  );
}
