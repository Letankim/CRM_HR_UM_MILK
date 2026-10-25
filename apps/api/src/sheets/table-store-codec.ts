import type { ZodType, ZodTypeDef } from 'zod';
import { MAX_CELL_CHARS } from '@umbm/shared';
import { Errors } from '../lib/errors.js';
import { serializeCell } from './a1.js';

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
export type InsertInput<T extends BaseRecord> = Omit<T, SystemKeys> & { id?: string };
export type UpdatePatch<T extends BaseRecord> = Partial<Omit<T, SystemKeys>>;

export interface InvalidRow {
  row: number;
  id: string;
  issues: string[];
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
