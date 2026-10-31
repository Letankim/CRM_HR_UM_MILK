'use client';

import { Card } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { MyEarningsTrackerView } from '@/ui/components/MyEarningsTrackerView';

/** Trang theo dõi số ca đã làm & thu nhập thực tế hiện tại cho nhân viên (/nv/thu-nhap). */
export default function MyEarningsPage() {
  return (
    <Card size="small" title={<span><DollarOutlined /> Theo dõi Ca đã làm &amp; Thu nhập hiện tại của bạn</span>} styles={{ body: { padding: 12 } }}>
      <MyEarningsTrackerView embedded />
    </Card>
  );
}
