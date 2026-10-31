'use client';

import { Card, Grid } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { MyEarningsTrackerView } from '@/ui/components/MyEarningsTrackerView';

/** Trang theo dõi số ca đã làm & thu nhập thực tế hiện tại cho nhân viên (/nv/thu-nhap). */
export default function MyEarningsPage() {
  const isDesktop = Boolean(Grid.useBreakpoint().md);
  return (
    <div style={{ padding: isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Card size="small" title={<span><DollarOutlined /> Theo dõi Ca đã làm &amp; Thu nhập hiện tại của bạn</span>} styles={{ body: { padding: isDesktop ? 12 : 8 } }}>
        <MyEarningsTrackerView embedded />
      </Card>
    </div>
  );
}
