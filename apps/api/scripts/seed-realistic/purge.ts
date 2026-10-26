/**
 * Gỡ sạch dữ liệu mẫu (purge): chỉ đánh dấu xóa mềm (is_deleted = TRUE) đúng các dòng có created_by = seed-realistic,
 * tăng version và ghi updated_by để TableStore / bộ đối soát nhận biết. Gom 1 request batchUpdate cho mỗi tab
 * (không ghi từng dòng) để không vượt quota Google Sheets. Không đụng tới bất kỳ dữ liệu thật nào.
 */
import { withRetry, type sheets_v4 } from '@umbm/google';
import { nowIso } from '../../src/lib/time.js';
import type { SheetsGateway } from '../../src/sheets/gateway.js';
import { SEED_ACTOR, TABLES, type TableKey } from './kit.js';

type Ids = Record<string, string>;

export async function purgeSeed(sheets: sheets_v4.Sheets, gw: SheetsGateway, ids: Ids, apply: boolean): Promise<Record<string, number>> {
  const report: Record<string, number> = {};
  const stamp = nowIso();
  for (const t of Object.keys(TABLES) as TableKey[]) {
    if (t === 'operationJournal') continue;
    const def = TABLES[t];
    const spreadsheetId = ids[def.key]!;
    const rows = await gw.readTab(spreadsheetId, def.tab);
    const header = rows[0] ?? [];
    const col = (name: string) => header.indexOf(name);
    const [cBy, cVer, cDel] = [col('created_by'), col('version'), col('is_deleted')];
    if (cBy !== 2 || col('updated_at') !== 3 || cVer !== 5 || cDel !== 6) throw new Error(`Cấu trúc cột hệ thống của ${def.tab} không đúng chuẩn, dừng gỡ dữ liệu để an toàn`);
    const targets = rows
      .map((r, i) => ({ r, row: i + 1 }))
      .slice(1)
      .filter((x) => (x.r[cBy] ?? '') === SEED_ACTOR && String(x.r[cDel] ?? '').toUpperCase() !== 'TRUE');
    report[`${def.key}.${def.tab}`] = targets.length;
    if (!apply || targets.length === 0) continue;
    const quoted = `'${def.tab.replace(/'/g, "''")}'`;
    const data = targets.map((x) => ({
      range: `${quoted}!D${x.row}:G${x.row}`,
      values: [[stamp, 'seed-purge', String((Number(x.r[cVer]) || 1) + 1), 'TRUE']],
    }));
    for (let i = 0; i < data.length; i += 500) {
      const chunk = data.slice(i, i + 500);
      await withRetry(() => sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: chunk } }));
    }
  }
  return report;
}
