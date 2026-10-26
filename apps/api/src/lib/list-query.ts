import type { ListMeta, SortOrder } from '@umbm/shared';

export interface PaginatedResult<T> {
  items: T[];
  meta: ListMeta;
}

export interface ListQueryOptions<T> {
  page?: number;
  perPage?: number;
  maxPerPage?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  defaultSortBy: string;
  defaultSortOrder?: SortOrder;
  allowedSortFields?: readonly string[];
  q?: string;
  searchExtractor?: (item: T) => (string | null | undefined)[];
  filters?: Record<string, string | undefined>;
  filterPredicates?: Partial<Record<string, (item: T, filterValue: string) => boolean>>;
}

function compareValues(a: unknown, b: unknown, order: SortOrder): number {
  const dir = order === 'asc' ? 1 : -1;
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * dir;
  }
  return String(a).localeCompare(String(b), 'vi', { numeric: true }) * dir;
}

/**
 * Bộ máy xử lý tìm kiếm (q), lọc đa trường (filters), sắp xếp (sort_by, sort_order)
 * và phân trang (page, per_page) chuẩn hóa cho mọi danh sách dữ liệu.
 */
export function paginateAndSort<T extends object>(
  sourceItems: readonly T[],
  options: ListQueryOptions<T>,
): PaginatedResult<T> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const perPage = Math.min(options.maxPerPage ?? 100, Math.max(1, Math.floor(options.perPage ?? 12)));
  const sortOrder: SortOrder = options.sortOrder ?? options.defaultSortOrder ?? 'desc';
  const requestedSortBy = options.sortBy?.trim() || options.defaultSortBy;
  const sortBy =
    options.allowedSortFields && !options.allowedSortFields.includes(requestedSortBy)
      ? options.defaultSortBy
      : requestedSortBy;

  const activeFilters: Record<string, string> = {};
  let filtered = [...sourceItems];

  // 1. Lọc theo các trường filter
  if (options.filters) {
    for (const [key, rawVal] of Object.entries(options.filters)) {
      const val = rawVal?.trim();
      if (!val || val === 'ALL') continue;
      activeFilters[key] = val;
      const customPredicate = options.filterPredicates?.[key];
      if (customPredicate) {
        filtered = filtered.filter((item) => customPredicate(item, val));
      } else {
        filtered = filtered.filter((item) => String((item as Record<string, unknown>)[key] ?? '') === val);
      }
    }
  }

  // 2. Tìm kiếm theo từ khóa q
  const keyword = options.q?.trim().toLowerCase();
  if (keyword) {
    activeFilters.q = options.q!.trim();
    if (options.searchExtractor) {
      filtered = filtered.filter((item) =>
        options
          .searchExtractor!(item)
          .some((fieldVal) => fieldVal && fieldVal.toLowerCase().includes(keyword)),
      );
    }
  }

  // 3. Sắp xếp
  filtered.sort((a, b) =>
    compareValues(
      (a as Record<string, unknown>)[sortBy],
      (b as Record<string, unknown>)[sortBy],
      sortOrder,
    ),
  );

  // 4. Phân trang
  const total = filtered.length;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, lastPage);
  const start = (safePage - 1) * perPage;
  const items = filtered.slice(start, start + perPage);

  return {
    items,
    meta: {
      pagination: {
        page: safePage,
        per_page: perPage,
        total,
        last_page: lastPage,
        has_next_page: safePage < lastPage,
        has_previous_page: safePage > 1,
      },
      sort: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
      filters: activeFilters,
    },
  };
}
