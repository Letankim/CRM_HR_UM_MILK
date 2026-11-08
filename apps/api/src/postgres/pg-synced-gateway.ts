import pg from 'pg';
import type { CreatedMonthlySpreadsheet, CreateMonthlySpreadsheetParams, SheetsGateway } from '../sheets/gateway.js';
import { pgAppendRows, pgBatchUpdateRows, pgEnsureTab, pgReadRow, pgReadTab, pgUpdateRow } from './pg-crud-ops.js';
import { PostgresOutboxWorker, type OutboxStats } from './pg-outbox-worker.js';
import { reconcileTabTwoWay, type PostgresParityReport, type TabParityResult } from './pg-parity-reconciler.js';
import { ensureDatabaseExists, ensurePostgresSchema, parsePostgresConfig, type PostgresConnectionConfig } from './pg-schema.js';

export type DualStorageMode = 'PG_PRIMARY' | 'SHEETS_FALLBACK' | 'PG_RECOVERING';

export interface PostgresSyncStatus {
  enabled: boolean; mode: DualStorageMode; database: string; host: string;
  dirtyFallbackTabs: number; lastFallbackReason: string | null; lastRecoveredAt: string | null; outbox: OutboxStats;
}
export interface PostgresKeepAlivePing {
  enabled: boolean; alive: boolean; mode: DualStorageMode; latency_ms: number | null; checked_at: string;
}

/** Cổng lưu trữ Kép (PostgreSQL Primary + Google Sheets Async Mirror + Tự động Failover 2 chiều). */
export class PostgresSyncedSheetsGateway implements SheetsGateway {
  readonly pool: pg.Pool;
  readonly worker: PostgresOutboxWorker;
  private mode: DualStorageMode = 'PG_PRIMARY';
  private simulatedOffline = false;
  private lastFallbackReason: string | null = null;
  private lastRecoveredAt: string | null = null;
  private readonly dirtyTabs = new Set<string>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveringPromise: Promise<boolean> | null = null;

  constructor(readonly remote: SheetsGateway, readonly config: PostgresConnectionConfig, outboxIntervalMs = 1200) {
    this.pool = new pg.Pool(config);
    this.pool.on('error', (err) => this.enterFallback(err));
    this.worker = new PostgresOutboxWorker(this.pool, this.remote, () => this.mode === 'PG_PRIMARY' && !this.simulatedOffline, outboxIntervalMs);
  }

  static async connectOrFallback(remote: SheetsGateway, connectionString: string, outboxIntervalMs = 1200, poolMax?: number): Promise<PostgresSyncedSheetsGateway | null> {
    const cfg = parsePostgresConfig(connectionString, poolMax);
    if (!cfg) return null;
    const gw = new PostgresSyncedSheetsGateway(remote, cfg, outboxIntervalMs);
    try {
      await ensureDatabaseExists(cfg);
      await ensurePostgresSchema(gw.pool);
      gw.worker.start();
    } catch (err) { gw.enterFallback(err); }
    return gw;
  }

  getMode(): DualStorageMode { return this.mode; }

  async setSimulatedOffline(offline: boolean): Promise<void> {
    this.simulatedOffline = offline;
    if (offline) this.enterFallback(new Error('Giả lập mất kết nối PostgreSQL'));
    else await this.tryRecoverNow();
  }

  private enterFallback(err: unknown): void {
    this.lastFallbackReason = (err as Error)?.message || String(err);
    if (this.mode !== 'SHEETS_FALLBACK') this.mode = 'SHEETS_FALLBACK';
    if (!this.recoveryTimer) {
      this.recoveryTimer = setInterval(() => {
        if (!this.simulatedOffline) void this.tryRecoverNow().catch(() => undefined);
      }, 5000);
      this.recoveryTimer.unref?.();
    }
  }

  async tryRecoverNow(): Promise<boolean> {
    if (this.simulatedOffline) return false;
    if (this.mode === 'PG_PRIMARY') return true;
    if (this.recoveringPromise) return this.recoveringPromise;

    this.recoveringPromise = (async () => {
      try {
        await ensureDatabaseExists(this.config);
        await ensurePostgresSchema(this.pool);
        this.mode = 'PG_RECOVERING';
        for (const key of Array.from(this.dirtyTabs)) {
          const [sid, tab] = key.split('::');
          if (sid && tab) await reconcileTabTwoWay(this.pool, this.remote, sid, tab);
          this.dirtyTabs.delete(key);
        }
        this.mode = 'PG_PRIMARY';
        this.lastRecoveredAt = new Date().toISOString();
        if (this.recoveryTimer) { clearInterval(this.recoveryTimer); this.recoveryTimer = null; }
        this.worker.start();
        await this.worker.flushAll().catch(() => undefined);
        return true;
      } catch (err) {
        this.mode = 'SHEETS_FALLBACK';
        this.lastFallbackReason = (err as Error)?.message || String(err);
        return false;
      } finally {
        this.recoveringPromise = null;
      }
    })();
    return this.recoveringPromise;
  }

  private async runWithFailover<T>(sid: string, tab: string, isWrite: boolean, pgTask: () => Promise<T>, fallbackTask: () => Promise<T>): Promise<T> {
    if (this.mode !== 'PG_PRIMARY' || this.simulatedOffline) {
      if (isWrite && sid && tab) this.dirtyTabs.add(`${sid}::${tab}`);
      return fallbackTask();
    }
    try { return await pgTask(); } catch (err) {
      this.enterFallback(err);
      if (isWrite && sid && tab) this.dirtyTabs.add(`${sid}::${tab}`);
      return fallbackTask();
    }
  }

  readTab(sid: string, tab: string): Promise<string[][]> {
    return this.runWithFailover(sid, tab, false, () => pgReadTab(this.pool, this.remote, sid, tab), () => this.remote.readTab(sid, tab));
  }
  readRow(sid: string, tab: string, row: number, width: number): Promise<string[]> {
    return this.runWithFailover(sid, tab, false, () => pgReadRow(this.pool, this.remote, sid, tab, row, width), () => this.remote.readRow(sid, tab, row, width));
  }
  async ensureTab(sid: string, tab: string, headers: readonly string[]): Promise<void> {
    return this.runWithFailover(sid, tab, true, async () => { if (await pgEnsureTab(this.pool, sid, tab, headers)) this.worker.wake(); }, () => this.remote.ensureTab(sid, tab, headers));
  }
  async appendRows(sid: string, tab: string, rows: string[][]): Promise<number> {
    if (rows.length === 0) return 2;
    return this.runWithFailover(sid, tab, true, async () => { const r = await pgAppendRows(this.pool, sid, tab, rows); this.worker.wake(); return r; }, () => this.remote.appendRows(sid, tab, rows));
  }
  async updateRow(sid: string, tab: string, row: number, values: string[]): Promise<void> {
    const clean = values.map((v) => String(v ?? ''));
    return this.runWithFailover(sid, tab, true, async () => { await pgUpdateRow(this.pool, sid, tab, row, clean); this.worker.wake(); }, () => this.remote.updateRow(sid, tab, row, clean));
  }
  async batchUpdateRows(sid: string, tab: string, items: { row: number; values: string[] }[]): Promise<void> {
    if (items.length === 0) return;
    return this.runWithFailover(sid, tab, true, async () => { await pgBatchUpdateRows(this.pool, sid, tab, items); this.worker.wake(); }, () => this.remote.batchUpdateRows(sid, tab, items));
  }

  async listTabs(spreadsheetId: string): Promise<string[]> {
    const remoteTabs = await this.remote.listTabs(spreadsheetId).catch(() => [] as string[]);
    if (this.mode !== 'PG_PRIMARY' || this.simulatedOffline) return remoteTabs;
    try {
      const pgTabs = await this.pool.query<{ tab_name: string }>(`SELECT tab_name FROM umbm_sheet_tabs WHERE spreadsheet_id = $1`, [spreadsheetId]);
      return Array.from(new Set([...remoteTabs, ...pgTabs.rows.map((r) => r.tab_name)]));
    } catch { return remoteTabs; }
  }

  async createMonthlySpreadsheet(params: CreateMonthlySpreadsheetParams): Promise<CreatedMonthlySpreadsheet> {
    const created = await this.remote.createMonthlySpreadsheet(params);
    for (const t of params.tabs) await this.ensureTab(created.spreadsheetId, t.name, t.headers);
    return created;
  }

  flushOutbox(): Promise<number> { return this.worker.flushAll(); }
  reconcileParity(): Promise<PostgresParityReport> { return this.flushAndReconcileAll(); }
  postgresStatus(): Promise<PostgresSyncStatus> { return this.status(); }

  async pingPostgres(timeoutMs = 3500): Promise<PostgresKeepAlivePing> {
    const t0 = performance.now();
    if (this.simulatedOffline) return { enabled: true, alive: false, mode: this.mode, latency_ms: 0, checked_at: new Date().toISOString() };
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pool.query('SELECT 1 AS alive'),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('PostgreSQL ping timeout')), timeoutMs); timer.unref?.(); }),
      ]);
      if (this.mode !== 'PG_PRIMARY') void this.tryRecoverNow().catch(() => undefined);
      return { enabled: true, alive: true, mode: this.mode, latency_ms: Math.round((performance.now() - t0) * 100) / 100, checked_at: new Date().toISOString() };
    } catch (err) {
      this.enterFallback(err);
      return { enabled: true, alive: false, mode: this.mode, latency_ms: Math.round((performance.now() - t0) * 100) / 100, checked_at: new Date().toISOString() };
    } finally { if (timer) clearTimeout(timer); }
  }

  async flushAndReconcileAll(): Promise<PostgresParityReport> {
    if (this.mode !== 'PG_PRIMARY') await this.tryRecoverNow();
    await this.worker.flushAll();
    const details: TabParityResult[] = [];
    if (this.mode === 'PG_PRIMARY' && !this.simulatedOffline) {
      const isMem = this.remote.constructor.name === 'InMemorySheetsGateway';
      const cond = isMem ? `spreadsheet_id LIKE 'mem%'` : `spreadsheet_id NOT LIKE 'mem%'`;
      const tabs = await this.pool.query<{ spreadsheet_id: string; tab_name: string }>(
        `SELECT spreadsheet_id, tab_name FROM umbm_sheet_tabs WHERE ${cond} ORDER BY spreadsheet_id, tab_name`,
      );
      for (const t of tabs.rows) {
        try {
          details.push(await reconcileTabTwoWay(this.pool, this.remote, t.spreadsheet_id, t.tab_name));
        } catch (err) {
          const code = Number((err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status ?? 0);
          if (code === 404 || t.spreadsheet_id.startsWith('mem')) {
            await this.pool.query(`DELETE FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`, [t.spreadsheet_id, t.tab_name]);
          } else {
            throw err;
          }
        }
      }
    }
    return {
      checkedAt: new Date().toISOString(), tabsChecked: details.length,
      pushedToSheets: details.reduce((s, d) => s + d.pushedToSheets, 0),
      pulledToPostgres: details.reduce((s, d) => s + d.pulledToPostgres, 0),
      realignedRows: details.reduce((s, d) => s + d.realignedRows, 0), details,
    };
  }

  async status(): Promise<PostgresSyncStatus> {
    return {
      enabled: true, mode: this.mode, database: this.config.database, host: `${this.config.host}:${this.config.port}`,
      dirtyFallbackTabs: this.dirtyTabs.size, lastFallbackReason: this.lastFallbackReason,
      lastRecoveredAt: this.lastRecoveredAt, outbox: await this.worker.stats(),
    };
  }

  async close(): Promise<void> {
    this.worker.stop();
    if (this.recoveryTimer) { clearInterval(this.recoveryTimer); this.recoveryTimer = null; }
    await this.worker.flushAll().catch(() => undefined);
    await this.pool.end().catch(() => undefined);
  }
}
