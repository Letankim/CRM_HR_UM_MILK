'use client';

import { Button, Flex, Space, Tag, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { BRAND } from '../theme';

export interface BulkActionItem<TRecord> {
  key: string;
  label: string;
  icon?: ReactNode;
  type?: 'primary' | 'default' | 'dashed';
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: (selectedRows: TRecord[], clearSelection: () => void) => void | Promise<void>;
}

export interface BulkActionBarProps<TRecord> {
  selectedRows: TRecord[];
  onClearSelection: () => void;
  actions?: BulkActionItem<TRecord>[];
}

/**
 * Thanh hành động hàng loạt (Bulk Action Bar) xuất hiện tự động khi người dùng tích chọn 1 hoặc nhiều dòng trên bảng.
 */
export function BulkActionBar<TRecord>({
  selectedRows,
  onClearSelection,
  actions = [],
}: BulkActionBarProps<TRecord>) {
  if (selectedRows.length === 0) return null;

  return (
    <div
      style={{
        background: BRAND.primaryBg,
        borderBottom: `1px solid ${BRAND.primaryBorder}`,
        padding: '10px 16px',
      }}
    >
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space size={10} wrap>
          <Tag
            color="blue"
            style={{
              margin: 0,
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 12,
              padding: '2px 8px',
            }}
          >
            Đã chọn {selectedRows.length} bản ghi
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Chọn thao tác áp dụng hàng loạt cho các bản ghi đang đánh dấu:
          </Typography.Text>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClearSelection}>
            Bỏ chọn tất cả
          </Button>
        </Space>

        <Space size={8} wrap>
          {actions.map((act) => (
            <Button
              key={act.key}
              size="small"
              type={act.type ?? 'default'}
              danger={act.danger}
              icon={act.icon}
              loading={act.loading}
              disabled={act.disabled}
              onClick={() => act.onClick(selectedRows, onClearSelection)}
            >
              {act.label}
            </Button>
          ))}
        </Space>
      </Flex>
    </div>
  );
}
