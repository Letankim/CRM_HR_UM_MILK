import { SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import type { Database, SpreadsheetIds } from '../data/database.js';
import type { BackupLogRow } from '../data/system-schemas.js';
import { APP_TZ, dayjs } from '../lib/time.js';
import { monthlyFileName, readPartitionRegistry } from './data-partition.service.js';
import type { BackupKind } from './backup.service.js';

export interface BackupTargetFile {
  fileId: string;
  title: string;
  sourceKind: 'ROOT' | 'MONTHLY_FILE';
  monthKey?: string;
}

export interface ExposedMonthlySpreadsheet {
  monthKey: string;
  title: string;
  spreadsheetId: string;
  isActive: boolean;
}

/** Danh sách toàn bộ tệp Google Sheets theo tháng đã đăng ký (hoặc đang kích hoạt) trên Drive. */
export function listRegisteredMonthlySpreadsheets(db: Database, rootScheduleId?: string): ExposedMonthlySpreadsheet[] {
  const byId = new Map<string, ExposedMonthlySpreadsheet>();
  const schedRoot = rootScheduleId || db.ids.SCHEDULE;
  for (const r of readPartitionRegistry(db)) {
    if (r.mode !== 'MONTHLY_FILE' || !r.spreadsheetId || r.spreadsheetId === schedRoot) continue;
    byId.set(r.spreadsheetId, {
      monthKey: r.monthKey,
      title: r.fileName || monthlyFileName(r.monthKey),
      spreadsheetId: r.spreadsheetId,
      isActive: r.monthKey === db.partitionMonth,
    });
  }
  const activeSid = db.shiftAssignments.spreadsheetId;
  if (db.partitionMonth && activeSid && activeSid !== schedRoot && !byId.has(activeSid)) {
    byId.set(activeSid, {
      monthKey: db.partitionMonth,
      title: monthlyFileName(db.partitionMonth),
      spreadsheetId: activeSid,
      isActive: true,
    });
  }
  return [...byId.values()].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

/**
 * Xác định danh sách tệp Spreadsheet cần sao lưu cho từng cấp độ Backup:
 * - Gốc: toàn bộ `keys` (7 tệp gốc cho DAILY/WEEKLY/MONTHLY/PRE_OPERATION; CORE + ATTENDANCE + PAYROLL cho CRITICAL).
 * - Theo tháng (`UMBM_MONTHLY_YYYY_MM`):
 *   + WEEKLY / MONTHLY / PRE_OPERATION: sao lưu 100% các tệp tháng đã đăng ký trong `DATA_PARTITIONS_REGISTRY`.
 *   + CRITICAL / DAILY: sao lưu tệp tháng đang kích hoạt (`db.partitionMonth`), tệp tháng lịch hiện tại (`YYYY_MM`),
 *     và tệp tháng liền trước (`YYYY_MM` — đang rà soát/chốt lương đầu tháng mới), khử trùng lặp theo `spreadsheetId`.
 */
export function resolveBackupTargets(
  db: Database,
  ids: Partial<SpreadsheetIds>,
  kind: BackupKind,
  keys: readonly SpreadsheetKey[],
  at = dayjs().tz(APP_TZ),
): BackupTargetFile[] {
  const targets: BackupTargetFile[] = [];
  const seen = new Set<string>();
  const push = (t: BackupTargetFile) => {
    if (!t.fileId || seen.has(t.fileId)) return;
    seen.add(t.fileId);
    targets.push(t);
  };

  for (const key of keys) {
    const fid = ids[key] || db.ids[key];
    if (fid) push({ fileId: fid, title: SPREADSHEETS[key].title, sourceKind: 'ROOT' });
  }

  if (!keys.includes('ATTENDANCE') && !keys.includes('SCHEDULE')) return targets;

  const monthlyList = listRegisteredMonthlySpreadsheets(db, ids.SCHEDULE || db.ids.SCHEDULE);
  if (monthlyList.length === 0) return targets;

  const includeAllMonthly = kind === 'WEEKLY' || kind === 'MONTHLY' || kind === 'PRE_OPERATION';
  const curCalMonth = at.tz(APP_TZ).format('YYYY_MM');
  const prevCalMonth = at.tz(APP_TZ).subtract(1, 'month').format('YYYY_MM');
  const hotMonths = new Set<string>([db.partitionMonth, curCalMonth, prevCalMonth].filter(Boolean));

  for (const m of monthlyList) {
    if (includeAllMonthly || m.isActive || hotMonths.has(m.monthKey)) {
      push({ fileId: m.spreadsheetId, title: m.title, sourceKind: 'MONTHLY_FILE', monthKey: m.monthKey });
    }
  }
  return targets;
}

/**
 * Phát hiện bản sao lưu bị lỡ lịch khi Render Free Tier ngủ đông và tự động chạy bù (catch-up)
 * theo thứ tự ưu tiên: DAILY -> MONTHLY -> WEEKLY -> CRITICAL (mỗi 4 giờ trong khung vận hành 06:00-23:30).
 */
export function detectDueCatchUpBackup(db: Database, now = dayjs().tz(APP_TZ)): BackupKind | null {
  const logs = db.backupLog.all().filter((b: BackupLogRow) => b.status === 'SUCCESS');
  const todayStr = now.format('YYYY-MM-DD'), monthPrefix = now.format('YYYY-MM'), hhmm = now.format('HH:mm');

  const hasDailyToday = logs.some((b) => b.kind === 'DAILY' && String(b.started_at).startsWith(todayStr));
  if (!hasDailyToday && hhmm >= '01:00') return 'DAILY';

  if (now.date() > 1 || hhmm >= '03:00') {
    const hasMonthly = logs.some((b) => b.kind === 'MONTHLY' && String(b.started_at).startsWith(monthPrefix));
    if (!hasMonthly) return 'MONTHLY';
  }

  const weekSundayStr = now.subtract(now.day(), 'day').format('YYYY-MM-DD');
  if (now.day() > 0 || hhmm >= '02:00') {
    const hasWeekly = logs.some((b) => b.kind === 'WEEKLY' && String(b.started_at).slice(0, 10) >= weekSundayStr);
    if (!hasWeekly) return 'WEEKLY';
  }

  if (hhmm >= '06:00' && hhmm <= '23:30') {
    const hasRecentCritical = logs.some((b) => {
      if (b.kind !== 'CRITICAL' && b.kind !== 'DAILY') return false;
      const t = dayjs(b.started_at);
      return t.isValid() && now.diff(t, 'minute') < 240;
    });
    if (!hasRecentCritical) return 'CRITICAL';
  }
  return null;
}
