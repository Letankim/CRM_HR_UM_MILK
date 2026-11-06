'use client';

import { Popover, Space, Tag, Typography } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { computeLateFine, SYSTEM_CONFIG, type LateFineTier } from '@umbm/shared';

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
  const deductedLabel = calc.fineVnd > 0 ? `-${calc.fineVnd.toLocaleString('vi-VN')}đ` : '0đ';
  return {
    lateMinutes: mins,
    tier: (mins <= 0 ? 'NONE' : calc.tier) as LateFineTier,
    fineVnd: mins <= 0 ? 0 : calc.fineVnd,
    shiftPayVnd,
    color: calc.fineVnd > 0 ? 'red' : mins > 0 ? 'gold' : 'green',
    shortTag: `Số tiền bị trừ: ${deductedLabel}`,
    detailText: `Số tiền bị trừ: ${deductedLabel}`,
  };
}

export function resolveEventLateFine(ev?: LateFineEventLike | null) {
  if (!ev || ev.isHrCompensated) return null;
  const mins = Math.max(0, Number(ev.lateMinutes ?? ev.late_minutes ?? 0));
  const fallback = evaluateClientLateFine(mins, 5, true, ev.shiftPayVnd);
  const tier = (ev.lateFineTier ?? ev.late_fine_tier ?? fallback.tier) as LateFineTier;
  const fineVnd = Number(ev.lateFineVnd ?? ev.late_fine_vnd ?? fallback.fineVnd);
  const deductedLabel = fineVnd > 0 ? `-${fineVnd.toLocaleString('vi-VN')}đ` : '0đ';
  return {
    mins,
    tier,
    fineVnd,
    color: fineVnd > 0 ? 'red' : mins > 0 ? 'gold' : 'green',
    shortTag: `Số tiền bị trừ: ${deductedLabel}`,
    detailText: `Số tiền bị trừ: ${deductedLabel}`,
  };
}

/** Icon chấm thang tròn — chỉ khi bấm vào mới mở Popover hiển thị quy định cơ chế trừ tiền. */
export function LateFinePolicyPopover({ activeTier = 'NONE', mins = 0 }: { activeTier?: LateFineTier; mins?: number }) {
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Popover
        trigger="click"
        title="Quy định cơ chế trừ tiền đi trễ"
        content={
          <div style={{ maxWidth: 340, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#475569' }}>Hệ thống tự động tính số phút đi trễ so với giờ bắt đầu ca:</div>
            {LATE_FINE_RULE_ITEMS.map((r) => {
              const isActive = mins > 0 && r.tier === activeTier;
              return (
                <div
                  key={r.step}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: isActive ? '#FEF2F2' : '#F8FAFC',
                    border: isActive ? '1px solid #FECACA' : '1px solid #E5E7EB',
                    color: isActive ? '#B91C1C' : '#0F172A',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {r.step}. {r.range}: {r.penalty}
                </div>
              );
            })}
          </div>
        }
      >
        <ExclamationCircleOutlined
          title="Bấm để xem quy định cơ chế trừ tiền đi trễ"
          style={{ color: mins > 0 ? '#DC2626' : '#64748B', fontSize: 14, cursor: 'pointer' }}
        />
      </Popover>
    </span>
  );
}

/** Chỉ hiển thị số tiền bị trừ + icon chấm thang tròn (bấm vào mới xem quy định). */
export function renderLateFineInlineTag(ev?: LateFineEventLike | null) {
  const info = resolveEventLateFine(ev);
  if (!info || (info.mins <= 0 && info.fineVnd <= 0)) return null;
  return (
    <Space size={4} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Tag color={info.color} className="num" style={{ margin: 0, fontWeight: 600 }}>
        {info.shortTag}
      </Tag>
      <LateFinePolicyPopover activeTier={info.tier} mins={info.mins} />
    </Space>
  );
}

/** Hiển thị gọn số tiền bị trừ + icon chấm thang tròn trong Modal chi tiết điểm danh & Camera chấm công. */
export function LateFineDetailBlock({ ev, liveLateMinutes, shiftHours = 5, isOfficial = true }: { ev?: LateFineEventLike | null; liveLateMinutes?: number; shiftHours?: number; isOfficial?: boolean }) {
  const info = ev ? resolveEventLateFine(ev) : evaluateClientLateFine(liveLateMinutes ?? 0, shiftHours, isOfficial);
  if (ev?.isHrCompensated) {
    return <Tag color="default" style={{ margin: 0 }}>Được bù bởi HR — Không áp dụng trừ tiền</Tag>;
  }
  const activeTier = info?.tier ?? 'NONE';
  const fineVnd = info?.fineVnd ?? 0;
  const mins = info ? ('mins' in info ? info.mins : info.lateMinutes) : 0;

  return (
    <Space size={6} wrap style={{ alignItems: 'center' }}>
      <Typography.Text strong className="num" style={{ color: fineVnd > 0 ? '#DC2626' : '#15803D', fontSize: 13 }}>
        Số tiền bị trừ: {fineVnd > 0 ? `-${fineVnd.toLocaleString('vi-VN')}đ` : '0đ'}
      </Typography.Text>
      <LateFinePolicyPopover activeTier={activeTier} mins={mins} />
    </Space>
  );
}
