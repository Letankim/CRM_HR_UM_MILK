'use client';

import { Space } from 'antd';
import { DataPartitionCard } from './DataPartitionCard';
import { OperationsConfigCard } from './OperationsConfigCard';

/** Khối "Cấu hình vận hành & Dữ liệu tháng" trong khu vực Chính sách & Sao lưu Bảo trì. */
export function OperationsAndPartitionPane() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <OperationsConfigCard />
      <DataPartitionCard />
    </Space>
  );
}
