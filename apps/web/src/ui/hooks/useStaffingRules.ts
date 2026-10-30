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
  kind: 'SURPLUS' | 'SHORTAGE' | 'OK';
  color: 'red' | 'volcano' | 'green';
  branchCode: string;
  label: string;
  tooltip: string;
}

export interface SurplusBranchAlertItem {
  key: string;
  workDate: string;
  shiftCode: string;
  shiftLabel: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  count: number;
  approvedCount: number;
  draftCount: number;
  minStaff: number;
  maxStaff: number;
  surplusDiff: number;
}

export function resolveApplicableBranchRule(
  rules: StaffingRuleItem[],
  branchId: string,
  shiftCode: string,
  branchCode?: string,
): StaffingRuleItem | null {
  if (!branchId || branchId === 'ALL') return null;
  const bUpper = branchId.trim().toUpperCase();
  const cUpper = (branchCode || '').trim().toUpperCase();
  const sUpper = (shiftCode || '').trim().toUpperCase();
  let best: StaffingRuleItem | null = null;
  let bestScore = 0;

  for (const r of rules) {
    const rb = (r.branchId || r.branch_id || 'ALL').trim();
    const rc = (r.branchCode || '').trim().toUpperCase();
    const rawB = (r.branch_id || '').trim().toUpperCase();
    const isGlobalBranch = !rb || rb.toUpperCase() === 'ALL';
    const isExactBranch = !isGlobalBranch && (
      rb.toUpperCase() === bUpper || rawB === bUpper || rc === bUpper ||
      Boolean(cUpper && (rb.toUpperCase() === cUpper || rawB === cUpper || rc === cUpper))
    );
    if (!isExactBranch && !isGlobalBranch) continue;

    const rs = (r.shiftCode || r.shift_template_id || 'ALL').trim().toUpperCase();
    const rawS = (r.shift_template_id || '').trim().toUpperCase();
    const isGlobalShift = !rs || rs === 'ALL' || rawS === 'ALL';
    const isExactShift = !isGlobalShift && Boolean(sUpper && (rs === sUpper || rawS === sUpper));
    if (!isExactShift && !isGlobalShift) continue;

    const score = (isExactBranch ? 2 : 0) + (isExactShift ? 1 : 0) + 1;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function computePerBranchStaffingBadges(params: {
  cellItems: ScheduleAssignmentItem[];
  rules: StaffingRuleItem[];
  branchCodeById: Map<string, string>;
  selectedBranchId?: string;
  shiftCode: string;
  shiftShortLabel?: string;
  suppressShortage?: boolean;
}): BranchStaffingWarningBadge[] {
  const { cellItems, rules, branchCodeById, selectedBranchId = 'ALL', shiftCode, shiftShortLabel, suppressShortage = false } = params;
  const workItems = cellItems.filter((a) => a.dayType !== 'OFF' && a.status !== 'ON_LEAVE');
  if (workItems.length === 0 || rules.length === 0) return [];

  const grouped = new Map<string, { branchName: string; count: number; approvedCount: number; draftCount: number }>();
  for (const item of workItems) {
    const bId = item.branchId;
    if (!bId || (selectedBranchId !== 'ALL' && bId !== selectedBranchId)) continue;
    const cur = grouped.get(bId) ?? { branchName: item.branchName, count: 0, approvedCount: 0, draftCount: 0 };
    cur.count += 1;
    if (item.status === 'DRAFT') cur.draftCount += 1;
    else cur.approvedCount += 1;
    grouped.set(bId, cur);
  }

  const badges: BranchStaffingWarningBadge[] = [];
  const showPrefix = selectedBranchId === 'ALL';

  for (const [bId, info] of grouped.entries()) {
    const knownCode = branchCodeById.get(bId);
    const rule = resolveApplicableBranchRule(rules, bId, shiftCode, knownCode);
    if (!rule) continue;
    const minStaff = Number(rule.min_staff), maxStaff = Number(rule.max_staff);
    const bCode = knownCode || (rule.branchCode && rule.branchCode !== 'ALL' ? rule.branchCode : info.branchName);
    const prefix = shiftShortLabel
      ? `${showPrefix ? `${bCode} · ` : ''}${shiftShortLabel}: `
      : `${showPrefix ? `${bCode}: ` : ''}`;
    const rangeText = minStaff === maxStaff ? `${maxStaff}` : `${minStaff}–${maxStaff}`;
    const detail = info.draftCount > 0 ? ` (${info.approvedCount} đã duyệt, ${info.draftCount} chờ duyệt)` : '';

    if (info.count > maxStaff) {
      const diff = info.count - maxStaff;
      badges.push({
        key: `${bId}-${shiftCode}-surplus`, kind: 'SURPLUS', color: 'red', branchCode: bCode,
        label: `${prefix}Dư +${diff} (${info.count}/${rangeText})`,
        tooltip: `${info.branchName}: Hiện có ${info.count} nhân sự${detail}, vượt định biên tối đa ${maxStaff} người — Dư +${diff} nhân sự (định biên ${rangeText}).`,
      });
    } else if (info.count < minStaff && !suppressShortage) {
      const diff = minStaff - info.count;
      badges.push({
        key: `${bId}-${shiftCode}-short`, kind: 'SHORTAGE', color: 'volcano', branchCode: bCode,
        label: `${prefix}Thiếu ${diff} (${info.count}/${rangeText})`,
        tooltip: `${info.branchName}: Hiện có ${info.count} nhân sự${detail}, tối thiểu cần ${minStaff} nhân sự (định biên ${rangeText}).`,
      });
    } else if (!showPrefix && !shiftShortLabel) {
      badges.push({
        key: `${bId}-${shiftCode}-ok`, kind: 'OK', color: 'green', branchCode: bCode,
        label: `Đủ (${info.count}/${rangeText})`,
        tooltip: `${info.branchName}: Đạt định biên (${info.count}/${rangeText} nhân sự).`,
      });
    }
  }
  const rank = { SURPLUS: 0, SHORTAGE: 1, OK: 2 } as const;
  return badges.sort((a, b) => rank[a.kind] - rank[b.kind] || a.branchCode.localeCompare(b.branchCode));
}

export function collectSurplusBranchAlerts(params: {
  assignments: ScheduleAssignmentItem[];
  rules: StaffingRuleItem[];
  branchCodeById: Map<string, string>;
  selectedBranchId?: string;
}): SurplusBranchAlertItem[] {
  const { assignments, rules, branchCodeById, selectedBranchId = 'ALL' } = params;
  if (assignments.length === 0 || rules.length === 0) return [];
  const buckets = new Map<string, { workDate: string; shiftCode: string; shiftLabel: string; branchId: string; branchName: string; count: number; approvedCount: number; draftCount: number }>();
  for (const a of assignments) {
    if (a.dayType === 'OFF' || a.status === 'ON_LEAVE' || !a.branchId) continue;
    if (selectedBranchId !== 'ALL' && a.branchId !== selectedBranchId) continue;
    const k = `${a.workDate}__${a.shiftCode}__${a.branchId}`;
    const cur = buckets.get(k) ?? { workDate: a.workDate, shiftCode: a.shiftCode, shiftLabel: a.shiftLabel, branchId: a.branchId, branchName: a.branchName, count: 0, approvedCount: 0, draftCount: 0 };
    cur.count += 1;
    if (a.status === 'DRAFT') cur.draftCount += 1; else cur.approvedCount += 1;
    buckets.set(k, cur);
  }
  const alerts: SurplusBranchAlertItem[] = [];
  for (const [key, b] of buckets.entries()) {
    const knownCode = branchCodeById.get(b.branchId);
    const rule = resolveApplicableBranchRule(rules, b.branchId, b.shiftCode, knownCode);
    if (!rule) continue;
    const minStaff = Number(rule.min_staff), maxStaff = Number(rule.max_staff);
    if (b.count > maxStaff) {
      const branchCode = knownCode || (rule.branchCode && rule.branchCode !== 'ALL' ? rule.branchCode : b.branchName);
      alerts.push({ key, ...b, branchCode, minStaff, maxStaff, surplusDiff: b.count - maxStaff });
    }
  }
  return alerts.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.branchCode.localeCompare(b.branchCode) || a.shiftCode.localeCompare(b.shiftCode));
}

export function evaluateBranchShiftSurplusPreview(params: {
  assignments: ScheduleAssignmentItem[];
  rules: StaffingRuleItem[];
  branchCodeById: Map<string, string>;
  branchId?: string;
  branchName?: string;
  workDate?: string;
  shiftCode?: string;
  editingId?: string;
  isOff?: boolean;
}) {
  const { assignments, rules, branchCodeById, branchId, branchName, workDate, shiftCode, editingId, isOff = false } = params;
  if (!branchId || branchId === 'ALL' || !workDate || !shiftCode || isOff || rules.length === 0) return null;
  const knownCode = branchCodeById.get(branchId);
  const rule = resolveApplicableBranchRule(rules, branchId, shiftCode, knownCode);
  if (!rule) return null;
  const minStaff = Number(rule.min_staff), maxStaff = Number(rule.max_staff);
  const sameSlot = assignments.filter((a) => a.branchId === branchId && a.workDate === workDate && a.shiftCode === shiftCode && a.dayType !== 'OFF' && a.status !== 'ON_LEAVE');
  const othersCount = sameSlot.filter((a) => a.id !== editingId).length;
  const projectedCount = othersCount + 1;
  if (projectedCount <= maxStaff) return null;
  const bCode = knownCode || (rule.branchCode && rule.branchCode !== 'ALL' ? rule.branchCode : '');
  const branchLabel = branchName ? (bCode && !branchName.includes(bCode) ? `${bCode} — ${branchName}` : branchName) : (bCode || 'Chi nhánh');
  return { branchLabel, currentCount: sameSlot.length, projectedCount, minStaff, maxStaff, surplusDiff: projectedCount - maxStaff, isNew: !editingId };
}

export function useStaffingRules(enabled = true) {
  const rulesQ = useQuery({ queryKey: ['staffing-rules', 'schedule-matrix'], queryFn: () => api.get<StaffingRuleItem[]>('/admin/staffing-rules'), enabled, retry: false });
  const branchesQ = useQuery({ queryKey: ['branches', 'select'], queryFn: () => api.list<{ id: string; code: string; name: string }>('/admin/branches?per_page=50'), enabled });
  const branchCodeById = new Map((branchesQ.data?.data ?? []).map((b) => [b.id, b.code]));
  const branchNameById = new Map((branchesQ.data?.data ?? []).map((b) => [b.id, `${b.code} — ${b.name}`]));
  return { rules: rulesQ.data ?? [], branchCodeById, branchNameById };
}
