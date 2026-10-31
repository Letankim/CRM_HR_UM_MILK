import * as S from '@umbm/shared';
import { Errors } from '../lib/errors.js';
import type { SheetsGateway } from '../sheets/gateway.js';
import { TableStore, type BaseRecord } from '../sheets/table-store.js';
import type { WriteQueue } from '../sheets/write-queue.js';
import { zAuditRow, zBackupLogRow, zDeadLetterRow, zOperationJournalRow, type AuditRow, type BackupLogRow, type DeadLetterRow, type OperationJournalRow } from './system-schemas.js';

export interface SpreadsheetIds {
  CORE: string; HR: string; SCHEDULE: string; ATTENDANCE: string; PAYROLL: string; COMMS: string; SYSTEM: string;
}
interface Logger { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void }

export class Database {
  readonly users: TableStore<S.User>;
  readonly branches: TableStore<S.Branch>;
  readonly shiftTemplates: TableStore<S.ShiftTemplate>;
  readonly staffingRules: TableStore<S.StaffingRule>;
  readonly policies: TableStore<S.Policy>;
  readonly systemSettings: TableStore<S.SystemSetting>;
  readonly maintenance: TableStore<S.Maintenance>;
  readonly candidates: TableStore<S.Candidate>;
  readonly interviews: TableStore<S.Interview>;
  readonly employees: TableStore<S.Employee>;
  readonly employeeStageHistory: TableStore<S.EmployeeStageHistory>;
  readonly testBank: TableStore<S.TestBank>;
  readonly testAssignments: TableStore<S.TestAssignment>;
  readonly testAttempts: TableStore<S.TestAttempt>;
  readonly shiftAssignments: TableStore<S.ShiftAssignment>;
  readonly leaveRequests: TableStore<S.LeaveRequest>;
  readonly shiftSwaps: TableStore<S.ShiftSwap>;
  readonly scheduleWeeks: TableStore<S.ScheduleWeek>;
  readonly attendanceEvents: TableStore<S.AttendanceEvent>;
  readonly attendanceAdjustments: TableStore<S.AttendanceAdjustment>;
  readonly payRates: TableStore<S.PayRate>;
  readonly payPeriods: TableStore<S.PayPeriod>;
  readonly payrollItems: TableStore<S.PayrollItem>;
  readonly payrollSnapshots: TableStore<S.PayrollSnapshot>;
  readonly payslips: TableStore<S.Payslip>;
  readonly payslipRevisions: TableStore<S.PayslipRevision>;
  readonly payments: TableStore<S.Payment>;
  readonly revenueInputs: TableStore<S.RevenueInput>;
  readonly notifications: TableStore<S.NotificationRow>;
  readonly campaigns: TableStore<S.Campaign>;
  readonly announcements: TableStore<S.Announcement>;
  readonly deliveryLogs: TableStore<S.DeliveryLog>;
  readonly mediaAssets: TableStore<S.MediaAsset>;
  readonly supportTickets: TableStore<S.SupportTicket>;
  readonly deadLetters: TableStore<DeadLetterRow>;
  readonly backupLog: TableStore<BackupLogRow>;
  readonly operationJournal: TableStore<OperationJournalRow>;

  private readonly auditStores = new Map<string, Promise<TableStore<AuditRow>>>();
  /** Phân vùng dữ liệu tháng đang hoạt động (YYYY_MM) — rỗng nghĩa là dùng tab gốc. */
  partitionMonth = '';
  private timer: NodeJS.Timeout | null = null;
  private refreshCursor = 0;
  private lastRefreshError: string | null = null;
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  constructor(readonly gateway: SheetsGateway, readonly queue: WriteQueue, readonly ids: SpreadsheetIds) {
    const core = S.SPREADSHEETS.CORE.tabs, hr = S.SPREADSHEETS.HR.tabs, sched = S.SPREADSHEETS.SCHEDULE.tabs;
    const att = S.SPREADSHEETS.ATTENDANCE.tabs, payroll = S.SPREADSHEETS.PAYROLL.tabs, comms = S.SPREADSHEETS.COMMS.tabs, sys = S.SPREADSHEETS.SYSTEM.tabs;

    this.users = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'USERS', headers: core.USERS, schema: S.zUser });
    this.branches = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'BRANCHES', headers: core.BRANCHES, schema: S.zBranch });
    this.shiftTemplates = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'SHIFT_TEMPLATES', headers: core.SHIFT_TEMPLATES, schema: S.zShiftTemplate });
    this.staffingRules = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'STAFFING_RULES', headers: core.STAFFING_RULES, schema: S.zStaffingRule });
    this.policies = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'POLICIES', headers: core.POLICIES, schema: S.zPolicy });
    this.systemSettings = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'SYSTEM_SETTINGS', headers: core.SYSTEM_SETTINGS, schema: S.zSystemSetting });
    this.maintenance = new TableStore(gateway, queue, { spreadsheetKey: 'CORE', spreadsheetId: ids.CORE, tab: 'MAINTENANCE', headers: core.MAINTENANCE, schema: S.zMaintenance });

    this.candidates = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'CANDIDATES', headers: hr.CANDIDATES, schema: S.zCandidate });
    this.interviews = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'INTERVIEWS', headers: hr.INTERVIEWS, schema: S.zInterview });
    this.employees = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'EMPLOYEES', headers: hr.EMPLOYEES, schema: S.zEmployee });
    this.employeeStageHistory = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'EMPLOYEE_STAGE_HISTORY', headers: hr.EMPLOYEE_STAGE_HISTORY, schema: S.zEmployeeStageHistory });
    this.testBank = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'TEST_BANK', headers: hr.TEST_BANK, schema: S.zTestBank });
    this.testAssignments = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'TEST_ASSIGNMENTS', headers: hr.TEST_ASSIGNMENTS, schema: S.zTestAssignment });
    this.testAttempts = new TableStore(gateway, queue, { spreadsheetKey: 'HR', spreadsheetId: ids.HR, tab: 'TEST_ATTEMPTS', headers: hr.TEST_ATTEMPTS, schema: S.zTestAttempt });

    this.shiftAssignments = new TableStore(gateway, queue, { spreadsheetKey: 'SCHEDULE', spreadsheetId: ids.SCHEDULE, tab: 'SHIFT_ASSIGNMENTS', headers: sched.SHIFT_ASSIGNMENTS, schema: S.zShiftAssignment });
    this.leaveRequests = new TableStore(gateway, queue, { spreadsheetKey: 'SCHEDULE', spreadsheetId: ids.SCHEDULE, tab: 'LEAVE_REQUESTS', headers: sched.LEAVE_REQUESTS, schema: S.zLeaveRequest });
    this.shiftSwaps = new TableStore(gateway, queue, { spreadsheetKey: 'SCHEDULE', spreadsheetId: ids.SCHEDULE, tab: 'SHIFT_SWAPS', headers: sched.SHIFT_SWAPS, schema: S.zShiftSwap });
    this.scheduleWeeks = new TableStore(gateway, queue, { spreadsheetKey: 'SCHEDULE', spreadsheetId: ids.SCHEDULE, tab: 'SCHEDULE_WEEKS', headers: sched.SCHEDULE_WEEKS, schema: S.zScheduleWeek });

    this.attendanceEvents = new TableStore(gateway, queue, { spreadsheetKey: 'ATTENDANCE', spreadsheetId: ids.ATTENDANCE, tab: 'ATTENDANCE_EVENTS', headers: att.ATTENDANCE_EVENTS, schema: S.zAttendanceEvent });
    this.attendanceAdjustments = new TableStore(gateway, queue, { spreadsheetKey: 'ATTENDANCE', spreadsheetId: ids.ATTENDANCE, tab: 'ATTENDANCE_ADJUSTMENTS', headers: att.ATTENDANCE_ADJUSTMENTS, schema: S.zAttendanceAdjustment });
    this.payRates = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAY_RATES', headers: payroll.PAY_RATES, schema: S.zPayRate });
    this.payPeriods = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAY_PERIODS', headers: payroll.PAY_PERIODS, schema: S.zPayPeriod });
    this.payrollItems = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAYROLL_ITEMS', headers: payroll.PAYROLL_ITEMS, schema: S.zPayrollItem });
    this.payrollSnapshots = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAYROLL_SNAPSHOTS', headers: payroll.PAYROLL_SNAPSHOTS, schema: S.zPayrollSnapshot });
    this.payslips = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAYSLIPS', headers: payroll.PAYSLIPS, schema: S.zPayslip });
    this.payslipRevisions = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAYSLIP_REVISIONS', headers: payroll.PAYSLIP_REVISIONS, schema: S.zPayslipRevision });
    this.payments = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'PAYMENTS', headers: payroll.PAYMENTS, schema: S.zPayment });
    this.revenueInputs = new TableStore(gateway, queue, { spreadsheetKey: 'PAYROLL', spreadsheetId: ids.PAYROLL, tab: 'REVENUE_INPUTS', headers: payroll.REVENUE_INPUTS, schema: S.zRevenueInput });
    this.notifications = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'NOTIFICATIONS', headers: comms.NOTIFICATIONS, schema: S.zNotification });
    this.campaigns = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'CAMPAIGNS', headers: comms.CAMPAIGNS, schema: S.zCampaign });
    this.announcements = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'ANNOUNCEMENTS', headers: comms.ANNOUNCEMENTS, schema: S.zAnnouncement });
    this.deliveryLogs = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'DELIVERY_LOGS', headers: comms.DELIVERY_LOGS, schema: S.zDeliveryLog });
    this.mediaAssets = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'MEDIA_ASSETS', headers: comms.MEDIA_ASSETS, schema: S.zMediaAsset });
    this.supportTickets = new TableStore(gateway, queue, { spreadsheetKey: 'COMMS', spreadsheetId: ids.COMMS, tab: 'SUPPORT_TICKETS', headers: comms.SUPPORT_TICKETS, schema: S.zSupportTicket });
    this.deadLetters = new TableStore(gateway, queue, { spreadsheetKey: 'SYSTEM', spreadsheetId: ids.SYSTEM, tab: 'SYNC_DEAD_LETTER', headers: sys.SYNC_DEAD_LETTER, schema: zDeadLetterRow });
    this.backupLog = new TableStore(gateway, queue, { spreadsheetKey: 'SYSTEM', spreadsheetId: ids.SYSTEM, tab: 'BACKUP_LOG', headers: sys.BACKUP_LOG, schema: zBackupLogRow });
    this.operationJournal = new TableStore(gateway, queue, { spreadsheetKey: 'SYSTEM', spreadsheetId: ids.SYSTEM, tab: 'OPERATION_JOURNAL', headers: sys.OPERATION_JOURNAL, schema: zOperationJournalRow });
  }

  /** Các bảng dữ liệu phát sinh theo tháng (mỗi tháng tách sang 1 file Google Spreadsheet độc lập). */
  monthlyStores() {
    const sched = S.SPREADSHEETS.SCHEDULE.tabs, att = S.SPREADSHEETS.ATTENDANCE.tabs;
    return [
      { base: 'SHIFT_ASSIGNMENTS', defaultSpreadsheetId: this.ids.SCHEDULE, headers: sched.SHIFT_ASSIGNMENTS, schema: S.zShiftAssignment, store: this.shiftAssignments },
      { base: 'LEAVE_REQUESTS', defaultSpreadsheetId: this.ids.SCHEDULE, headers: sched.LEAVE_REQUESTS, schema: S.zLeaveRequest, store: this.leaveRequests },
      { base: 'SHIFT_SWAPS', defaultSpreadsheetId: this.ids.SCHEDULE, headers: sched.SHIFT_SWAPS, schema: S.zShiftSwap, store: this.shiftSwaps },
      { base: 'ATTENDANCE_EVENTS', defaultSpreadsheetId: this.ids.ATTENDANCE, headers: att.ATTENDANCE_EVENTS, schema: S.zAttendanceEvent, store: this.attendanceEvents },
      { base: 'ATTENDANCE_ADJUSTMENTS', defaultSpreadsheetId: this.ids.ATTENDANCE, headers: att.ATTENDANCE_ADJUSTMENTS, schema: S.zAttendanceAdjustment, store: this.attendanceAdjustments },
    ];
  }

  private get stores() {
    return [
      this.users, this.branches, this.shiftTemplates, this.staffingRules, this.policies, this.systemSettings, this.maintenance,
      this.candidates, this.interviews, this.employees, this.employeeStageHistory, this.testBank, this.testAssignments, this.testAttempts,
      this.shiftAssignments, this.leaveRequests, this.shiftSwaps, this.scheduleWeeks,
      this.attendanceEvents, this.attendanceAdjustments,
      this.payRates, this.payPeriods, this.payrollItems, this.payrollSnapshots, this.payslips, this.payslipRevisions, this.payments, this.revenueInputs,
      this.notifications, this.campaigns, this.announcements, this.deliveryLogs, this.mediaAssets, this.supportTickets,
      this.deadLetters, this.backupLog, this.operationJournal,
    ];
  }

  audit(date: Date = new Date()): Promise<TableStore<AuditRow>> {
    const tab = S.monthlyTabName('AUDIT_LOG', date);
    let pending = this.auditStores.get(tab);
    if (!pending) {
      pending = (async () => {
        const headers = S.SPREADSHEETS.SYSTEM.tabs.AUDIT_LOG;
        await this.gateway.ensureTab(this.ids.SYSTEM, tab, headers);
        const store = new TableStore(this.gateway, this.queue, { spreadsheetKey: 'SYSTEM', spreadsheetId: this.ids.SYSTEM, tab, headers, schema: zAuditRow });
        await store.load();
        return store;
      })();
      pending.catch(() => this.auditStores.delete(tab));
      this.auditStores.set(tab, pending);
    }
    return pending;
  }

  async loadAll(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const monthly = new Set<unknown>(this.monthlyStores().map((m) => m.store));
      await Promise.all(this.stores.filter((s) => !monthly.has(s)).map((s) => s.load()));
      const month = this.systemSettings.find((s) => s.key === S.OPERATION_SETTING_KEYS.DATA_PARTITION_MONTH)?.value.trim() ?? '';
      this.partitionMonth = S.PARTITION_MONTH_REGEX.test(month) ? month : '';
      const reg = S.parsePartitionRegistry(this.systemSettings.find((s) => s.key === S.OPERATION_SETTING_KEYS.DATA_PARTITIONS_REGISTRY)?.value);
      const entry = this.partitionMonth ? reg.find((e) => e.monthKey === this.partitionMonth) : undefined;
      let bootPartitionError: string | null = null;
      if (this.partitionMonth) {
        try {
          const descs = this.monthlyStores();
          const prepared = await Promise.all(descs.map((m) => {
            const target = entry?.mode === 'MONTHLY_FILE' ? { spreadsheetId: entry.spreadsheetId, tab: m.base } : { spreadsheetId: m.defaultSpreadsheetId, tab: S.partitionTabName(m.base, this.partitionMonth) };
            return (m.store as unknown as TableStore<BaseRecord>).prepareTarget(target);
          }));
          descs.forEach((m, i) => (m.store as unknown as TableStore<BaseRecord>).commitPreparedTarget(prepared[i]!));
        } catch (err) {
          bootPartitionError = `Không thể nạp tệp dữ liệu tháng ${this.partitionMonth} (${(err as Error).message}), hệ thống tạm quay về tệp gốc`;
          this.partitionMonth = '';
          await Promise.all(this.monthlyStores().map((m) => m.store.load()));
        }
      } else {
        await Promise.all(this.monthlyStores().map((m) => m.store.load()));
      }
      await this.audit();
      this.lastRefreshError = bootPartitionError;
      this.ready = true;
    })();
    try { await this.readyPromise; } catch (err) { this.readyPromise = null; throw err; }
  }

  setBootError(msg: string | null): void { this.lastRefreshError = msg; }
  isReady(): boolean { return this.ready; }
  async waitReady(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) await this.readyPromise;
    if (!this.ready && this.lastRefreshError) throw Errors.syncPending(this.lastRefreshError);
  }

  startAutoRefresh(intervalSeconds: number, log: Logger): void {
    this.stopAutoRefresh();
    const groups = [
      [this.users, this.branches, this.shiftTemplates, this.staffingRules, this.policies, this.systemSettings, this.maintenance],
      [this.candidates, this.interviews, this.employees, this.employeeStageHistory, this.testBank, this.testAssignments, this.testAttempts],
      [this.shiftAssignments, this.leaveRequests, this.shiftSwaps, this.scheduleWeeks, this.attendanceEvents, this.attendanceAdjustments],
      [this.payRates, this.payPeriods, this.payrollItems, this.payrollSnapshots, this.payslips, this.payslipRevisions, this.payments, this.revenueInputs],
      [this.notifications, this.campaigns, this.announcements, this.deliveryLogs, this.mediaAssets, this.supportTickets, this.deadLetters, this.backupLog, this.operationJournal],
    ];
    const cooldownMs = Math.max(30_000, intervalSeconds * 1000);
    this.timer = setInterval(async () => {
      try {
        const group = groups[this.refreshCursor % groups.length] ?? [];
        this.refreshCursor = (this.refreshCursor + 1) % groups.length;
        await Promise.all(group.map((s) => s.refreshIfIdle(cooldownMs)));
        this.lastRefreshError = null;
      } catch (error) {
        this.lastRefreshError = (error as Error).message;
        log.error({ err: error }, 'Làm mới cache Google Sheets thất bại');
      }
    }, intervalSeconds * 1000);
    this.timer.unref();
  }

  stopAutoRefresh(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  stats() {
    return { ready: this.ready, lastRefreshError: this.lastRefreshError, queue: this.queue.stats(), tables: this.stores.map((s) => s.stats()), unresolvedDeadLetters: this.deadLetters.filter((d) => !d.resolved_at).length };
  }
}
