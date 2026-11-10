import {
  PARTITION_MONTH_REGEX,
  SPREADSHEETS,
  partitionTabName,
  zShiftAssignment,
  type ShiftAssignment,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import type { Database } from '../data/database.js';
import { dayjs } from '../lib/time.js';
import { parseSheetRows } from '../sheets/table-store-codec.js';
import { readPartitionRegistry } from './data-partition.service.js';

interface CachedPartitionShifts {
  loadedAtMs: number;
  rows: ShiftAssignment[];
}

interface CachedTabList {
  loadedAtMs: number;
  tabs: Set<string>;
}

const CACHE_TTL_MS = 60_000;
const partitionShiftsCache = new WeakMap<Database, Map<string, CachedPartitionShifts>>();
const scheduleTabsCache = new WeakMap<Database, CachedTabList>();

/** Xóa bộ nhớ đệm lịch sử ca liên phân vùng ngay khi chuyển tháng / tạo sheet tháng mới. */
export function invalidateHistoricalShiftsCache(db: Database): void {
  partitionShiftsCache.delete(db);
  scheduleTabsCache.delete(db);
}

/** Liệt kê toàn bộ mã tháng YYYY_MM giao với khoảng ngày [fromDate, toDate]. */
export function listMonthKeysInRange(fromDate: string, toDate: string): string[] {
  if (!fromDate || !toDate || fromDate > toDate) return [];
  const start = dayjs(`${fromDate.slice(0, 7)}-01`);
  const end = dayjs(`${toDate.slice(0, 7)}-01`);
  if (!start.isValid() || !end.isValid()) return [];
  const keys: string[] = [];
  let cur = start;
  while (cur.isBefore(end) || cur.isSame(end, 'month')) {
    keys.push(cur.format('YYYY_MM'));
    cur = cur.add(1, 'month');
  }
  return keys;
}

async function getScheduleRootTabs(db: Database, forceRefresh = false): Promise<Set<string>> {
  const now = Date.now();
  const cached = scheduleTabsCache.get(db);
  if (!forceRefresh && cached && now - cached.loadedAtMs < CACHE_TTL_MS) return cached.tabs;
  const list = await db.gateway.listTabs(db.ids.SCHEDULE).catch(() => [] as string[]);
  const tabs = new Set(list);
  scheduleTabsCache.set(db, { loadedAtMs: now, tabs });
  return tabs;
}

async function readHistoricalShiftTarget(
  db: Database,
  target: { spreadsheetId: string; tab: string },
  forceRefresh = false,
): Promise<ShiftAssignment[]> {
  let dbCache = partitionShiftsCache.get(db);
  if (!dbCache) {
    dbCache = new Map();
    partitionShiftsCache.set(db, dbCache);
  }
  const key = `${target.spreadsheetId}::${target.tab}`;
  const now = Date.now();
  const hit = dbCache.get(key);
  if (!forceRefresh && hit && now - hit.loadedAtMs < CACHE_TTL_MS) return hit.rows;

  const rawRows = await db.gateway.readTab(target.spreadsheetId, target.tab).catch(() => [] as string[][]);
  const headers = SPREADSHEETS.SCHEDULE.tabs.SHIFT_ASSIGNMENTS;
  const parsed = rawRows.length > 1 ? parseSheetRows(headers, zShiftAssignment, rawRows) : { entries: new Map() };
  const rows: ShiftAssignment[] = [];
  for (const entry of parsed.entries.values()) {
    if (!entry.data.is_deleted) rows.push(entry.data);
  }
  dbCache.set(key, { loadedAtMs: now, rows });
  return rows;
}

function canonicalEmpId(ctx: AppContext, empIdOrCode: string): string {
  const emp = ctx.db.employees.get(empIdOrCode) ?? ctx.db.employees.find((e) => e.employee_code === empIdOrCode);
  return emp?.id ?? empIdOrCode;
}

/**
 * Đọc gộp ca làm việc xuyên các tệp Google Sheets phân vùng theo tháng trong khoảng [fromDate, toDate].
 * Nếu tháng nào đã có tệp riêng trong DATA_PARTITIONS_REGISTRY thì chỉ lấy dữ liệu của tháng đó từ tệp riêng,
 * tuyệt đối không lấy dữ liệu mẫu trùng tháng từ Tệp gốc.
 */
export async function loadShiftsAcrossPartitions(
  ctx: AppContext,
  fromDate: string,
  toDate: string,
  opts?: { forceRefresh?: boolean },
): Promise<ShiftAssignment[]> {
  const { db } = ctx;
  const force = Boolean(opts?.forceRefresh);
  const activeKey = `${db.shiftAssignments.spreadsheetId}::${db.shiftAssignments.tab}`;
  const registry = readPartitionRegistry(db);
  if (registry.length === 0 && db.partitionMonth === '') {
    return db.shiftAssignments.all().filter((a) => a.work_date >= fromDate && a.work_date <= toDate);
  }
  const monthKeys = listMonthKeysInRange(fromDate, toDate);
  const regMap = new Map(registry.map((r) => [r.monthKey, r]));
  const targets = new Map<string, { spreadsheetId: string; tab: string; filterUncoveredMonthsOnly?: boolean }>();
  const addTarget = (spreadsheetId: string, tab: string, filterUncoveredMonthsOnly = false) => {
    const k = `${spreadsheetId}::${tab}`;
    if (spreadsheetId && tab && k !== activeKey) targets.set(k, { spreadsheetId, tab, filterUncoveredMonthsOnly });
  };

  let rootTabs: Set<string> | null = null;
  let hasUncoveredMonth = false;
  for (const mk of monthKeys) {
    if (!PARTITION_MONTH_REGEX.test(mk) || mk === db.partitionMonth) continue;
    const reg = regMap.get(mk);
    if (reg?.mode === 'MONTHLY_FILE') {
      addTarget(reg.spreadsheetId, 'SHIFT_ASSIGNMENTS');
    } else if (reg?.mode === 'LEGACY_TAB') {
      addTarget(db.ids.SCHEDULE, partitionTabName('SHIFT_ASSIGNMENTS', mk));
    } else {
      rootTabs = rootTabs ?? (await getScheduleRootTabs(db, force));
      const legacyTab = partitionTabName('SHIFT_ASSIGNMENTS', mk);
      if (rootTabs.has(legacyTab)) addTarget(db.ids.SCHEDULE, legacyTab);
      else hasUncoveredMonth = true;
    }
  }
  if (db.partitionMonth !== '' && hasUncoveredMonth) {
    addTarget(db.ids.SCHEDULE, 'SHIFT_ASSIGNMENTS', true);
  }

  const activeAll = db.shiftAssignments.all(true);
  const seenIds = new Set<string>(activeAll.map((a) => a.id));
  const seenSemantic = new Set<string>();
  const merged: ShiftAssignment[] = [];

  for (const a of db.shiftAssignments.all()) {
    if (a.work_date < fromDate || a.work_date > toDate) continue;
    merged.push(a);
    seenSemantic.add(`${canonicalEmpId(ctx, a.employee_id)}|${a.work_date}|${a.shift_code.toUpperCase()}`);
  }

  if (targets.size === 0) return merged;

  const targetEntries = Array.from(targets.values());
  const extraBatches = await Promise.all(targetEntries.map((t) => readHistoricalShiftTarget(db, t, force)));
  for (let i = 0; i < extraBatches.length; i++) {
    const batch = extraBatches[i]!;
    const targetInfo = targetEntries[i]!;
    for (const row of batch) {
      if (row.work_date < fromDate || row.work_date > toDate) continue;
      if (targetInfo.filterUncoveredMonthsOnly) {
        const rowMonth = `${row.work_date.slice(0, 4)}_${row.work_date.slice(5, 7)}`;
        if (regMap.has(rowMonth)) continue;
      }
      if (seenIds.has(row.id)) continue;
      const semKey = `${canonicalEmpId(ctx, row.employee_id)}|${row.work_date}|${row.shift_code.toUpperCase()}`;
      if (seenSemantic.has(semKey)) continue;
      seenIds.add(row.id);
      seenSemantic.add(semKey);
      merged.push(row);
    }
  }
  return merged;
}
