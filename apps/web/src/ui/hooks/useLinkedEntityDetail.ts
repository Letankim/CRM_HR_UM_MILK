'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface UseLinkedEntityDetailOptions<T> {
  enabled: boolean;
  selectedKey?: string;
  endpointPrefix: string;
  matchItem: (item: T, key: string) => boolean;
  fallbackList?: T[];
}

/**
 * Hook tải thông tin chi tiết mới nhất từ API của Tài khoản hoặc Hồ sơ Nhân sự khi người dùng chọn liên kết.
 */
export function useLinkedEntityDetail<T>({
  enabled,
  selectedKey,
  endpointPrefix,
  matchItem,
  fallbackList = [],
}: UseLinkedEntityDetailOptions<T>) {
  const [entity, setEntity] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !selectedKey) {
      setEntity(null);
      return;
    }
    if (entity && matchItem(entity, selectedKey)) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(`${endpointPrefix}/${encodeURIComponent(selectedKey)}`)
      .then((res) => {
        if (!cancelled) setEntity(res);
      })
      .catch(() => {
        const fb = fallbackList.find((x) => matchItem(x, selectedKey)) ?? null;
        if (!cancelled) setEntity(fb);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedKey, endpointPrefix, entity, matchItem, fallbackList]);

  const fetchFresh = useCallback(
    async (nextKey?: string): Promise<T | null> => {
      if (!nextKey) {
        setEntity(null);
        return null;
      }
      setLoading(true);
      const res = await api
        .get<T>(`${endpointPrefix}/${encodeURIComponent(nextKey)}`)
        .catch(() => fallbackList.find((x) => matchItem(x, nextKey)) ?? null);
      setLoading(false);
      setEntity(res);
      return res;
    },
    [endpointPrefix, fallbackList, matchItem],
  );

  return { entity, loading, fetchFresh, clearEntity: () => setEntity(null) };
}
