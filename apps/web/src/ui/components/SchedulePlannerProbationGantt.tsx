'use client';

import { useMemo } from 'react';
import { CheckCircleOutlined } from '@ant-design/icons';
import { Empty, Flex, Space, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { fmtDm, type PlannerProbationItem } from './schedule-planner-types';

const LABEL_W = 270, DAY_W = 48, ROW_H = 48;

/** Sắp xếp chu kỳ thử việc: người mới nhất (chu kỳ bắt đầu muộn nhất) lên đầu, người cũ nhất xuống cuối. */
export function sortProbationNewestFirst(rows: PlannerProbationItem[]): PlannerProbationItem[] {
  return [...rows].sort((a, b) => {
    const diff = dayjs(b.cycleStart).valueOf() - dayjs(a.cycleStart).valueOf();
    return diff !== 0 ? diff : b.employeeCode.localeCompare(a.employeeCode);
  });
}

interface Props { rows: PlannerProbationItem[]; onSelect?: (row: PlannerProbationItem) => void }

/** Biểu đồ Gantt chu kỳ thử việc 12 ngày: mỗi nhân viên một thanh, đánh dấu ngày có ca và tiến độ hoàn thành. */
export function SchedulePlannerProbationGantt({ rows, onSelect }: Props) {
  const range = useMemo(() => {
    if (rows.length === 0) return null;
    const today0 = dayjs().startOf('day');
    const recent = rows.filter((r) => !dayjs(r.cycleEnd).isBefore(today0.subtract(14, 'day')));
    const base = recent.length > 0 ? recent : rows;
    const minStart = base.reduce((m, r) => (dayjs(r.cycleStart).isBefore(m) ? dayjs(r.cycleStart) : m), dayjs(base[0]!.cycleStart)).startOf('day');
    const maxEnd = base.reduce((m, r) => (dayjs(r.cycleEnd).isAfter(m) ? dayjs(r.cycleEnd) : m), dayjs(base[0]!.cycleEnd)).startOf('day');
    const start = minStart.isAfter(today0) ? today0 : minStart, end = maxEnd.isBefore(today0) ? today0 : maxEnd;
    const days = Array.from({ length: end.diff(start, 'day') + 1 }, (_, i) => start.add(i, 'day'));
    return { start, end, days };
  }, [rows]);

  if (!range) return <Empty description="Không có nhân viên thử việc nào đang hoạt động" />;
  const today = dayjs().startOf('day'), todayIdx = today.diff(range.start, 'day');
  const totalW = range.days.length * DAY_W;

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF' }}>
      <Flex gap={14} wrap align="center" style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB', background: '#F8FAFC', fontSize: 12, color: '#475569' }}>
        <Space size={5}><span style={{ width: 14, height: 10, background: '#2563EB', display: 'inline-block', borderRadius: 2 }} />Ngày có ca làm</Space>
        <Space size={5}><span style={{ width: 14, height: 10, background: '#F59E0B', display: 'inline-block', borderRadius: 2 }} />Ngày nghỉ OFF</Space>
        <Space size={5}><span style={{ width: 14, height: 10, background: '#16A34A', display: 'inline-block', borderRadius: 2 }} />Đủ điều kiện chuyển chính thức</Space>
        <Space size={5}><span style={{ width: 14, height: 10, background: '#DBEAFE', border: '1px solid #93C5FD', display: 'inline-block', borderRadius: 2 }} />Khung chu kỳ 12 ngày</Space>
        <Space size={5}><span style={{ width: 2, height: 12, background: '#DC2626', display: 'inline-block' }} />Hôm nay</Space>
      </Flex>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ width: LABEL_W + totalW, minWidth: '100%' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', background: '#F8FAFC' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: '8px 12px', fontWeight: 600, fontSize: 13, position: 'sticky', left: 0, background: '#F8FAFC', zIndex: 2, borderRight: '1px solid #E5E7EB' }}>Nhân viên thử việc</div>
            {range.days.map((d) => (
              <div key={d.valueOf()} style={{ width: DAY_W, flexShrink: 0, textAlign: 'center', fontSize: 11, padding: '4px 0', color: d.day() === 0 ? '#DC2626' : '#475569', background: d.isSame(today) ? '#FEF2F2' : undefined, borderRight: '1px solid #F1F5F9' }}>
                <div style={{ fontWeight: 600 }}>{d.format('DD/MM')}</div>
                <div>{d.day() === 0 ? 'CN' : `T${d.day() + 1}`}</div>
              </div>
            ))}
          </div>
          {rows.map((r) => {
            const s = dayjs(r.cycleStart).startOf('day'), e = dayjs(r.cycleEnd).startOf('day');
            const vs = s.isBefore(range.start) ? range.start : s, ve = e.isAfter(range.end) ? range.end : e;
            const hasBar = !vs.isAfter(ve);
            const left = vs.diff(range.start, 'day') * DAY_W, width = (ve.diff(vs, 'day') + 1) * DAY_W;
            const shiftDates = new Set([
              ...(r.existingShifts ?? []).map((x) => dayjs(x.workDate).format('YYYY-MM-DD')),
              ...((r.existingShifts ?? []).length === 0 ? (r.planned ?? []).map((x) => dayjs(x.workDate).format('YYYY-MM-DD')) : []),
            ]);
            const offDates = new Set(r.offRequests.filter((o) => o.status !== 'REJECTED' && o.status !== 'CANCELLED').map((o) => dayjs(o.leaveDate).format('YYYY-MM-DD')));
            return (
              <div key={r.employeeId} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #F1F5F9', cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(r)}>
                <div style={{ width: LABEL_W, flexShrink: 0, padding: '5px 12px', position: 'sticky', left: 0, background: '#FFFFFF', zIndex: 2, borderRight: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.employeeName} <span style={{ color: '#64748B', fontWeight: 400 }}>({r.employeeCode})</span>
                    </div>
                    {r.readyForOfficial && (
                      <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        Đủ điều kiện
                      </Tag>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>
                    {fmtDm(r.cycleStart)} – {fmtDm(r.cycleEnd)} · Đã xếp {r.existingCount}/{r.workRequired} · Xong {r.completedCount}/{r.workRequired} ca
                  </div>
                </div>
                <div style={{ position: 'relative', width: totalW, flexShrink: 0, backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${DAY_W - 1}px, #F8FAFC ${DAY_W - 1}px, #F8FAFC ${DAY_W}px)` }}>
                  {todayIdx >= 0 && todayIdx < range.days.length && <div style={{ position: 'absolute', left: todayIdx * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 2, background: '#DC2626', zIndex: 3 }} />}
                  {hasBar ? (
                    <Tooltip title={`${r.employeeName} (${r.employeeCode}): Chu kỳ ${fmtDm(r.cycleStart)} – ${fmtDm(r.cycleEnd)} · Đã xếp ${r.existingCount}/${r.workRequired} ca · Hoàn thành ${r.completedCount}/${r.workRequired} ca · Nghỉ OFF ${r.offRequests.length}/${r.offLimit} ngày`}>
                      <div style={{ position: 'absolute', left, width, top: 9, height: ROW_H - 18, background: r.readyForOfficial ? '#DCFCE7' : '#DBEAFE', border: `1px solid ${r.readyForOfficial ? '#22C55E' : '#60A5FA'}`, borderRadius: 4, display: 'flex', zIndex: 1 }}>
                        {Array.from({ length: ve.diff(vs, 'day') + 1 }, (_, i) => vs.add(i, 'day')).map((d) => {
                          const iso = d.format('YYYY-MM-DD');
                          return (
                            <div key={d.valueOf()} style={{ width: DAY_W, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {shiftDates.has(iso) && <span style={{ width: DAY_W - 14, height: 14, borderRadius: 2, background: r.readyForOfficial ? '#16A34A' : '#2563EB' }} />}
                              {!shiftDates.has(iso) && offDates.has(iso) && <span style={{ width: DAY_W - 14, height: 14, borderRadius: 2, background: '#F59E0B' }} />}
                            </div>
                          );
                        })}
                      </div>
                    </Tooltip>
                  ) : <span style={{ position: 'absolute', left: 12, top: 14, fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' }}>Chu kỳ cũ ({fmtDm(r.cycleStart)} – {fmtDm(r.cycleEnd)}), nằm ngoài khung ngày hiện tại</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
