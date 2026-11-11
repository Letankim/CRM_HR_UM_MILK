import type pg from 'pg';
import type { SheetsGateway } from '../sheets/gateway.js';
import { resolvePgTableDescriptor } from './pg-table-registry.js';

interface OutboxRow {
  seq_id: string | number;
  spreadsheet_id: string;
  tab_name: string;
  op_type: 'ENSURE_TAB' | 'APPEND_ROWS' | 'UPDATE_ROW' | 'BATCH_UPDATE_ROWS';
  row_index: number | null;
  record_id: string | null;
  payload_json: {
    headers?: string[];
    firstRow?: number;
    rows?: string[][];
    row?: number;
    values?: string[];
    items?: { row: number; values: string[]; recordId?: string }[];
  };
  attempts: number;
}

export interface OutboxStats {
  pending: number;
  failed: number;
  syncedTotal: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/**
 * Tiến trình nền đẩy dữ liệu từ hàng đợi `umbm_sheet_outbox` (PostgreSQL) lên Google Sheets:
 * - Gom nhóm (Coalesce) nhiều lệnh sửa trùng dòng thành 1 lần gọi `batchUpdateRows`.
 * - Gộp nhiều lệnh thêm mới liên tiếp cùng tab thành 1 lần gọi `appendRows`.
 * - Đánh dấu `_synced_to_remote = TRUE` trực tiếp trên bảng vật lý tương ứng (`core_users`, `hr_employees`, ...).
 */
export class PostgresOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private flushingPromise: Promise<number> | null = null;
  private syncedTotal = 0;
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly remote: SheetsGateway,
    private readonly isPgOnline: () => boolean,
    private readonly intervalMs = 1500,
  ) {}

  start(): void {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.isPgOnline()) void this.flushBatch().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.wakeTimer) { clearTimeout(this.wakeTimer); this.wakeTimer = null; }
  }

  /** Đánh thức worker đẩy dữ liệu sau một khoảng gom ngắn (40ms) để gộp các thao tác liên tiếp. */
  wake(): void {
    if (this.stopped || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      if (!this.stopped && this.isPgOnline()) void this.flushBatch().catch(() => undefined);
    }, 40);
    this.wakeTimer.unref?.();
  }

  /** Đẩy toàn bộ hàng đợi đang chờ lên Google Sheets ngay lập tức. */
  async flushAll(): Promise<number> {
    if (!this.isPgOnline()) return 0;
    let total = 0;
    for (let round = 0; round < 50; round++) {
      const processed = await this.flushBatch();
      total += processed;
      if (processed === 0) break;
    }
    return total;
  }

  async flushBatch(): Promise<number> {
    if (this.flushingPromise) return this.flushingPromise;
    this.flushingPromise = this.doFlushBatch().finally(() => {
      this.flushingPromise = null;
    });
    return this.flushingPromise;
  }

  private async doFlushBatch(): Promise<number> {
    if (!this.isPgOnline()) return 0;
    const isMemRemote = this.remote.constructor.name === 'InMemorySheetsGateway';
    const filterSql = isMemRemote ? `AND spreadsheet_id LIKE 'mem%'` : `AND spreadsheet_id NOT LIKE 'mem%'`;
    const res = await this.pool.query<OutboxRow>(
      `SELECT seq_id, spreadsheet_id, tab_name, op_type, row_index, record_id, payload_json, attempts
       FROM umbm_sheet_outbox WHERE status = 'PENDING' AND attempts < 8 ${filterSql} ORDER BY seq_id ASC LIMIT 200`,
    );
    const items = res.rows;
    if (items.length === 0) return 0;

    let i = 0;
    const syncedIds: number[] = [];
    const failedTabs = new Set<string>();

    while (i < items.length) {
      const cur = items[i]!;
      const sid = cur.spreadsheet_id, tab = cur.tab_name, tabKey = `${sid}::${tab}`, desc = resolvePgTableDescriptor(tab);
      if (failedTabs.has(tabKey)) {
        i++;
        continue;
      }
      let batchSeqIds: number[] = [Number(cur.seq_id)];
      try {
        if (cur.op_type === 'ENSURE_TAB') {
          i++;
          await this.remote.ensureTab(sid, tab, cur.payload_json.headers ?? []);
          syncedIds.push(...batchSeqIds);
          continue;
        }
        if (cur.op_type === 'APPEND_ROWS') {
          const combinedRows: string[][] = [];
          batchSeqIds = [];
          while (i < items.length && items[i]!.op_type === 'APPEND_ROWS' && items[i]!.spreadsheet_id === sid && items[i]!.tab_name === tab && combinedRows.length < 200) {
            const item = items[i]!;
            for (const r of item.payload_json.rows ?? []) combinedRows.push(r);
            batchSeqIds.push(Number(item.seq_id));
            i++;
          }
          if (combinedRows.length > 0) {
            await this.remote.appendRows(sid, tab, combinedRows);
            const recordIds = combinedRows.map((r) => String(r[0] ?? '')).filter(Boolean);
            if (recordIds.length > 0) {
              await this.pool.query(
                `UPDATE public.${desc.pgTableName} SET _synced_to_remote = TRUE, _updated_at = NOW() WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND "id" = ANY($3::text[])`,
                [sid, tab, recordIds],
              );
            }
          }
          syncedIds.push(...batchSeqIds);
          continue;
        }
        if (cur.op_type === 'UPDATE_ROW' || cur.op_type === 'BATCH_UPDATE_ROWS') {
          const coalescedByRow = new Map<number, string[]>();
          batchSeqIds = [];
          while (i < items.length && (items[i]!.op_type === 'UPDATE_ROW' || items[i]!.op_type === 'BATCH_UPDATE_ROWS') && items[i]!.spreadsheet_id === sid && items[i]!.tab_name === tab) {
            const item = items[i]!;
            if (item.op_type === 'UPDATE_ROW' && item.payload_json.row && item.payload_json.values) {
              coalescedByRow.set(item.payload_json.row, item.payload_json.values);
            } else if (item.op_type === 'BATCH_UPDATE_ROWS' && Array.isArray(item.payload_json.items)) {
              for (const sub of item.payload_json.items) coalescedByRow.set(sub.row, sub.values);
            }
            batchSeqIds.push(Number(item.seq_id));
            i++;
          }
          const updateItems = Array.from(coalescedByRow.entries()).map(([row, values]) => ({ row, values }));
          if (updateItems.length > 0) {
            await this.remote.batchUpdateRows(sid, tab, updateItems);
            await this.pool.query(
              `UPDATE public.${desc.pgTableName} SET _synced_to_remote = TRUE, _updated_at = NOW() WHERE _spreadsheet_id = $1 AND _tab_name = $2 AND _row_index = ANY($3::int[])`,
              [sid, tab, updateItems.map((u) => u.row)],
            );
          }
          syncedIds.push(...batchSeqIds);
          continue;
        }
        i++;
        syncedIds.push(...batchSeqIds);
      } catch (err) {
        failedTabs.add(tabKey);
        const msg = (err as Error)?.message || String(err);
        this.lastError = msg;
        await this.pool.query(
          `UPDATE umbm_sheet_outbox SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts + 1 >= 8 THEN 'FAILED' ELSE 'PENDING' END WHERE seq_id = ANY($1::bigint[])`,
          [batchSeqIds, msg.slice(0, 1000)],
        );
      }
    }

    if (syncedIds.length > 0) {
      await this.pool.query(`DELETE FROM umbm_sheet_outbox WHERE seq_id = ANY($1::bigint[])`, [syncedIds]);
      this.syncedTotal += syncedIds.length;
      this.lastSyncedAt = new Date().toISOString();
      this.lastError = null;
    }

    return syncedIds.length;
  }

  async stats(): Promise<OutboxStats> {
    if (!this.isPgOnline()) {
      return { pending: 0, failed: 0, syncedTotal: this.syncedTotal, lastSyncedAt: this.lastSyncedAt, lastError: this.lastError };
    }
    try {
      const res = await this.pool.query<{ status: string; cnt: string }>(
        `SELECT status, COUNT(*)::text AS cnt FROM umbm_sheet_outbox GROUP BY status`,
      );
      let pending = 0, failed = 0;
      for (const r of res.rows) {
        if (r.status === 'PENDING') pending += Number(r.cnt);
        if (r.status === 'FAILED') failed += Number(r.cnt);
      }
      return { pending, failed, syncedTotal: this.syncedTotal, lastSyncedAt: this.lastSyncedAt, lastError: this.lastError };
    } catch {
      return { pending: 0, failed: 0, syncedTotal: this.syncedTotal, lastSyncedAt: this.lastSyncedAt, lastError: this.lastError };
    }
  }
}
