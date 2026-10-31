import type { ZodType, ZodTypeDef } from 'zod';
import { MAX_CELL_CHARS } from '@umbm/shared';
import { Errors } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { serializeCell } from './a1.js';
import type { SheetsGateway } from './gateway.js';

export interface BaseRecord {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  version: number;
  is_deleted: boolean;
}

type SystemKeys = keyof BaseRecord;
/** Cột bổ sung có giá trị mặc định trong schema Zod — được phép bỏ trống khi thêm mới (tự điền mặc định). */
type DefaultedInsertKeys = 'must_change_pin' | 'pin_changed_at' | 'linked_assignment_id' | 'kind' | 'requires_hr_approval' | 'punch_type';
export type InsertInput<T extends BaseRecord> = Omit<T, SystemKeys | DefaultedInsertKeys> & Partial<Pick<T, Extract<keyof T, DefaultedInsertKeys>>> & { id?: string; created_at?: string; updated_at?: string };
export type UpdatePatch<T extends BaseRecord> = Partial<Omit<T, SystemKeys>> & { is_deleted?: boolean };

export interface InvalidRow {
  row: number;
  id: string;
  issues: string[];
}

export interface TableEntry<T> {
  row: number;
  data: T;
}

export interface PreparedTableTarget<T> {
  spreadsheetId: string;
  tab: string;
  entries: Map<string, TableEntry<T>>;
  invalid: InvalidRow[];
  loadedAt: string;
  lastLoadedMs: number;
}

export interface TableStoreOptions<T extends BaseRecord> {
  spreadsheetKey: string;
  spreadsheetId: string;
  tab: string;
  headers: readonly string[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  appendOnly?: boolean;
  cacheRows?: boolean;
}

/** Phân tích toàn bộ các dòng đọc từ Google Sheets (bỏ qua dòng 1 tiêu đề và các dòng rỗng). */
export function parseSheetRows<T extends BaseRecord>(
  headers: readonly string[],
  schema: ZodType<T, ZodTypeDef, unknown>,
  rows: string[][],
): { entries: Map<string, TableEntry<T>>; invalid: InvalidRow[] } {
  const entries = new Map<string, TableEntry<T>>();
  const invalid: InvalidRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    if (raw.every((c) => c === '')) continue;
    const obj = rowToObject(headers, raw);
    const parsed = schema.safeParse(obj);
    const rowNumber = i + 1;
    if (!parsed.success) {
      invalid.push({
        row: rowNumber,
        id: String(obj.id ?? ''),
        issues: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`),
      });
      continue;
    }
    if (entries.has(parsed.data.id)) {
      invalid.push({ row: rowNumber, id: parsed.data.id, issues: ['Trùng id'] });
      continue;
    }
    entries.set(parsed.data.id, { row: rowNumber, data: parsed.data });
  }
  return { entries, invalid };
}

/** Chuyển một dòng ô Google Sheets thành object theo thứ tự header. */
export function rowToObject(headers: readonly string[], raw: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = raw[i] ?? '';
  });
  return obj;
}

/** Chuyển bản ghi thành mảng ô theo thứ tự header. */
export function recordToRow(headers: readonly string[], record: unknown): string[] {
  const rec = record as Record<string, unknown>;
  return headers.map((h) => serializeCell(rec[h]));
}

/**
 * Kiểm tra header thực tế trên Google Sheets khớp với header mong đợi.
 * Trả về `true` nếu cần mở rộng thêm cột mới ở cuối (các cột còn lại đang trống).
 */
export function checkHeader(name: string, expected: readonly string[], header: string[]): boolean {
  for (let i = 0; i < expected.length; i++) {
    const actual = (header[i] ?? '').trim();
    if (actual === expected[i]) continue;
    const restEmpty = header.slice(i).every((c) => (c ?? '').trim() === '');
    if (actual === '' && restEmpty && i >= 7) {
      return true;
    }
    throw new Error(
      `Header của ${name} không khớp tại cột ${i + 1}: mong đợi "${expected[i]}", thực tế "${actual}". ` +
        'Không được đổi thứ tự hoặc tên cột trên Google Sheets.',
    );
  }
  return false;
}

/** Xác thực bản ghi trước khi ghi: giới hạn độ dài ô và schema Zod. */
export function validateRecord<T>(
  name: string,
  headers: readonly string[],
  schema: ZodType<T, ZodTypeDef, unknown>,
  candidate: unknown,
): T {
  const asCells: Record<string, string> = {};
  const rec = candidate as Record<string, unknown>;
  for (const h of headers) {
    const cell = serializeCell(rec[h]);
    if (cell.length > MAX_CELL_CHARS) {
      throw Errors.badRequest(`Trường ${h} quá dài (tối đa ${MAX_CELL_CHARS} ký tự mỗi ô Google Sheets)`);
    }
    asCells[h] = cell;
  }
  const parsed = schema.safeParse(asCells);
  if (!parsed.success) {
    throw Errors.badRequest(
      `Dữ liệu không hợp lệ cho ${name}`,
      parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        code: 'INVALID_FORMAT' as const,
        message: i.message,
        rejected_value: rec[i.path.join('.')] ?? null,
      })),
    );
  }
  return parsed.data;
}

/** Đọc, kiểm tra header và phân tích dữ liệu của một tab đích trên Google Sheets. */
export async function loadAndParseTarget<T extends BaseRecord>(
  gateway: SheetsGateway,
  opts: TableStoreOptions<T>,
  target: { spreadsheetId: string; tab: string },
  ensureFirst = false,
): Promise<PreparedTableTarget<T>> {
  const { spreadsheetId: sid, tab } = target;
  const targetName = `${opts.spreadsheetKey}.${tab}`;
  if (ensureFirst) await gateway.ensureTab(sid, tab, opts.headers);
  if (opts.cacheRows === false) {
    const header = await gateway.readRow(sid, tab, 1, opts.headers.length).catch(async () => {
      await gateway.ensureTab(sid, tab, opts.headers);
      return gateway.readRow(sid, tab, 1, opts.headers.length);
    });
    if (checkHeader(targetName, opts.headers, header)) await gateway.updateRow(sid, tab, 1, [...opts.headers]);
    return { spreadsheetId: sid, tab, entries: new Map(), invalid: [], loadedAt: nowIso(), lastLoadedMs: Date.now() };
  }
  const rows = await gateway.readTab(sid, tab).catch(async () => {
    await gateway.ensureTab(sid, tab, opts.headers);
    return gateway.readTab(sid, tab);
  });
  if (checkHeader(targetName, opts.headers, rows[0] ?? [])) await gateway.updateRow(sid, tab, 1, [...opts.headers]);
  const { entries, invalid } = parseSheetRows(opts.headers, opts.schema, rows);
  return { spreadsheetId: sid, tab, entries, invalid, loadedAt: nowIso(), lastLoadedMs: Date.now() };
}
