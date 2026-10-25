import { z } from 'zod';
import { zSystemColumns } from '@umbm/shared';

/** Schema các bảng hệ thống chỉ dùng phía api. */

export const zAuditRow = zSystemColumns.extend({
  at: z.string(),
  actor_user_id: z.string(),
  actor_role: z.string(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string(),
  before_json: z.string().default(''),
  after_json: z.string().default(''),
  ip: z.string().default(''),
  user_agent: z.string().default(''),
  request_id: z.string().default(''),
});
export type AuditRow = z.infer<typeof zAuditRow>;

export const zDeadLetterRow = zSystemColumns.extend({
  spreadsheet: z.string(),
  tab: z.string(),
  operation: z.string(),
  payload_json: z.string(),
  error: z.string(),
  attempts: z.coerce.number().int(),
  resolved_at: z.string().default(''),
});
export type DeadLetterRow = z.infer<typeof zDeadLetterRow>;

export const zBackupLogRow = zSystemColumns.extend({
  kind: z.enum(['DAILY', 'CRITICAL', 'PRE_OPERATION', 'WEEKLY', 'MONTHLY']),
  started_at: z.string(),
  finished_at: z.string().default(''),
  status: z.enum(['RUNNING', 'SUCCESS', 'FAILED']),
  drive_folder_id: z.string().default(''),
  files_count: z.coerce.number().int().default(0),
  rows_json: z.string().default(''),
  error: z.string().default(''),
});
export type BackupLogRow = z.infer<typeof zBackupLogRow>;

export const zOperationJournalRow = zSystemColumns.extend({
  saga_key: z.string(),
  operation: z.string(),
  actor_id: z.string(),
  status: z.enum(['PENDING', 'COMMITTED', 'COMPENSATED', 'NEEDS_RECONCILIATION']),
  steps_json: z.string().default('[]'),
  error: z.string().default(''),
  completed_at: z.string().default(''),
});
export type OperationJournalRow = z.infer<typeof zOperationJournalRow>;
