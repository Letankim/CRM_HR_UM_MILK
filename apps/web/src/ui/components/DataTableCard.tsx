'use client';

import { Table, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { Key } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { ListMeta } from '@umbm/shared';
import { BRAND } from '../theme';
import { BulkActionBar, type BulkActionItem, buildTableSelections, type TableSelectionPreset } from './BulkActionBar';

export interface DataTableCardProps<TRecord extends { id: string }> {
  columns: ColumnsType<TRecord>;
  dataSource?: TRecord[];
  meta?: ListMeta | null;
  loading?: boolean;
  codeExtractor?: (record: TRecord) => string;
  onPageChange?: (page: number, perPage: number) => void;
  emptyText?: string;
  selectable?: boolean;
  bulkActions?: BulkActionItem<TRecord>[];
  selectionPresets?: TableSelectionPreset<TRecord>[];
}

/**
 * Bảng dữ liệu chuẩn mẫu 3DO ADMIN:
 * - Tự động sinh cột NO (số thứ tự đậm + mã định danh in hoa monospace phía dưới).
 * - Khi chọn nhiều dòng, tự động hiển thị BulkActionBar và menu chọn nhanh theo đúng trạng thái của bảng.
 * - Tính toán chiều rộng cuộn ngang chính xác để không bao giờ bị đè cột.
 */
export function DataTableCard<TRecord extends { id: string }>({
  columns,
  dataSource = [],
  meta,
  loading,
  codeExtractor,
  onPageChange,
  emptyText = 'Không có dữ liệu phù hợp với bộ lọc hiện tại',
  selectable = true,
  bulkActions = [],
  selectionPresets,
}: DataTableCardProps<TRecord>) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [localPage, setLocalPage] = useState(1);
  const [localPerPage, setLocalPerPage] = useState(12);
  const [localTotal, setLocalTotal] = useState(0);

  useEffect(() => {
    const validIds = new Set(dataSource.map((r) => r.id));
    setSelectedRowKeys((prev) => prev.filter((k) => validIds.has(String(k))));
  }, [dataSource]);

  useEffect(() => {
    if (meta?.pagination) {
      setLocalPage(meta.pagination.page);
      setLocalPerPage(meta.pagination.per_page);
      setLocalTotal(meta.pagination.total);
    }
  }, [meta?.pagination]);

  const selectedRows = useMemo(() => {
    const keySet = new Set(selectedRowKeys.map(String));
    return dataSource.filter((r) => keySet.has(r.id));
  }, [dataSource, selectedRowKeys]);

  const page = meta?.pagination.page ?? localPage;
  const perPage = meta?.pagination.per_page ?? localPerPage;
  const total = meta?.pagination.total ?? (localTotal > 0 && loading ? localTotal : dataSource.length);

  const { fullColumns, totalScrollX } = useMemo(() => {
    const noColumn: ColumnsType<TRecord>[number] = {
      title: 'NO',
      key: '__no',
      width: 78,
      fixed: 'left',
      render: (_value, record, index) => {
        const seq = (page - 1) * perPage + index + 1;
        const code = codeExtractor ? codeExtractor(record) : record.id.slice(0, 10).toUpperCase();
        return (
          <div style={{ lineHeight: 1.35 }}>
            <Typography.Text strong style={{ fontSize: 13, color: BRAND.text }}>
              {seq}
            </Typography.Text>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: '#64748B',
                textTransform: 'uppercase',
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {code}
            </div>
          </div>
        );
      },
    };
    const normalizedCols = columns.map((col, idx) => {
      const isLast = idx === columns.length - 1;
      const isAction = isLast && (col.key === 'actions' || col.key === 'act' || col.title === 'Thao tác');
      const w = Number(col.width ?? (isAction ? 88 : 'ellipsis' in col && col.ellipsis ? 230 : 185));
      return {
        ...col,
        width: w,
        ...(isAction ? { fixed: 'right' as const } : {}),
      };
    });
    const allCols = [noColumn, ...normalizedCols];
    const sumW = allCols.reduce((acc, c) => acc + Number(c.width || 185), 56);
    return { fullColumns: allCols, totalScrollX: Math.max(sumW, 960) };
  }, [codeExtractor, columns, page, perPage]);

  const selections = useMemo(
    () => buildTableSelections(dataSource, (r) => r.id, setSelectedRowKeys, bulkActions, selectionPresets),
    [dataSource, bulkActions, selectionPresets],
  );

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: perPage,
    total,
    showSizeChanger: true,
    pageSizeOptions: ['10', '12', '15', '20', '50', '100'],
    showTotal: (t) => `Tổng ${t} bản ghi`,
    onChange: (nextPage, nextSize) => {
      const targetPage = nextSize !== perPage ? 1 : nextPage;
      setLocalPage(targetPage);
      setLocalPerPage(nextSize);
      onPageChange?.(targetPage, nextSize);
    },
    style: { paddingInline: 16, marginBottom: 12, marginTop: 12 },
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${BRAND.border}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {selectable && (
        <BulkActionBar<TRecord>
          selectedRows={selectedRows}
          onClearSelection={() => setSelectedRowKeys([])}
          onFilterSelection={(rows) => setSelectedRowKeys(rows.map((r) => r.id))}
          actions={bulkActions}
        />
      )}
      <Table<TRecord>
        rowKey="id"
        size="middle"
        columns={fullColumns}
        dataSource={dataSource}
        loading={{
          spinning: Boolean(loading),
          tip: 'Đang tải và đồng bộ dữ liệu mới nhất...',
        }}
        rowSelection={
          selectable
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
                selections,
              }
            : undefined
        }
        pagination={pagination}
        locale={{ emptyText }}
        scroll={{ x: totalScrollX }}
      />
    </div>
  );
}
