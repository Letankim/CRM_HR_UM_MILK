'use client';

import { Grid, Tabs } from 'antd';
import { DollarOutlined, FileTextOutlined } from '@ant-design/icons';
import { MyEarningsTrackerView } from '@/ui/components/MyEarningsTrackerView';
import { MyPayslipsView } from '@/ui/components/MyPayslipsView';

/** Phiếu lương cá nhân & Theo dõi Ca đã làm / Thu nhập hiện tại (/nv/phieu-luong). */
export default function MyPayslipsPage() {
  const isDesktop = Boolean(Grid.useBreakpoint().md);
  return (
    <div style={{ padding: isDesktop ? 0 : '8px 6px', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <Tabs
        defaultActiveKey="payslips"
        items={[
          {
            key: 'payslips',
            label: <span><FileTextOutlined /> Phiếu lương kỳ đã phát hành</span>,
            children: <MyPayslipsView embedded />,
          },
          {
            key: 'earnings',
            label: <span><DollarOutlined /> Ca đã làm &amp; Thu nhập hiện tại</span>,
            children: <MyEarningsTrackerView embedded />,
          },
        ]}
      />
    </div>
  );
}
