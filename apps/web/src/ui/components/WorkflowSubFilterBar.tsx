'use client';

import type { ReactNode } from 'react';
import { Button, Flex, Input, Select, Space } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';

type Opt = { value: string; label: string };

interface Props {
  searchInput: string;
  onSearchChange: (v: string) => void;
  branchValue: string;
  branchOptions: Opt[];
  onBranchChange: (v: string) => void;
  statusValue?: string;
  statusOptions?: Opt[];
  onStatusChange?: (v: string) => void;
  extraFilters?: ReactNode;
  refreshing?: boolean;
  onRefresh: () => void;
  onExport: () => void;
  actionBtn?: ReactNode;
  searchPlaceholder?: string;
}

/** Thanh lọc dùng chung cho các tab nghiệp vụ lịch làm việc (tìm kiếm + chi nhánh + trạng thái + Làm mới / Xuất Excel). */
export function WorkflowSubFilterBar({
  searchInput, onSearchChange, branchValue, branchOptions, onBranchChange, statusValue, statusOptions, onStatusChange,
  extraFilters, refreshing, onRefresh, onExport, actionBtn, searchPlaceholder = 'Tìm tên nhân sự, mã đơn, ngày, lý do...',
}: Props) {
  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 16px', marginTop: 4, marginBottom: 12 }}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space size={10} wrap>
          <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder={searchPlaceholder} value={searchInput} onChange={(e) => onSearchChange(e.target.value)} style={{ width: 245 }} />
          <Select value={branchValue} onChange={onBranchChange} style={{ width: 195 }} options={branchOptions} />
          {statusOptions && onStatusChange && <Select value={statusValue} onChange={onStatusChange} style={{ width: 215 }} options={statusOptions} />}
          {extraFilters}
        </Space>
        <Space size={8} wrap>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>Làm mới</Button>
          <Button icon={<DownloadOutlined />} onClick={onExport}>Xuất Excel</Button>
          {actionBtn}
        </Space>
      </Flex>
    </div>
  );
}
