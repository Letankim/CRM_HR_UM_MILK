import {
  copyFile,
  ensureFolderPath,
  exportSpreadsheetXlsx,
  listChildFolders,
  trashFile,
  uploadFile,
  withRetry,
  type GoogleClients,
} from '@umbm/google';
import { DRIVE_FOLDERS, MONTHLY_TABS, monthlyTabName, SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import type { Env } from '../config/env.js';
import { sheetIds } from '../config/env.js';
import type { Database } from '../data/database.js';
import { dayjs, nowIso } from '../lib/time.js';
import type { ReconciliationService } from './reconciliation.service.js';
import { sweepExpiredShiftsAndMarkAbsent } from './shift-absent-scanner.js';

export type BackupKind = 'DAILY' | 'CRITICAL' | 'WEEKLY' | 'MONTHLY' | 'PRE_OPERATION';

interface BackupPlan {
  kind: BackupKind;
  folder: string[];
  keys: SpreadsheetKey[];
  exportXlsx: boolean;
}

const CRITICAL_KEYS: SpreadsheetKey[] = ['CORE', 'ATTENDANCE', 'PAYROLL'];
const ALL_KEYS = Object.keys(SPREADSHEETS) as SpreadsheetKey[];

function planFor(kind: BackupKind, at = dayjs()): BackupPlan {
  switch (kind) {
    case 'DAILY':
      return { kind, folder: ['daily', at.format('YYYY-MM-DD')], keys: ALL_KEYS, exportXlsx: true };
    case 'CRITICAL':
      return { kind, folder: ['critical', at.format('YYYY-MM-DD_HHmm')], keys: CRITICAL_KEYS, exportXlsx: false };
    case 'WEEKLY':
      return { kind, folder: ['weekly', at.format('YYYY-[W]WW')], keys: ALL_KEYS, exportXlsx: true };
    case 'MONTHLY':
      return { kind, folder: ['monthly', at.format('YYYY-MM')], keys: ALL_KEYS, exportXlsx: true };
    case 'PRE_OPERATION':
      return { kind, folder: ['pre-operation', at.format('YYYY-MM-DD_HHmmss')], keys: ALL_KEYS, exportXlsx: false };
  }
}

/**
 * Dịch vụ Sao lưu Tự động & Lập lịch Nội bộ (Embedded Worker cho Render Free Tier & Local).
 * Tự động sao lưu 7 Google Spreadsheets + xuất .xlsx lên Google Drive, dọn bản cũ và chạy đối soát định kỳ
 * ngay trong tiến trình `apps/api` mà không cần thuê thêm Background Worker riêng.
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private lastTriggeredSlot = '';
  private running = false;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly reconciliation: ReconciliationService,
    private readonly googleClients?: GoogleClients,
  ) {}

  async runBackup(kind: BackupKind, actorId = 'embedded-worker') {
    const startedAt = nowIso();
    const plan = planFor(kind);
    const logRow = await this.db.backupLog.insert(
      {
        kind,
        started_at: startedAt,
        finished_at: '',
        status: 'RUNNING',
        drive_folder_id: '',
        files_count: 0,
        rows_json: '',
        error: '',
      },
      actorId,
    );

    const rows: Record<string, number> = {};
    let filesCount = 0;
    let folderId = '';

    try {
      for (const t of this.db.stats().tables) {
        rows[t.table] = t.rows;
      }

      if (this.googleClients && this.env.DATA_BACKEND === 'google' && this.env.DRIVE_ROOT_FOLDER_ID) {
        const ids = sheetIds(this.env);
        folderId = await ensureFolderPath(this.googleClients.drive, this.env.DRIVE_ROOT_FOLDER_ID, [
          DRIVE_FOLDERS.BACKUPS,
          ...plan.folder,
        ]);
        const stamp = plan.folder[plan.folder.length - 1]!;

        for (const key of plan.keys) {
          const fileId = ids[key];
          if (!fileId) continue;
          const tabs = Object.keys(SPREADSHEETS[key].tabs);
          const monthlySet = new Set(MONTHLY_TABS[key] ?? []);
          const sheetRanges = tabs.map((t) => `'${monthlySet.has(t) ? monthlyTabName(t) : t}'!A:A`);
          const res = await withRetry(() =>
            this.googleClients!.sheets.spreadsheets.values.batchGet({
              spreadsheetId: fileId,
              ranges: sheetRanges,
            }),
          ).catch(() => null);
          res?.data.valueRanges?.forEach((vr, i) => {
            rows[`${key}.${tabs[i]}`] = Math.max(0, (vr.values?.length ?? 0) - 1);
          });

          await copyFile(this.googleClients.drive, fileId, {
            name: `${SPREADSHEETS[key].title}__${stamp}`,
            parentId: folderId,
          });
          filesCount++;

          if (plan.exportXlsx) {
            const xlsx = await exportSpreadsheetXlsx(this.googleClients.drive, fileId);
            await uploadFile(this.googleClients.drive, {
              name: `${SPREADSHEETS[key].title}__${stamp}.xlsx`,
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              parentId: folderId,
              data: xlsx,
            });
            filesCount++;
          }
        }
      } else {
        folderId = `memory://${plan.folder.join('/')}`;
        filesCount = plan.keys.length * (plan.exportXlsx ? 2 : 1);
      }

      const updated = await this.db.backupLog.update(logRow.id, logRow.version, { status: 'SUCCESS', finished_at: nowIso(), drive_folder_id: folderId, files_count: filesCount, rows_json: JSON.stringify(rows), error: '' }, actorId);
      return updated;
    } catch (err) {
      const errMsg = (err as Error).message || 'Lỗi sao lưu không xác định';
      await this.db.backupLog.update(logRow.id, logRow.version, { status: 'FAILED', finished_at: nowIso(), drive_folder_id: folderId, files_count: filesCount, rows_json: JSON.stringify(rows), error: errMsg.slice(0, 2000) }, actorId).catch(() => undefined);
      throw err;
    }
  }

  async applyRetention() {
    if (!this.googleClients || this.env.DATA_BACKEND !== 'google' || !this.env.DRIVE_ROOT_FOLDER_ID) return { cleaned: 0, mode: this.env.DATA_BACKEND };
    let cleaned = 0;
    const policies: [string, number][] = [['daily', 30], ['weekly', 12], ['monthly', 24]];
    for (const [sub, keep] of policies) {
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

  /** Khởi chạy bộ lập lịch tích hợp sẵn trong tiến trình API (kiểm tra mỗi 60 giây theo múi giờ Việt Nam). */
  startEmbeddedScheduler(log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      if (this.running) return;
      this.running = true;
      try {
        await sweepExpiredShiftsAndMarkAbsent(this.db, 'embedded-absent-scanner');
        const now = dayjs();
        const slot = now.format('YYYY-MM-DD HH:mm');
        if (slot !== this.lastTriggeredSlot) {
          const hhmm = now.format('HH:mm');
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
    log.info('Đã kích hoạt bộ lập lịch sao lưu & quét tự động khóa ca vắng mặt quá giờ (Embedded Worker)');
  }

  stopEmbeddedScheduler() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
