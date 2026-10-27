'use client';

import { Button, Flex, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd/es/table';
import { CloseOutlined } from '@ant-design/icons';
import { type Key, type ReactNode, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../theme';

export interface BulkActionItem<TRecord> {
  key: string;
  label: string;
  icon?: ReactNode;
  type?: 'primary' | 'default' | 'dashed';
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  confirm?: string;
  onClick: (selectedRows: TRecord[], clearSelection: () => void) => unknown;
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
          {actions.map((act) => {
            const btn = (
              <Button
                key={act.key}
                size="small"
                type={act.type ?? 'default'}
                danger={act.danger}
                icon={act.icon}
                loading={act.loading}
                disabled={act.disabled}
                onClick={act.confirm ? undefined : () => act.onClick(selectedRows, onClearSelection)}
              >
                {act.label}
              </Button>
            );
            return act.confirm ? (
              <Popconfirm
                key={act.key}
                title={act.confirm}
                okText="Xác nhận"
                cancelText="Hủy bỏ"
                okButtonProps={{ danger: act.danger }}
                onConfirm={() => act.onClick(selectedRows, onClearSelection)}
              >
                {btn}
              </Popconfirm>
            ) : (
              btn
            );
          })}
        </Space>
      </Flex>
    </div>
  );
}

export interface SelectableTableProps<TRecord extends object> extends TableProps<TRecord> {
  bulkActions?:
    | BulkActionItem<TRecord>[]
    | ((selectedRows: TRecord[], clearSelection: () => void) => BulkActionItem<TRecord>[]);
}

/**
 * Bảng dữ liệu tích hợp sẵn cột tích chọn hàng loạt (rowSelection) và thanh BulkActionBar.
 */
export function SelectableTable<TRecord extends object>({
  bulkActions = [],
  dataSource = [],
  rowKey = 'id',
  columns,
  scroll,
  ...rest
}: SelectableTableProps<TRecord>) {
  const getKey = (r: TRecord): string =>
    typeof rowKey === 'function' ? String(rowKey(r)) : String((r as Record<string, unknown>)[String(rowKey)] ?? '');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const clearSelection = () => setSelectedRowKeys([]);

  useEffect(() => {
    const valid = new Set(dataSource.map(getKey));
    setSelectedRowKeys((prev) => (prev.length === 0 ? prev : prev.filter((k) => valid.has(String(k)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource]);

  const selectedRows = useMemo(() => {
    if (selectedRowKeys.length === 0) return [];
    const keySet = new Set(selectedRowKeys.map(String));
    return dataSource.filter((r) => keySet.has(getKey(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, selectedRowKeys]);

  const normalizedColumns = useMemo(
    () =>
      columns?.map((col) => ({
        ...col,
        width: col.width ?? ('ellipsis' in col && col.ellipsis ? 230 : 185),
      })),
    [columns],
  );

  const resolvedActions =
    typeof bulkActions === 'function' ? bulkActions(selectedRows, clearSelection) : bulkActions;

  return (
    <>
      <BulkActionBar
        selectedRows={selectedRows}
        onClearSelection={clearSelection}
        actions={resolvedActions}
      />
      <Table<TRecord>
        rowKey={rowKey}
        dataSource={dataSource}
        columns={normalizedColumns}
        scroll={scroll ?? { x: 'max-content' }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        {...rest}
      />
    </>
  );
}
