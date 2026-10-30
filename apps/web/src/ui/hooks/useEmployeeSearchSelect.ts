'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useDebouncedValue } from './useDebouncedValue';

export interface EmployeeSelectOption {
  value: string;
  label: string;
  branchId?: string;
  branchName?: string;
  employeeCode?: string;
}

interface EmployeeApiRow {
  id: string;
  employeeCode: string;
  fullName: string;
  branchId: string;
  branchName: string;
  status?: string;
}

function foldVi(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function useEmployeeSearchSelect(params?: {
  initialOptions?: EmployeeSelectOption[];
  branchId?: string;
  status?: 'ACTIVE' | 'ALL';
  enabled?: boolean;
}) {
  const initialOptions = params?.initialOptions ?? [];
  const branchId = params?.branchId;
  const status = params?.status ?? 'ACTIVE';
  const enabled = params?.enabled ?? true;

  const [searchText, setSearchText] = useState('');
  const debouncedQ = useDebouncedValue(searchText, 400);
  const cacheRef = useRef<Map<string, EmployeeSelectOption>>(new Map());

  useEffect(() => {
    for (const opt of initialOptions) {
      if (opt.value) cacheRef.current.set(opt.value, opt);
    }
  }, [initialOptions]);

  const queryUrl = useMemo(() => {
    const sp = new URLSearchParams({ per_page: '200' });
    if (status !== 'ALL') sp.set('status', status);
    if (branchId && branchId !== 'ALL') sp.set('branch_id', branchId);
    if (debouncedQ.trim()) sp.set('q', debouncedQ.trim());
    return `/admin/employees?${sp.toString()}`;
  }, [branchId, status, debouncedQ]);

  const empQ = useQuery({
    queryKey: ['employees-search-select', status, branchId ?? 'ALL', debouncedQ.trim()],
    queryFn: () => api.list<EmployeeApiRow>(queryUrl),
    enabled,
  });

  const options = useMemo(() => {
    const merged = new Map<string, EmployeeSelectOption>();
    for (const row of empQ.data?.data ?? []) {
      const opt: EmployeeSelectOption = {
        value: row.id,
        label: `${row.employeeCode} — ${row.fullName}${row.branchName ? ` (${row.branchName})` : ''}`,
        branchId: row.branchId,
        branchName: row.branchName,
        employeeCode: row.employeeCode,
      };
      cacheRef.current.set(opt.value, opt);
      merged.set(opt.value, opt);
    }
    for (const opt of initialOptions) {
      if (opt.value && !merged.has(opt.value)) {
        if (!branchId || branchId === 'ALL' || !opt.branchId || opt.branchId === branchId) {
          merged.set(opt.value, opt);
        }
      }
    }
    for (const [k, opt] of cacheRef.current.entries()) {
      if (!merged.has(k) && (!branchId || branchId === 'ALL' || !opt.branchId || opt.branchId === branchId)) {
        merged.set(k, opt);
      }
    }
    return Array.from(merged.values());
  }, [empQ.data, initialOptions, branchId]);

  const filterOption = useCallback((input: string, option?: { label?: unknown; value?: unknown }) => {
    const kw = foldVi(String(input || '').trim());
    if (!kw) return true;
    const lbl = foldVi(String(option?.label ?? ''));
    return lbl.includes(kw);
  }, []);

  const onDropdownVisibleChange = useCallback((open: boolean) => {
    if (!open) setSearchText('');
  }, []);

  return {
    options,
    loading: empQ.isFetching,
    onSearch: setSearchText,
    filterOption,
    onDropdownVisibleChange,
  };
}
