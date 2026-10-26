'use client';

import { Badge, Button, Calendar, Card, Space, Tag } from 'antd';
import { CalendarOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';

interface ScheduleCellHandlers {
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  onAddAtCell: (dateStr: string, shiftCode?: string) => void;
  onEditItem: (item: ScheduleAssignmentItem) => void;
}

export interface ScheduleMonthCalendarProps extends ScheduleCellHandlers {
  todayDate?: string;
  calMonth: Dayjs;
  onMonthChange: (value: Dayjs) => void;
}

/** Chế độ xem Lịch Tháng có đánh dấu phân ca & trạng thái nhân sự. */
export function ScheduleMonthCalendar({ todayDate, assignments, canEdit, onAddAtCell, onEditItem, calMonth, onMonthChange }: ScheduleMonthCalendarProps) {
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
                    {dayItems.map((item) => {
                      const isDraft = item.status === 'DRAFT';
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
                            background: isOff ? '#FEF2F2' : isDraft ? '#FFFBEB' : '#EFF6FF',
                            border: `1px solid ${isOff ? '#FECACA' : isDraft ? '#FDE68A' : '#BFDBFE'}`,
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
