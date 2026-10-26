'use client';

import { Button, Card, Flex, Space, Tag, Tooltip, Typography } from 'antd';
import { CalendarOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo } from 'react';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { BRAND } from '../theme';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';

const SHIFT_COLORS = ['#2563EB', '#0D9488', '#7C3AED', '#EA580C', '#D97706', '#0284C7'];
const WEEKDAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];

export function getMonday(d: Dayjs): Dayjs {
  const day = d.day();
  const diff = day === 0 ? -6 : 1 - day;
  return d.add(diff, 'day').startOf('day');
}

interface ScheduleCellHandlers {
  assignments: ScheduleAssignmentItem[];
  canEdit: boolean;
  onAddAtCell: (dateStr: string, shiftCode?: string) => void;
  onEditItem: (item: ScheduleAssignmentItem) => void;
}

export interface ScheduleWeekMatrixProps extends ScheduleCellHandlers {
  todayDate?: string;
  weekStart: Dayjs;
  onWeekStartChange: (updater: (prev: Dayjs) => Dayjs) => void;
}

/** Chế độ xem Lưới Lịch Tuần (Ca × Ngày), bấm vào ô để thêm hoặc sửa phân ca. */
export function ScheduleWeekMatrix({ todayDate, assignments, canEdit, onAddAtCell, onEditItem, weekStart, onWeekStartChange }: ScheduleWeekMatrixProps) {
  const effectiveToday = todayDate || dayjs().format('YYYY-MM-DD');
  const currentWeekMonday = getMonday(dayjs(effectiveToday));
  const isCurrentWeek = weekStart.format('YYYY-MM-DD') === currentWeekMonday.format('YYYY-MM-DD');
  const days = Array.from({ length: 7 }, (_, idx) => weekStart.add(idx, 'day'));
  const { shifts: dynamicShifts } = useShiftTemplates();
  const shiftRows = useMemo(() => {
    const rows = dynamicShifts
      .filter((s) => s.code !== 'CA_HANH_CHINH' || assignments.some((a) => a.shiftCode === 'CA_HANH_CHINH'))
      .map((s, idx) => ({
        code: s.code,
        label: s.name.replace(/\s*\([^)]*\)\s*/g, '').trim(),
        time: `${s.startTime} – ${s.endTime}`,
        color: SHIFT_COLORS[idx % SHIFT_COLORS.length]!,
      }));
    for (const a of assignments) {
      if (!rows.some((r) => r.code === a.shiftCode)) {
        rows.push({
          code: a.shiftCode,
          label: (a.shiftLabel || a.shiftCode).replace(/\s*\([^)]*\)\s*/g, '').trim(),
          time: `${a.startAt || '07:00'} – ${a.endAt || '12:00'}`,
          color: SHIFT_COLORS[rows.length % SHIFT_COLORS.length]!,
        });
      }
    }
    return rows;
  }, [dynamicShifts, assignments]);

  return (
    <Card
      size="small"
      title={
        <Flex justify="space-between" align="center" wrap gap={10}>
          <Space size={8} wrap>
            <Typography.Text strong>
              Lưới Lịch Tuần ({weekStart.format('DD/MM/YYYY')} – {weekStart.add(6, 'day').format('DD/MM/YYYY')})
            </Typography.Text>
            {isCurrentWeek && <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>Tuần hiện tại</Tag>}
            {canEdit ? (
              <Tag color="blue" style={{ borderRadius: 2, margin: 0 }}>Bấm vào ô để thêm hoặc sửa trực tiếp</Tag>
            ) : (
              <Tag style={{ borderRadius: 2, margin: 0 }}>Chế độ xem lịch (Chỉ đọc)</Tag>
            )}
          </Space>
          <Space size={6} wrap>
            <Button size="small" icon={<LeftOutlined />} onClick={() => onWeekStartChange((w) => w.subtract(7, 'day'))}>
              Tuần trước
            </Button>
            <Button size="small" type={isCurrentWeek ? 'primary' : 'default'} ghost={isCurrentWeek} icon={<CalendarOutlined />} onClick={() => onWeekStartChange(() => currentWeekMonday)}>
              Tuần hiện tại ({currentWeekMonday.format('DD/MM')} – {currentWeekMonday.add(6, 'day').format('DD/MM')})
            </Button>
            <Button size="small" icon={<RightOutlined />} onClick={() => onWeekStartChange((w) => w.add(7, 'day'))}>
              Tuần sau
            </Button>
          </Space>
        </Flex>
      }
    >
      <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1040 }}>
          <thead>
            <tr>
              <th style={{ width: 145, padding: '10px 12px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, textAlign: 'left' }}>
                Khung ca / Ngày
              </th>
              {days.map((d, i) => {
                const isToday = d.format('YYYY-MM-DD') === effectiveToday;
                return (
                  <th
                    key={d.format('YYYY-MM-DD')}
                    style={{
                      padding: '8px 10px',
                      background: isToday ? '#EFF6FF' : '#F8FAFC',
                      border: `1px solid ${BRAND.border}`,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? BRAND.primary : '#0F172A' }}>
                      {WEEKDAY_NAMES[i]} {isToday ? '· Hôm nay' : ''}
                    </div>
                    <div className="num" style={{ fontSize: 11, color: isToday ? BRAND.primary : '#64748B', fontWeight: isToday ? 600 : 400 }}>{d.format('DD/MM')}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shiftRows.map((shift) => (
              <tr key={shift.code}>
                <td style={{ padding: '10px 12px', border: `1px solid ${BRAND.border}`, background: '#FFFFFF', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 700, color: shift.color, fontSize: 13 }}>{shift.label}</div>
                  <div className="num" style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{shift.time}</div>
                </td>
                {days.map((d) => {
                  const dateStr = d.format('YYYY-MM-DD');
                  const cellItems = assignments.filter((a) => a.workDate === dateStr && a.shiftCode === shift.code);
                  return (
                    <td
                      key={`${shift.code}-${dateStr}`}
                      style={{ padding: 8, border: `1px solid ${BRAND.border}`, verticalAlign: 'top', background: '#FFFFFF', minHeight: 88 }}
                    >
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {cellItems.map((item) => (
                          <Tooltip key={item.id} title={`${item.employeeName} (${item.employeeStageLabel}) · ${item.statusLabel}${item.note ? ` · ${item.note}` : ''}`}>
                            <div
                              onClick={() => onEditItem(item)}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                overflow: 'hidden',
                                wordBreak: 'break-word',
                                background: item.status === 'ABSENT' ? '#FEF2F2' : item.status === 'COMPLETED' ? '#F0FDF4' : item.status === 'DRAFT' ? '#FFFBEB' : '#EFF6FF',
                                border: `1px solid ${item.status === 'ABSENT' ? '#FECACA' : item.status === 'COMPLETED' ? '#BBF7D0' : item.status === 'DRAFT' ? '#FCD34D' : '#93C5FD'}`,
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 12, color: '#0F172A', lineHeight: 1.35 }}>{item.employeeName}</div>
                              <Flex justify="space-between" align="center" wrap gap={4} style={{ marginTop: 3 }}>
                                <Tag color={item.employeeStage === 'OFFICIAL' ? 'green' : 'blue'} style={{ margin: 0, borderRadius: 2, fontSize: 10 }}>
                                  {item.employeeCode}
                                </Tag>
                                <span className="num" style={{ fontSize: 11, color: '#475569' }}>{item.scheduledHours}h</span>
                              </Flex>
                              {item.status === 'DRAFT' ? (
                                <div style={{ marginTop: 4 }}>
                                  <Tag color="gold" style={{ margin: 0, borderRadius: 2, fontSize: 10, whiteSpace: 'normal', maxWidth: '100%', lineHeight: 1.3 }}>Chờ duyệt phân ca</Tag>
                                </div>
                              ) : item.attendanceStatusLabel && item.attendanceStatusColor !== 'default' ? (
                                <div style={{ marginTop: 4 }}>
                                  <Tag color={item.attendanceStatusColor} style={{ margin: 0, borderRadius: 2, fontSize: 10, whiteSpace: 'normal', maxWidth: '100%', lineHeight: 1.3 }}>
                                    {item.attendanceStatusLabel}
                                  </Tag>
                                </div>
                              ) : null}
                            </div>
                          </Tooltip>
                        ))}
                        {canEdit && (
                          <Button
                            type="dashed"
                            size="small"
                            block
                            icon={<PlusOutlined />}
                            onClick={() => onAddAtCell(dateStr, shift.code)}
                            style={{ fontSize: 11 }}
                          >
                            Phân ca
                          </Button>
                        )}
                      </Space>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
