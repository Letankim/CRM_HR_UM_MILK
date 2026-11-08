import { TABLE_DISPLAY_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { PostgresSyncedSheetsGateway } from '../postgres/pg-synced-gateway.js';
import { getAllPgTableDescriptors } from '../postgres/pg-table-registry.js';

export const PG_GROUP_LABELS: Record<string, string> = {
  CORE: 'Cốt lõi & Tài khoản',
  HR: 'Nhân sự, Tuyển dụng & Đề thi',
  SCHEDULE: 'Lịch làm việc & Nghỉ/Đổi ca',
  ATTENDANCE: 'Chấm công GPS & Bổ sung công',
  PAYROLL: 'Tiền lương & Phiếu lương',
  COMMS: 'Truyền thông, Thông báo & Hỗ trợ',
  SYSTEM: 'Hệ thống, Sao lưu & Saga',
  INFRA: 'Hạ tầng Đồng bộ PostgreSQL',
};

const MODE_LABELS: Record<string, string> = {
  PG_PRIMARY: 'PostgreSQL Chính (Đọc/Ghi trực tiếp + Đồng bộ ngầm)',
  SHEETS_FALLBACK: 'Dự phòng Google Sheets (Đang chờ khôi phục PostgreSQL)',
  PG_RECOVERING: 'Đang đối soát khôi phục PostgreSQL',
  DISABLED: 'Chưa bật PostgreSQL (Chạy trực tiếp bộ nhớ / Sheets)',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DevPgTableStat {
  pgTableName: string;
  domainKey: string;
  group: string;
  groupLabel: string;
  displayLabel: string;
  columnCount: number;
  indexCount: number;
  rowCount: number;
  unsyncedRows: number;
  deadRows: number;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
  sharePercent: number;
}

export async function collectDevPostgresTelemetry(ctx: AppContext) {
  const quotaMb = ctx.env.POSTGRES_MAX_STORAGE_MB;
  const quotaBytes = quotaMb * 1024 * 1024;
  const gw = ctx.db.gateway;

  if (!(gw instanceof PostgresSyncedSheetsGateway)) {
    return {
      enabled: false,
      alive: false,
      mode: 'DISABLED',
      modeLabel: MODE_LABELS.DISABLED,
      host: 'Chưa cấu hình DATABASE_URL',
      database: '-',
      serverVersion: '-',
      serverStartedAt: null as string | null,
      serverTime: null as string | null,
      pingLatencyMs: null as number | null,
      storage: {
        quotaMb, quotaBytes, usedBytes: 0, freeBytes: quotaBytes,
        usedMb: 0, freeMb: quotaMb, usagePercent: 0, freePercent: 100,
        tablesDataBytes: 0, tablesIndexBytes: 0, tablesTotalBytes: 0, systemOverheadBytes: 0,
      },
      connections: {
        serverMax: 0, serverUsed: 0, serverFree: 0, serverActive: 0, serverIdle: 0, usagePercent: 0,
        poolMax: ctx.env.POSTGRES_POOL_MAX, poolTotal: 0, poolIdle: 0, poolWaiting: 0,
      },
      sync: {
        hydratedTabs: 0, totalPhysicalRows: 0, totalUnsyncedRows: 0, dirtyFallbackTabs: 0,
        lastFallbackReason: null as string | null, lastRecoveredAt: null as string | null,
        outbox: { pending: 0, failed: 0, syncedTotal: 0, lastSyncedAt: null as string | null, lastError: null as string | null },
        recentHydratedTabs: [] as { tabName: string; rowCount: number; lastSyncedAt: string }[],
      },
      tables: [] as DevPgTableStat[],
    };
  }

  const [ping, syncStatus] = await Promise.all([gw.pingPostgres(3500), gw.status()]);
  const poolStats = {
    poolMax: gw.config.max ?? ctx.env.POSTGRES_POOL_MAX,
    poolTotal: gw.pool.totalCount,
    poolIdle: gw.pool.idleCount,
    poolWaiting: gw.pool.waitingCount,
  };

  if (!ping.alive) {
    return {
      enabled: true, alive: false, mode: syncStatus.mode,
      modeLabel: MODE_LABELS[syncStatus.mode] ?? syncStatus.mode,
      host: syncStatus.host, database: syncStatus.database,
      serverVersion: 'Không thể truy vấn khi mất kết nối', serverStartedAt: null, serverTime: null,
      pingLatencyMs: ping.latency_ms,
      storage: {
        quotaMb, quotaBytes, usedBytes: 0, freeBytes: quotaBytes,
        usedMb: 0, freeMb: quotaMb, usagePercent: 0, freePercent: 100,
        tablesDataBytes: 0, tablesIndexBytes: 0, tablesTotalBytes: 0, systemOverheadBytes: 0,
      },
      connections: { serverMax: 20, serverUsed: 0, serverFree: 20, serverActive: 0, serverIdle: 0, usagePercent: 0, ...poolStats },
      sync: {
        hydratedTabs: 0, totalPhysicalRows: 0, totalUnsyncedRows: 0, dirtyFallbackTabs: syncStatus.dirtyFallbackTabs,
        lastFallbackReason: syncStatus.lastFallbackReason, lastRecoveredAt: syncStatus.lastRecoveredAt,
        outbox: syncStatus.outbox, recentHydratedTabs: [],
      },
      tables: [] as DevPgTableStat[],
    };
  }

  const descriptors = getAllPgTableDescriptors();
  const descByPg = new Map(descriptors.map((d) => [d.pgTableName, d]));
  const unionCountsSql = [
    ...descriptors.map((d) => `SELECT '${d.pgTableName}' AS t, COUNT(*)::int AS c, COUNT(*) FILTER (WHERE NOT _synced_to_remote)::int AS u FROM public.${d.pgTableName}`),
    `SELECT 'umbm_sheet_tabs' AS t, COUNT(*)::int AS c, 0::int AS u FROM public.umbm_sheet_tabs`,
    `SELECT 'umbm_sheet_outbox' AS t, COUNT(*)::int AS c, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS u FROM public.umbm_sheet_outbox`,
  ].join(' UNION ALL ');

  const client = await gw.pool.connect();
  let metaRes, maxConnRes, actRes, relRes, cntRes, tabsRes;
  try {
    metaRes = await client.query<{ db_name: string; pg_version: string; started_at: string; server_time: string; db_size_bytes: string }>(
      `SELECT current_database() AS db_name, version() AS pg_version, pg_postmaster_start_time()::text AS started_at, NOW()::text AS server_time, pg_database_size(current_database())::text AS db_size_bytes`,
    );
    maxConnRes = await client.query<{ max_connections: string }>(`SHOW max_connections`);
    actRes = await client.query<{ state: string; cnt: number }>(
      `SELECT COALESCE(state, 'background') AS state, COUNT(*)::int AS cnt FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`,
    );
    relRes = await client.query<{ table_name: string; total_bytes: string; data_bytes: string; index_bytes: string; dead_rows: string; idx_count: number }>(
      `SELECT c.relname AS table_name, pg_total_relation_size(c.oid)::text AS total_bytes, pg_relation_size(c.oid)::text AS data_bytes,
              pg_indexes_size(c.oid)::text AS index_bytes, COALESCE(s.n_dead_tup, 0)::text AS dead_rows,
              (SELECT COUNT(*)::int FROM pg_index i WHERE i.indrelid = c.oid) AS idx_count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC, c.relname ASC`,
    );
    cntRes = await client.query<{ t: string; c: number; u: number }>(unionCountsSql);
    tabsRes = await client.query<{ tab_name: string; row_count: number; last_synced_at: string }>(
      `SELECT tab_name, row_count, updated_at::text AS last_synced_at FROM public.umbm_sheet_tabs ORDER BY updated_at DESC LIMIT 60`,
    );
  } finally {
    client.release();
  }

  const meta = metaRes.rows[0];
  const usedBytes = Number(meta?.db_size_bytes ?? 0);
  const freeBytes = Math.max(0, quotaBytes - usedBytes);
  const usagePercent = round2(Math.min(100, (usedBytes / quotaBytes) * 100));
  const serverMax = Number(maxConnRes.rows[0]?.max_connections ?? 20);
  const serverUsed = actRes.rows.reduce((s, r) => s + Number(r.cnt), 0);
  const serverActive = actRes.rows.filter((r) => r.state === 'active').reduce((s, r) => s + Number(r.cnt), 0);
  const serverIdle = actRes.rows.filter((r) => r.state === 'idle').reduce((s, r) => s + Number(r.cnt), 0);

  const countMap = new Map(cntRes.rows.map((r) => [r.t, { rowCount: Number(r.c), unsyncedRows: Number(r.u) }]));
  let tablesDataBytes = 0, tablesIndexBytes = 0, tablesTotalBytes = 0, totalPhysicalRows = 0, totalUnsyncedRows = 0;

  const tables: DevPgTableStat[] = relRes.rows.map((r) => {
    const desc = descByPg.get(r.table_name);
    const domainKey = desc ? `${desc.spreadsheetKey}.${desc.baseTabName}` : r.table_name.toUpperCase();
    const group = desc ? desc.spreadsheetKey : 'INFRA';
    const infraLabel = r.table_name === 'umbm_sheet_tabs'
      ? ' Danh mục Tab đã nạp đồng bộ (Metadata)'
      : r.table_name === 'umbm_sheet_outbox'
        ? 'Hàng đợi Outbox chờ đẩy Google Sheets'
        : r.table_name;
    const displayLabel = (desc ? TABLE_DISPLAY_LABELS[domainKey] || TABLE_DISPLAY_LABELS[desc.baseTabName] : infraLabel)?.trim() || domainKey;
    const cnt = countMap.get(r.table_name) ?? { rowCount: 0, unsyncedRows: 0 };
    const dataBytes = Number(r.data_bytes), indexBytes = Number(r.index_bytes), totalBytes = Number(r.total_bytes);
    tablesDataBytes += dataBytes;
    tablesIndexBytes += indexBytes;
    tablesTotalBytes += totalBytes;
    if (desc) {
      totalPhysicalRows += cnt.rowCount;
      totalUnsyncedRows += cnt.unsyncedRows;
    }
    return {
      pgTableName: r.table_name, domainKey, group, groupLabel: PG_GROUP_LABELS[group] ?? group,
      displayLabel, columnCount: desc ? desc.columns.length + 6 : (r.table_name === 'umbm_sheet_outbox' ? 11 : 4),
      indexCount: Number(r.idx_count), rowCount: cnt.rowCount, unsyncedRows: cnt.unsyncedRows,
      deadRows: Number(r.dead_rows), dataBytes, indexBytes, totalBytes,
      sharePercent: usedBytes > 0 ? round2((totalBytes / usedBytes) * 100) : 0,
    };
  });

  return {
    enabled: true, alive: true, mode: syncStatus.mode,
    modeLabel: MODE_LABELS[syncStatus.mode] ?? syncStatus.mode,
    host: syncStatus.host, database: meta?.db_name ?? syncStatus.database,
    serverVersion: (meta?.pg_version ?? '').split(' on ')[0] || meta?.pg_version || 'PostgreSQL',
    serverStartedAt: meta?.started_at ?? null, serverTime: meta?.server_time ?? null,
    pingLatencyMs: ping.latency_ms,
    storage: {
      quotaMb, quotaBytes, usedBytes, freeBytes,
      usedMb: round2(usedBytes / (1024 * 1024)), freeMb: round2(freeBytes / (1024 * 1024)),
      usagePercent, freePercent: round2(Math.max(0, 100 - usagePercent)),
      tablesDataBytes, tablesIndexBytes, tablesTotalBytes,
      systemOverheadBytes: Math.max(0, usedBytes - tablesTotalBytes),
    },
    connections: {
      serverMax, serverUsed, serverFree: Math.max(0, serverMax - serverUsed),
      serverActive, serverIdle, usagePercent: serverMax > 0 ? round2((serverUsed / serverMax) * 100) : 0,
      ...poolStats,
    },
    sync: {
      hydratedTabs: tabsRes.rowCount ?? tabsRes.rows.length,
      totalPhysicalRows, totalUnsyncedRows, dirtyFallbackTabs: syncStatus.dirtyFallbackTabs,
      lastFallbackReason: syncStatus.lastFallbackReason, lastRecoveredAt: syncStatus.lastRecoveredAt,
      outbox: syncStatus.outbox,
      recentHydratedTabs: tabsRes.rows.map((t) => ({ tabName: t.tab_name, rowCount: Number(t.row_count), lastSyncedAt: t.last_synced_at })),
    },
    tables,
  };
}
