import { createHash } from 'node:crypto';
import pg from 'pg';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  connectionTimeoutMillis?: number;
  max?: number;
}

/**
 * Phân tích chuỗi kết nối PostgreSQL:
 * Hỗ trợ cả 2 chuẩn:
 * 1) Chuỗi Key-Value: "Host=localhost;Port=5432;Database=umbm_db;Username=postgres;Password=sa"
 * 2) Chuỗi URI chuẩn: "postgresql://postgres:sa@localhost:5432/umbm_db"
 */
export function parsePostgresConfig(raw: string): PostgresConnectionConfig | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const sslMode = url.searchParams.get('sslmode') || '';
    const needSsl = sslMode === 'require' || (!['localhost', '127.0.0.1'].includes(url.hostname) && sslMode !== 'disable');
    return {
      host: url.hostname || 'localhost',
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'umbm_db',
      user: decodeURIComponent(url.username || 'postgres'),
      password: decodeURIComponent(url.password || ''),
      ...(needSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      connectionTimeoutMillis: 2500,
      max: 12,
    };
  }

  if (trimmed.includes('=')) {
    const kv = new Map<string, string>();
    for (const part of trimmed.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const k = part.slice(0, idx).trim().toLowerCase();
      const v = part.slice(idx + 1).trim();
      kv.set(k, v);
    }
    const host = kv.get('host') || kv.get('server') || 'localhost';
    const port = Number(kv.get('port') || 5432);
    const database = kv.get('database') || kv.get('initial catalog') || 'umbm_db';
    const user = kv.get('username') || kv.get('user id') || kv.get('uid') || kv.get('user') || 'postgres';
    const password = kv.get('password') || kv.get('pwd') || '';
    const sslMode = (kv.get('ssl mode') || kv.get('sslmode') || '').toLowerCase();
    const needSsl = sslMode === 'require' || (!['localhost', '127.0.0.1'].includes(host) && sslMode !== 'disable' && sslMode !== '');
    return {
      host,
      port,
      database,
      user,
      password,
      ...(needSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      connectionTimeoutMillis: 2500,
      max: 12,
    };
  }

  return null;
}

/** Tự động tạo database đích (ví dụ `umbm_db`) nếu chưa tồn tại trên PostgreSQL server. */
export async function ensureDatabaseExists(cfg: PostgresConnectionConfig): Promise<void> {
  const probe = new pg.Client({ ...cfg });
  try {
    await probe.connect();
    await probe.end();
    return;
  } catch (err) {
    await probe.end().catch(() => undefined);
    const code = (err as { code?: string })?.code;
    if (code !== '3D000') throw err;
  }

  const adminClient = new pg.Client({ ...cfg, database: 'postgres' });
  await adminClient.connect();
  try {
    const safeDbName = cfg.database.replace(/"/g, '""');
    const check = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
    if (check.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${safeDbName}"`);
    }
  } finally {
    await adminClient.end().catch(() => undefined);
  }
}

/** Khởi tạo đầy đủ bảng lưu trữ bản ghi, bản đồ dòng và hàng đợi Outbox đồng bộ Google Sheets. */
export async function ensurePostgresSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS umbm_sheet_tabs (
      spreadsheet_id TEXT NOT NULL,
      tab_name TEXT NOT NULL,
      headers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_count INTEGER NOT NULL DEFAULT 1,
      hydrated_at TIMESTAMPTZ,
      last_reconciled_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (spreadsheet_id, tab_name)
    );

    CREATE TABLE IF NOT EXISTS umbm_sheet_rows (
      spreadsheet_id TEXT NOT NULL,
      tab_name TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      record_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      cells_json JSONB NOT NULL,
      row_hash TEXT NOT NULL,
      synced_to_remote BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (spreadsheet_id, tab_name, row_index)
    );

    CREATE INDEX IF NOT EXISTS idx_umbm_sheet_rows_record
      ON umbm_sheet_rows (spreadsheet_id, tab_name, record_id);

    CREATE TABLE IF NOT EXISTS umbm_sheet_outbox (
      seq_id BIGSERIAL PRIMARY KEY,
      spreadsheet_id TEXT NOT NULL,
      tab_name TEXT NOT NULL,
      op_type TEXT NOT NULL,
      row_index INTEGER,
      record_id TEXT,
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_umbm_sheet_outbox_pending
      ON umbm_sheet_outbox (status, seq_id)
      WHERE status = 'PENDING';
  `);
}

export function computeRowHash(cells: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(cells.map((c) => String(c ?? '')))).digest('hex');
}

export function extractRowVersion(headers: readonly string[], cells: readonly string[]): number {
  const vIdx = headers.indexOf('version');
  if (vIdx >= 0) {
    const parsed = Number(cells[vIdx]);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  }
  const fallback = Number(cells[5]);
  return Number.isFinite(fallback) && fallback >= 1 ? Math.floor(fallback) : 1;
}

export function normalizeCellsWidth(cells: readonly string[], width: number): string[] {
  const out: string[] = new Array(Math.max(width, cells.length));
  for (let i = 0; i < out.length; i++) out[i] = String(cells[i] ?? '');
  return out;
}
