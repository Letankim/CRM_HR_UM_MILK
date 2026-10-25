/**
 * Kiểm tra toàn bộ kết nối Google thật trước khi chạy hệ thống.
 *
 *   pnpm google:doctor
 *
 * Kiểm tra: refresh token, quyền (scope), dung lượng Drive, thư mục gốc, 7 spreadsheet,
 * từng tab + header, ghi/đọc thử một dòng (Sheets) và tải lên/xóa thử một file (Drive).
 * Trả mã thoát 1 nếu có lỗi nghiêm trọng.
 */
import {
  createGoogleClients,
  ensureFolder,
  getStorageQuota,
  isAuthRevokedError,
  trashFile,
  uploadFile,
  withRetry,
} from '@umbm/google';
import { DRIVE_FOLDERS, MONTHLY_TABS, SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';
import { loadEnv, sheetIds } from '../src/config/env.js';
import { newId, nowIso } from '../src/lib/time.js';
import { serializeCell } from '../src/sheets/a1.js';
import { GoogleSheetsGateway } from '../src/sheets/gateway.js';

type Level = 'PASS' | 'WARN' | 'FAIL';
const results: { level: Level; check: string; detail: string }[] = [];
const report = (level: Level, check: string, detail = '') => {
  results.push({ level, check, detail });
  console.log(`[${level}] ${check}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const env = loadEnv({ ...process.env, DATA_BACKEND: 'google' });
  const clients = createGoogleClients({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  // 1. Token
  try {
    const { email } = await clients.verify();
    report('PASS', 'Refresh token hợp lệ', `tài khoản ${email}`);
  } catch (err) {
    report('FAIL', 'Refresh token', isAuthRevokedError(err) ? 'đã bị thu hồi — chạy lại pnpm google:auth' : (err as Error).message);
    return;
  }

  // 2. Dung lượng
  const { usage, limit } = await getStorageQuota(clients.drive);
  if (limit) {
    const pct = Math.round((usage / limit) * 100);
    const detail = `${(usage / 1e9).toFixed(2)}GB / ${(limit / 1e9).toFixed(0)}GB (${pct}%)`;
    report(pct >= 90 ? 'FAIL' : pct >= 80 ? 'WARN' : 'PASS', 'Dung lượng Google Drive', detail);
    if (limit <= 16e9) report('WARN', 'Gói dung lượng', 'Đang dùng 15GB miễn phí — khuyến nghị nâng Google One 100GB cho ảnh điểm danh');
  }

  // 3. Thư mục gốc + thư mục con
  if (!env.DRIVE_ROOT_FOLDER_ID) {
    report('FAIL', 'DRIVE_ROOT_FOLDER_ID', 'chưa cấu hình — chạy pnpm sheets:bootstrap');
  } else {
    try {
      const f = await clients.drive.files.get({ fileId: env.DRIVE_ROOT_FOLDER_ID, fields: 'id,name,trashed' });
      if (f.data.trashed) report('FAIL', 'Thư mục gốc', 'đang nằm trong thùng rác');
      else report('PASS', 'Thư mục gốc', f.data.name ?? '');
      for (const name of Object.values(DRIVE_FOLDERS)) await ensureFolder(clients.drive, name, env.DRIVE_ROOT_FOLDER_ID);
      report('PASS', 'Cấu trúc thư mục con', Object.values(DRIVE_FOLDERS).join(', '));
    } catch (err) {
      report('FAIL', 'Thư mục gốc', `không truy cập được (${(err as Error).message}). Thư mục phải do app tạo (scope drive.file).`);
    }
  }

  // 4. Spreadsheet + tab + header
  const ids = sheetIds(env);
  for (const key of Object.keys(SPREADSHEETS) as SpreadsheetKey[]) {
    const id = ids[key];
    if (!id) {
      report('FAIL', `Spreadsheet ${key}`, `thiếu SHEET_ID_${key}`);
      continue;
    }
    try {
      const meta = await withRetry(() => clients.sheets.spreadsheets.get({ spreadsheetId: id, fields: 'properties.title,sheets.properties.title' }));
      const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ''));
      const monthly = new Set(MONTHLY_TABS[key] ?? []);
      const tabs = Object.entries(SPREADSHEETS[key].tabs).filter(([t]) => !monthly.has(t)) as [string, readonly string[]][];
      const missing = tabs.filter(([t]) => !existing.has(t)).map(([t]) => t);
      if (missing.length) {
        report('FAIL', `Spreadsheet ${key}`, `thiếu tab: ${missing.join(', ')}`);
        continue;
      }
      const heads = await withRetry(() =>
        clients.sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: tabs.map(([t]) => `'${t}'!1:1`) }),
      );
      const bad: string[] = [];
      tabs.forEach(([t, expected], i) => {
        const actual = (heads.data.valueRanges?.[i]?.values?.[0] ?? []).map(String);
        const mismatch = expected.findIndex((h, j) => actual[j] !== h);
        if (mismatch >= 0) bad.push(`${t} (cột ${mismatch + 1}: mong đợi "${expected[mismatch]}", thực tế "${actual[mismatch] ?? ''}")`);
      });
      if (bad.length) report('FAIL', `Header ${key}`, bad.join('; '));
      else report('PASS', `Spreadsheet ${key}`, `${meta.data.properties?.title} — ${tabs.length} tab, header đúng`);
    } catch (err) {
      report('FAIL', `Spreadsheet ${key}`, `không truy cập được: ${(err as Error).message}`);
    }
  }

  // 5. Ghi/đọc thử Sheets (tab JOB_RUNS)
  if (ids.SYSTEM) {
    try {
      const gw = new GoogleSheetsGateway(clients.sheets);
      const headers = SPREADSHEETS.SYSTEM.tabs.JOB_RUNS;
      const now = nowIso();
      const marker = newId();
      const row = { id: marker, created_at: now, created_by: 'doctor', updated_at: now, updated_by: 'doctor', version: 1, is_deleted: false, job: 'google-doctor', started_at: now, finished_at: now, status: 'SUCCESS', detail: 'Kiểm tra ghi/đọc' };
      const t0 = Date.now();
      const rowNumber = await gw.appendRows(ids.SYSTEM, 'JOB_RUNS', [headers.map((h) => serializeCell((row as Record<string, unknown>)[h]))]);
      const back = await gw.readRow(ids.SYSTEM, 'JOB_RUNS', rowNumber, headers.length);
      if (back[0] === marker && back[6] === 'FALSE') report('PASS', 'Ghi/đọc Google Sheets', `dòng ${rowNumber}, ${Date.now() - t0}ms`);
      else report('FAIL', 'Ghi/đọc Google Sheets', `đọc lại không khớp: ${JSON.stringify(back.slice(0, 7))}`);
    } catch (err) {
      report('FAIL', 'Ghi/đọc Google Sheets', (err as Error).message);
    }
  }

  // 6. Tải lên / xóa thử Drive
  if (env.DRIVE_ROOT_FOLDER_ID) {
    try {
      const exports = await ensureFolder(clients.drive, DRIVE_FOLDERS.EXPORTS, env.DRIVE_ROOT_FOLDER_ID);
      const t0 = Date.now();
      const { id } = await uploadFile(clients.drive, { name: `doctor-${Date.now()}.txt`, mimeType: 'text/plain', parentId: exports, data: Buffer.from('umbm doctor') });
      await trashFile(clients.drive, id);
      report('PASS', 'Tải lên Google Drive', `${Date.now() - t0}ms (file thử đã đưa vào thùng rác)`);
    } catch (err) {
      report('FAIL', 'Tải lên Google Drive', (err as Error).message);
    }
  }

  const fails = results.filter((r) => r.level === 'FAIL').length;
  const warns = results.filter((r) => r.level === 'WARN').length;
  console.log(`\nKết quả: ${results.length - fails - warns} đạt, ${warns} cảnh báo, ${fails} lỗi.`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
