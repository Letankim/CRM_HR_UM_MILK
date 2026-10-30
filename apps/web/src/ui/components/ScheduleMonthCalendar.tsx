'use client';

import { Badge, Button, Calendar, Card, Space, Tag, Tooltip } from 'antd';
import { CalendarOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { computePerBranchStaffingBadges, useStaffingRules } from '../hooks/useStaffingRules';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';

interface ScheduleCellHandlers {
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  hideStaffingBadge?: boolean;
  isPartialFilter?: boolean;
  onAddAtCell: (dateStr: string, shiftCode?: string) => void;
  onEditItem: (item: ScheduleAssignmentItem) => void;
}

export interface ScheduleMonthCalendarProps extends ScheduleCellHandlers {
  todayDate?: string;
  selectedBranchId?: string;
  calMonth: Dayjs;
  onMonthChange: (value: Dayjs) => void;
}

/** Chế độ xem Lịch Tháng có đánh dấu phân ca & trạng thái nhân sự. */
export function ScheduleMonthCalendar({ todayDate, selectedBranchId = 'ALL', assignments, canEdit, hideStaffingBadge = false, isPartialFilter = false, onAddAtCell, onEditItem, calMonth, onMonthChange }: ScheduleMonthCalendarProps) {
  const { rules, branchCodeById } = useStaffingRules(!hideStaffingBadge);
  const effectiveToday = dayjs(todayDate || dayjs().format('YYYY-MM-DD'));
  const isCurrentMonth = calMonth.format('YYYY-MM') === effectiveToday.format('YYYY-MM');

  return (
    <Card
      size="small"
      title={
        <Space size={8} wrap>
          <span>Lịch Tháng ({calMonth.format('MM/YYYY')}) — Đánh Dấu Phân Ca &amp; Trạng Thái</span>
          {isCurrentMonth && <Tag color="blue" style={{ margin: 0 }}>Tháng hiện tại</Tag>}
        </Space>
      }
      extra={
        <Space size={12} wrap>
          <Space size={10} wrap>
            <Badge status="processing" text="Đã phát hành chính thức" />
            <Badge status="warning" text="Bản nháp / Chờ duyệt" />
            <Badge status="error" text="Nghỉ phép (OFF)" />
          </Space>
          <Space size={6} wrap>
            <Button size="small" icon={<LeftOutlined />} onClick={() => onMonthChange(calMonth.subtract(1, 'month'))}>Tháng trước</Button>
            <Button size="small" type={isCurrentMonth ? 'primary' : 'default'} ghost={isCurrentMonth} icon={<CalendarOutlined />} onClick={() => onMonthChange(effectiveToday)}>
              Tháng hiện tại ({effectiveToday.format('MM/YYYY')})
            </Button>
            <Button size="small" icon={<RightOutlined />} onClick={() => onMonthChange(calMonth.add(1, 'month'))}>Tháng sau</Button>
          </Space>
        </Space>
      }
    >
      <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: 880 }}>
          <Calendar
            value={calMonth}
            onChange={onMonthChange}
            cellRender={(current, info) => {
              if (info.type !== 'date') return info.originNode;
              const dateStr = current.format('YYYY-MM-DD');
              const dayItems = assignments.filter((a) => a.workDate === dateStr);
              const shiftMap = new Map<string, { label: string; items: ScheduleAssignmentItem[] }>();
              for (const it of dayItems) {
                const cur = shiftMap.get(it.shiftCode) ?? { label: (it.shiftLabel || it.shiftCode).replace(/^Ca\s+/i, '').replace(/\s*\([^)]*\)\s*/g, '').trim(), items: [] };
                cur.items.push(it);
                shiftMap.set(it.shiftCode, cur);
              }
              const dayBadges = hideStaffingBadge ? [] : Array.from(shiftMap.entries()).flatMap(([sCode, grp]) =>
                computePerBranchStaffingBadges({ cellItems: grp.items, rules, branchCodeById, selectedBranchId, shiftCode: sCode, shiftShortLabel: grp.label, suppressShortage: isPartialFilter }).filter((b) => b.kind !== 'OK'),
              );
              return (
                <div style={{ padding: '2px 0' }}>
                  {canEdit && (
                    <div style={{ textAlign: 'right', marginBottom: 2 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined style={{ fontSize: 10 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddAtCell(dateStr, 'CA_SANG');
                        }}
                        style={{ height: 18, padding: '0 4px', fontSize: 10, color: '#64748B' }}
                      >
                        Phân ca
                      </Button>
                    </div>
                  )}
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {dayBadges.map((b) => (
                      <Tooltip key={b.key} title={b.tooltip}>
                        <Tag color={b.color} style={{ margin: 0, borderRadius: 2, fontSize: 10, fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.label}
                        </Tag>
                      </Tooltip>
                    ))}
                    {dayItems.map((item) => {
                      const isDraft = item.status === 'DRAFT';
                      const isAbsent = item.status === 'ABSENT';
                      const isDone = item.status === 'COMPLETED';
                      const isOff = item.dayType === 'OFF' || item.status === 'ON_LEAVE';
                      return (
                        <div
                          key={item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditItem(item);
                          }}
                          style={{
                            padding: '4px 6px',
                            borderRadius: 4,
                            fontSize: 11,
                            cursor: 'pointer',
                            background: isOff || isAbsent ? '#FEF2F2' : isDone ? '#F0FDF4' : isDraft ? '#FFFBEB' : '#EFF6FF',
                            border: `1px solid ${isOff || isAbsent ? '#FECACA' : isDone ? '#BBF7D0' : isDraft ? '#FDE68A' : '#BFDBFE'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.shiftLabel.replace('Ca ', '')}: {item.employeeName}
                          </span>
                          <span className="num" style={{ fontSize: 10, color: '#475569', marginLeft: 4 }}>
                            {item.scheduledHours}h
                          </span>
                        </div>
                      );
                    })}
                  </Space>
                </div>
              );
            }}
          />
        </div>
      </div>
    </Card>
  );
}
