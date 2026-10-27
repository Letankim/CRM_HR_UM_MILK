'use client';

import { Button, Flex, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { TableProps } from 'antd/es/table';
import { CloseOutlined, FilterOutlined } from '@ant-design/icons';
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
  /** Điều kiện lọc các bản ghi hợp lệ cho thao tác (VD: chỉ chọn đơn đang Chờ duyệt). */
  eligibleFilter?: (row: TRecord) => boolean;
  onClick: (selectedRows: TRecord[], clearSelection: () => void) => unknown;
}

export interface BulkActionBarProps<TRecord> {
  selectedRows: TRecord[];
  onClearSelection: () => void;
  onFilterSelection?: (filteredRows: TRecord[]) => void;
  actions?: BulkActionItem<TRecord>[];
}

const ACTIONABLE_STATUSES = new Set([
  'PENDING', 'STORE_CONFIRMED', 'PENDING_PEER', 'PEER_ACCEPTED', 'REPORTED',
  'DRAFT', 'PENDING_ACTIVATION', 'LOCKED', 'NEW', 'INTERVIEW_SCHEDULED',
]);

export function isRowActionable(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (r.status && ACTIONABLE_STATUSES.has(String(r.status))) return true;
  if (r.decision && ACTIONABLE_STATUSES.has(String(r.decision))) return true;
  return r.stage === 'PROBATION' || Boolean(r.isAbsentShift);
}

/**
 * Thanh hành động hàng loạt (Bulk Action Bar) thông minh:
 * - Tự động đếm số bản ghi hợp lệ theo từng nút hành động (eligibleFilter).
 * - Hỗ trợ lọc nhanh "Chỉ chọn mục chờ xử lý" khi tích chọn tất cả trang (bao gồm cả mục đã duyệt).
 */
export function BulkActionBar<TRecord>({
  selectedRows, onClearSelection, onFilterSelection, actions = [],
}: BulkActionBarProps<TRecord>) {
  if (selectedRows.length === 0) return null;

  const filterableActions = actions.filter((a) => typeof a.eligibleFilter === 'function');
  const actionableRows = selectedRows.filter((row) =>
    filterableActions.length > 0 ? filterableActions.some((a) => a.eligibleFilter!(row)) : isRowActionable(row),
  );
  const hasMixedSelection = actionableRows.length > 0 && actionableRows.length < selectedRows.length;
  const allAlreadyProcessed = filterableActions.length > 0 && actionableRows.length === 0;

  return (
    <div style={{ background: BRAND.primaryBg, borderBottom: `1px solid ${BRAND.primaryBorder}`, padding: '10px 16px' }}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space size={8} wrap>
          <Tag color="blue" style={{ margin: 0, borderRadius: 4, fontWeight: 600, fontSize: 12, padding: '2px 8px' }}>
            Đã chọn {selectedRows.length} bản ghi
          </Tag>
          {hasMixedSelection && (
            <>
              <Tag color="gold" style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
                {actionableRows.length} mục chờ xử lý · {selectedRows.length - actionableRows.length} mục đã xử lý
              </Tag>
              {onFilterSelection && (
                <Button size="small" type="primary" ghost icon={<FilterOutlined />} onClick={() => onFilterSelection(actionableRows)}>
                  Chỉ chọn mục chờ xử lý ({actionableRows.length})
                </Button>
              )}
            </>
          )}
          {allAlreadyProcessed && (
            <Tag color="default" style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
              Các mục đang chọn đều đã hoàn tất duyệt/xử lý
            </Tag>
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
              return <Tooltip key={act.key} title="Không có bản ghi nào trong danh sách đang chọn ở trạng thái chờ xử lý cho thao tác này">{btn}</Tooltip>;
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
}

export function SelectableTable<TRecord extends object>({
  bulkActions = [], dataSource = [], rowKey = 'id', columns, scroll, ...rest
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

  return (
    <>
      <BulkActionBar selectedRows={selectedRows} onClearSelection={clearSelection} onFilterSelection={(rows) => setSelectedRowKeys(rows.map(getKey))} actions={resolvedActions} />
      <Table<TRecord>
        rowKey={rowKey} dataSource={dataSource} columns={normalizedColumns}
        scroll={scroll ? { ...scroll, x: typeof scroll.x === 'number' ? Math.max(scroll.x, totalScrollX) : totalScrollX } : { x: totalScrollX }}
        rowSelection={{
          selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys),
          selections: [
            { key: 'all-page', text: 'Chọn tất cả trang này', onSelect: () => setSelectedRowKeys(dataSource.map(getKey)) },
            {
              key: 'only-actionable', text: 'Chỉ chọn mục chờ duyệt / chờ xử lý',
              onSelect: () => {
                const filterable = resolvedActions.filter((a) => typeof a.eligibleFilter === 'function');
                const rows = dataSource.filter((r) => (filterable.length > 0 ? filterable.some((a) => a.eligibleFilter!(r)) : isRowActionable(r)));
                setSelectedRowKeys(rows.map(getKey));
              },
            },
            { key: 'clear-all', text: 'Bỏ chọn tất cả', onSelect: () => setSelectedRowKeys([]) },
          ],
        }}
        {...rest}
      />
    </>
  );
}
