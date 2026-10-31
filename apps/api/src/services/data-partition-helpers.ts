import type { ZodType, ZodTypeDef } from 'zod';
import { addDaysYmd, mondayOfWeek, type ShiftAssignment } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { nowIso } from '../lib/time.js';
import { TableStore, type BaseRecord } from '../sheets/table-store.js';
import { probationLockCode, weekLockCode } from './schedule-rules.js';

export type AnyRecord = BaseRecord & Record<string, unknown>;
export type AnyStore = TableStore<AnyRecord>;
export type MonthlyStoreDesc = ReturnType<Database['monthlyStores']>[number];

const partitionLocks = new WeakMap<Database, Promise<void>>();

/** Tuần tự hóa mọi thao tác chuyển đổi hoặc tạo mới tệp dữ liệu tháng để tránh tranh chấp ghi/đọc song song. */
export async function runPartitionExclusive<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  const prev = partitionLocks.get(db) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  partitionLocks.set(db, prev.then(() => gate, () => gate));
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function isMissingSpreadsheetError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  const code = Number((err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status ?? 0);
  return code === 404 || /not found|requested entity was not found|deleted|trashed|không tồn tại/i.test(msg);
}

/**
 * Ghi trước toàn bộ các dòng chuyển tiếp sang tệp Google Sheets tháng mới (giữ nguyên `id` khóa ngoại)
 * thông qua TableStore tạm độc lập trước khi chạm vào dữ liệu trên tệp cũ hay bộ nhớ đang phục vụ đọc.
 */
export async function stageCarryRowsToTarget(
  db: Database,
  desc: MonthlyStoreDesc,
  target: { spreadsheetId: string; tab: string },
  rowsToCarry: AnyRecord[],
  actorId: string,
): Promise<number> {
  const stageStore = new TableStore<AnyRecord>(db.gateway, db.queue, {
    spreadsheetKey: 'MONTHLY',
    spreadsheetId: target.spreadsheetId,
    tab: target.tab,
    headers: desc.headers,
    schema: desc.schema as unknown as ZodType<AnyRecord, ZodTypeDef, unknown>,
  });
  await stageStore.switchTarget(target);
  if (rowsToCarry.length === 0) return 0;

  const existingById = new Map(stageStore.all(true).map((r) => [r.id, r]));
  let count = 0;
  const ops: Promise<unknown>[] = [];
  for (const r of rowsToCarry) {
    const found = existingById.get(r.id);
    if (!found) {
      const { version: _v, is_deleted: _d, created_by: _cb, updated_by: _ub, ...rest } = r;
      ops.push(stageStore.insert(rest as never, actorId));
      count++;
    } else if (found.is_deleted) {
      ops.push(stageStore.restore(found.id, found.version, actorId));
      count++;
    }
  }
  await Promise.all(ops);
  await db.queue.enqueue(target.spreadsheetId, async () => undefined);
  return count;
}

/**
 * Khi chuyển tiếp các ca làm việc của tuần/chu kỳ đã chốt từ kỳ cũ sang tệp tháng mới,
 * đồng bộ khóa chốt lịch gắn theo mã phân vùng mới để trạng thái Đã chốt lịch không bị mất.
 */
export async function carryScheduleLocksToMonth(
  db: Database,
  oldMonth: string,
  newMonth: string,
  carriedShifts: ShiftAssignment[],
  actorId: string,
): Promise<void> {
  if (!newMonth || carriedShifts.length === 0) return;
  const now = nowIso();
  const seenWeekPairs = new Set<string>();

  for (const s of carriedShifts) {
    if (s.status === 'DRAFT' || s.day_type === 'OFF') continue;
    const emp = db.employees.get(s.employee_id) ?? db.employees.find((e) => e.employee_code === s.employee_id);
    const branchId = emp?.branch_id || s.branch_id;
    const weekStart = mondayOfWeek(s.work_date);
    const pairKey = `${branchId}::${weekStart}`;
    if (branchId && !seenWeekPairs.has(pairKey)) {
      seenWeekPairs.add(pairKey);
      const oldCodes = new Set([
        weekLockCode(branchId, weekStart, oldMonth),
        weekLockCode('ALL', weekStart, oldMonth),
        weekLockCode(branchId, weekStart, ''),
        weekLockCode('ALL', weekStart, ''),
      ]);
      const srcLock = db.scheduleWeeks.find((w) => oldCodes.has(w.code) && w.status === 'PUBLISHED');
      if (srcLock) {
        const nextCode = weekLockCode(branchId, weekStart, newMonth);
        if (!db.scheduleWeeks.find((w) => w.code === nextCode && w.status === 'PUBLISHED')) {
          const ex = db.scheduleWeeks.find((w) => w.code === nextCode);
          const rec = {
            branch_id: branchId, week_start: weekStart, week_end: addDaysYmd(weekStart, 6),
            status: 'PUBLISHED' as const, published_by: srcLock.published_by || actorId,
            published_at: srcLock.published_at || now, code: nextCode, schedule_kind: 'WEEKLY' as const,
            store_confirmed_by: srcLock.store_confirmed_by, store_confirmed_at: srcLock.store_confirmed_at,
            locked_at: srcLock.locked_at || now, note: srcLock.note || `Chuyển tiếp lịch tuần đã chốt sang ${newMonth}`,
          };
          if (ex) await db.scheduleWeeks.update(ex.id, ex.version, rec, actorId);
          else await db.scheduleWeeks.insert(rec, actorId);
        }
      }
    }

    if (emp && s.schedule_week_id.startsWith('PB')) {
      const srcPb = db.scheduleWeeks.find((w) => w.code === s.schedule_week_id && w.status === 'PUBLISHED');
      if (srcPb) {
        const nextPbCode = probationLockCode(emp.employee_code, srcPb.week_start, newMonth);
        if (!db.scheduleWeeks.find((w) => w.code === nextPbCode && w.status === 'PUBLISHED')) {
          const exPb = db.scheduleWeeks.find((w) => w.code === nextPbCode);
          const recPb = { ...srcPb, code: nextPbCode, branch_id: emp.branch_id };
          const { id: _i, version: _v, is_deleted: _d, created_at: _ca, created_by: _cb, updated_at: _ua, updated_by: _ub, ...cleanPb } = recPb;
          if (exPb) await db.scheduleWeeks.update(exPb.id, exPb.version, cleanPb, actorId);
          else await db.scheduleWeeks.insert(cleanPb, actorId);
        }
      }
    }
  }
}
