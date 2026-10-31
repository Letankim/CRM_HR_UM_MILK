'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Flex, Space, Tag } from 'antd';
import { DownOutlined, TeamOutlined, UpOutlined } from '@ant-design/icons';
import { cleanShiftLabel, type PlannerEmployeeLoadItem } from './schedule-planner-types';

function describeRotationFormula(size: number): string {
  if (size <= 1) return '1 nhân sự phụ trách';
  if (size === 2) return '2 nhân sự xoay vòng 4–3 ca/tuần';
  if (size === 3) return '3 nhân sự xoay vòng 3–2–2 ca/tuần';
  if (size === 4) return '4 nhân sự xoay vòng 2–2–2–1 ca/tuần';
  const base = Math.floor(7 / size);
  const rem = 7 % size;
  return `${size} nhân sự xoay vòng ${rem > 0 ? `${base + 1}–${base}` : `${base}`} ca/tuần`;
}

/** Thanh tóm tắt phân bổ số ca tuần này & tích lũy 4 tuần trước theo từng nhóm ca mặc định. */
export function PlannerEmployeeLoadStrip({
  loads,
  selectedBranchId,
}: {
  loads: PlannerEmployeeLoadItem[];
  selectedBranchId: string;
}) {
  const [open, setOpen] = useState(selectedBranchId !== 'ALL');
  useEffect(() => { setOpen(selectedBranchId !== 'ALL'); }, [selectedBranchId]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; size: number; items: PlannerEmployeeLoadItem[] }>();
    for (const item of loads) {
      const k = `${item.branchId}|${item.defaultShiftCode}`;
      const prefix = selectedBranchId === 'ALL' && item.branchCode ? `${item.branchCode} · ` : '';
      const cur = map.get(k) ?? { key: k, title: `${prefix}${cleanShiftLabel(item.defaultShiftLabel)}`, size: item.groupSize, items: [] };
      cur.items.push(item);
      map.set(k, cur);
    }
    return [...map.values()];
  }, [loads, selectedBranchId]);

  if (loads.length === 0) return null;

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: open ? '10px 12px' : '7px 12px' }}>
      <Flex justify="space-between" align="center" gap={8} onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <Space size={8} wrap>
          <TeamOutlined style={{ color: '#2563EB' }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            Phân bổ xoay vòng theo nhóm ca mặc định ({loads.length} nhân sự chính thức · chỉ xoay vòng trong đúng ca mặc định)
          </span>
        </Space>
        <Button size="small" type="text" icon={open ? <UpOutlined /> : <DownOutlined />} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} style={{ fontWeight: 600, color: '#2563EB' }}>
          {open ? 'Thu gọn' : 'Xem phân bổ'}
        </Button>
      </Flex>
      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
          {groups.map((g) => (
            <Flex key={g.key} align="center" wrap gap={8}>
              <Tag color="geekblue" style={{ margin: 0, fontWeight: 600 }}>
                {g.title} ({describeRotationFormula(g.size)})
              </Tag>
              {g.items.map((emp) => (
                <div key={emp.employeeId} style={{ padding: '3px 8px', borderRadius: 4, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 12 }}>
                  <strong>{emp.employeeName}</strong> <span style={{ color: '#64748B' }}>({emp.employeeCode})</span>:{' '}
                  <strong className="num" style={{ color: '#2563EB' }}>{emp.totalWeekShifts} ca</strong>{' '}
                  <span className="num" style={{ color: '#475569' }}>({emp.totalWeekHours}h)</span>
                  {emp.offDaysCount > 0 && <span style={{ color: '#D97706' }}> · OFF {emp.offDaysCount}</span>}
                  <span className="num" style={{ color: '#64748B' }}> · 4 tuần trước: {emp.recent4WeeksShifts} ca</span>
                </div>
              ))}
            </Flex>
          ))}
        </div>
      )}
    </div>
  );
}
