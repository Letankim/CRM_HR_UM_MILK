import { Errors } from '../lib/errors.js';
import { newId, nowIso } from '../lib/time.js';
import { checkHeader, recordToRow, rowToObject, validateRecord } from './table-store-codec.js';
import type { BaseRecord, InsertInput, InvalidRow, TableStoreOptions, UpdatePatch } from './table-store-codec.js';
import type { SheetsGateway } from './gateway.js';
import type { WriteQueue } from './write-queue.js';

export type { BaseRecord, InsertInput, InvalidRow, TableStoreOptions, UpdatePatch } from './table-store-codec.js';

interface Entry<T> { row: number; data: T; }
interface PendingInsert<T> { record: T; resolve: (value: T) => void; reject: (reason: unknown) => void; }
const MAX_APPEND_BATCH = 200;

export class TableStore<T extends BaseRecord> {
  private entries = new Map<string, Entry<T>>();
  private pendingEntries = new Map<string, T>();
  private invalid: InvalidRow[] = [];
  private loadedAt: string | null = null;
  private lastLoadedMs = 0;
  private loadInFlight: Promise<void> | null = null;
  private insertBuffer: PendingInsert<T>[] = [];
  private flushScheduled = false;

  constructor(private readonly gateway: SheetsGateway, private readonly queue: WriteQueue, private readonly opts: TableStoreOptions<T>) {}

  get name(): string { return `${this.opts.spreadsheetKey}.${this.opts.tab}`; }

  async load(): Promise<void> {
    if (this.loadInFlight) return this.loadInFlight;
    this.loadInFlight = this.doLoad().finally(() => { this.loadInFlight = null; });
    return this.loadInFlight;
  }

  private async doLoad(): Promise<void> {
    if (this.opts.cacheRows === false) {
      const header = await this.gateway.readRow(this.opts.spreadsheetId, this.opts.tab, 1, this.opts.headers.length).catch(async () => {
        await this.gateway.ensureTab(this.opts.spreadsheetId, this.opts.tab, this.opts.headers);
        return this.gateway.readRow(this.opts.spreadsheetId, this.opts.tab, 1, this.opts.headers.length);
      });
      await this.ensureHeader(header);
      this.loadedAt = nowIso();
      this.lastLoadedMs = Date.now();
      return;
    }
    const rows = await this.gateway.readTab(this.opts.spreadsheetId, this.opts.tab).catch(async () => {
      await this.gateway.ensureTab(this.opts.spreadsheetId, this.opts.tab, this.opts.headers);
      return this.gateway.readTab(this.opts.spreadsheetId, this.opts.tab);
    });
    const header = rows[0] ?? [];
    await this.ensureHeader(header);

    const next = new Map<string, Entry<T>>();
    const invalid: InvalidRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i] ?? [];
      if (raw.every((c) => c === '')) continue;
      const obj = this.toObject(raw);
      const parsed = this.opts.schema.safeParse(obj);
      const rowNumber = i + 1;
      if (!parsed.success) {
        invalid.push({ row: rowNumber, id: String(obj.id ?? ''), issues: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) });
        continue;
      }
      if (next.has(parsed.data.id)) {
        invalid.push({ row: rowNumber, id: parsed.data.id, issues: ['Trùng id'] });
        continue;
      }
      next.set(parsed.data.id, { row: rowNumber, data: parsed.data });
    }
    this.entries = next;
    this.invalid = invalid;
    this.loadedAt = nowIso();
    this.lastLoadedMs = Date.now();
  }

  async refreshIfIdle(cooldownMs = 12_000): Promise<boolean> {
    if (this.opts.cacheRows === false || !this.queue.isIdle(this.opts.spreadsheetId)) return false;
    if (this.lastLoadedMs > 0 && Date.now() - this.lastLoadedMs < cooldownMs) return false;
    await this.load();
    return true;
  }

  all(includeDeleted = false): T[] {
    const out: T[] = [];
    for (const e of this.entries.values()) if (includeDeleted || !e.data.is_deleted) out.push(e.data);
    for (const [id, d] of this.pendingEntries.entries()) if (!this.entries.has(id) && (includeDeleted || !d.is_deleted)) out.push(d);
    return out;
  }

  get(id: string): T | undefined {
    const d = this.entries.get(id)?.data ?? this.pendingEntries.get(id);
    return d && !d.is_deleted ? d : undefined;
  }

  find(predicate: (row: T) => boolean): T | undefined {
    for (const e of this.entries.values()) if (!e.data.is_deleted && predicate(e.data)) return e.data;
    for (const [id, d] of this.pendingEntries.entries()) if (!this.entries.has(id) && !d.is_deleted && predicate(d)) return d;
    return undefined;
  }

  filter(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  async insert(input: InsertInput<T>, actorId: string): Promise<T> {
    const now = nowIso();
    const record = this.validate({ ...input, id: input.id ?? newId(), created_at: now, created_by: actorId, updated_at: now, updated_by: actorId, version: 1, is_deleted: false });
    if (this.entries.has(record.id) || this.pendingEntries.has(record.id)) {
      throw Errors.badRequest(`id ${record.id} đã tồn tại`);
    }
    this.pendingEntries.set(record.id, record);
    return new Promise<T>((resolve, reject) => {
      this.insertBuffer.push({ record, resolve, reject });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void this.queue.enqueue(this.opts.spreadsheetId, () => this.flushInserts()).catch(() => undefined);
  }

  private async flushInserts(): Promise<void> {
    this.flushScheduled = false;
    const batch = this.insertBuffer.splice(0, MAX_APPEND_BATCH);
    if (batch.length === 0) return;
    if (this.insertBuffer.length > 0) this.scheduleFlush();

    try {
      const firstRow = await this.gateway.appendRows(
        this.opts.spreadsheetId,
        this.opts.tab,
        batch.map((b) => this.toRow(b.record)),
      );
      batch.forEach((b, i) => {
        this.pendingEntries.delete(b.record.id);
        if (this.opts.cacheRows !== false) this.entries.set(b.record.id, { row: firstRow + i, data: b.record });
        b.resolve(b.record);
      });
      this.lastLoadedMs = Date.now();
    } catch (err) {
      for (const b of batch) {
        this.pendingEntries.delete(b.record.id);
        b.reject(err);
      }
      throw err;
    }
  }

  async update(id: string, expectedVersion: number, patch: UpdatePatch<T>, actorId: string): Promise<T> {
    if (this.opts.appendOnly) throw new Error(`${this.name} là bảng chỉ thêm, không được cập nhật`);
    return this.queue.enqueue(this.opts.spreadsheetId, async () => {
      const entry = this.entries.get(id);
      const isRestoring = (patch as Record<string, unknown>).is_deleted === false;
      if (!entry || (entry.data.is_deleted && !isRestoring)) throw Errors.notFound();
      if (entry.data.version !== expectedVersion) throw Errors.conflict(undefined, entry.data.version);

      const live = await this.gateway.readRow(this.opts.spreadsheetId, this.opts.tab, entry.row, this.opts.headers.length);
      const liveObj = this.toObject(live);
      if (String(liveObj.id) !== id || Number(liveObj.version) !== expectedVersion) {
        await this.load();
        const refreshed = this.entries.get(id);
        throw Errors.conflict(undefined, refreshed?.data.version ?? Number(liveObj.version));
      }

      const next = this.validate({ ...entry.data, ...patch, id, version: expectedVersion + 1, updated_at: nowIso(), updated_by: actorId });
      await this.gateway.updateRow(this.opts.spreadsheetId, this.opts.tab, entry.row, this.toRow(next));
      this.entries.set(id, { row: entry.row, data: next });
      this.lastLoadedMs = Date.now();
      return next;
    });
  }

  async batchUpdate(items: { id: string; expectedVersion: number; patch: UpdatePatch<T> }[], actorId: string): Promise<T[]> {
    if (items.length === 0) return [];
    if (this.opts.appendOnly) throw new Error(`${this.name} là bảng chỉ thêm, không được cập nhật`);
    return this.queue.enqueue(this.opts.spreadsheetId, async () => {
      const now = nowIso();
      const staged: { id: string; row: number; next: T; values: string[] }[] = [];
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

  async softDelete(id: string, expectedVersion: number, actorId: string): Promise<T> {
    return this.update(id, expectedVersion, { is_deleted: true } as unknown as UpdatePatch<T>, actorId);
  }

  async restore(id: string, expectedVersion: number, actorId: string): Promise<T> {
    return this.update(id, expectedVersion, { is_deleted: false } as unknown as UpdatePatch<T>, actorId);
  }

  stats() {
    return { table: this.name, rows: this.entries.size, invalidRows: this.invalid.length, invalid: this.invalid.slice(0, 20), loadedAt: this.loadedAt };
  }

  private async ensureHeader(header: string[]): Promise<void> {
    if (checkHeader(this.name, this.opts.headers, header)) await this.gateway.updateRow(this.opts.spreadsheetId, this.opts.tab, 1, [...this.opts.headers]);
  }

  private toObject(raw: string[]): Record<string, string> { return rowToObject(this.opts.headers, raw); }
  private toRow(record: T): string[] { return recordToRow(this.opts.headers, record); }
  private validate(candidate: unknown): T { return validateRecord(this.name, this.opts.headers, this.opts.schema, candidate); }
}
