'use client';

import { Button, Flex, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { TableProps } from 'antd/es/table';
import { CloseOutlined, FilterOutlined } from '@ant-design/icons';
import { type Key, type ReactNode, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../theme';
import {
  buildTableSelections,
  describeSelectionBreakdown,
  getRowStateLabel,
  isRowActionable,
  type TableSelectionPreset,
} from './table-selection-helpers';

export { buildTableSelections, describeSelectionBreakdown, getRowStateLabel, isRowActionable, type TableSelectionPreset };

export interface BulkActionItem<TRecord> {
  key: string;
  label: string;
  icon?: ReactNode;
  type?: 'primary' | 'default' | 'dashed';
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  confirm?: string;
  /** Điều kiện lọc các bản ghi hợp lệ theo đúng trạng thái của bảng cho thao tác này. */
  eligibleFilter?: (row: TRecord) => boolean;
  onClick: (selectedRows: TRecord[], clearSelection: () => void) => unknown;
}

export interface BulkActionBarProps<TRecord> {
  selectedRows: TRecord[];
  onClearSelection: () => void;
  onFilterSelection?: (filteredRows: TRecord[]) => void;
  actions?: BulkActionItem<TRecord>[];
}

/**
 * Thanh hành động hàng loạt (Bulk Action Bar) thích ứng theo đúng trạng thái của từng bảng:
 * - Hiển thị phân rã số lượng theo đúng nhãn trạng thái thực tế của bảng đang xem.
 * - Khi chọn lẫn nhiều trạng thái, hiển thị nút lọc nhanh theo từng trạng thái cụ thể của bảng.
 */
export function BulkActionBar<TRecord>({
  selectedRows, onClearSelection, onFilterSelection, actions = [],
}: BulkActionBarProps<TRecord>) {
  if (selectedRows.length === 0) return null;

  const breakdown = describeSelectionBreakdown(selectedRows, actions);
  const hasMultipleStates = breakdown.length > 1;
  const singleGroup = breakdown.length === 1 ? breakdown[0] : null;

  return (
    <div style={{ background: BRAND.primaryBg, borderBottom: `1px solid ${BRAND.primaryBorder}`, padding: '10px 16px' }}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space size={8} wrap>
          <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontWeight: 600, fontSize: 12, padding: '2px 8px' }}>
            Đã chọn {selectedRows.length} bản ghi
          </Tag>
          {singleGroup && singleGroup.label !== 'Bản ghi' && (
            <Tag color={singleGroup.isActionable ? 'gold' : 'cyan'} style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
              {singleGroup.rows.length} {singleGroup.label}
            </Tag>
          )}
          {hasMultipleStates && (
            <>
              <Tag color="gold" style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
                {breakdown.map((g) => `${g.rows.length} ${g.label}`).join(' · ')}
              </Tag>
              {onFilterSelection && breakdown.map((g) => (
                <Button
                  key={g.label}
                  size="small"
                  type={g.isActionable ? 'primary' : 'default'}
                  ghost={g.isActionable}
                  icon={<FilterOutlined />}
                  onClick={() => onFilterSelection(g.rows)}
                >
                  Chỉ giữ: {g.label} ({g.rows.length})
                </Button>
              ))}
            </>
          )}
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClearSelection}>Bỏ chọn tất cả</Button>
        </Space>

        <Space size={8} wrap>
          {actions.map((act) => {
            const eligibleRows = act.eligibleFilter ? selectedRows.filter(act.eligibleFilter) : selectedRows;
            const isDisabled = Boolean(act.disabled || (act.eligibleFilter && eligibleRows.length === 0));
            const countSuffix = act.eligibleFilter
              ? eligibleRows.length < selectedRows.length ? ` (${eligibleRows.length}/${selectedRows.length})` : ` (${eligibleRows.length})`
              : ` (${selectedRows.length})`;
            const btn = (
              <Button
                key={act.key} size="small" type={act.type ?? 'default'} danger={act.danger} icon={act.icon} loading={act.loading}
                disabled={isDisabled} onClick={act.confirm || isDisabled ? undefined : () => act.onClick(eligibleRows, onClearSelection)}
              >
                {act.label}{countSuffix}
              </Button>
            );
            if (isDisabled && act.eligibleFilter) {
              return (
                <Tooltip key={act.key} title={`Các bản ghi đang chọn không ở trạng thái hợp lệ để thực hiện "${act.label}"`}>
                  {btn}
                </Tooltip>
              );
            }
            return act.confirm ? (
              <Popconfirm key={act.key} title={act.confirm} okText="Xác nhận" cancelText="Hủy bỏ" okButtonProps={{ danger: act.danger }} onConfirm={() => act.onClick(eligibleRows, onClearSelection)}>
                {btn}
              </Popconfirm>
            ) : btn;
          })}
        </Space>
      </Flex>
    </div>
  );
}

export interface SelectableTableProps<TRecord extends object> extends TableProps<TRecord> {
  bulkActions?: BulkActionItem<TRecord>[] | ((selectedRows: TRecord[], clearSelection: () => void) => BulkActionItem<TRecord>[]);
  selectionPresets?: TableSelectionPreset<TRecord>[];
}

export function SelectableTable<TRecord extends object>({
  bulkActions = [], selectionPresets, dataSource = [], rowKey = 'id', columns, scroll, ...rest
}: SelectableTableProps<TRecord>) {
  const getKey = (r: TRecord): string => typeof rowKey === 'function' ? String(rowKey(r)) : String((r as Record<string, unknown>)[String(rowKey)] ?? '');
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

  const { normalizedColumns, totalScrollX } = useMemo(() => {
    const cols = columns?.map((col, idx) => {
      const isLast = columns ? idx === columns.length - 1 : false;
      const isAction = isLast && (col.key === 'actions' || col.key === 'act' || col.title === 'Thao tác' || col.title === 'Điều phối' || col.title === 'Chi tiết');
      const w = Number(col.width ?? (isAction ? 88 : 'ellipsis' in col && col.ellipsis ? 230 : 185));
      return { ...col, width: w, ...(isAction && !col.fixed ? { fixed: 'right' as const } : {}) };
    });
    const sumW = (cols ?? []).reduce((acc, c) => acc + Number(c.width || 185), 56);
    return { normalizedColumns: cols, totalScrollX: Math.max(sumW, 920) };
  }, [columns]);

  const resolvedActions = typeof bulkActions === 'function' ? bulkActions(selectedRows, clearSelection) : bulkActions;
  const selections = useMemo(
    () => buildTableSelections(dataSource, getKey, setSelectedRowKeys, resolvedActions, selectionPresets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource, resolvedActions, selectionPresets],
  );

  return (
    <>
      <BulkActionBar selectedRows={selectedRows} onClearSelection={clearSelection} onFilterSelection={(rows) => setSelectedRowKeys(rows.map(getKey))} actions={resolvedActions} />
      <Table<TRecord>
        rowKey={rowKey} dataSource={dataSource} columns={normalizedColumns}
        scroll={scroll ? { ...scroll, x: typeof scroll.x === 'number' ? Math.max(scroll.x, totalScrollX) : totalScrollX } : { x: totalScrollX }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          selections,
        }}
        {...rest}
      />
    </>
  );
}
