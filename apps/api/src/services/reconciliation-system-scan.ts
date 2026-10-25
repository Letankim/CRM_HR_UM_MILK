import { RECONCILIATION_ISSUE_LABELS } from '@umbm/shared';
import type { Database } from '../data/database.js';
import type { ReconciliationIssue } from './reconciliation-scan.js';

/** 6-8. Kiểm tra Dead Letters chưa giải quyết, Saga bị kẹt và dòng sai schema trên các bảng. */
export function scanSystemTables(db: Database): { issues: ReconciliationIssue[]; tablesScanned: number; rowsScanned: number } {
  const issues: ReconciliationIssue[] = [];

  // 6. Kiểm tra Dead Letters chưa giải quyết
  for (const dl of db.deadLetters.filter((d) => !d.resolved_at)) {
    issues.push({
      id: `dl-${dl.id}`,
      code: 'UNRESOLVED_DEAD_LETTER',
      label: RECONCILIATION_ISSUE_LABELS.UNRESOLVED_DEAD_LETTER,
      severity: 'error',
      table: `${dl.spreadsheet}.${dl.tab}`,
      recordId: dl.id,
      message: `Thao tác "${dl.operation}" ghi lỗi chưa đồng bộ: ${dl.error}`,
      autoRepaired: false,
    });
  }

  // 7. Kiểm tra giao dịch Saga bị kẹt hoặc cần đối soát
  for (const op of db.operationJournal.filter(
    (j) => j.status === 'NEEDS_RECONCILIATION' || j.status === 'PENDING',
  )) {
    issues.push({
      id: `saga-${op.id}`,
      code: 'STUCK_SAGA_OPERATION',
      label: RECONCILIATION_ISSUE_LABELS.STUCK_SAGA_OPERATION,
      severity: op.status === 'NEEDS_RECONCILIATION' ? 'error' : 'warning',
      table: 'SYSTEM.OPERATION_JOURNAL',
      recordId: op.id,
      message: `Giao dịch đa bảng "${op.operation}" (${op.saga_key}) đang ở trạng thái ${op.status}`,
      autoRepaired: false,
    });
  }

  // 8. Kiểm tra dòng lỗi schema từ TableStore stats
  const stats = db.stats();
  let totalRows = 0;
  for (const t of stats.tables) {
    totalRows += t.rows;
    for (const inv of t.invalid) {
      issues.push({
        id: `invalid-${t.table}-${inv.row}`,
        code: 'SCHEMA_INVALID_ROW',
        label: RECONCILIATION_ISSUE_LABELS.SCHEMA_INVALID_ROW,
        severity: 'error',
        table: t.table,
        recordId: inv.id || `row-${inv.row}`,
        message: `Dòng ${inv.row} trên bảng ${t.table} sai định dạng: ${inv.issues.join('; ')}`,
        autoRepaired: false,
      });
    }
  }
  return { issues, tablesScanned: stats.tables.length, rowsScanned: totalRows };
}
