import { MAX_CELL_CHARS } from '@umbm/shared';
import type { Database } from '../data/database.js';
import { nowIso } from '../lib/time.js';

export interface AuditContext {
  actorUserId: string;
  actorRole: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEYS = new Set(['password_hash', 'secret', 'pin', 'token', 'refresh_token']);

function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redact(v);
  return out;
}

/** JSON đã ẩn dữ liệu nhạy cảm, cắt bớt nếu vượt giới hạn ký tự của một ô Sheets. */
export function toAuditJson(value: unknown): string {
  if (value === undefined) return '';
  const json = JSON.stringify(redact(value));
  return json.length > MAX_CELL_CHARS ? `${json.slice(0, MAX_CELL_CHARS)}…[TRUNCATED]` : json;
}

/**
 * Ghi audit log append-only (SEC-04). Không có API sửa/xóa.
 * Lỗi ghi audit không làm hỏng thao tác chính nhưng được log lại để xử lý.
 */
export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly onError: (err: unknown) => void,
  ) {}

  async record(ctx: AuditContext, entry: AuditEntry): Promise<void> {
    try {
      const store = await this.db.audit();
      await store.insert(
        {
          at: nowIso(),
          actor_user_id: ctx.actorUserId,
          actor_role: ctx.actorRole,
          action: entry.action,
          entity: entry.entity,
          entity_id: entry.entityId,
          before_json: toAuditJson(entry.before),
          after_json: toAuditJson(entry.after),
          ip: ctx.ip ?? '',
          user_agent: (ctx.userAgent ?? '').slice(0, 300),
          request_id: ctx.requestId ?? '',
        },
        ctx.actorUserId,
      );
    } catch (err) {
      this.onError(err);
    }
  }
}
