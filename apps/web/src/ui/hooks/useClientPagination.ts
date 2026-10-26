'use client';

import type { TablePaginationConfig } from 'antd/es/table';
import { useState } from 'react';

/**
 * Hook quản lý phân trang đầy đủ (đổi trang + đổi số dòng mỗi trang 10/12/20/50/100)
 * cho các bảng Ant Design Table, tránh lỗi khóa cứng pageSize không chọn được mức khác.
 */
export function useClientPagination(defaultSize = 12, unitLabel = 'bản ghi'): TablePaginationConfig {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);

  return {
    current: page,
    pageSize,
    showSizeChanger: true,
    pageSizeOptions: ['10', '12', '20', '50', '100'],
    showTotal: (t) => `Tổng ${t} ${unitLabel}`,
    onChange: (nextPage, nextSize) => {
      setPage(nextSize !== pageSize ? 1 : nextPage);
      setPageSize(nextSize);
    },
  };
}
