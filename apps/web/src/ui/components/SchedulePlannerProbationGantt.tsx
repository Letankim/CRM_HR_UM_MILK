'use client';

import { useMemo } from 'react';
import { Empty, Flex, Space, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { fmtDm, type PlannerProbationItem } from './schedule-planner-types';

const LABEL_W = 230, DAY_W = 46, ROW_H = 44;

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
    // Chỉ lấy các chu kỳ còn hiệu lực hoặc vừa kết thúc trong 14 ngày gần đây để khung thời gian luôn gọn, nhìn được ngay.
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
      <Flex gap={12} wrap align="center" style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB', background: '#F8FAFC', fontSize: 12, color: '#475569' }}>
        <Space size={4}><span style={{ width: 14, height: 10, background: '#2563EB', display: 'inline-block', borderRadius: 2 }} />Ngày có ca</Space>
        <Space size={4}><span style={{ width: 14, height: 10, background: '#F59E0B', display: 'inline-block', borderRadius: 2 }} />Ngày nghỉ OFF</Space>
        <Space size={4}><span style={{ width: 14, height: 10, background: '#16A34A', display: 'inline-block', borderRadius: 2 }} />Đủ điều kiện chính thức</Space>
        <Space size={4}><span style={{ width: 14, height: 10, background: '#DBEAFE', border: '1px solid #93C5FD', display: 'inline-block', borderRadius: 2 }} />Chu kỳ thử việc</Space>
        <Space size={4}><span style={{ width: 2, height: 12, background: '#DC2626', display: 'inline-block' }} />Hôm nay</Space>
      </Flex>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LABEL_W + totalW }}>
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
            const shiftDates = new Set((r.existingShifts ?? []).map((x) => dayjs(x.workDate).format('YYYY-MM-DD')));
            const offDates = new Set(r.offRequests.filter((o) => o.status !== 'REJECTED' && o.status !== 'CANCELLED').map((o) => dayjs(o.leaveDate).format('YYYY-MM-DD')));
            return (
              <div key={r.employeeId} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #F1F5F9', cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(r)}>
                <div style={{ width: LABEL_W, flexShrink: 0, padding: '4px 12px', position: 'sticky', left: 0, background: '#FFFFFF', zIndex: 1, borderRight: '1px solid #E5E7EB', overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.employeeName} <span style={{ color: '#64748B', fontWeight: 400 }}>({r.employeeCode})</span></div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>{fmtDm(r.cycleStart)} – {fmtDm(r.cycleEnd)} · {r.completedCount}/{r.workRequired} ca</div>
                </div>
                <div style={{ position: 'relative', width: totalW, flexShrink: 0 }}>
                  {todayIdx >= 0 && todayIdx < range.days.length && <div style={{ position: 'absolute', left: todayIdx * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 2, background: '#DC2626', zIndex: 3 }} />}
                  {hasBar ? (
                  <Tooltip title={`${r.employeeName}: ${fmtDm(r.cycleStart)} – ${fmtDm(r.cycleEnd)} · Đã xếp ${r.existingCount}/${r.workRequired} ca · Đã làm xong ${r.completedCount}/${r.workRequired} ca · OFF ${r.offRequests.length}/${r.offLimit}`}>
                    <div style={{ position: 'absolute', left, width, top: 8, height: ROW_H - 16, background: r.readyForOfficial ? '#DCFCE7' : '#DBEAFE', border: `1px solid ${r.readyForOfficial ? '#86EFAC' : '#93C5FD'}`, borderRadius: 4, display: 'flex' }}>
                      {Array.from({ length: ve.diff(vs, 'day') + 1 }, (_, i) => vs.add(i, 'day')).map((d) => (
                        <div key={d.valueOf()} style={{ width: DAY_W, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {shiftDates.has(d.format('YYYY-MM-DD')) && <span style={{ width: DAY_W - 14, height: 12, borderRadius: 2, background: r.readyForOfficial ? '#16A34A' : '#2563EB' }} />}
                          {offDates.has(d.format('YYYY-MM-DD')) && <span style={{ width: DAY_W - 14, height: 12, borderRadius: 2, background: '#F59E0B' }} />}
                        </div>
                      ))}
                    </div>
                  </Tooltip>
                  ) : <span style={{ position: 'absolute', left: 12, top: 12, fontSize: 12, color: '#94A3B8' }}>Chu kỳ cũ, nằm ngoài khung thời gian đang hiển thị</span>}
                </div>
                {r.readyForOfficial && <Tag color="success" style={{ position: 'sticky', right: 8, alignSelf: 'center', margin: 0, zIndex: 2 }}>Đủ ĐK</Tag>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
