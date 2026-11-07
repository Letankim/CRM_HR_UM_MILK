import type pg from 'pg';
import type { SheetsGateway } from '../sheets/gateway.js';
import { hydrateTabFromRemoteToPostgres } from './pg-parity-reconciler.js';
import { computeRowHash, extractRowVersion, normalizeCellsWidth } from './pg-schema.js';

export async function pgReadTab(pool: pg.Pool, remote: SheetsGateway, spreadsheetId: string, tab: string): Promise<string[][]> {
  const meta = await pool.query<{ headers_json: string[]; hydrated_at: string | null }>(
    `SELECT headers_json, hydrated_at FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
    [spreadsheetId, tab],
  );
  if (meta.rowCount === 0 || !meta.rows[0]?.hydrated_at) {
    return hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
  }
  const headers = (meta.rows[0]!.headers_json ?? []).map((c) => String(c ?? ''));
  const rowsRes = await pool.query<{ cells_json: string[] }>(
    `SELECT cells_json FROM umbm_sheet_rows WHERE spreadsheet_id = $1 AND tab_name = $2 ORDER BY row_index ASC`,
    [spreadsheetId, tab],
  );
  if (headers.length === 0 && rowsRes.rowCount === 0) return [];
  return [headers, ...rowsRes.rows.map((r) => (r.cells_json ?? []).map((c) => String(c ?? '')))];
}

export async function pgReadRow(pool: pg.Pool, remote: SheetsGateway, spreadsheetId: string, tab: string, row: number, width: number): Promise<string[]> {
  if (row === 1) {
    const meta = await pool.query<{ headers_json: string[]; hydrated_at: string | null }>(
      `SELECT headers_json, hydrated_at FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
      [spreadsheetId, tab],
    );
    if (meta.rowCount === 0 || !meta.rows[0]?.hydrated_at) {
      const all = await hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
      return normalizeCellsWidth(all[0] ?? [], width);
    }
    return normalizeCellsWidth(meta.rows[0]!.headers_json ?? [], width);
  }
  const r = await pool.query<{ cells_json: string[] }>(
    `SELECT cells_json FROM umbm_sheet_rows WHERE spreadsheet_id = $1 AND tab_name = $2 AND row_index = $3`,
    [spreadsheetId, tab, row],
  );
  if (r.rowCount === 0) {
    const all = await hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
    return normalizeCellsWidth(all[row - 1] ?? [], width);
  }
  return normalizeCellsWidth(r.rows[0]!.cells_json ?? [], width);
}

export async function pgEnsureTab(pool: pg.Pool, spreadsheetId: string, tab: string, headers: readonly string[]): Promise<boolean> {
  const cleanHeaders = headers.map((h) => String(h ?? ''));
  const existing = await pool.query<{ hydrated_at: string | null }>(
    `SELECT hydrated_at FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
    [spreadsheetId, tab],
  );
  if ((existing.rowCount ?? 0) > 0 && existing.rows[0]?.hydrated_at) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO umbm_sheet_tabs (spreadsheet_id, tab_name, headers_json, row_count, hydrated_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, NOW(), NOW())
       ON CONFLICT (spreadsheet_id, tab_name) DO UPDATE SET headers_json = EXCLUDED.headers_json, hydrated_at = COALESCE(umbm_sheet_tabs.hydrated_at, NOW()), updated_at = NOW()`,
      [spreadsheetId, tab, JSON.stringify(cleanHeaders)],
    );
    await client.query(
      `INSERT INTO umbm_sheet_outbox (spreadsheet_id, tab_name, op_type, payload_json) VALUES ($1, $2, 'ENSURE_TAB', $3::jsonb)`,
      [spreadsheetId, tab, JSON.stringify({ headers: cleanHeaders })],
    );
    await client.query('COMMIT');
    return true;
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
}

export async function pgAppendRows(pool: pg.Pool, spreadsheetId: string, tab: string, rows: string[][]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tabRes = await client.query<{ headers_json: string[]; row_count: number }>(
      `SELECT headers_json, row_count FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2 FOR UPDATE`,
      [spreadsheetId, tab],
    );
    const headers = tabRes.rows[0]?.headers_json ?? [];
    const maxRowRes = await client.query<{ max_row: number | null }>(
      `SELECT MAX(row_index) AS max_row FROM umbm_sheet_rows WHERE spreadsheet_id = $1 AND tab_name = $2`,
      [spreadsheetId, tab],
    );
    const currentMax = Math.max(1, Number(tabRes.rows[0]?.row_count ?? 1), Number(maxRowRes.rows[0]?.max_row ?? 1));
    const firstRow = currentMax + 1;
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i]!.map((c) => String(c ?? ''));
      const rowIndex = firstRow + i;
      await client.query(
        `INSERT INTO umbm_sheet_rows (spreadsheet_id, tab_name, row_index, record_id, version, cells_json, row_hash, synced_to_remote, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, FALSE, NOW())
         ON CONFLICT (spreadsheet_id, tab_name, row_index) DO UPDATE SET record_id = EXCLUDED.record_id, version = EXCLUDED.version, cells_json = EXCLUDED.cells_json, row_hash = EXCLUDED.row_hash, synced_to_remote = FALSE, updated_at = NOW()`,
        [spreadsheetId, tab, rowIndex, String(cells[0] ?? ''), extractRowVersion(headers, cells), JSON.stringify(cells), computeRowHash(cells)],
      );
    }
    await client.query(
      `INSERT INTO umbm_sheet_tabs (spreadsheet_id, tab_name, headers_json, row_count, hydrated_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
       ON CONFLICT (spreadsheet_id, tab_name) DO UPDATE SET row_count = $4, updated_at = NOW()`,
      [spreadsheetId, tab, JSON.stringify(headers), firstRow + rows.length - 1],
    );
    await client.query(
      `INSERT INTO umbm_sheet_outbox (spreadsheet_id, tab_name, op_type, row_index, payload_json) VALUES ($1, $2, 'APPEND_ROWS', $3, $4::jsonb)`,
      [spreadsheetId, tab, firstRow, JSON.stringify({ firstRow, rows })],
    );
    await client.query('COMMIT');
    return firstRow;
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
}

export async function pgUpdateRow(pool: pg.Pool, spreadsheetId: string, tab: string, row: number, cleanValues: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (row === 1) {
      await client.query(
        `INSERT INTO umbm_sheet_tabs (spreadsheet_id, tab_name, headers_json, row_count, hydrated_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 1, NOW(), NOW())
         ON CONFLICT (spreadsheet_id, tab_name) DO UPDATE SET headers_json = EXCLUDED.headers_json, updated_at = NOW()`,
        [spreadsheetId, tab, JSON.stringify(cleanValues)],
      );
    } else {
      const tabRes = await client.query<{ headers_json: string[] }>(
        `SELECT headers_json FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
        [spreadsheetId, tab],
      );
      const headers = tabRes.rows[0]?.headers_json ?? [];
      await client.query(
        `INSERT INTO umbm_sheet_rows (spreadsheet_id, tab_name, row_index, record_id, version, cells_json, row_hash, synced_to_remote, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, FALSE, NOW())
         ON CONFLICT (spreadsheet_id, tab_name, row_index) DO UPDATE SET record_id = EXCLUDED.record_id, version = EXCLUDED.version, cells_json = EXCLUDED.cells_json, row_hash = EXCLUDED.row_hash, synced_to_remote = FALSE, updated_at = NOW()`,
        [spreadsheetId, tab, row, String(cleanValues[0] ?? ''), extractRowVersion(headers, cleanValues), JSON.stringify(cleanValues), computeRowHash(cleanValues)],
      );
    }
    await client.query(
      `INSERT INTO umbm_sheet_outbox (spreadsheet_id, tab_name, op_type, row_index, record_id, payload_json) VALUES ($1, $2, 'UPDATE_ROW', $3, $4, $5::jsonb)`,
      [spreadsheetId, tab, row, String(cleanValues[0] ?? ''), JSON.stringify({ row, values: cleanValues })],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
}

export async function pgBatchUpdateRows(pool: pg.Pool, spreadsheetId: string, tab: string, items: { row: number; values: string[] }[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tabRes = await client.query<{ headers_json: string[] }>(
      `SELECT headers_json FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
      [spreadsheetId, tab],
    );
    const headers = tabRes.rows[0]?.headers_json ?? [];
    for (const { row, values } of items) {
      const clean = values.map((v) => String(v ?? ''));
      await client.query(
        `INSERT INTO umbm_sheet_rows (spreadsheet_id, tab_name, row_index, record_id, version, cells_json, row_hash, synced_to_remote, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, FALSE, NOW())
         ON CONFLICT (spreadsheet_id, tab_name, row_index) DO UPDATE SET record_id = EXCLUDED.record_id, version = EXCLUDED.version, cells_json = EXCLUDED.cells_json, row_hash = EXCLUDED.row_hash, synced_to_remote = FALSE, updated_at = NOW()`,
        [spreadsheetId, tab, row, String(clean[0] ?? ''), extractRowVersion(headers, clean), JSON.stringify(clean), computeRowHash(clean)],
      );
    }
    await client.query(
      `INSERT INTO umbm_sheet_outbox (spreadsheet_id, tab_name, op_type, payload_json) VALUES ($1, $2, 'BATCH_UPDATE_ROWS', $3::jsonb)`,
      [spreadsheetId, tab, JSON.stringify({ items: items.map((x) => ({ row: x.row, values: x.values.map((v) => String(v ?? '')) })) })],
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
}
