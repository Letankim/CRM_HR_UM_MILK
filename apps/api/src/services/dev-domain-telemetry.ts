import os from 'node:os';
import v8 from 'node:v8';
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, BACKUP_STATUS_LABELS, EMPLOYEE_STAGES, EMPLOYEE_STAGE_LABELS, PAY_PERIOD_STATUSES, PAY_PERIOD_STATUS_LABELS, ROLES, ROLE_LABELS, TABLE_DISPLAY_LABELS } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { PG_GROUP_LABELS } from './dev-postgres-telemetry.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DevStoreStat {
  tableKey: string; group: string; groupLabel: string; tabName: string; displayLabel: string;
  activeRows: number; deletedRows: number; totalRows: number; invalidRows: number; isMonthlyPartitioned: boolean; loadedAt: string | null;
}

export async function collectDevDomainAndRuntimeTelemetry(ctx: AppContext) {
  const monthlySet = new Set<unknown>(ctx.db.monthlyStores().map((m) => m.store));
  const auditStore = await ctx.db.audit().catch(() => null);

  const storesList: DevStoreStat[] = ctx.db.allStores().map((s) => {
    const [group = 'SYSTEM', baseTab = s.tab] = s.name.split('.');
    const baseKey = `${group}.${baseTab.replace(/_\d{4}_(0[1-9]|1[0-2])$/, '')}`;
    const activeRows = s.all(false).length, totalRows = s.all(true).length, st = s.stats();
    return {
      tableKey: baseKey, group, groupLabel: PG_GROUP_LABELS[group] ?? group, tabName: s.tab,
      displayLabel: TABLE_DISPLAY_LABELS[baseKey] || TABLE_DISPLAY_LABELS[baseTab] || s.tab,
      activeRows, deletedRows: Math.max(0, totalRows - activeRows), totalRows,
      invalidRows: st.invalidRows, isMonthlyPartitioned: monthlySet.has(s), loadedAt: st.loadedAt,
    };
  });

  if (auditStore) {
    const active = auditStore.all(false).length, total = auditStore.all(true).length, st = auditStore.stats();
    storesList.push({
      tableKey: 'SYSTEM.AUDIT_LOG', group: 'SYSTEM', groupLabel: PG_GROUP_LABELS.SYSTEM ?? 'Hệ thống',
      tabName: auditStore.tab, displayLabel: `Nhật ký Kiểm toán Thao tác (${auditStore.tab})`,
      activeRows: active, deletedRows: Math.max(0, total - active), totalRows: total,
      invalidRows: st.invalidRows, isMonthlyPartitioned: true, loadedAt: st.loadedAt,
    });
  }

  const groupKeys = ['CORE', 'HR', 'SCHEDULE', 'ATTENDANCE', 'PAYROLL', 'COMMS', 'SYSTEM'];
  const moduleGroups = groupKeys.map((g) => {
    const items = storesList.filter((s) => s.group === g);
    return {
      group: g, groupLabel: PG_GROUP_LABELS[g] ?? g, tableCount: items.length,
      activeRows: items.reduce((a, b) => a + b.activeRows, 0),
      deletedRows: items.reduce((a, b) => a + b.deletedRows, 0),
      totalRows: items.reduce((a, b) => a + b.totalRows, 0),
    };
  });

  const users = ctx.db.users.all();
  const employees = ctx.db.employees.all();
  const branches = ctx.db.branches.all();
  const candidates = ctx.db.candidates.all();
  const interviews = ctx.db.interviews.all();
  const shifts = ctx.db.shiftAssignments.all();
  const leaves = ctx.db.leaveRequests.all();
  const swaps = ctx.db.shiftSwaps.all();
  const periods = ctx.db.payPeriods.all();
  const notifications = ctx.db.notifications.all();
  const tickets = ctx.db.supportTickets.all();
  const deadLetters = ctx.db.deadLetters.all();
  const backups = ctx.db.backupLog.all();
  const sagas = ctx.db.operationJournal.all();
  const lastBackup = backups.length > 0 ? backups[backups.length - 1] : null;

  const partitionLabel = ctx.db.partitionMonth
    ? `Tháng ${ctx.db.partitionMonth.slice(5, 7)}/${ctx.db.partitionMonth.slice(0, 4)}`
    : 'Tệp gốc mặc định';

  const business = {
    accounts: {
      total: users.length,
      byStatus: ACCOUNT_STATUSES.map((st) => ({ label: ACCOUNT_STATUS_LABELS[st], count: users.filter((u) => u.status === st).length })),
      byRole: ROLES.map((r) => ({ label: ROLE_LABELS[r], count: users.filter((u) => u.role === r).length })),
    },
    employees: {
      total: employees.length,
      activeWorking: employees.filter((e) => e.status === 'ACTIVE').length,
      onLeaveOrSuspended: employees.filter((e) => e.status === 'ON_LEAVE' || e.status === 'SUSPENDED').length,
      resigned: employees.filter((e) => e.status === 'RESIGNED').length,
      branchesActive: branches.filter((b) => b.status === 'ACTIVE').length,
      branchesTotal: branches.length,
      byStage: EMPLOYEE_STAGES.map((st) => ({ label: EMPLOYEE_STAGE_LABELS[st], count: employees.filter((e) => e.stage === st).length })),
    },
    recruitment: {
      candidatesTotal: candidates.length,
      candidatesNewOrScreening: candidates.filter((c) => c.status === 'NEW' || c.status === 'CONTACTED').length,
      candidatesOfferedOrHired: candidates.filter((c) => c.status === 'HIRED' || c.status === 'INTERVIEW_SCHEDULED').length,
      candidatesRejected: candidates.filter((c) => c.status === 'REJECTED').length,
      interviewsTotal: interviews.length,
      interviewsEvaluated: interviews.filter((i) => i.status === 'COMPLETED').length,
      testBankQuestions: ctx.db.testBank.all().length,
      testAttempts: ctx.db.testAttempts.all().length,
    },
    operations: {
      activePartitionLabel: partitionLabel,
      scheduleWeeks: ctx.db.scheduleWeeks.all().length,
      shiftsTotal: shifts.length,
      shiftsCompleted: shifts.filter((s) => s.status === 'COMPLETED').length,
      shiftsCheckedIn: shifts.filter((s) => s.status === 'PUBLISHED').length,
      shiftsAbsent: shifts.filter((s) => s.status === 'ABSENT').length,
      leavesTotal: leaves.length,
      leavesPending: leaves.filter((l) => l.status === 'PENDING').length,
      swapsTotal: swaps.length,
      attendanceEvents: ctx.db.attendanceEvents.all().length,
      attendanceAdjustments: ctx.db.attendanceAdjustments.all().length,
    },
    payroll: {
      payRates: ctx.db.payRates.all().length,
      periodsTotal: periods.length,
      payrollItems: ctx.db.payrollItems.all().length,
      snapshots: ctx.db.payrollSnapshots.all().length,
      payslips: ctx.db.payslips.all().length,
      revisions: ctx.db.payslipRevisions.all().length,
      payments: ctx.db.payments.all().length,
      revenueInputs: ctx.db.revenueInputs.all().length,
      byPeriodStatus: PAY_PERIOD_STATUSES.map((st) => ({ label: PAY_PERIOD_STATUS_LABELS[st], count: periods.filter((p) => p.status === st).length })),
    },
    commsAndSystem: {
      notificationsTotal: notifications.length,
      notificationsUnread: notifications.filter((n) => !n.read_at).length,
      campaigns: ctx.db.campaigns.all().length,
      announcements: ctx.db.announcements.all().length,
      deliveryLogs: ctx.db.deliveryLogs.all().length,
      mediaAssets: ctx.db.mediaAssets.all().length,
      ticketsTotal: tickets.length,
      ticketsOpen: tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length,
      deadLettersUnresolved: deadLetters.filter((d) => !d.resolved_at).length,
      backupsTotal: backups.length,
      lastBackupStatusLabel: lastBackup ? (BACKUP_STATUS_LABELS[lastBackup.status as keyof typeof BACKUP_STATUS_LABELS] ?? lastBackup.status) : 'Chưa chạy',
      lastBackupAt: lastBackup?.started_at ?? null,
      sagasTotal: sagas.length,
      sagasCommitted: sagas.filter((s) => s.status === 'COMMITTED').length,
      sagasNeedsReconcile: sagas.filter((s) => s.status === 'NEEDS_RECONCILIATION' || s.status === 'PENDING').length,
      auditLogsCurrentMonth: auditStore ? auditStore.all().length : 0,
    },
  };

  const mem = process.memoryUsage();
  const totalOsMem = os.totalmem(), freeOsMem = os.freemem(), usedOsMem = Math.max(0, totalOsMem - freeOsMem);
  const cpus = os.cpus();
  const load = os.loadavg();
  const googleCheck = await ctx.google.check().catch((e) => ({ ok: false, detail: (e as Error).message }));
  const mnt = ctx.db.maintenance.all()[0];
  const qStats = ctx.db.stats().queue;

  return {
    domain: {
      ready: ctx.db.isReady(),
      totalStores: storesList.length,
      totalActiveRows: storesList.reduce((a, b) => a + b.activeRows, 0),
      totalDeletedRows: storesList.reduce((a, b) => a + b.deletedRows, 0),
      totalCachedRows: storesList.reduce((a, b) => a + b.totalRows, 0),
      totalInvalidRows: storesList.reduce((a, b) => a + b.invalidRows, 0),
      moduleGroups,
      stores: storesList,
      business,
    },
    runtime: {
      version: ctx.version,
      envMode: ctx.env.NODE_ENV === 'production' ? 'Production (Vận hành thực tế)' : ctx.env.NODE_ENV === 'test' ? 'Test (Kiểm thử)' : 'Development (Phát triển)',
      dataBackendMode: ctx.google.mode === 'google' ? 'Google Sheets + Drive Thật' : 'Bộ nhớ RAM (Mẫu thử nghiệm)',
      nodeVersion: process.version,
      platform: `${os.type()} ${os.release()} (${process.arch})`,
      hostname: os.hostname(),
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      serverTime: nowIso(),
      timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh',
      memory: (() => {
        const v8Stats = v8.getHeapStatistics?.() ?? { heap_size_limit: 0 };
        const heapLimit = v8Stats.heap_size_limit > 0 ? v8Stats.heap_size_limit : mem.heapTotal;
        return {
          rssMb: round2(mem.rss / (1024 * 1024)),
          heapUsedMb: round2(mem.heapUsed / (1024 * 1024)),
          heapTotalMb: round2(heapLimit / (1024 * 1024)),
          allocatedMb: round2(mem.heapTotal / (1024 * 1024)),
          externalMb: round2(mem.external / (1024 * 1024)),
          heapUsagePercent: heapLimit > 0 ? round2((mem.heapUsed / heapLimit) * 100) : 0,
        };
      })(),
      os: {
        cpuModel: cpus[0]?.model?.trim() || 'CPU Server',
        cpuCores: cpus.length,
        loadAvg: load.map((v) => round2(v)),
        totalMemMb: round2(totalOsMem / (1024 * 1024)),
        freeMemMb: round2(freeOsMem / (1024 * 1024)),
        usedMemMb: round2(usedOsMem / (1024 * 1024)),
        memUsagePercent: totalOsMem > 0 ? round2((usedOsMem / totalOsMem) * 100) : 0,
      },
      integrations: {
        googleOk: googleCheck.ok,
        googleDetail: googleCheck.detail,
        writeQueuePending: qStats.pending,
        realtimeConnections: ctx.realtime()?.connectionCount() ?? 0,
        emailEnabled: ctx.env.EMAIL_ENABLED,
        emailQueue: ctx.email.queueStats(),
        maintenanceEnabled: Boolean(mnt?.enabled),
        maintenanceMessage: mnt?.message ?? '',
      },
    },
  };
}
