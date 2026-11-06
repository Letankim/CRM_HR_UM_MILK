'use client';

import { Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, DollarOutlined, ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { computeLateFine, SYSTEM_CONFIG, type LateFineTier } from '@umbm/shared';
import { BRAND } from '../theme';

export interface LateFineEventLike {
  type?: 'CHECK_IN' | 'CHECK_OUT';
  punctualityStatus?: 'ON_TIME' | 'LATE' | 'EARLY_LEAVE';
  late_minutes?: number;
  lateMinutes?: number;
  late_fine_tier?: LateFineTier;
  lateFineTier?: LateFineTier;
  late_fine_vnd?: number;
  lateFineVnd?: number;
  lateFineLabel?: string;
  shiftPayVnd?: number;
  isHrCompensated?: boolean;
}

export const LATE_FINE_RULE_ITEMS: { tier: LateFineTier; step: string; range: string; penalty: string }[] = [
  { tier: 'NONE', step: '1', range: 'Trễ < 5 phút', penalty: 'Mức du di cho phép — Không phạt (0đ)' },
  { tier: 'FLAT_30K', step: '2', range: 'Trễ từ 5 – 29 phút', penalty: 'Phạt cố định -30.000đ' },
  { tier: 'HALF_SHIFT', step: '3', range: 'Trễ từ 30 – 59 phút', penalty: 'Phạt 50% tiền lương ca' },
  { tier: 'FULL_SHIFT', step: '4', range: 'Trễ từ ≥ 60 phút', penalty: 'Phạt 100% tiền lương ca (đi làm không hưởng lương ca đó)' },
];

export function evaluateClientLateFine(lateMinutes: number, shiftHours = 5, isOfficial = true, shiftPayOverrideVnd?: number) {
  const mins = Math.max(0, Math.floor(Number(lateMinutes) || 0));
  const hourly = isOfficial ? SYSTEM_CONFIG.defaults.officialHourlyRateVnd : SYSTEM_CONFIG.defaults.probationHourlyRateVnd;
  const shiftPayVnd = shiftPayOverrideVnd && shiftPayOverrideVnd > 0 ? shiftPayOverrideVnd : Math.round((Number(shiftHours) || 5) * hourly);
  const calc = computeLateFine(mins, shiftPayVnd);
  if (mins <= 0) {
    return { lateMinutes: 0, tier: 'NONE' as LateFineTier, fineVnd: 0, shiftPayVnd, color: 'green', shortTag: 'Không phạt (0đ)', detailText: 'Vào đúng giờ — Không bị trừ phạt đi trễ (0đ)' };
  }
  if (calc.tier === 'NONE') {
    return { lateMinutes: mins, tier: 'NONE' as LateFineTier, fineVnd: 0, shiftPayVnd, color: 'gold', shortTag: 'Du di < 5p: 0đ', detailText: `Bậc 1 (Trễ ${mins} phút < 5 phút): Mức du di cho phép — Không phạt (0đ)` };
  }
  if (calc.tier === 'FLAT_30K') {
    return { lateMinutes: mins, tier: 'FLAT_30K' as LateFineTier, fineVnd: 30000, shiftPayVnd, color: 'volcano', shortTag: 'Phạt trễ: -30.000đ', detailText: `Bậc 2 (Trễ ${mins} phút, từ 5 – 29 phút): Phạt cố định -30.000đ` };
  }
  if (calc.tier === 'HALF_SHIFT') {
    return { lateMinutes: mins, tier: 'HALF_SHIFT' as LateFineTier, fineVnd: calc.fineVnd, shiftPayVnd, color: 'red', shortTag: `Phạt 50% ca: -${calc.fineVnd.toLocaleString('vi-VN')}đ`, detailText: `Bậc 3 (Trễ ${mins} phút, từ 30 – 59 phút): Phạt 50% tiền lương ca (-${calc.fineVnd.toLocaleString('vi-VN')}đ)` };
  }
  return { lateMinutes: mins, tier: 'FULL_SHIFT' as LateFineTier, fineVnd: calc.fineVnd, shiftPayVnd, color: 'red', shortTag: `Phạt 100% ca: -${calc.fineVnd.toLocaleString('vi-VN')}đ`, detailText: `Bậc 4 (Trễ ${mins} phút, từ ≥ 60 phút): Phạt 100% tiền lương ca (-${calc.fineVnd.toLocaleString('vi-VN')}đ — đi làm không hưởng lương ca đó)` };
}

export function resolveEventLateFine(ev?: LateFineEventLike | null) {
  if (!ev || ev.isHrCompensated) return null;
  const mins = Math.max(0, Number(ev.lateMinutes ?? ev.late_minutes ?? 0));
  const fallback = evaluateClientLateFine(mins, 5, true, ev.shiftPayVnd);
  const tier = (ev.lateFineTier ?? ev.late_fine_tier ?? fallback.tier) as LateFineTier;
  const fineVnd = Number(ev.lateFineVnd ?? ev.late_fine_vnd ?? fallback.fineVnd);
  if (mins <= 0 && fineVnd <= 0) {
    return { mins: 0, tier: 'NONE' as LateFineTier, fineVnd: 0, color: 'green', shortTag: 'Không phạt (0đ)', detailText: 'Đúng giờ — Không bị trừ phạt đi trễ (0đ)' };
  }
  const shortTag = fineVnd > 0
    ? (tier === 'HALF_SHIFT' ? `Phạt 50% ca: -${fineVnd.toLocaleString('vi-VN')}đ` : tier === 'FULL_SHIFT' ? `Phạt 100% ca: -${fineVnd.toLocaleString('vi-VN')}đ` : `Phạt trễ: -${fineVnd.toLocaleString('vi-VN')}đ`)
    : 'Du di < 5p: Không phạt (0đ)';
  return {
    mins,
    tier,
    fineVnd,
    color: fineVnd > 0 ? (tier === 'FLAT_30K' ? 'volcano' : 'red') : 'gold',
    shortTag,
    detailText: ev.lateFineLabel || fallback.detailText,
  };
}

/** Tag nhỏ gọn hiển thị ngay cạnh giờ Vào ca trên bảng danh sách cho cả Nhân viên & Quản trị. */
export function renderLateFineInlineTag(ev?: LateFineEventLike | null) {
  const info = resolveEventLateFine(ev);
  if (!info || (info.mins <= 0 && info.fineVnd <= 0)) return null;
  return (
    <Tag color={info.color} icon={info.fineVnd > 0 ? <WarningOutlined /> : <ExclamationCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
      {info.shortTag}
    </Tag>
  );
}

/** Khối chi tiết Mục 8.5 hiển thị trong Modal chi tiết điểm danh & Camera chấm công. */
export function LateFineDetailBlock({ ev, liveLateMinutes, shiftHours = 5, isOfficial = true }: { ev?: LateFineEventLike | null; liveLateMinutes?: number; shiftHours?: number; isOfficial?: boolean }) {
  const info = ev ? resolveEventLateFine(ev) : evaluateClientLateFine(liveLateMinutes ?? 0, shiftHours, isOfficial);
  if (ev?.isHrCompensated) {
    return <Tag color="default" style={{ margin: 0 }}>Được bù bởi HR — Không áp dụng phạt đi trễ</Tag>;
  }
  const activeTier = info?.tier ?? 'NONE';
  const fineVnd = info?.fineVnd ?? 0;
  const mins = info ? ('mins' in info ? info.mins : info.lateMinutes) : 0;

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <Tag color={fineVnd > 0 ? 'red' : mins > 0 ? 'gold' : 'green'} icon={fineVnd > 0 ? <DollarOutlined /> : <CheckCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>
          {info?.detailText || 'Đúng giờ — Không phạt (0đ)'}
        </Tag>
        <Typography.Text strong className="num" style={{ color: fineVnd > 0 ? '#DC2626' : '#15803D', fontSize: 13 }}>
          Số tiền bị trừ: {fineVnd > 0 ? `-${fineVnd.toLocaleString('vi-VN')}đ` : '0đ'}
        </Typography.Text>
      </div>
      <div style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 11.5 }}>
        <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>8.5. Cơ chế phạt đi trễ theo 4 bậc (Tự động tính theo giờ bắt đầu ca):</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 }}>
          {LATE_FINE_RULE_ITEMS.map((r) => {
            const isActive = mins > 0 ? r.tier === activeTier : false;
            return (
              <div key={r.step} style={{ padding: '3px 6px', borderRadius: 2, background: isActive ? '#FEF2F2' : 'transparent', border: isActive ? '1px solid #FECACA' : '1px solid transparent', color: isActive ? '#B91C1C' : '#475569', fontWeight: isActive ? 600 : 400 }}>
                {r.step}. {r.range}: {r.penalty}
              </div>
            );
          })}
        </div>
      </div>
    </Space>
  );
}
