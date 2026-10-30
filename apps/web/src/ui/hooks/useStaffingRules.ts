'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScheduleAssignmentItem } from '../components/ScheduleFormModal';

export interface StaffingRuleItem {
  id: string;
  branch_id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  shift_template_id: string;
  shiftCode?: string;
  min_staff: number;
  max_staff: number;
}

export interface BranchStaffingWarningBadge {
  key: string;
  color: 'volcano' | 'purple' | 'green';
  label: string;
  tooltip: string;
}

export function resolveApplicableBranchRule(
  rules: StaffingRuleItem[],
  branchId: string,
  shiftCode: string,
): StaffingRuleItem | null {
  if (!branchId || branchId === 'ALL') return null;
  let best: StaffingRuleItem | null = null;
  let bestScore = 0;

  for (const r of rules) {
    const rBranch = r.branchId || r.branch_id || 'ALL';
    const isGlobalBranch = rBranch === 'ALL';
    const isExactBranch = !isGlobalBranch && (rBranch === branchId || r.branch_id === branchId || r.branchCode === branchId);
    if (!isExactBranch && !isGlobalBranch) continue;

    const rShift = r.shiftCode || r.shift_template_id || 'ALL';
    const isGlobalShift = rShift === 'ALL' || r.shift_template_id === 'ALL';
    const isExactShift = !isGlobalShift && (rShift === shiftCode || r.shift_template_id === shiftCode);
    if (!isExactShift && !isGlobalShift) continue;

    const score = (isExactBranch ? 2 : 0) + (isExactShift ? 1 : 0) + 1;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function computePerBranchStaffingBadges(params: {
  cellItems: ScheduleAssignmentItem[];
  rules: StaffingRuleItem[];
  branchCodeById: Map<string, string>;
  selectedBranchId?: string;
  shiftCode: string;
}): BranchStaffingWarningBadge[] {
  const { cellItems, rules, branchCodeById, selectedBranchId = 'ALL', shiftCode } = params;
  const workItems = cellItems.filter((a) => a.dayType !== 'OFF' && a.status !== 'ON_LEAVE');
  if (workItems.length === 0 || rules.length === 0) return [];

  const grouped = new Map<string, { branchName: string; count: number }>();
  for (const item of workItems) {
    const bId = item.branchId;
    if (!bId) continue;
    if (selectedBranchId !== 'ALL' && bId !== selectedBranchId) continue;
    const cur = grouped.get(bId) ?? { branchName: item.branchName, count: 0 };
    cur.count += 1;
    grouped.set(bId, cur);
  }

  const badges: BranchStaffingWarningBadge[] = [];
  const showPrefix = selectedBranchId === 'ALL';

  for (const [bId, info] of grouped.entries()) {
    const rule = resolveApplicableBranchRule(rules, bId, shiftCode);
    if (!rule) continue;
    const bCode = branchCodeById.get(bId) || (rule.branchCode && rule.branchCode !== 'ALL' ? rule.branchCode : info.branchName);
    const prefix = showPrefix ? `${bCode}: ` : '';
    const rangeText = rule.min_staff === rule.max_staff ? `${rule.max_staff}` : `${rule.min_staff}–${rule.max_staff}`;

    if (info.count < rule.min_staff) {
      const diff = rule.min_staff - info.count;
      badges.push({
        key: `${bId}-short`,
        color: 'volcano',
        label: `${prefix}Thiếu ${diff} (${info.count}/${rangeText})`,
        tooltip: `${info.branchName}: Hiện có ${info.count} nhân sự, tối thiểu cần ${rule.min_staff} nhân sự (định biên ${rangeText}).`,
      });
    } else if (info.count > rule.max_staff) {
      const diff = info.count - rule.max_staff;
      badges.push({
        key: `${bId}-surplus`,
        color: 'purple',
        label: `${prefix}Dư +${diff} (${info.count}/${rule.max_staff})`,
        tooltip: `${info.branchName}: Hiện có ${info.count} nhân sự, vượt tối đa ${rule.max_staff} nhân sự (định biên ${rangeText}).`,
      });
    } else if (!showPrefix) {
      badges.push({
        key: `${bId}-ok`,
        color: 'green',
        label: `Đủ (${info.count}/${rangeText})`,
        tooltip: `${info.branchName}: Đạt định biên (${info.count}/${rangeText} nhân sự).`,
      });
    }
  }
  return badges;
}

export function useStaffingRules(enabled = true) {
  const rulesQ = useQuery({
    queryKey: ['staffing-rules', 'schedule-matrix'],
    queryFn: () => api.get<StaffingRuleItem[]>('/admin/staffing-rules'),
    enabled,
    retry: false,
  });
  const branchesQ = useQuery({
    queryKey: ['branches', 'select'],
    queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'),
    enabled,
  });
  const branchCodeById = new Map((branchesQ.data?.data ?? []).map((b) => [b.id, b.code]));
  return { rules: rulesQ.data ?? [], branchCodeById };
}
