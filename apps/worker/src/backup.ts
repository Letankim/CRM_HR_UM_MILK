import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
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
import { DRIVE_FOLDERS, SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import type { WorkerEnv } from './env.js';
import { alert, type InternalApi } from './internal-api.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
const TZ = 'Asia/Ho_Chi_Minh';
const now = () => dayjs().tz(TZ);
const iso = () => now().format('YYYY-MM-DDTHH:mm:ssZ');

export type BackupKind = 'DAILY' | 'CRITICAL' | 'WEEKLY' | 'MONTHLY' | 'PRE_OPERATION';

interface BackupPlan {
  kind: BackupKind;
  folder: string[];
  keys: SpreadsheetKey[];
  exportXlsx: boolean;
}

/** Dữ liệu quan trọng được snapshot dày hơn (mỗi 4 giờ). */
const CRITICAL_KEYS: SpreadsheetKey[] = ['CORE', 'ATTENDANCE', 'PAYROLL'];
const ALL_KEYS = Object.keys(SPREADSHEETS) as SpreadsheetKey[];

export function planFor(kind: BackupKind, at = now()): BackupPlan {
  switch (kind) {
    case 'DAILY':
      return { kind, folder: ['daily', at.format('YYYY-MM-DD')], keys: ALL_KEYS, exportXlsx: true };
    case 'CRITICAL':
      return { kind, folder: ['critical', at.format('YYYY-MM-DD_HHmm')], keys: CRITICAL_KEYS, exportXlsx: false };
    case 'WEEKLY':
      return { kind, folder: ['weekly', `${at.isoWeekYear()}-W${String(at.isoWeek()).padStart(2, '0')}`], keys: ALL_KEYS, exportXlsx: true };
    case 'MONTHLY':
      return { kind, folder: ['monthly', at.format('YYYY-MM')], keys: ALL_KEYS, exportXlsx: true };
    case 'PRE_OPERATION':
      return { kind, folder: ['pre-operation', at.format('YYYY-MM-DD_HHmmss')], keys: ALL_KEYS, exportXlsx: false };
  }
}

/** Đếm số dòng dữ liệu (trừ header) của từng tab — dùng để phát hiện mất dữ liệu bất thường. */
async function countRows(google: GoogleClients, spreadsheetId: string, key: SpreadsheetKey): Promise<Record<string, number>> {
  const tabs = Object.keys(SPREADSHEETS[key].tabs);
  const res = await withRetry(() =>
    google.sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((t) => `'${t}'!A:A`) }),
  );
  const out: Record<string, number> = {};
  res.data.valueRanges?.forEach((vr, i) => {
    out[`${key}.${tabs[i]}`] = Math.max(0, (vr.values?.length ?? 0) - 1);
  });
  return out;
}

export async function runBackup(env: WorkerEnv, google: GoogleClients, api: InternalApi, kind: BackupKind): Promise<void> {
  const plan = planFor(kind);
  const { id: logId } = await api.startBackup(kind, iso());
  const rows: Record<string, number> = {};
  let files = 0;
  let folderId = '';

  try {
    const { spreadsheets } = await api.spreadsheets();
    folderId = await ensureFolderPath(google.drive, env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, ...plan.folder]);
    const stamp = plan.folder[plan.folder.length - 1];

    for (const key of plan.keys) {
      const fileId = spreadsheets[key];
      if (!fileId) throw new Error(`Thiếu spreadsheet ${key}`);
      Object.assign(rows, await countRows(google, fileId, key));

      await copyFile(google.drive, fileId, { name: `${SPREADSHEETS[key].title}__${stamp}`, parentId: folderId });
      files++;

      if (plan.exportXlsx) {
        const xlsx = await exportSpreadsheetXlsx(google.drive, fileId);
        await uploadFile(google.drive, {
          name: `${SPREADSHEETS[key].title}__${stamp}.xlsx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          parentId: folderId,
          data: xlsx,
        });
        files++;
      }
    }

    await api.finishBackup({ id: logId, status: 'SUCCESS', finishedAt: iso(), driveFolderId: folderId, filesCount: files, rows });
    console.log(`[backup] ${kind} OK — ${files} file → ${plan.folder.join('/')}`);
  } catch (err) {
    const message = (err as Error).message;
    await api
      .finishBackup({ id: logId, status: 'FAILED', finishedAt: iso(), driveFolderId: folderId, filesCount: files, rows, error: message })
      .catch(() => undefined);
    await alert(env, `Backup ${kind} THẤT BẠI: ${message}`);
    throw err;
  }
}

/**
 * Xóa (đưa vào thùng rác) các bản backup cũ theo chính sách giữ lại.
 * Tên thư mục bắt đầu bằng ngày nên sắp xếp theo tên = sắp xếp theo thời gian.
 */
export async function applyRetention(env: WorkerEnv, google: GoogleClients): Promise<void> {
  const policies: [string, number][] = [
    ['daily', env.BACKUP_DAILY_RETENTION],
    ['weekly', env.BACKUP_WEEKLY_RETENTION],
    ['monthly', env.BACKUP_MONTHLY_RETENTION],
  ];
  for (const [sub, keep] of policies) {
    const parent = await ensureFolderPath(google.drive, env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, sub]);
    const folders = (await listChildFolders(google.drive, parent)).sort((a, b) => b.name.localeCompare(a.name));
    for (const f of folders.slice(keep)) {
      await trashFile(google.drive, f.id);
      console.log(`[retention] ${sub}/${f.name} → thùng rác`);
    }
  }

  const criticalParent = await ensureFolderPath(google.drive, env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.BACKUPS, 'critical']);
  const cutoff = now().subtract(env.BACKUP_CRITICAL_RETENTION_DAYS, 'day').format('YYYY-MM-DD');
  for (const f of await listChildFolders(google.drive, criticalParent)) {
    if (f.name.slice(0, 10) < cutoff) {
      await trashFile(google.drive, f.id);
      console.log(`[retention] critical/${f.name} → thùng rác`);
    }
  }
}
