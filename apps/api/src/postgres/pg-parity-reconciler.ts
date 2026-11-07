import type pg from 'pg';
import type { SheetsGateway } from '../sheets/gateway.js';
import { computeRowHash, extractRowVersion, normalizeCellsWidth } from './pg-schema.js';
import { buildRowUpsertQuery, resolvePgTableDescriptor } from './pg-table-registry.js';

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

interface PgRowSnapshot {
  rowIndex: number;
  recordId: string;
  version: number;
  cells: string[];
  rowHash: string;
  syncedToRemote: boolean;
}

/**
 * Nạp toàn bộ dữ liệu của 1 tab từ Google Sheets vào bảng vật lý PostgreSQL tương ứng (`core_users`, `hr_employees`, ...).
 */
export async function hydrateTabFromRemoteToPostgres(
  pool: pg.Pool,
  remote: SheetsGateway,
  spreadsheetId: string,
  tab: string,
): Promise<string[][]> {
  const desc = resolvePgTableDescriptor(tab);
  const remoteRows = await remote.readTab(spreadsheetId, tab);
  const rawHeaders = (remoteRows[0] ?? []).map((c) => String(c ?? ''));
  const headers = rawHeaders.length > 0 ? rawHeaders : [...desc.columns];
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
      `DELETE FROM public.${desc.pgTableName} WHERE _spreadsheet_id = $1 AND _tab_name = $2`,
      [spreadsheetId, tab],
    );

    for (let i = 1; i < remoteRows.length; i++) {
      const rawCells = (remoteRows[i] ?? []).map((c) => String(c ?? ''));
      if (rawCells.every((c) => c === '')) continue;
      const recordId = String(rawCells[0] ?? '').trim();
      if (!recordId) continue;
      const cells = normalizeCellsWidth(rawCells, desc.columns.length);
      const rowIndex = i + 1;
      await client.query(buildRowUpsertQuery(desc, spreadsheetId, tab, rowIndex, cells, computeRowHash(cells), true));
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
 * Đối soát và đồng bộ 2 chiều giữa bảng vật lý PostgreSQL và Google Sheets cho 1 tab:
 * - Bản ghi có ở Postgres nhưng thiếu trên Sheet (hoặc Postgres có version cao hơn) -> Đẩy lên Google Sheets.
 * - Bản ghi mới trên Sheet (ví dụ phát sinh khi Fallback hoặc Google Form) hoặc Sheet có version cao hơn -> Kéo về Postgres.
 * - Tự động căn chỉnh lại `_row_index` theo đúng vị trí dòng thực tế trên Google Sheets.
 */
export async function reconcileTabTwoWay(
  pool: pg.Pool,
  remote: SheetsGateway,
  spreadsheetId: string,
  tab: string,
): Promise<TabParityResult> {
  const desc = resolvePgTableDescriptor(tab);
  const tabMeta = await pool.query<{ headers_json: string[]; hydrated_at: string | null }>(
    `SELECT headers_json, hydrated_at FROM umbm_sheet_tabs WHERE spreadsheet_id = $1 AND tab_name = $2`,
    [spreadsheetId, tab],
  );
  if (tabMeta.rowCount === 0 || !tabMeta.rows[0]?.hydrated_at) {
    await hydrateTabFromRemoteToPostgres(pool, remote, spreadsheetId, tab);
    return { spreadsheetId, tab, pushedToSheets: 0, pulledToPostgres: 0, realignedRows: 0 };
  }

  const remoteRows = await remote.readTab(spreadsheetId, tab);
  const headers = (remoteRows[0] ?? tabMeta.rows[0]!.headers_json ?? desc.columns).map((c) => String(c ?? ''));
  if (remoteRows.length === 0 && headers.length > 0) {
    await remote.ensureTab(spreadsheetId, tab, headers);
  }

  const pgRes = await pool.query<unknown[]>({
    text: `SELECT ${desc.selectColumnsSql}, _row_index, _synced_to_remote FROM public.${desc.pgTableName} WHERE _spreadsheet_id = $1 AND _tab_name = $2 ORDER BY _row_index ASC`,
    values: [spreadsheetId, tab],
    rowMode: 'array',
  });
  const colLen = desc.columns.length;
  const pgById = new Map<string, PgRowSnapshot>();
  for (const raw of pgRes.rows) {
    const cells = raw.slice(0, colLen).map((c) => String(c ?? ''));
    const recordId = String(cells[0] ?? '').trim();
    if (!recordId) continue;
    pgById.set(recordId, {
      rowIndex: Number(raw[colLen]),
      recordId,
      version: extractRowVersion(desc.columns, cells),
      cells,
      rowHash: computeRowHash(cells),
      syncedToRemote: Boolean(raw[colLen + 1]),
    });
  }

  const sheetById = new Map<string, { rowIndex: number; cells: string[]; version: number; hash: string }>();
  for (let i = 1; i < remoteRows.length; i++) {
    const rawCells = (remoteRows[i] ?? []).map((c) => String(c ?? ''));
    if (rawCells.every((c) => c === '')) continue;
    const id = String(rawCells[0] ?? '').trim();
    if (!id) continue;
    const cells = normalizeCellsWidth(rawCells, colLen);
    sheetById.set(id, {
      rowIndex: i + 1,
      cells,
      version: extractRowVersion(desc.columns, cells),
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
      toAppendOnSheet.push(pgRow.cells);
      pushedToSheets++;
      continue;
    }
    if (pgRow.rowHash !== sh.hash) {
      const pgWins = pgRow.version > sh.version || (pgRow.version === sh.version && !pgRow.syncedToRemote);
      if (pgWins) {
        toUpdateOnSheet.push({ row: sh.rowIndex, values: pgRow.cells });
        pushedToSheets++;
      } else {
        pulledToPostgres++;
      }
    } else if (pgRow.rowIndex !== sh.rowIndex) {
      realignedRows++;
    }
  }

  for (const [id] of sheetById.entries()) {
    if (!pgById.has(id)) pulledToPostgres++;
  }

  if (toUpdateOnSheet.length > 0) await remote.batchUpdateRows(spreadsheetId, tab, toUpdateOnSheet);
  if (toAppendOnSheet.length > 0) await remote.appendRows(spreadsheetId, tab, toAppendOnSheet);

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
