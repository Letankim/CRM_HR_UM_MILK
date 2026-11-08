import { createHash } from 'node:crypto';
import pg from 'pg';
import { getAllPgTableDescriptors } from './pg-table-registry.js';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
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
    const host = url.hostname || 'localhost';
    const isLocal = ['localhost', '127.0.0.1'].includes(host);
    const sslMode = url.searchParams.get('sslmode') || '';
    const needSsl = sslMode === 'require' || (!isLocal && sslMode !== 'disable');
    return {
      host,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'umbm_db',
      user: decodeURIComponent(url.username || 'postgres'),
      password: decodeURIComponent(url.password || ''),
      ...(needSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      connectionTimeoutMillis: isLocal ? 2500 : 12000,
      idleTimeoutMillis: 30000,
      max: Number(process.env.POSTGRES_POOL_MAX || 8),
    };
  }

  if (trimmed.includes('=')) {
    const kv = new Map<string, string>();
    for (const part of trimmed.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      kv.set(part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim());
    }
    const host = kv.get('host') || kv.get('server') || 'localhost';
    const isLocal = ['localhost', '127.0.0.1'].includes(host);
    const port = Number(kv.get('port') || 5432);
    const database = kv.get('database') || kv.get('initial catalog') || 'umbm_db';
    const user = kv.get('username') || kv.get('user id') || kv.get('uid') || kv.get('user') || 'postgres';
    const password = kv.get('password') || kv.get('pwd') || '';
    const sslMode = (kv.get('ssl mode') || kv.get('sslmode') || '').toLowerCase();
    const needSsl = sslMode === 'require' || (!isLocal && sslMode !== 'disable' && sslMode !== '');
    return {
      host,
      port,
      database,
      user,
      password,
      ...(needSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      connectionTimeoutMillis: isLocal ? 2500 : 12000,
      idleTimeoutMillis: 30000,
      max: Number(process.env.POSTGRES_POOL_MAX || 8),
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
    if ((err as { code?: string })?.code !== '3D000') throw err;
  }

  const adminClient = new pg.Client({ ...cfg, database: 'postgres' });
  await adminClient.connect();
  try {
    const safeDbName = cfg.database.replace(/"/g, '""');
    const check = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
    if (check.rowCount === 0) await adminClient.query(`CREATE DATABASE "${safeDbName}"`);
  } finally {
    await adminClient.end().catch(() => undefined);
  }
}

/**
 * Khởi tạo đầy đủ 42 bảng nghiệp vụ chuẩn quan hệ (với đầy đủ cột thật theo schema V5.1 + B-Tree Indexes)
 * cùng bảng quản lý tab `umbm_sheet_tabs` và hàng đợi `umbm_sheet_outbox`.
 */
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

  const legacyCheck = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'umbm_sheet_rows'`,
  );
  if ((legacyCheck.rowCount ?? 0) > 0) {
    await pool.query(`DROP TABLE IF EXISTS public.umbm_sheet_rows CASCADE; UPDATE umbm_sheet_tabs SET hydrated_at = NULL;`);
  }

  const ddlStatements: string[] = [];
  for (const desc of getAllPgTableDescriptors()) {
    const colDefs = desc.columns.map((c) => `"${c}" TEXT NOT NULL DEFAULT ''`).join(',\n      ');
    ddlStatements.push(`
      CREATE TABLE IF NOT EXISTS public.${desc.pgTableName} (
        ${colDefs},
        _spreadsheet_id TEXT NOT NULL,
        _tab_name TEXT NOT NULL,
        _row_index INTEGER NOT NULL,
        _row_hash TEXT NOT NULL DEFAULT '',
        _synced_to_remote BOOLEAN NOT NULL DEFAULT FALSE,
        _updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (_spreadsheet_id, _tab_name, _row_index)
      );
      ALTER TABLE public.${desc.pgTableName} DROP CONSTRAINT IF EXISTS ${desc.pgTableName}_record_uniq;
      CREATE INDEX IF NOT EXISTS idx_${desc.pgTableName}_sheet_id
        ON public.${desc.pgTableName} (_spreadsheet_id, _tab_name, "id");
    `);
    for (const col of desc.indexedColumns) {
      ddlStatements.push(
        `CREATE INDEX IF NOT EXISTS idx_${desc.pgTableName}_${col} ON public.${desc.pgTableName} ("${col}");`,
      );
    }
  }
  await pool.query(ddlStatements.join('\n'));
}

export function computeRowHash(cells: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(cells.map((c) => String(c ?? '')))).digest('hex');
}

export function extractRowVersion(headers: readonly string[], cells: readonly string[]): number {
  const vIdx = headers.indexOf('version');
  const raw = vIdx >= 0 ? Number(cells[vIdx]) : Number(cells[5]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

export function normalizeCellsWidth(cells: readonly string[], width: number): string[] {
  const out: string[] = new Array(Math.max(width, cells.length));
  for (let i = 0; i < out.length; i++) out[i] = String(cells[i] ?? '');
  return out;
}
