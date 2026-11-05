'use client';

import { useState } from 'react';
import { Space, Tabs } from 'antd';
import { DatabaseOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons';
import { AdminPayrollSignatureCard } from './AdminPayrollSignatureCard';
import { DataPartitionCard } from './DataPartitionCard';
import { OperationsConfigCard } from './OperationsConfigCard';

/** Khối "Cấu hình vận hành & Dữ liệu tháng" phân tách thành các tab chuyên biệt. */
export function OperationsAndPartitionPane() {
  const [activeTab, setActiveTab] = useState<'config' | 'partitions' | 'signature'>('config');

  return (
    <div style={{ marginTop: 4 }}>
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'config' | 'partitions' | 'signature')}
        destroyOnHidden={false}
        items={[
          {
            key: 'config',
            label: (
              <Space size={6}>
                <SettingOutlined />
                <span>Cấu hình vận hành</span>
              </Space>
            ),
            children: <OperationsConfigCard />,
          },
          {
            key: 'partitions',
            label: (
              <Space size={6}>
                <DatabaseOutlined />
                <span>Quản lý dữ liệu theo tháng (Google Sheets)</span>
              </Space>
            ),
            children: <DataPartitionCard />,
          },
          {
            key: 'signature',
            label: (
              <Space size={6}>
                <SafetyCertificateOutlined />
                <span>Chữ ký mẫu Ban Quản trị</span>
              </Space>
            ),
            children: <AdminPayrollSignatureCard />,
          },
        ]}
      />
    </div>
  );
}
