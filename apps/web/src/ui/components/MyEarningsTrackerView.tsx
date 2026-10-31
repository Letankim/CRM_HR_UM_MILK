'use client';

import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, DatePicker, Grid, Row, Segmented, Select, Space, Tag } from 'antd';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, DollarOutlined,
  DownloadOutlined, LeftOutlined, ProfileOutlined, ReloadOutlined, RightOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { MyEarningsShiftTable } from '@/ui/components/MyEarningsShiftTable';
import {
  computePeriodBounds,
  exportMyEarningsExcel,
  startOfVnWeek,
  type EarningsCategoryFilter,
  type EarningsFilterMode,
  type MyEarningsSummary,
} from '@/ui/components/my-earnings-types';
import { fmtVnd } from '@/ui/components/payroll-types';
import { BRAND } from '@/ui/theme';

export function MyEarningsTrackerView({ embedded = false, initialMode = 'MONTH' }: { embedded?: boolean; initialMode?: EarningsFilterMode }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const isDesktop = Boolean(Grid.useBreakpoint().md);
  const [mode, setMode] = useState<EarningsFilterMode>(initialMode);
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs());
  const [customFrom, setCustomFrom] = useState<Dayjs>(() => startOfVnWeek(dayjs()));
  const [customTo, setCustomTo] = useState<Dayjs>(() => dayjs());
  const [catFilter, setCatFilter] = useState<EarningsCategoryFilter>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const bounds = useMemo(() => computePeriodBounds(mode, anchor, customFrom, customTo), [mode, anchor, customFrom, customTo]);
  const qKey = ['my-earnings', bounds.fromDate, bounds.toDate] as const;

  const query = useQuery({
    queryKey: qKey,
    queryFn: () => api.get<MyEarningsSummary>(`/me/earnings?from_date=${bounds.fromDate}&to_date=${bounds.toDate}`),
  });

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.get<MyEarningsSummary>(`/me/earnings?from_date=${bounds.fromDate}&to_date=${bounds.toDate}&refresh=1`);
      qc.setQueryData(qKey, fresh);
      message.success('Đã đồng bộ số ca đã làm và thu nhập hiện tại mới nhất');
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Đồng bộ thu nhập thất bại');
    } finally {
      setRefreshing(false);
    }
  };

  const summary = query.data;
  const filteredRows = useMemo(() => {
    const all = summary?.shifts ?? [];
    if (catFilter === 'ALL') return all;
    if (catFilter === 'OTHER') return all.filter((r) => r.category === 'ABSENT' || r.category === 'LEAVE_OFF' || r.category === 'SWAPPED_OUT');
    return all.filter((r) => r.category === catFilter);
  }, [summary?.shifts, catFilter]);

  const shiftAnchor = (dir: -1 | 1) => {
    if (mode === 'DAY') setAnchor((d) => d.add(dir, 'day'));
    else if (mode === 'WEEK') setAnchor((d) => d.add(dir * 7, 'day'));
    else if (mode === 'MONTH') setAnchor((d) => d.add(dir, 'month'));
  };

  const counts = summary?.counts;
  const earned = summary?.earned;
  const projected = summary?.projected;
  const prof = summary?.salaryProfile;

  return (
    <div style={{ padding: embedded || isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <Space size={8} wrap>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as EarningsFilterMode)}
              options={[
                { value: 'DAY', label: 'Theo ngày' },
                { value: 'WEEK', label: 'Theo tuần' },
                { value: 'MONTH', label: 'Theo tháng' },
                { value: 'RANGE', label: 'Từ ngày – Đến ngày' },
              ]}
            />
            <Tag color="blue" icon={<CalendarOutlined />} style={{ margin: 0, padding: '3px 8px', fontWeight: 600 }}>
              {bounds.label} ({summary?.range.daysInRange ?? dayjs(bounds.toDate).diff(dayjs(bounds.fromDate), 'day') + 1} ngày)
            </Tag>
          </Space>
          <Space size={8} wrap>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing || query.isFetching} onClick={() => void handleManualRefresh()}>Làm mới</Button>
            <Button size="small" icon={<DownloadOutlined />} disabled={!summary || filteredRows.length === 0} onClick={() => summary && exportMyEarningsExcel(summary, filteredRows)}>Xuất Excel</Button>
          </Space>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Space size={6} wrap>
            {mode !== 'RANGE' ? (
              <>
                <Button size="small" icon={<LeftOutlined />} onClick={() => shiftAnchor(-1)}>
                  {mode === 'DAY' ? 'Hôm trước' : mode === 'WEEK' ? 'Tuần trước' : 'Tháng trước'}
                </Button>
                <DatePicker
                  size="small"
                  allowClear={false}
                  picker={mode === 'MONTH' ? 'month' : 'date'}
                  format={mode === 'MONTH' ? 'MM/YYYY' : 'DD/MM/YYYY'}
                  value={anchor}
                  onChange={(d) => d && setAnchor(d)}
                  style={{ width: mode === 'MONTH' ? 120 : 135 }}
                />
                <Button size="small" onClick={() => shiftAnchor(1)}>
                  {mode === 'DAY' ? 'Hôm sau' : mode === 'WEEK' ? 'Tuần sau' : 'Tháng sau'} <RightOutlined />
                </Button>
                <Button size="small" type="link" onClick={() => setAnchor(dayjs())} style={{ paddingInline: 4 }}>
                  {mode === 'DAY' ? 'Về hôm nay' : mode === 'WEEK' ? 'Về tuần này' : 'Về tháng này'}
                </Button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12, color: BRAND.textSecondary }}>Từ ngày:</span>
                <DatePicker size="small" allowClear={false} format="DD/MM/YYYY" value={customFrom} onChange={(d) => { if (!d) return; setCustomFrom(d); if (d.isAfter(customTo, 'day')) setCustomTo(d); }} style={{ width: 132 }} />
                <span style={{ fontSize: 12, color: BRAND.textSecondary }}>Đến ngày:</span>
                <DatePicker size="small" allowClear={false} format="DD/MM/YYYY" value={customTo} onChange={(d) => { if (!d) return; setCustomTo(d); if (d.isBefore(customFrom, 'day')) setCustomFrom(d); }} style={{ width: 132 }} />
                <Button size="small" onClick={() => { setCustomFrom(dayjs().subtract(6, 'day')); setCustomTo(dayjs()); }}>7 ngày qua</Button>
                <Button size="small" onClick={() => { const m = dayjs().startOf('month'); setCustomFrom(m); setCustomTo(m.add(14, 'day')); }}>Nửa đầu tháng</Button>
                <Button size="small" onClick={() => { setCustomFrom(dayjs().startOf('month').add(15, 'day')); setCustomTo(dayjs().endOf('month')); }}>Nửa cuối tháng</Button>
              </>
            )}
          </Space>
          <Select
            size="small"
            value={catFilter}
            onChange={setCatFilter}
            style={{ width: isDesktop ? 235 : '100%' }}
            options={[
              { value: 'ALL', label: `Tất cả trạng thái (${summary?.shifts.length ?? 0} ca)` },
              { value: 'COMPLETED', label: `Ca đã hoàn thành (${counts?.completedShiftsCount ?? 0} ca)` },
              { value: 'INCOMPLETE', label: `Đang làm / Thiếu Ra ca (${counts?.incompleteShiftsCount ?? 0} ca)` },
              { value: 'UPCOMING', label: `Ca sắp tới dự kiến (${counts?.upcomingShiftsCount ?? 0} ca)` },
              { value: 'OTHER', label: `Vắng / Nghỉ OFF / Đổi ca (${(counts?.absentShiftsCount ?? 0) + (counts?.leaveOffCount ?? 0) + (counts?.swappedOutCount ?? 0)})` },
            ]}
          />
        </div>
      </Card>

      {summary && !summary.salaryProfile.hasProfile && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Hồ sơ lương cá nhân của bạn chưa được thiết lập mức đơn giá. Số ca và giờ công vẫn được ghi nhận đầy đủ; vui lòng liên hệ Nhân sự / Kế toán để cập nhật đơn giá lương." />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" style={{ height: '100%', borderColor: '#BBF7D0', background: '#F0FDF4' }}>
            <div style={{ fontSize: 12, color: BRAND.textSecondary, marginBottom: 4 }}><CheckCircleOutlined style={{ color: '#15803D' }} /> Số ca đã làm (Hoàn thành)</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: '#14532D', lineHeight: 1.25 }}>
              {counts?.completedShiftsCount ?? 0} ca <span style={{ fontSize: 13.5, fontWeight: 600, color: '#15803D' }}>({counts?.completedHours ?? 0} giờ)</span>
            </div>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary, marginTop: 6 }}>
              {counts?.workedDaysCount ?? 0} ngày đi làm · Chính thức: {counts?.completedOfficialShiftsCount ?? 0} ca · Thử việc: {counts?.completedProbationShiftsCount ?? 0} ca{(counts?.completedOtHours ?? 0) > 0 ? ` · OT: ${counts?.completedOtHours}h` : ''}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" style={{ height: '100%', borderColor: '#86EFAC', background: '#FFFFFF' }}>
            <div style={{ fontSize: 12, color: BRAND.textSecondary, marginBottom: 4 }}><DollarOutlined style={{ color: '#15803D' }} /> Tiền hiện tại nhận được (Thực tế)</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: '#15803D', lineHeight: 1.25 }}>{fmtVnd(earned?.netVnd ?? 0)}</div>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary, marginTop: 6 }}>
              Lương ca: {fmtVnd(earned?.basePayVnd ?? 0)} · OT &amp; Phụ cấp: {fmtVnd((earned?.otPayVnd ?? 0) + (earned?.mealAllowanceVnd ?? 0) + (earned?.swapAllowanceVnd ?? 0) + (earned?.fixedAllowanceAppliedVnd ?? 0))}
              {((earned?.bonusAndAddItemsVnd ?? 0) > 0 || (earned?.deductionItemsVnd ?? 0) > 0) ? ` · Thưởng/Trừ: ${fmtVnd((earned?.bonusAndAddItemsVnd ?? 0) - (earned?.deductionItemsVnd ?? 0))}` : ''}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: BRAND.textSecondary, marginBottom: 4 }}><ClockCircleOutlined style={{ color: BRAND.primary }} /> Dự kiến nếu làm đủ ca đã xếp</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 700, color: BRAND.primary, lineHeight: 1.3 }}>{fmtVnd(projected?.projectedNetVnd ?? 0)}</div>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary, marginTop: 6 }}>
              Còn {counts?.upcomingShiftsCount ?? 0} ca sắp tới · {counts?.incompleteShiftsCount ?? 0} ca đang làm/thiếu Ra ca · Nghỉ OFF: {counts?.leaveOffCount ?? 0}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" style={{ height: '100%' }}>
            <div style={{ fontSize: 12, color: BRAND.textSecondary, marginBottom: 4 }}><ProfileOutlined /> Đơn giá lương cá nhân đang áp dụng</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 700, color: BRAND.text, lineHeight: 1.35 }}>
              {prof?.hasProfile ? `${fmtVnd(prof.currentAppliedAmountVnd)} (${prof.unitLabel})` : 'Chưa cấu hình'}
            </div>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary, marginTop: 6 }}>
              {prof?.hasProfile
                ? `${prof.rateTypeLabel} · ${prof.currentStageLabel} · OT x${prof.otMultiplier}${!summary?.range.isFullMonthRange && prof.fixedMonthlyReferenceVnd > 0 ? ` · PC tháng: ${fmtVnd(prof.fixedMonthlyReferenceVnd)} (tính khi xem cả tháng)` : ''}`
                : 'Liên hệ Nhân sự / Kế toán để thiết lập'}
            </div>
          </Card>
        </Col>
      </Row>

      <MyEarningsShiftTable summary={summary} rows={filteredRows} loading={query.isLoading} />
    </div>
  );
}
