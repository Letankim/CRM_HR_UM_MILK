import type pg from 'pg';
import type { SheetsGateway } from '../sheets/gateway.js';
import { computeRowHash, extractRowVersion } from './pg-schema.js';

export interface TabParityResult {
  spreadsheetId: string;
  tab: string;
  pushedToSheets: number;
  pulledToPostgres: number;
  realignedRows: number;
}

export interface PostgresParityReport {
  checkedAt: string;
  tabsChecked: number;
  pushedToSheets: number;
  pulledToPostgres: number;
  realignedRows: number;
  details: TabParityResult[];
}

interface PgRowRecord {
  row_index: number;
  record_id: string;
  version: number;
  cells_json: string[];
  row_hash: string;
  synced_to_remote: boolean;
}

/**
 * Nạp lần đầu toàn bộ dữ liệu của 1 tab từ Google Sheets xuống PostgreSQL (Hydration).
 */
export async function hydrateTabFromRemoteToPostgres(
  pool: pg.Pool,
  remote: SheetsGateway,
  spreadsheetId: string,
  tab: string,
): Promise<string[][]> {
  const remoteRows = await remote.readTab(spreadsheetId, tab);
  const headers = (remoteRows[0] ?? []).map((c) => String(c ?? ''));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO umbm_sheet_tabs (spreadsheet_id, tab_name, headers_json, row_count, hydrated_at, last_reconciled_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW(), NOW())
       ON CONFLICT (spreadsheet_id, tab_name) DO UPDATE
       SET headers_json = EXCLUDED.headers_json,
           row_count = EXCLUDED.row_count,
           hydrated_at = COALESCE(umbm_sheet_tabs.hydrated_at, NOW()),
           last_reconciled_at = NOW(),
           updated_at = NOW()`,
      [spreadsheetId, tab, JSON.stringify(headers), Math.max(1, remoteRows.length)],
    );

    await client.query(
      `DELETE FROM umbm_sheet_rows WHERE spreadsheet_id = $1 AND tab_name = $2`,
      [spreadsheetId, tab],
    );

    for (let i = 1; i < remoteRows.length; i++) {
      const cells = (remoteRows[i] ?? []).map((c) => String(c ?? ''));
      if (cells.every((c) => c === '')) continue;
      const recordId = String(cells[0] ?? '').trim();
      if (!recordId) continue;
      const rowIndex = i + 1;
      const version = extractRowVersion(headers, cells);
      const rowHash = computeRowHash(cells);
      await client.query(
        `INSERT INTO umbm_sheet_rows (spreadsheet_id, tab_name, row_index, record_id, version, cells_json, row_hash, synced_to_remote, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, TRUE, NOW())
         ON CONFLICT (spreadsheet_id, tab_name, row_index) DO UPDATE
         SET record_id = EXCLUDED.record_id, version = EXCLUDED.version, cells_json = EXCLUDED.cells_json,
             row_hash = EXCLUDED.row_hash, synced_to_remote = TRUE, updated_at = NOW()`,
        [spreadsheetId, tab, rowIndex, recordId, version, JSON.stringify(cells), rowHash],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return remoteRows;
}

/**
 * Đối soát và đồng bộ 2 chiều giữa PostgreSQL và Google Sheets cho 1 tab:
 * - Bản ghi có ở Postgres nhưng thiếu trên Sheet (hoặc Postgres có version cao hơn) -> Đẩy lên Google Sheets.
 * - Bản ghi mới trên Sheet (ví dụ phát sinh khi Fallback hoặc Google Form) hoặc Sheet có version cao hơn -> Kéo về Postgres.
 * - Tự động căn chỉnh lại `row_index` theo đúng vị trí dòng thực tế trên Google Sheets.
 */
export async function reconcileTabTwoWay(
  pool: pg.Pool,
  remote: SheetsGateway,
  spreadsheetId: string,
  tab: string,
): Promise<TabParityResult> {
  const tabMeta = await pool.query<{ headers_json: string[]; hydrated_at: string | null }>(
    `SELECT headers_json, hydrated_at FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
    [spreadsheetId, tab],
  );
  if (tabMeta.rowCount === 0 || !tabMeta.rows[0]?.hydrated_at) {
    await hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
    return { spreadsheetId, tab, pushedToSheets: 0, pulledToPostgres: 0, realignedRows: 0 };
  }

  const remoteRows = await remote.readTab(spreadsheetId, tab);
  const headers = (remoteRows[0] ?? tabMeta.rows[0]!.headers_json ?? []).map((c) => String(c ?? ''));
  if (remoteRows.length === 0 && headers.length > 0) {
    await remote.ensureTab(spreadsheetId, tab, headers);
  }

  const pgRes = await pool.query<PgRowRecord>(
    `SELECT row_index, record_id, version, cells_json, row_hash, synced_to_remote
     FROM umbm_sheet_rows WHERE spreadsheet_id = $1 AND tab_name = $2 ORDER BY row_index ASC`,
    [spreadsheetId, tab],
  );
  const pgById = new Map<string, PgRowRecord>();
  for (const r of pgRes.rows) {
    if (r.record_id) pgById.set(r.record_id, r);
  }

  const sheetById = new Map<string, { rowIndex: number; cells: string[]; version: number; hash: string }>();
  for (let i = 1; i < remoteRows.length; i++) {
    const cells = (remoteRows[i] ?? []).map((c) => String(c ?? ''));
    if (cells.every((c) => c === '')) continue;
    const id = String(cells[0] ?? '').trim();
    if (!id) continue;
    sheetById.set(id, {
      rowIndex: i + 1,
      cells,
      version: extractRowVersion(headers, cells),
      hash: computeRowHash(cells),
    });
  }

  const toAppendOnSheet: string[][] = [];
  const toUpdateOnSheet: { row: number; values: string[] }[] = [];
  let pushedToSheets = 0;
  let pulledToPostgres = 0;
  let realignedRows = 0;

  for (const [id, pgRow] of pgById.entries()) {
    const sh = sheetById.get(id);
    if (!sh) {
      toAppendOnSheet.push(pgRow.cells_json);
      pushedToSheets++;
      continue;
    }
    if (pgRow.row_hash !== sh.hash) {
      const pgWins = pgRow.version > sh.version || (pgRow.version === sh.version && !pgRow.synced_to_remote);
      if (pgWins) {
        toUpdateOnSheet.push({ row: sh.rowIndex, values: pgRow.cells_json });
        pushedToSheets++;
      } else {
        pulledToPostgres++;
      }
    } else if (pgRow.row_index !== sh.rowIndex) {
      realignedRows++;
    }
  }

  for (const [id] of sheetById.entries()) {
    if (!pgById.has(id)) pulledToPostgres++;
  }

  if (toUpdateOnSheet.length > 0) {
    await remote.batchUpdateRows(spreadsheetId, tab, toUpdateOnSheet);
  }
  if (toAppendOnSheet.length > 0) {
    await remote.appendRows(spreadsheetId, tab, toAppendOnSheet);
  }

  // Sau khi đã đồng bộ các dòng mới hơn từ Postgres lên Sheet hoặc có dòng mới từ Sheet, nạp lại chuẩn hóa 100%
  if (pushedToSheets > 0 || pulledToPostgres > 0 || realignedRows > 0) {
    await hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
  } else {
    await pool.query(
      `UPDATE umbm_sheet_tabs SET last_reconciled_at = NOW() WHERE spreadsheet_id = $1 AND tab_name = $2`,
      [spreadsheetId, tab],
    );
  }

  return { spreadsheetId, tab, pushedToSheets, pulledToPostgres, realignedRows };
}
