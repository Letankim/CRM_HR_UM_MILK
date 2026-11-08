'use client';

import type { ApiErrorEnvelope, ApiSuccessEnvelope } from '@umbm/shared';
import { ApiClientError } from './api';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';
const DEV_KEY_SESSION_KEY = 'umbm_dev_monitor_key';

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

export interface DevStoreStat {
  tableKey: string;
  group: string;
  groupLabel: string;
  tabName: string;
  displayLabel: string;
  activeRows: number;
  deletedRows: number;
  totalRows: number;
  invalidRows: number;
  isMonthlyPartitioned: boolean;
  loadedAt: string | null;
}

export interface DevSystemStatsResponse {
  generatedAt: string;
  postgres: {
    enabled: boolean;
    alive: boolean;
    mode: string;
    modeLabel: string;
    host: string;
    database: string;
    serverVersion: string;
    serverStartedAt: string | null;
    serverTime: string | null;
    pingLatencyMs: number | null;
    storage: {
      quotaMb: number;
      quotaBytes: number;
      usedBytes: number;
      freeBytes: number;
      usedMb: number;
      freeMb: number;
      usagePercent: number;
      freePercent: number;
      tablesDataBytes: number;
      tablesIndexBytes: number;
      tablesTotalBytes: number;
      systemOverheadBytes: number;
    };
    connections: {
      serverMax: number;
      serverUsed: number;
      serverFree: number;
      serverActive: number;
      serverIdle: number;
      usagePercent: number;
      poolMax: number;
      poolTotal: number;
      poolIdle: number;
      poolWaiting: number;
    };
    sync: {
      hydratedTabs: number;
      totalPhysicalRows: number;
      totalUnsyncedRows: number;
      dirtyFallbackTabs: number;
      lastFallbackReason: string | null;
      lastRecoveredAt: string | null;
      outbox: { pending: number; failed: number; syncedTotal: number; lastSyncedAt: string | null; lastError: string | null };
      recentHydratedTabs: { tabName: string; rowCount: number; lastSyncedAt: string }[];
    };
    tables: DevPgTableStat[];
  };
  domain: {
    ready: boolean;
    totalStores: number;
    totalActiveRows: number;
    totalDeletedRows: number;
    totalCachedRows: number;
    totalInvalidRows: number;
    moduleGroups: { group: string; groupLabel: string; tableCount: number; activeRows: number; deletedRows: number; totalRows: number }[];
    stores: DevStoreStat[];
    business: {
      accounts: { total: number; byStatus: { label: string; count: number }[]; byRole: { label: string; count: number }[] };
      employees: { total: number; activeWorking: number; onLeaveOrSuspended: number; resigned: number; branchesActive: number; branchesTotal: number; byStage: { label: string; count: number }[] };
      recruitment: { candidatesTotal: number; candidatesNewOrScreening: number; candidatesOfferedOrHired: number; candidatesRejected: number; interviewsTotal: number; interviewsEvaluated: number; testBankQuestions: number; testAttempts: number };
      operations: { activePartitionLabel: string; scheduleWeeks: number; shiftsTotal: number; shiftsCompleted: number; shiftsCheckedIn: number; shiftsAbsent: number; leavesTotal: number; leavesPending: number; swapsTotal: number; attendanceEvents: number; attendanceAdjustments: number };
      payroll: { payRates: number; periodsTotal: number; payrollItems: number; snapshots: number; payslips: number; revisions: number; payments: number; revenueInputs: number; byPeriodStatus: { label: string; count: number }[] };
      commsAndSystem: { notificationsTotal: number; notificationsUnread: number; campaigns: number; announcements: number; deliveryLogs: number; mediaAssets: number; ticketsTotal: number; ticketsOpen: number; deadLettersUnresolved: number; backupsTotal: number; lastBackupStatusLabel: string; lastBackupAt: string | null; sagasTotal: number; sagasCommitted: number; sagasNeedsReconcile: number; auditLogsCurrentMonth: number };
    };
  };
  runtime: {
    version: string;
    envMode: string;
    dataBackendMode: string;
    nodeVersion: string;
    platform: string;
    hostname: string;
    pid: number;
    uptimeSeconds: number;
    startedAt: string;
    serverTime: string;
    timezone: string;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number; heapUsagePercent: number };
    os: { cpuModel: string; cpuCores: number; loadAvg: number[]; totalMemMb: number; freeMemMb: number; usedMemMb: number; memUsagePercent: number };
    integrations: {
      googleOk: boolean;
      googleDetail: string;
      writeQueuePending: number;
      realtimeConnections: number;
      emailEnabled: boolean;
      emailQueue: { queuedCount: number; sentCount: number; failedCount: number; lastFlushedAt: string | null };
      maintenanceEnabled: boolean;
      maintenanceMessage: string;
    };
  };
}

export type DevActionKind = 'PING_POSTGRES' | 'FLUSH_OUTBOX' | 'RECONCILE_PG_SHEETS' | 'RECONCILE_INTEGRITY';

export function getSavedDevKey(): string {
  if (typeof window === 'undefined') return '';
  try { return window.sessionStorage.getItem(DEV_KEY_SESSION_KEY) ?? ''; } catch { return ''; }
}
export function saveDevKey(key: string): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(DEV_KEY_SESSION_KEY, key.trim()); } catch { /* ignore */ }
}
export function clearDevKey(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(DEV_KEY_SESSION_KEY); } catch { /* ignore */ }
}

async function callDevEndpoint<T>(method: 'GET' | 'POST', path: string, devKey: string, body?: unknown): Promise<ApiSuccessEnvelope<T, null>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-umbm-client': 'web',
      'x-dev-monitor-key': devKey.trim(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const payload = (await res.json().catch(() => null)) as ApiSuccessEnvelope<T, null> | ApiErrorEnvelope | null;
  if (!res.ok || !payload || payload.success === false) {
    const err = payload as ApiErrorEnvelope | null;
    if (res.status === 401) clearDevKey();
    throw new ApiClientError(res.status, err?.errors?.code ?? 'UNAUTHORIZED', err?.message ?? `Yêu cầu thất bại (HTTP ${res.status})`, err?.errors?.details ?? [], err?.request_id ?? '');
  }
  return payload;
}

export async function verifyDevMonitorKey(key: string) {
  const res = await callDevEndpoint<{ verified: boolean; version: string; serverTime: string; pgEnabled: boolean; maxStorageMb: number }>('POST', '/dev/verify-key', key, { key });
  saveDevKey(key);
  return res.data;
}

export async function fetchDevSystemStats(devKey: string, refresh = false): Promise<DevSystemStatsResponse> {
  const res = await callDevEndpoint<DevSystemStatsResponse>('GET', refresh ? '/dev/system-stats?refresh=1' : '/dev/system-stats', devKey);
  return res.data;
}

export async function executeDevAction(devKey: string, action: DevActionKind) {
  return callDevEndpoint<Record<string, unknown>>('POST', '/dev/actions', devKey, { action });
}

export async function pingPublicHealthApi() {
  const res = await fetch(`${BASE}/health`, { headers: { 'x-umbm-client': 'web' }, cache: 'no-store' });
  return (await res.json()) as ApiSuccessEnvelope<{ status: string; ready: boolean; version: string; time: string; postgres: { enabled: boolean; alive: boolean; mode: string; latency_ms: number | null; checked_at: string } }, null>;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (d > 0) return `${d} ngày ${h} giờ ${m} phút`;
  if (h > 0) return `${h} giờ ${m} phút ${s} giây`;
  return `${m} phút ${s} giây`;
}
