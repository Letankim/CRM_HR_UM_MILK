'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { DEFAULT_SHIFT_OPTIONS } from '@umbm/shared';
import { api } from '@/lib/api';
import type { ShiftTemplateItem } from '../components/ShiftTemplatesCard';

export interface ShiftSelectOption {
  value: string;
  label: string;
  name: string;
  startTime: string;
  endTime: string;
  standardHours: number;
  branchId: string;
}

const FALLBACK_SHIFTS: ShiftSelectOption[] = DEFAULT_SHIFT_OPTIONS.map((o) => {
  const m = o.label.match(/^(.+?)\s*\((\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\)/);
  const name = m?.[1]?.trim() || o.label;
  const startTime = m?.[2] || '07:00';
  const endTime = m?.[3] || '12:00';
  return {
    value: o.value,
    label: `${name} (${startTime} – ${endTime})`,
    name,
    startTime,
    endTime,
    standardHours: String(o.value).includes('HANH_CHINH') ? 8 : 5,
    branchId: 'ALL',
  };
});

/**
 * Hook tải động Danh mục Khung ca mẫu từ `/api/admin/shift-templates`
 * và lọc tự động theo Chi nhánh (`branchId`) đang chọn.
 */
export function useShiftTemplates(branchId?: string, enabled = true) {
  const q = useQuery({
    queryKey: ['shift-templates'],
    queryFn: () => api.get<ShiftTemplateItem[]>('/admin/shift-templates'),
    enabled,
    staleTime: 30_000,
  });

  const activeAll = useMemo(
    () => (q.data ?? []).filter((s) => !s.status || s.status === 'ACTIVE'),
    [q.data],
  );

  const shifts = useMemo(() => {
    const targetBranch = branchId && branchId !== 'ALL' ? branchId : null;
    const candidates = activeAll.filter((s) => {
      if (!targetBranch) return true;
      const bId = s.branchId ?? 'ALL';
      return bId === 'ALL' || bId === targetBranch || s.branchCode === targetBranch;
    });

    // Nếu cùng mã ca vừa có cấu hình riêng cho chi nhánh vừa có cấu hình ALL, ưu tiên bản ghi của chi nhánh
    const byCode = new Map<string, ShiftTemplateItem>();
    for (const s of candidates) {
      const existing = byCode.get(s.code);
      if (!existing || (targetBranch && s.branchId === targetBranch)) {
        byCode.set(s.code, s);
      }
    }
    return Array.from(byCode.values());
  }, [activeAll, branchId]);

  const options: ShiftSelectOption[] = useMemo(() => {
    if (shifts.length === 0) return FALLBACK_SHIFTS;
    return shifts.map((s) => ({
      value: s.code,
      label: `${s.name} (${s.startTime} – ${s.endTime})`,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      standardHours: Number(s.standardHours) || 5,
      branchId: s.branchId ?? 'ALL',
    }));
  }, [shifts]);

  const endTimeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of options) map[o.value] = o.endTime;
    return map;
  }, [options]);

  const hoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of options) map[o.value] = o.standardHours;
    return map;
  }, [options]);

  return {
    allShifts: activeAll,
    shifts,
    options,
    endTimeMap,
    hoursMap,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
  };
}
