'use client';

import { useMemo } from 'react';
import { Card, Flex, Space, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import {
  computePerBranchStaffingBadges,
  resolveApplicableBranchRule,
  useStaffingRules,
  type BranchStaffingWarningBadge,
} from '../hooks/useStaffingRules';
import { BRAND } from '../theme';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import {
  cleanShiftLabel,
  type PlannerBranchStatus,
  type PlannerMatrixCellItem,
  type PlannerOffItem,
} from './schedule-planner-types';

const SHIFT_COLORS = ['#2563EB', '#0D9488', '#7C3AED', '#EA580C', '#D97706', '#0284C7'];
const WEEKDAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];

export interface PlannerMatrixGridProps {
  weekStart: string;
  selectedBranchId?: string;
  branchStatuses?: PlannerBranchStatus[];
  items: PlannerMatrixCellItem[];
  offRequests?: PlannerOffItem[];
  isLocked: boolean;
  hideStaffingBadge?: boolean;
  validDateRange?: { start: string; end: string };
  titleExtra?: React.ReactNode;
}

/** Lưới Lịch Tuần (Ca × Ngày) chế độ xem trước khi chốt lịch hoặc xem lại dữ liệu chi nhánh đã chốt (Chỉ đọc). */
export function PlannerMatrixGrid({
  weekStart,
  selectedBranchId = 'ALL',
  branchStatuses,
  items,
  offRequests = [],
  isLocked,
  hideStaffingBadge = false,
  validDateRange,
  titleExtra,
}: PlannerMatrixGridProps) {
  const { rules, branchCodeById } = useStaffingRules(!hideStaffingBadge);
  const { shifts: dynamicShifts } = useShiftTemplates();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const monday = dayjs(weekStart);
  const days = useMemo(() => Array.from({ length: 7 }, (_, idx) => monday.add(idx, 'day')), [weekStart]);

  const shiftRows = useMemo(() => {
    const rows = dynamicShifts
      .filter((s) => s.code !== 'CA_HANH_CHINH' || items.some((a) => a.shiftCode === 'CA_HANH_CHINH'))
      .map((s, idx) => ({
        code: s.code,
        label: cleanShiftLabel(s.name),
        time: `${s.startTime} – ${s.endTime}`,
        color: SHIFT_COLORS[idx % SHIFT_COLORS.length]!,
      }));
    for (const a of items) {
      if (!rows.some((r) => r.code === a.shiftCode)) {
        rows.push({
          code: a.shiftCode,
          label: cleanShiftLabel(a.shiftLabel || a.shiftCode),
          time: `${a.startAt || '07:00'} – ${a.endAt || '12:00'}`,
          color: SHIFT_COLORS[rows.length % SHIFT_COLORS.length]!,
        });
      }
    }
    return rows;
  }, [dynamicShifts, items]);

  const weekOffs = useMemo(() => {
    const wStart = days[0]?.format('YYYY-MM-DD') ?? '';
    const wEnd = days[6]?.format('YYYY-MM-DD') ?? '';
    return offRequests.filter((o) => o.leaveDate >= wStart && o.leaveDate <= wEnd);
  }, [offRequests, days]);

  const buildCellBadges = (cellItems: PlannerMatrixCellItem[], shiftCode: string): BranchStaffingWarningBadge[] => {
    if (hideStaffingBadge || rules.length === 0) return [];
    const asAssign = cellItems.map((c) => ({ ...c, dayType: 'WORK', status: 'PUBLISHED' })) as unknown as ScheduleAssignmentItem[];
    const badges = [...computePerBranchStaffingBadges({ cellItems: asAssign, rules, branchCodeById, selectedBranchId, shiftCode })];
    const checkTargets = selectedBranchId === 'ALL'
      ? (branchStatuses ?? []).map((b) => ({ id: b.branchId, code: b.branchCode, name: b.branchName }))
      : [{ id: selectedBranchId, code: branchCodeById.get(selectedBranchId) ?? '', name: branchStatuses?.find((b) => b.branchId === selectedBranchId)?.branchName ?? 'Chi nhánh' }];
    for (const t of checkTargets) {
      if (!t.id || cellItems.some((c) => c.branchId === t.id)) continue;
      const rule = resolveApplicableBranchRule(rules, t.id, shiftCode, t.code);
      if (!rule || Number(rule.min_staff) <= 0) continue;
      const minS = Number(rule.min_staff), maxS = Number(rule.max_staff), range = minS === maxS ? `${maxS}` : `${minS}–${maxS}`;
      const prefix = selectedBranchId === 'ALL' && (t.code || rule.branchCode) ? `${t.code || rule.branchCode}: ` : '';
      badges.push({
        key: `${t.id}-${shiftCode}-empty`, kind: 'SHORTAGE', color: 'volcano', branchCode: t.code || t.name,
        label: `${prefix}Thiếu ${minS} (0/${range})`,
        tooltip: `${t.name}: Chưa có nhân sự trực ca này — tối thiểu cần ${minS} nhân sự (định biên ${range}).`,
      });
    }
    return badges;
  };

  return (
    <Card
      size="small"
      title={
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Space size={8} wrap>
            <Typography.Text strong>Lưới Lịch Tuần ({monday.format('DD/MM/YYYY')} – {monday.add(6, 'day').format('DD/MM/YYYY')})</Typography.Text>
            <Tag color={isLocked ? 'green' : 'blue'} style={{ borderRadius: 2, margin: 0 }}>
              {isLocked ? 'Dữ liệu lịch đã chốt (Chỉ xem)' : 'Bản xem trước tự động sắp ca (1 người/ca)'}
            </Tag>
          </Space>
          {titleExtra}
        </Flex>
      }
    >
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1060 }}>
          <thead>
            <tr>
              <th style={{ width: 145, padding: '10px 12px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2 }}>
                Khung ca / Ngày
              </th>
              {days.map((d, i) => {
                const dStr = d.format('YYYY-MM-DD');
                const isToday = dStr === todayStr;
                const outRange = Boolean(validDateRange && (dStr < validDateRange.start || dStr > validDateRange.end));
                return (
                  <th key={dStr} style={{ padding: '8px 10px', background: outRange ? '#F1F5F9' : isToday ? '#EFF6FF' : '#F8FAFC', border: `1px solid ${isToday ? '#93C5FD' : BRAND.border}`, textAlign: 'center', opacity: outRange ? 0.55 : 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? BRAND.primary : '#0F172A' }}>{WEEKDAY_NAMES[i]}{isToday ? ' · Hôm nay' : ''}</div>
                    <div className="num" style={{ fontSize: 11, color: isToday ? BRAND.primary : '#64748B' }}>{d.format('DD/MM')}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shiftRows.map((shift) => (
              <tr key={shift.code}>
                <td style={{ padding: '10px 12px', border: `1px solid ${BRAND.border}`, background: '#FFFFFF', verticalAlign: 'top', position: 'sticky', left: 0, zIndex: 1 }}>
                  <div style={{ fontWeight: 700, color: shift.color, fontSize: 13 }}>{shift.label}</div>
                  <div className="num" style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{shift.time}</div>
                </td>
                {days.map((d) => {
                  const dateStr = d.format('YYYY-MM-DD');
                  const outRange = Boolean(validDateRange && (dateStr < validDateRange.start || dateStr > validDateRange.end));
                  const cellItems = items.filter((a) => a.workDate === dateStr && a.shiftCode === shift.code);
                  const badges = outRange ? [] : buildCellBadges(cellItems, shift.code);
                  return (
                    <td key={`${shift.code}-${dateStr}`} style={{ padding: 8, border: `1px solid ${BRAND.border}`, verticalAlign: 'top', background: outRange ? '#F8FAFC' : '#FFFFFF', opacity: outRange ? 0.5 : 1 }}>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {badges.map((b) => <Tooltip key={b.key} title={b.tooltip}><Tag color={b.color} style={{ margin: 0, borderRadius: 2, fontSize: 11, fontWeight: 600 }}>{b.label}</Tag></Tooltip>)}
                        {cellItems.map((item) => {
                          const bg = isLocked ? (item.status === 'ABSENT' ? '#FEF2F2' : item.status === 'COMPLETED' ? '#F0FDF4' : '#EFF6FF') : item.isPlanned ? (item.isCoverShift ? '#ECFEFF' : '#EFF6FF') : '#F0FDF4';
                          const bd = isLocked ? (item.status === 'ABSENT' ? '#FECACA' : item.status === 'COMPLETED' ? '#BBF7D0' : '#93C5FD') : item.isPlanned ? (item.isCoverShift ? '#67E8F9' : '#93C5FD') : '#BBF7D0';
                          const tagColor = isLocked ? (item.status === 'ABSENT' ? 'red' : item.status === 'COMPLETED' ? 'green' : 'geekblue') : item.isPlanned ? (item.isCoverShift ? 'cyan' : 'blue') : 'green';
                          const tagText = isLocked ? item.statusLabel : item.isPlanned ? (item.isCoverShift ? 'Tự động bù OFF' : 'Dự kiến tự động sắp') : 'Đã có trên lịch';
                          return (
                            <Tooltip key={item.key} title={`${item.employeeName} (${item.stageLabel}) · ${item.branchName}${item.note ? ` · ${item.note}` : ''}`}>
                              <div style={{ padding: '6px 8px', borderRadius: 4, background: bg, border: `1px solid ${bd}`, wordBreak: 'break-word' }}>
                                <div style={{ fontWeight: 600, fontSize: 12, color: '#0F172A', lineHeight: 1.35 }}>{item.employeeName}</div>
                                <Flex justify="space-between" align="center" wrap gap={4} style={{ marginTop: 3 }}>
                                  <Space size={3} wrap>
                                    <Tag color={item.stage === 'OFFICIAL' ? 'green' : 'blue'} style={{ margin: 0, borderRadius: 2, fontSize: 10 }}>{item.employeeCode}</Tag>
                                    {selectedBranchId === 'ALL' && item.branchCode && <Tag style={{ margin: 0, borderRadius: 2, fontSize: 10 }}>{item.branchCode}</Tag>}
                                  </Space>
                                  <span className="num" style={{ fontSize: 11, color: '#475569' }}>{item.hours}h</span>
                                </Flex>
                                <div style={{ marginTop: 4 }}><Tag color={tagColor} style={{ margin: 0, borderRadius: 2, fontSize: 10, whiteSpace: 'normal', lineHeight: 1.3 }}>{tagText}</Tag></div>
                              </div>
                            </Tooltip>
                          );
                        })}
                        {!outRange && cellItems.length === 0 && badges.length === 0 && <span style={{ fontSize: 11, color: '#94A3B8' }}>—</span>}
                      </Space>
                    </td>
                  );
                })}
              </tr>
            ))}
            {weekOffs.length > 0 && (
              <tr>
                <td style={{ padding: '10px 12px', border: `1px solid ${BRAND.border}`, background: '#FFFBEB', verticalAlign: 'top', position: 'sticky', left: 0, zIndex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#B45309', fontSize: 12 }}>Nghỉ OFF trong ngày</div>
                  <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>Đơn đăng ký nghỉ</div>
                </td>
                {days.map((d) => {
                  const dateStr = d.format('YYYY-MM-DD');
                  const dayOffs = weekOffs.filter((o) => o.leaveDate === dateStr);
                  return (
                    <td key={`off-${dateStr}`} style={{ padding: 8, border: `1px solid ${BRAND.border}`, verticalAlign: 'top', background: '#FFFDF5' }}>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {dayOffs.map((o) => (
                          <div key={o.id} style={{ padding: '4px 6px', borderRadius: 4, background: '#FEF3C7', border: '1px solid #FDE68A', fontSize: 11 }}>
                            <div style={{ fontWeight: 600, color: '#92400E' }}>{o.employeeName} ({o.employeeCode})</div>
                            <Tag color={o.status === 'APPROVED' ? 'green' : 'gold'} style={{ margin: '2px 0 0', borderRadius: 2, fontSize: 10 }}>
                              {!isLocked && (o.status === 'PENDING' || o.status === 'DRAFT') ? 'Sẽ duyệt khi chốt' : o.statusLabel}
                            </Tag>
                          </div>
                        ))}
                      </Space>
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
