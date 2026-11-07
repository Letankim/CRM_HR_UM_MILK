import { SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';

export interface PgTableDescriptor {
  spreadsheetKey: SpreadsheetKey;
  baseTabName: string;
  pgTableName: string;
  columns: readonly string[];
  selectColumnsSql: string;
  indexedColumns: readonly string[];
}

const INDEX_CANDIDATE_COLUMNS = new Set([
  'id',
  'employee_id',
  'branch_id',
  'work_date',
  'period_id',
  'candidate_id',
  'user_id',
  'assignment_id',
  'schedule_week_id',
  'username',
  'phone',
  'employee_code',
  'code',
  'status',
]);

function buildPgTableName(spreadsheetKey: SpreadsheetKey, tabName: string): string {
  const prefix = spreadsheetKey.toLowerCase();
  const rawTab = tabName.toLowerCase();
  const stripped = rawTab.startsWith(`${prefix}_`) ? rawTab.slice(prefix.length + 1) : rawTab;
  return `${prefix}_${stripped}`;
}

const BY_BASE_TAB = new Map<string, PgTableDescriptor>();
const ALL_DESCRIPTORS: PgTableDescriptor[] = [];

for (const spreadsheetKey of Object.keys(SPREADSHEETS) as SpreadsheetKey[]) {
  const group = SPREADSHEETS[spreadsheetKey];
  for (const [tabName, cols] of Object.entries(group.tabs) as [string, readonly string[]][]) {
    const pgTableName = buildPgTableName(spreadsheetKey, tabName);
    const columns = [...cols];
    const selectColumnsSql = columns.map((c) => `"${c}"`).join(', ');
    const indexedColumns = columns.filter((c) => INDEX_CANDIDATE_COLUMNS.has(c));
    const desc: PgTableDescriptor = {
      spreadsheetKey,
      baseTabName: tabName,
      pgTableName,
      columns,
      selectColumnsSql,
      indexedColumns,
    };
    BY_BASE_TAB.set(tabName, desc);
    ALL_DESCRIPTORS.push(desc);
  }
}

/**
 * Chuẩn hóa tên tab (bao gồm cả tab phân vùng theo tháng như `SHIFT_ASSIGNMENTS_2026_12` hoặc `AUDIT_LOG_2026_11`)
 * về cấu trúc bảng vật lý PostgreSQL tương ứng.
 */
export function resolvePgTableDescriptor(tabName: string): PgTableDescriptor {
  const direct = BY_BASE_TAB.get(tabName);
  if (direct) return direct;
  const baseName = tabName.replace(/_\d{4}_(0[1-9]|1[0-2])$/, '');
  const stripped = BY_BASE_TAB.get(baseName);
  if (stripped) return stripped;
  throw new Error(`Không tìm thấy định nghĩa bảng PostgreSQL cho tab: ${tabName}`);
}

export function getAllPgTableDescriptors(): readonly PgTableDescriptor[] {
  return ALL_DESCRIPTORS;
}

/**
 * Sinh câu lệnh UPSERT 1 dòng vào bảng vật lý PostgreSQL với đầy đủ các cột thật.
 */
export function buildRowUpsertQuery(
  desc: PgTableDescriptor,
  spreadsheetId: string,
  tabName: string,
  rowIndex: number,
  cells: readonly string[],
  rowHash: string,
  syncedToRemote: boolean,
): { text: string; values: unknown[] } {
  const colNames = desc.columns.map((c) => `"${c}"`);
  const allCols = [...colNames, '_spreadsheet_id', '_tab_name', '_row_index', '_row_hash', '_synced_to_remote', '_updated_at'];
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < desc.columns.length; i++) {
    values.push(String(cells[i] ?? ''));
    placeholders.push(`$${values.length}`);
  }
  values.push(spreadsheetId, tabName, rowIndex, rowHash, syncedToRemote);
  placeholders.push(`$${values.length - 4}`, `$${values.length - 3}`, `$${values.length - 2}`, `$${values.length - 1}`, `$${values.length}`, 'NOW()');

  const updateSet = [
    ...desc.columns.map((c) => `"${c}" = EXCLUDED."${c}"`),
    '_row_hash = EXCLUDED._row_hash',
    '_synced_to_remote = EXCLUDED._synced_to_remote',
    '_updated_at = NOW()',
  ].join(', ');

  const text = `
    INSERT INTO public.${desc.pgTableName} (${allCols.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (_spreadsheet_id, _tab_name, _row_index)
    DO UPDATE SET ${updateSet}
  `;
  return { text, values };
}
