import { withRetry, type sheets_v4 } from '@umbm/google';
import { columnLetter, rowFromRange } from './a1.js';
import { createGoogleMonthlySpreadsheet, type CreatedMonthlySpreadsheet, type CreateMonthlySpreadsheetParams, type GoogleDrivePlacementOpts } from './monthly-spreadsheet.js';

export type { CreatedMonthlySpreadsheet, CreateMonthlySpreadsheetParams, GoogleDrivePlacementOpts } from './monthly-spreadsheet.js';

/** Cổng truy cập Google Sheets mức thấp (hỗ trợ cả Google thật và InMemorySheetsGateway cho kiểm thử). */
export interface SheetsGateway {
  readTab(spreadsheetId: string, tab: string): Promise<string[][]>;
  readRow(spreadsheetId: string, tab: string, row: number, width: number): Promise<string[]>;
  appendRows(spreadsheetId: string, tab: string, rows: string[][]): Promise<number>;
  updateRow(spreadsheetId: string, tab: string, row: number, values: string[]): Promise<void>;
  batchUpdateRows(spreadsheetId: string, tab: string, items: { row: number; values: string[] }[]): Promise<void>;
  ensureTab(spreadsheetId: string, tab: string, headers: readonly string[]): Promise<void>;
  listTabs(spreadsheetId: string): Promise<string[]>;
  createMonthlySpreadsheet(params: CreateMonthlySpreadsheetParams): Promise<CreatedMonthlySpreadsheet>;
}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export class GoogleSheetsGateway implements SheetsGateway {
  private readonly sheetTitlesCache = new Map<string, Promise<Set<string>>>();
  private readonly pendingTabReads = new Map<string, { tab: string; resolve: (rows: string[][]) => void; reject: (err: unknown) => void }[]>();

  constructor(
    private readonly sheets: sheets_v4.Sheets,
    private readonly onRetry?: (attempt: number, error: unknown) => void,
    private readonly driveOpts?: GoogleDrivePlacementOpts,
  ) {}

  async createMonthlySpreadsheet(params: CreateMonthlySpreadsheetParams): Promise<CreatedMonthlySpreadsheet> {
    const created = await createGoogleMonthlySpreadsheet(this.sheets, this.driveOpts, params, this.onRetry);
    this.sheetTitlesCache.delete(created.spreadsheetId);
    for (const t of params.tabs) await this.ensureTab(created.spreadsheetId, t.name, t.headers);
    return created;
  }

  private getSheetTitles(spreadsheetId: string): Promise<Set<string>> {
    let pending = this.sheetTitlesCache.get(spreadsheetId);
    if (!pending) {
      pending = withRetry(() => this.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' }), { onRetry: this.onRetry })
        .then((meta) => new Set((meta.data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => !!t)));
      pending.catch(() => this.sheetTitlesCache.delete(spreadsheetId));
      this.sheetTitlesCache.set(spreadsheetId, pending);
    }
    return pending;
  }

  private async readSingleTab(spreadsheetId: string, tab: string): Promise<string[][]> {
    const res = await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId, range: quoteTab(tab), valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' }), { onRetry: this.onRetry });
    return (res.data.values ?? []).map((r) => r.map((c) => String(c ?? '')));
  }

  readTab(spreadsheetId: string, tab: string): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      let bucket = this.pendingTabReads.get(spreadsheetId);
      if (!bucket) {
        bucket = [];
        this.pendingTabReads.set(spreadsheetId, bucket);
        queueMicrotask(() => void this.flushTabReads(spreadsheetId));
      }
      bucket.push({ tab, resolve, reject });
    });
  }

  private async flushTabReads(spreadsheetId: string): Promise<void> {
    const bucket = this.pendingTabReads.get(spreadsheetId) ?? [];
    this.pendingTabReads.delete(spreadsheetId);
    if (bucket.length === 0) return;
    if (bucket.length === 1) {
      const only = bucket[0]!;
      return this.readSingleTab(spreadsheetId, only.tab).then(only.resolve, only.reject);
    }
    const uniqueTabs = Array.from(new Set(bucket.map((b) => b.tab)));
    try {
      const res = await withRetry(
        () => this.sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: uniqueTabs.map(quoteTab), valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' }),
        { onRetry: this.onRetry },
      );
      const map = new Map<string, string[][]>();
      uniqueTabs.forEach((t, idx) => {
        const vals = res.data.valueRanges?.[idx]?.values ?? [];
        map.set(t, vals.map((r) => r.map((c) => String(c ?? ''))));
      });
      bucket.forEach((b) => b.resolve(map.get(b.tab) ?? []));
    } catch {
      await Promise.all(bucket.map((b) => this.readSingleTab(spreadsheetId, b.tab).then(b.resolve, b.reject)));
    }
  }

  async readRow(spreadsheetId: string, tab: string, row: number, width: number): Promise<string[]> {
    const range = `${quoteTab(tab)}!A${row}:${columnLetter(width)}${row}`;
    const res = await withRetry(() => this.sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' }), { onRetry: this.onRetry });
    return (res.data.values?.[0] ?? []).map((c) => String(c ?? ''));
  }

  async appendRows(spreadsheetId: string, tab: string, rows: string[][]): Promise<number> {
    const res = await withRetry(() => this.sheets.spreadsheets.values.append({ spreadsheetId, range: `${quoteTab(tab)}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows } }), { onRetry: this.onRetry });
    const updated = res.data.updates?.updatedRange;
    if (!updated) throw new Error(`Append không trả về updatedRange (${tab})`);
    return rowFromRange(updated);
  }

  async listTabs(spreadsheetId: string): Promise<string[]> {
    this.sheetTitlesCache.delete(spreadsheetId);
    return Array.from(await this.getSheetTitles(spreadsheetId));
  }

  async ensureTab(spreadsheetId: string, tab: string, headers: readonly string[]): Promise<void> {
    const titles = await this.getSheetTitles(spreadsheetId);
    if (titles.has(tab)) return;
    titles.add(tab);

    let sheetId: number | undefined;
    try {
      const res = await withRetry(
        () => this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1, columnCount: Math.max(headers.length, 26) } } } }] } }),
        { onRetry: this.onRetry },
      );
      sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
    } catch (err) {
      // Một request khác vừa tạo tab này — coi như thành công.
      if (/already exists/i.test((err as Error).message)) return;
      throw err;
    }

    if (sheetId !== undefined) {
      await withRetry(
        () => this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } }] } }),
        { onRetry: this.onRetry },
      );
    }
    await withRetry(
      () => this.sheets.spreadsheets.values.update({ spreadsheetId, range: `${quoteTab(tab)}!A1`, valueInputOption: 'RAW', requestBody: { values: [[...headers]] } }),
      { onRetry: this.onRetry },
    );
  }

  async updateRow(spreadsheetId: string, tab: string, row: number, values: string[]): Promise<void> {
    const range = `${quoteTab(tab)}!A${row}:${columnLetter(values.length)}${row}`;
    await withRetry(() => this.sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [values] } }), { onRetry: this.onRetry });
  }

  async batchUpdateRows(spreadsheetId: string, tab: string, items: { row: number; values: string[] }[]): Promise<void> {
    if (items.length === 0) return;
    if (items.length === 1) return this.updateRow(spreadsheetId, tab, items[0]!.row, items[0]!.values);
    const data = items.map(({ row, values }) => ({ range: `${quoteTab(tab)}!A${row}:${columnLetter(values.length)}${row}`, values: [values] }));
    await withRetry(() => this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } }), { onRetry: this.onRetry });
  }
}

/** Gateway giả lập trong bộ nhớ — dùng cho unit test và chạy thử không cần Google. */
export class InMemorySheetsGateway implements SheetsGateway {
  private readonly data = new Map<string, string[][]>();
  public calls = { read: 0, write: 0 };

  seed(spreadsheetId: string, tab: string, rows: string[][]): void { this.data.set(`${spreadsheetId}::${tab}`, rows.map((r) => [...r])); }
  private tab(spreadsheetId: string, tab: string): string[][] {
    const key = `${spreadsheetId}::${tab}`;
    if (!this.data.has(key)) this.data.set(key, []);
    return this.data.get(key)!;
  }

  async readTab(spreadsheetId: string, tab: string) { this.calls.read++; return this.tab(spreadsheetId, tab).map((r) => [...r]); }
  async readRow(spreadsheetId: string, tab: string, row: number) { this.calls.read++; return [...(this.tab(spreadsheetId, tab)[row - 1] ?? [])]; }

  async appendRows(spreadsheetId: string, tab: string, rows: string[][]) {
    this.calls.write++;
    const data = this.tab(spreadsheetId, tab), first = data.length + 1;
    for (const r of rows) data.push([...r]);
    return first;
  }

  async ensureTab(spreadsheetId: string, tab: string, headers: readonly string[]) {
    const key = `${spreadsheetId}::${tab}`;
    if (!this.data.has(key)) this.data.set(key, [[...headers]]);
  }

  async createMonthlySpreadsheet(params: CreateMonthlySpreadsheetParams): Promise<CreatedMonthlySpreadsheet> {
    const spreadsheetId = `mem-monthly-${params.monthKey}`;
    for (const t of params.tabs) await this.ensureTab(spreadsheetId, t.name, t.headers);
    return { spreadsheetId, fileName: params.title, folderId: `mem-folder-${params.monthKey}`, folderPath: params.folderSegments.join('/'), webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }

  async listTabs(spreadsheetId: string): Promise<string[]> {
    const prefix = `${spreadsheetId}::`;
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  hasTab(spreadsheetId: string, tab: string): boolean { return this.data.has(`${spreadsheetId}::${tab}`); }

  async updateRow(spreadsheetId: string, tab: string, row: number, values: string[]) {
    this.calls.write++;
    this.tab(spreadsheetId, tab)[row - 1] = [...values];
  }

  async batchUpdateRows(spreadsheetId: string, tab: string, items: { row: number; values: string[] }[]) {
    if (items.length === 0) return;
    this.calls.write++;
    const rows = this.tab(spreadsheetId, tab);
    for (const { row, values } of items) rows[row - 1] = [...values];
  }

  /** Mô phỏng ai đó sửa tay trực tiếp trên Google Sheets. */
  editCell(spreadsheetId: string, tab: string, row: number, col: number, value: string) {
    const r = this.tab(spreadsheetId, tab)[row - 1];
    if (r) r[col] = value;
  }
}
