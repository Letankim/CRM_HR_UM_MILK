'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Col, Row, Segmented, Skeleton } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, DollarOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { computePeriodBounds, type MyEarningsSummary } from '@/ui/components/my-earnings-types';
import { fmtVnd } from '@/ui/components/payroll-types';
import { BRAND } from '@/ui/theme';

export function EmployeeEarningsQuickCard({ isDesktop }: { isDesktop?: boolean }) {
  const [quickMode, setQuickMode] = useState<'WEEK' | 'MONTH'>('MONTH');
  const bounds = useMemo(() => computePeriodBounds(quickMode, dayjs(), dayjs(), dayjs()), [quickMode]);

  const query = useQuery({
    queryKey: ['my-earnings', bounds.fromDate, bounds.toDate],
    queryFn: () => api.get<MyEarningsSummary>(`/me/earnings?from_date=${bounds.fromDate}&to_date=${bounds.toDate}`),
  });

  const s = query.data;

  return (
    <Card
      size="small"
      style={{ marginBottom: isDesktop ? 0 : 12, borderColor: '#BFDBFE', background: '#FFFFFF' }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span><DollarOutlined style={{ color: '#15803D' }} /> Ca đã làm &amp; Thu nhập hiện tại</span>
          <Segmented
            size="small"
            value={quickMode}
            onChange={(v) => setQuickMode(v as 'WEEK' | 'MONTH')}
            options={[
              { value: 'WEEK', label: 'Tuần này' },
              { value: 'MONTH', label: 'Tháng này' },
            ]}
          />
        </div>
      }
      extra={
        <Link href="/nv/thu-nhap">
          <Button size="small" type="link" style={{ paddingInline: 0, fontWeight: 600 }}>
            Lọc ngày / tuần <RightOutlined />
          </Button>
        </Link>
      }
    >
      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : (
        <Row gutter={[10, 10]} align="middle">
          <Col xs={12} sm={8}>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary }}><CheckCircleOutlined style={{ color: '#15803D' }} /> Đã hoàn thành</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 800, color: '#14532D' }}>
              {s?.counts.completedShiftsCount ?? 0} ca <span style={{ fontSize: 12.5, fontWeight: 600 }}>({s?.counts.completedHours ?? 0}h)</span>
            </div>
          </Col>
          <Col xs={12} sm={9}>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary }}>Tiền hiện tại nhận được</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 800, color: '#15803D' }}>{fmtVnd(s?.earned.netVnd ?? 0)}</div>
          </Col>
          <Col xs={24} sm={7}>
            <div style={{ fontSize: 11.5, color: BRAND.textSecondary }}><ClockCircleOutlined /> Sắp tới / Dự kiến cả kỳ</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, color: BRAND.primary }}>
              {s?.counts.upcomingShiftsCount ?? 0} ca · {fmtVnd(s?.projected.projectedNetVnd ?? 0)}
            </div>
          </Col>
        </Row>
      )}
    </Card>
  );
}
