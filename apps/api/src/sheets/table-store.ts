import { Errors } from '../lib/errors.js';
import { newId, nowIso } from '../lib/time.js';
import { loadAndParseTarget, recordToRow, rowToObject, validateRecord } from './table-store-codec.js';
import type { BaseRecord, InsertInput, InvalidRow, PreparedTableTarget, TableEntry, TableStoreOptions, UpdatePatch } from './table-store-codec.js';
import type { SheetsGateway } from './gateway.js';
import type { WriteQueue } from './write-queue.js';

export type { BaseRecord, InsertInput, InvalidRow, PreparedTableTarget, TableStoreOptions, UpdatePatch } from './table-store-codec.js';

interface PendingInsert<T> {
  record: T;
  spreadsheetId: string;
  tab: string;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
const MAX_APPEND_BATCH = 200;

export class TableStore<T extends BaseRecord> {
  private entries = new Map<string, TableEntry<T>>();
  private pendingEntries = new Map<string, T>();
  private invalid: InvalidRow[] = [];
  private loadedAt: string | null = null;
  private lastLoadedMs = 0;
  private loadInFlight: Promise<void> | null = null;
  private insertBuffer: PendingInsert<T>[] = [];
  private flushScheduled = false;

  constructor(private readonly gateway: SheetsGateway, private readonly queue: WriteQueue, private opts: TableStoreOptions<T>) {}

  get name(): string { return `${this.opts.spreadsheetKey}.${this.opts.tab}`; }
  get tab(): string { return this.opts.tab; }
  get spreadsheetId(): string { return this.opts.spreadsheetId; }

  /** Xả sạch buffer ghi cũ và đọc/kiểm tra trước dữ liệu bảng đích mà chưa thay đổi bộ nhớ đang phục vụ đọc. */
  async prepareTarget(target: { spreadsheetId: string; tab: string }): Promise<PreparedTableTarget<T>> {
    if (this.loadInFlight) await this.loadInFlight.catch(() => undefined);
    await this.queue.enqueue(this.opts.spreadsheetId, async () => {
      while (this.insertBuffer.length > 0) await this.flushInserts();
    });
    return this.queue.enqueue(target.spreadsheetId, () => loadAndParseTarget(this.gateway, this.opts, target, true));
  }

  /** Hoán đổi nguyên tử con trỏ Spreadsheet/Tab và cache bộ nhớ sau khi đã prepareTarget thành công. */
  commitPreparedTarget(prepared: PreparedTableTarget<T>): void {
    this.opts = { ...this.opts, spreadsheetId: prepared.spreadsheetId, tab: prepared.tab };
    this.entries = prepared.entries;
    this.pendingEntries = new Map();
    this.invalid = prepared.invalid;
    this.loadedAt = prepared.loadedAt;
    this.lastLoadedMs = prepared.lastLoadedMs;
  }

  /** Chuyển bảng sang file Spreadsheet và/hoặc tab khác một cách nguyên tử, không có khoảng trống rỗng dữ liệu. */
  async switchTarget(target: { spreadsheetId: string; tab: string }): Promise<void> {
    if (target.spreadsheetId === this.opts.spreadsheetId && target.tab === this.opts.tab && this.loadedAt) return;
    const prepared = await this.prepareTarget(target);
    this.commitPreparedTarget(prepared);
  }

  /** Chuyển bảng sang tab khác trên cùng Spreadsheet hiện tại. */
  async switchTab(tab: string): Promise<void> {
    return this.switchTarget({ spreadsheetId: this.opts.spreadsheetId, tab });
  }

  async load(): Promise<void> {
    if (this.loadInFlight) return this.loadInFlight;
    this.loadInFlight = this.doLoad().finally(() => { this.loadInFlight = null; });
    return this.loadInFlight;
  }

  private async doLoad(): Promise<void> {
    const target = { spreadsheetId: this.opts.spreadsheetId, tab: this.opts.tab };
    const prepared = await loadAndParseTarget(this.gateway, this.opts, target, false);
    if (this.opts.spreadsheetId === target.spreadsheetId && this.opts.tab === target.tab) {
      this.entries = prepared.entries;
      this.invalid = prepared.invalid;
      this.loadedAt = prepared.loadedAt;
      this.lastLoadedMs = prepared.lastLoadedMs;
    }
  }

  async refreshIfIdle(cooldownMs = 12_000): Promise<boolean> {
    if (this.opts.cacheRows === false || !this.queue.isIdle(this.opts.spreadsheetId)) return false;
    if (this.lastLoadedMs > 0 && Date.now() - this.lastLoadedMs < cooldownMs) return false;
    await this.load(); return true;
  }

  all(includeDeleted = false): T[] {
    const out: T[] = [];
    for (const e of this.entries.values()) if (includeDeleted || !e.data.is_deleted) out.push(e.data);
    for (const [id, d] of this.pendingEntries.entries()) if (!this.entries.has(id) && (includeDeleted || !d.is_deleted)) out.push(d);
    return out;
  }

  get(id: string): T | undefined { const d = this.entries.get(id)?.data ?? this.pendingEntries.get(id); return d && !d.is_deleted ? d : undefined; }

  find(predicate: (row: T) => boolean): T | undefined {
    for (const e of this.entries.values()) if (!e.data.is_deleted && predicate(e.data)) return e.data;
    for (const [id, d] of this.pendingEntries.entries()) if (!this.entries.has(id) && !d.is_deleted && predicate(d)) return d;
    return undefined;
  }

  filter(predicate: (row: T) => boolean): T[] { return this.all().filter(predicate); }

  async insert(input: InsertInput<T>, actorId: string): Promise<T> {
    const now = nowIso(), createdAt = input.created_at || now, updatedAt = input.updated_at || createdAt;
    const record = this.validate({ ...input, id: input.id ?? newId(), created_at: createdAt, created_by: actorId, updated_at: updatedAt, updated_by: actorId, version: 1, is_deleted: false });
    if (this.entries.has(record.id) || this.pendingEntries.has(record.id)) {
      throw Errors.badRequest(`id ${record.id} đã tồn tại`);
    }
    const targetSid = this.opts.spreadsheetId, targetTab = this.opts.tab;
    this.pendingEntries.set(record.id, record);
    return new Promise<T>((resolve, reject) => {
      this.insertBuffer.push({ record, spreadsheetId: targetSid, tab: targetTab, resolve, reject });
      this.scheduleFlush(targetSid);
    });
  }

  private scheduleFlush(spreadsheetId = this.opts.spreadsheetId): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void this.queue.enqueue(spreadsheetId, () => this.flushInserts()).catch(() => undefined);
  }

  private async flushInserts(): Promise<void> {
    this.flushScheduled = false;
    const head = this.insertBuffer[0];
    if (!head) return;
    let count = 0;
    while (count < this.insertBuffer.length && count < MAX_APPEND_BATCH && this.insertBuffer[count]!.spreadsheetId === head.spreadsheetId && this.insertBuffer[count]!.tab === head.tab) count++;
    const batch = this.insertBuffer.splice(0, count);
    if (this.insertBuffer.length > 0) this.scheduleFlush(this.insertBuffer[0]!.spreadsheetId);

    try {
      const firstRow = await this.gateway.appendRows(head.spreadsheetId, head.tab, batch.map((b) => this.toRow(b.record)));
      const matchesCurrent = this.opts.spreadsheetId === head.spreadsheetId && this.opts.tab === head.tab;
      batch.forEach((b, i) => {
        if (matchesCurrent) {
          this.pendingEntries.delete(b.record.id);
          if (this.opts.cacheRows !== false) this.entries.set(b.record.id, { row: firstRow + i, data: b.record });
        }
        b.resolve(b.record);
      });
      if (matchesCurrent) this.lastLoadedMs = Date.now();
    } catch (err) {
      for (const b of batch) { this.pendingEntries.delete(b.record.id); b.reject(err); }
      throw err;
    }
  }

  async update(id: string, expectedVersion: number, patch: UpdatePatch<T>, actorId: string): Promise<T> {
    if (this.opts.appendOnly) throw new Error(`${this.name} là bảng chỉ thêm, không được cập nhật`);
    return this.queue.enqueue(this.opts.spreadsheetId, async () => {
      const tab = this.opts.tab, activeSid = this.opts.spreadsheetId, entry = this.entries.get(id);
      const isRestoring = (patch as Record<string, unknown>).is_deleted === false;
      if (!entry || (entry.data.is_deleted && !isRestoring)) throw Errors.notFound();
      if (entry.data.version !== expectedVersion) throw Errors.conflict(undefined, entry.data.version);

      const live = await this.gateway.readRow(activeSid, tab, entry.row, this.opts.headers.length);
      const liveObj = this.toObject(live);
      if (String(liveObj.id) !== id || Number(liveObj.version) !== expectedVersion) {
        await this.load();
        const refreshed = this.entries.get(id);
        throw Errors.conflict(undefined, refreshed?.data.version ?? Number(liveObj.version));
      }

      const next = this.validate({ ...entry.data, ...patch, id, version: expectedVersion + 1, updated_at: nowIso(), updated_by: actorId });
      await this.gateway.updateRow(activeSid, tab, entry.row, this.toRow(next));
      this.entries.set(id, { row: entry.row, data: next });
      this.lastLoadedMs = Date.now();
      return next;
    });
  }

  async batchUpdate(items: { id: string; expectedVersion: number; patch: UpdatePatch<T> }[], actorId: string): Promise<T[]> {
    if (items.length === 0) return [];
    if (this.opts.appendOnly) throw new Error(`${this.name} là bảng chỉ thêm, không được cập nhật`);
    return this.queue.enqueue(this.opts.spreadsheetId, async () => {
      const now = nowIso(), staged: { id: string; row: number; next: T; values: string[] }[] = [];
      for (const { id, expectedVersion, patch } of items) {
        const entry = this.entries.get(id);
        const isRestoring = (patch as Record<string, unknown>).is_deleted === false;
        if (!entry || (entry.data.is_deleted && !isRestoring)) throw Errors.notFound();
        if (entry.data.version !== expectedVersion) throw Errors.conflict(undefined, entry.data.version);
        const next = this.validate({ ...entry.data, ...patch, id, version: expectedVersion + 1, updated_at: now, updated_by: actorId });
        staged.push({ id, row: entry.row, next, values: this.toRow(next) });
      }
      await this.gateway.batchUpdateRows(this.opts.spreadsheetId, this.opts.tab, staged.map((s) => ({ row: s.row, values: s.values })));
      for (const s of staged) this.entries.set(s.id, { row: s.row, data: s.next });
      this.lastLoadedMs = Date.now();
      return staged.map((s) => s.next);
    });
  }

  async softDelete(id: string, expectedVersion: number, actorId: string): Promise<T> { return this.update(id, expectedVersion, { is_deleted: true } as unknown as UpdatePatch<T>, actorId); }
  async restore(id: string, expectedVersion: number, actorId: string): Promise<T> { return this.update(id, expectedVersion, { is_deleted: false } as unknown as UpdatePatch<T>, actorId); }
  stats() { return { table: this.name, rows: this.entries.size, invalidRows: this.invalid.length, invalid: this.invalid.slice(0, 20), loadedAt: this.loadedAt }; }
  private toObject(raw: string[]): Record<string, string> { return rowToObject(this.opts.headers, raw); }
  private toRow(record: T): string[] { return recordToRow(this.opts.headers, record); }
  private validate(candidate: unknown): T { return validateRecord(this.name, this.opts.headers, this.opts.schema, candidate); }
}
