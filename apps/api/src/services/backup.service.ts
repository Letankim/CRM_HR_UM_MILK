import { copyFile, ensureFolderPath, exportSpreadsheetXlsx, listChildFolders, trashFile, uploadFile, withRetry, type GoogleClients } from '@umbm/google';
import { DRIVE_FOLDERS, SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import type { Env } from '../config/env.js';
import { sheetIds } from '../config/env.js';
import type { Database } from '../data/database.js';
import type { BackupLogRow } from '../data/system-schemas.js';
import { APP_TZ, dayjs, nowIso } from '../lib/time.js';
import type { ReconciliationService } from './reconciliation.service.js';
import { sweepExpiredShiftsAndMarkAbsent } from './shift-absent-scanner.js';

export type BackupKind = 'DAILY' | 'CRITICAL' | 'WEEKLY' | 'MONTHLY' | 'PRE_OPERATION';
interface BackupPlan { kind: BackupKind; folder: string[]; keys: SpreadsheetKey[]; exportXlsx: boolean }
const CRITICAL_KEYS: SpreadsheetKey[] = ['CORE', 'ATTENDANCE', 'PAYROLL'];
const ALL_KEYS = Object.keys(SPREADSHEETS) as SpreadsheetKey[];

function planFor(kind: BackupKind, at = dayjs()): BackupPlan {
  switch (kind) {
    case 'DAILY': return { kind, folder: ['daily', at.format('YYYY-MM-DD')], keys: ALL_KEYS, exportXlsx: true };
    case 'CRITICAL': return { kind, folder: ['critical', at.format('YYYY-MM-DD_HHmm')], keys: CRITICAL_KEYS, exportXlsx: false };
    case 'WEEKLY': return { kind, folder: ['weekly', at.format('YYYY-[W]WW')], keys: ALL_KEYS, exportXlsx: true };
    case 'MONTHLY': return { kind, folder: ['monthly', at.format('YYYY-MM')], keys: ALL_KEYS, exportXlsx: true };
    case 'PRE_OPERATION': return { kind, folder: ['pre-operation', at.format('YYYY-MM-DD_HHmmss')], keys: ALL_KEYS, exportXlsx: false };
  }
}

export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private lastTriggeredSlot = '';
  private running = false;
  private activePromise: Promise<unknown> | null = null;
  private readonly activeLogIds = new Set<string>();
  private healingPromise: Promise<void> | null = null;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly reconciliation: ReconciliationService,
    private readonly googleClients?: GoogleClients,
  ) {}

  private collectRowCounts(): Record<string, number> {
    const rows: Record<string, number> = {};
    for (const [spKey, spDef] of Object.entries(SPREADSHEETS)) {
      for (const tabKey of Object.keys(spDef.tabs)) rows[`${spKey}.${tabKey}`] = 0;
    }
    for (const t of this.db.stats().tables) {
      const normalized = t.table.replace(/__\d{4}_\d{2}$/, '');
      rows[normalized] = (rows[normalized] ?? 0) + t.rows;
    }
    return rows;
  }

  private async syncDriveFilesForPlan(plan: BackupPlan, reuseExisting = false): Promise<{ folderId: string; filesCount: number }> {
    if (!this.googleClients || this.env.DATA_BACKEND !== 'google' || !this.env.DRIVE_ROOT_FOLDER_ID) {
      return { folderId: `memory://${plan.folder.join('/')}`, filesCount: plan.keys.length * (plan.exportXlsx ? 2 : 1) };
    }
    const drive = this.googleClients.drive;
    const ids = sheetIds(this.env);
    const folderId = await ensureFolderPath(drive, this.env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, ...plan.folder]);
    const stamp = plan.folder[plan.folder.length - 1]!;

    const existingRes = await withRetry(() =>
      drive.files.list({ q: `'${folderId}' in parents and trashed=false`, fields: 'files(id,name)', pageSize: 100 }),
    ).catch(() => null);
    const existingByName = new Map<string, string[]>();
    for (const f of existingRes?.data.files ?? []) {
      if (f.id && f.name) existingByName.set(f.name, [...(existingByName.get(f.name) ?? []), f.id]);
    }

    let filesCount = 0;
    for (const key of plan.keys) {
      const fileId = ids[key];
      if (!fileId) continue;
      const sheetName = `${SPREADSHEETS[key].title}__${stamp}`;
      const existingSheets = existingByName.get(sheetName) ?? [];
      if (reuseExisting && existingSheets.length > 0) {
        for (const dupId of existingSheets.slice(1)) await trashFile(drive, dupId).catch(() => undefined);
        filesCount++;
      } else {
        for (const oldId of existingSheets) await trashFile(drive, oldId).catch(() => undefined);
        await copyFile(drive, fileId, { name: sheetName, parentId: folderId });
        filesCount++;
      }

      if (plan.exportXlsx) {
        const xlsxName = `${SPREADSHEETS[key].title}__${stamp}.xlsx`, existingXlsx = existingByName.get(xlsxName) ?? [];
        if (reuseExisting && existingXlsx.length > 0) {
          for (const dupId of existingXlsx.slice(1)) await trashFile(drive, dupId).catch(() => undefined);
          filesCount++;
        } else {
          for (const oldId of existingXlsx) await trashFile(drive, oldId).catch(() => undefined);
          const xlsx = await exportSpreadsheetXlsx(drive, fileId);
          await uploadFile(drive, { name: xlsxName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parentId: folderId, data: xlsx });
          filesCount++;
        }
      }
    }
    return { folderId, filesCount };
  }

  async runBackup(kind: BackupKind, actorId = 'embedded-worker') {
    const task = (async () => {
      const startedAt = nowIso(), plan = planFor(kind, dayjs(startedAt)), rows = this.collectRowCounts();
      const logRow = await this.db.backupLog.insert(
        { kind, started_at: startedAt, finished_at: '', status: 'RUNNING', drive_folder_id: '', files_count: 0, rows_json: JSON.stringify(rows), error: '' },
        actorId,
      );
      this.activeLogIds.add(logRow.id);
      try {
        const { folderId, filesCount } = await this.syncDriveFilesForPlan(plan, false);
        const cur = this.db.backupLog.get(logRow.id) ?? logRow;
        return await this.db.backupLog.update(
          logRow.id, cur.version,
          { status: 'SUCCESS', finished_at: nowIso(), drive_folder_id: folderId, files_count: filesCount, rows_json: JSON.stringify(this.collectRowCounts()), error: '' },
          actorId,
        );
      } catch (err) {
        const errMsg = (err as Error).message || 'Lỗi sao lưu không xác định';
        const cur = this.db.backupLog.get(logRow.id) ?? logRow;
        await this.db.backupLog.update(logRow.id, cur.version, { status: 'FAILED', finished_at: nowIso(), rows_json: JSON.stringify(this.collectRowCounts()), error: errMsg.slice(0, 2000) }, actorId).catch(() => undefined);
        throw err;
      } finally {
        this.activeLogIds.delete(logRow.id);
      }
    })();
    this.activePromise = task;
    return task.finally(() => { if (this.activePromise === task) this.activePromise = null; });
  }

  /** Tự động hoàn tất bản sao lưu bị ngắt giữa chừng (kẹt RUNNING khi khởi động lại server) hoặc lỗi cũ. */
  async healInterruptedBackups(): Promise<void> {
    if (this.healingPromise) return this.healingPromise;
    this.healingPromise = (async () => {
      for (const b of this.db.backupLog.all()) {
        if (this.activeLogIds.has(b.id)) continue;
        const isStuckRunning = b.status === 'RUNNING';
        const isFailedRangeErr = b.status === 'FAILED' && b.error.includes('Unable to parse range');
        if (!isStuckRunning && !isFailedRangeErr) continue;

        const kind = (['DAILY', 'CRITICAL', 'WEEKLY', 'MONTHLY', 'PRE_OPERATION'].includes(b.kind) ? b.kind : 'DAILY') as BackupKind;
        const startedTime = b.started_at ? dayjs(b.started_at) : dayjs();
        const plan = planFor(kind, startedTime.isValid() ? startedTime : dayjs());
        try {
          const { folderId, filesCount } = await this.syncDriveFilesForPlan(plan, true);
          const rows = this.collectRowCounts();
          const cur = this.db.backupLog.get(b.id);
          if (!cur) continue;
          await this.db.backupLog.update(cur.id, cur.version, {
            status: 'SUCCESS', finished_at: cur.finished_at || nowIso(), drive_folder_id: folderId || cur.drive_folder_id,
            files_count: filesCount, rows_json: cur.rows_json && cur.rows_json.length > 10 ? cur.rows_json : JSON.stringify(rows), error: '',
          }, 'system');
        } catch {
          // Bỏ qua nếu tạm thời mất kết nối mạng, lần quét kế tiếp sẽ hoàn tất
        }
      }
    })().finally(() => { this.healingPromise = null; });
    return this.healingPromise;
  }

  async applyRetention() {
    if (!this.googleClients || this.env.DATA_BACKEND !== 'google' || !this.env.DRIVE_ROOT_FOLDER_ID) return { cleaned: 0, mode: this.env.DATA_BACKEND };
    let cleaned = 0;
    for (const [sub, keep] of [['daily', 30], ['weekly', 12], ['monthly', 24]] as [string, number][]) {
      const parent = await ensureFolderPath(this.googleClients.drive, this.env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, sub]);
      const folders = (await listChildFolders(this.googleClients.drive, parent)).sort((a, b) => b.name.localeCompare(a.name));
      for (const f of folders.slice(keep)) { await trashFile(this.googleClients.drive, f.id); cleaned++; }
    }
    const criticalParent = await ensureFolderPath(this.googleClients.drive, this.env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, 'critical']);
    const cutoff = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    for (const f of await listChildFolders(this.googleClients.drive, criticalParent)) {
      if (f.name.slice(0, 10) < cutoff) { await trashFile(this.googleClients.drive, f.id); cleaned++; }
    }
    return { cleaned, mode: 'google' };
  }

  startEmbeddedScheduler(log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }) {
    if (this.timer) return;
    void this.healInterruptedBackups().catch((err) => log.error({ err }, 'Lỗi tự động khôi phục bản sao lưu bị ngắt'));
    this.timer = setInterval(async () => {
      if (this.running) return;
      this.running = true;
      try {
        await sweepExpiredShiftsAndMarkAbsent(this.db, 'embedded-absent-scanner');
        await this.healInterruptedBackups();
        const now = dayjs().tz(APP_TZ), todayStr = now.format('YYYY-MM-DD'), hhmm = now.format('HH:mm');
        const hasDailyToday = this.db.backupLog.all().some((b: BackupLogRow) => b.kind === 'DAILY' && String(b.started_at).startsWith(todayStr) && b.status === 'SUCCESS');
        if (!hasDailyToday && hhmm >= '01:00') {
          this.lastTriggeredSlot = `${todayStr} 01:00`;
          await this.runBackup('DAILY', 'embedded-cron');
          return;
        }
        const slot = now.format('YYYY-MM-DD HH:mm');
        if (slot !== this.lastTriggeredSlot) {
          if (hhmm === '01:00') { this.lastTriggeredSlot = slot; await this.runBackup('DAILY', 'embedded-cron'); }
          else if (['06:00', '10:00', '14:00', '18:00', '22:00'].includes(hhmm)) { this.lastTriggeredSlot = slot; await this.runBackup('CRITICAL', 'embedded-cron'); }
          else if (hhmm === '02:00' && now.day() === 0) { this.lastTriggeredSlot = slot; await this.runBackup('WEEKLY', 'embedded-cron'); }
          else if (hhmm === '03:00' && now.date() === 1) { this.lastTriggeredSlot = slot; await this.runBackup('MONTHLY', 'embedded-cron'); }
          else if (hhmm === '04:00') { this.lastTriggeredSlot = slot; await this.applyRetention(); await this.reconciliation.scanAndRepair({ autoFix: true, actorId: 'embedded-cron' }); }
        }
      } catch (err) {
        log.error({ err }, 'Lỗi chạy tác vụ lập lịch nội bộ');
      } finally {
        this.running = false;
      }
    }, 60_000);
    this.timer.unref?.();
    log.info('Đã kích hoạt bộ lập lịch sao lưu & tự động phục hồi sao lưu bị ngắt (Embedded Worker)');
  }

  async stopEmbeddedScheduler() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.activePromise) await this.activePromise.catch(() => undefined);
    if (this.healingPromise) await this.healingPromise.catch(() => undefined);
  }
}
