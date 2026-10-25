import type { SagaStatus } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { nowIso } from '../lib/time.js';
import { scanUniqueKeys, scanUserInvariants, type ReconciliationIssue, type ReconciliationReport } from './reconciliation-scan.js';
import { scanSystemTables } from './reconciliation-system-scan.js';

export type { ReconciliationIssue, ReconciliationReport } from './reconciliation-scan.js';

export interface SagaStep<TContext> {
  name: string;
  run: (ctx: TContext) => Promise<void>;
  compensate?: (ctx: TContext) => Promise<void>;
}

export interface SagaOptions<TContext, TResult> {
  sagaKey: string;
  operation: string;
  actorId: string;
  initialContext: TContext;
  steps: SagaStep<TContext>[];
  resultSelector: (ctx: TContext) => TResult;
}

/**
 * Bộ máy Saga & Đối soát Toàn vẹn Dữ liệu (Reconciliation Engine).
 * Giải quyết bài toán Google Sheets không có ACID Transaction đa bảng và không có
 * ràng buộc khóa ngoại / khóa duy nhất ở tầng cơ sở dữ liệu.
 */
export class ReconciliationService {
  constructor(private readonly db: Database) {}

  /**
   * Thực thi chuỗi thao tác nhiều bước (Saga Pattern).
   * Nếu bước sau thất bại, tự động chạy hàm bù trừ (compensate) theo thứ tự ngược lại.
   * Nếu bù trừ thất bại, ghi vào OPERATION_JOURNAL & SYNC_DEAD_LETTER với trạng thái NEEDS_RECONCILIATION.
   */
  async executeSaga<TContext, TResult>(options: SagaOptions<TContext, TResult>): Promise<TResult> {
    const completedSteps: { step: SagaStep<TContext>; completedAt: string }[] = [];
    const journalRow = await this.db.operationJournal.insert(
      {
        saga_key: options.sagaKey,
        operation: options.operation,
        actor_id: options.actorId,
        status: 'PENDING',
        steps_json: '[]',
        error: '',
        completed_at: '',
      },
      options.actorId,
    );

    const ctx = options.initialContext;

    try {
      for (const step of options.steps) {
        await step.run(ctx);
        completedSteps.push({ step, completedAt: nowIso() });
      }

      await this.db.operationJournal.update(
        journalRow.id,
        journalRow.version,
        {
          status: 'COMMITTED',
          steps_json: JSON.stringify(completedSteps.map((s) => ({ name: s.step.name, at: s.completedAt }))),
          completed_at: nowIso(),
        },
        options.actorId,
      );

      return options.resultSelector(ctx);
    } catch (stepError) {
      const errorMsg = (stepError as Error).message || 'Lỗi khi thực thi giao dịch đa bảng';
      let finalStatus: SagaStatus = 'COMPENSATED';
      const compensationErrors: string[] = [];

      for (const completed of [...completedSteps].reverse()) {
        if (!completed.step.compensate) continue;
        try {
          await completed.step.compensate(ctx);
        } catch (compErr) {
          finalStatus = 'NEEDS_RECONCILIATION';
          compensationErrors.push(`${completed.step.name}: ${(compErr as Error).message}`);
        }
      }

      const combinedError =
        compensationErrors.length > 0
          ? `${errorMsg} | Lỗi hoàn tác: ${compensationErrors.join('; ')}`
          : errorMsg;

      await this.db.operationJournal.update(
        journalRow.id,
        journalRow.version,
        {
          status: finalStatus,
          steps_json: JSON.stringify(completedSteps.map((s) => ({ name: s.step.name, at: s.completedAt }))),
          error: combinedError.slice(0, 1500),
          completed_at: nowIso(),
        },
        options.actorId,
      );

      if (finalStatus === 'NEEDS_RECONCILIATION') {
        await this.db.deadLetters.insert(
          {
            spreadsheet: 'SYSTEM',
            tab: 'OPERATION_JOURNAL',
            operation: options.operation,
            payload_json: JSON.stringify({ sagaKey: options.sagaKey, journalId: journalRow.id }),
            error: combinedError.slice(0, 1500),
            attempts: 1,
            resolved_at: '',
          },
          options.actorId,
        );
      }

      throw stepError;
    }
  }

  /**
   * Quét toàn bộ dữ liệu trên các bảng để phát hiện sai lệch và tự động sửa chữa các lỗi an toàn.
   */
  async scanAndRepair(opts: { autoFix?: boolean; actorId?: string } = {}): Promise<ReconciliationReport> {
    const autoFix = opts.autoFix ?? true;
    const actorId = opts.actorId ?? 'system-reconciler';
    const now = nowIso();
    const issues: ReconciliationIssue[] = [
      ...(await scanUniqueKeys(this.db, { autoFix, actorId })),
      ...(await scanUserInvariants(this.db, { autoFix, actorId, now })),
    ];
    const system = scanSystemTables(this.db);
    issues.push(...system.issues);

    const autoRepaired = issues.filter((i) => i.autoRepaired).length;
    const unresolved = issues.filter((i) => !i.autoRepaired);
    const status = unresolved.length > 0 ? 'degraded' : 'ok';

    return {
      checkedAt: now,
      status,
      summary: {
        tablesScanned: system.tablesScanned,
        rowsScanned: system.rowsScanned,
        issuesFound: issues.length,
        autoRepaired,
        unresolvedIssues: unresolved.length,
      },
      issues,
    };
  }
}
