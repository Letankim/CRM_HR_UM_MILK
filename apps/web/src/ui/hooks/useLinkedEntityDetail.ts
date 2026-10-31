'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface UseLinkedEntityDetailOptions<T> {
  enabled: boolean;
  selectedKey?: string;
  endpointPrefix: string;
  matchItem: (item: T, key: string) => boolean;
  fallbackList?: T[];
}

const DETAIL_STALE_MS = 15_000;

/**
 * Hook tải thông tin chi tiết mới nhất từ API của Tài khoản hoặc Hồ sơ Nhân sự khi người dùng chọn liên kết.
 * Sử dụng chung cache & in-flight Promise của React Query để tuyệt đối không gọi trùng API 2 lần.
 */
export function useLinkedEntityDetail<T>({
  enabled,
  selectedKey,
  endpointPrefix,
  matchItem,
  fallbackList = [],
}: UseLinkedEntityDetailOptions<T>) {
  const qc = useQueryClient();
  const [fetchingFresh, setFetchingFresh] = useState(false);
  const matchRef = useRef(matchItem);
  matchRef.current = matchItem;
  const fallbackRef = useRef(fallbackList);
  fallbackRef.current = fallbackList;

  const loadEntity = useCallback(
    (key: string) =>
      api
        .get<T>(`${endpointPrefix}/${encodeURIComponent(key)}`)
        .catch(() => fallbackRef.current.find((x) => matchRef.current(x, key)) ?? null),
    [endpointPrefix],
  );

  const detailQuery = useQuery({
    queryKey: ['linked-entity-detail', endpointPrefix, selectedKey ?? ''],
    queryFn: () => loadEntity(selectedKey!),
    enabled: Boolean(enabled && selectedKey),
    staleTime: DETAIL_STALE_MS,
  });

  const fetchFresh = useCallback(
    async (nextKey?: string): Promise<T | null> => {
      if (!nextKey) return null;
      setFetchingFresh(true);
      try {
        return await qc.fetchQuery({
          queryKey: ['linked-entity-detail', endpointPrefix, nextKey],
          queryFn: () => loadEntity(nextKey),
          staleTime: DETAIL_STALE_MS,
        });
      } finally {
        setFetchingFresh(false);
      }
    },
    [qc, endpointPrefix, loadEntity],
  );

  const entity = enabled && selectedKey ? (detailQuery.data ?? null) : null;
  const loading = fetchingFresh || detailQuery.isFetching;

  return { entity, loading, fetchFresh };
}
