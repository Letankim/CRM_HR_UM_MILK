/**
 * Tạo toàn bộ cấu trúc Google Drive + 7 spreadsheet cho hệ thống (chạy một lần).
 *
 *   pnpm sheets:bootstrap
 *
 * - Tạo thư mục gốc "UMBM_HR_SYSTEM" và các thư mục con (00_DATABASE, 01_ATTENDANCE_PHOTOS, ...).
 * - Tạo 7 spreadsheet trong 00_DATABASE, mỗi tab có header đúng hợp đồng dữ liệu,
 *   đóng băng dòng 1 và bảo vệ header (cảnh báo khi sửa tay).
 * - In ra các dòng SHEET_ID_* và DRIVE_ROOT_FOLDER_ID để dán vào .env.
 *
 * An toàn khi chạy lại: spreadsheet đã có ID trong .env sẽ được bỏ qua.
 */
import { createGoogleClients, ensureFolder, withRetry } from '@umbm/google';
import { DRIVE_FOLDERS, MONTHLY_TABS, SPREADSHEETS, type SpreadsheetKey } from '@umbm/shared';

const clients = createGoogleClients({
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '',
});
const { sheets, drive } = clients;

async function createSpreadsheet(key: SpreadsheetKey, folderId: string): Promise<string> {
  const def = SPREADSHEETS[key];
  const year = new Date().getFullYear();
  const title = key === 'ATTENDANCE' ? `${def.title}_${year}` : def.title;
  const monthly = new Set(MONTHLY_TABS[key] ?? []);
  // Tab theo tháng (AUDIT_LOG_YYYY_MM) do API tự tạo khi chạy — không tạo ở đây.
  const tabs = (Object.entries(def.tabs) as [string, readonly string[]][]).filter(([name]) => !monthly.has(name));

  const created = await withRetry(() =>
    sheets.spreadsheets.create({
      requestBody: {
        properties: { title, locale: 'vi_VN', timeZone: 'Asia/Ho_Chi_Minh' },
        sheets: tabs.map(([name, headers]) => ({
          properties: { title: name, gridProperties: { frozenRowCount: 1, columnCount: Math.max(headers.length, 26) } },
        })),
      },
    }),
  );
  const spreadsheetId = created.data.spreadsheetId!;

  // Chuyển file vào thư mục 00_DATABASE
  const meta = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
  await withRetry(() =>
    drive.files.update({
      fileId: spreadsheetId,
      addParents: folderId,
      removeParents: (meta.data.parents ?? []).join(','),
      fields: 'id',
    }),
  );

  // Ghi header
  await withRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: tabs.map(([name, headers]) => ({ range: `'${name}'!A1`, values: [[...headers]] })),
      },
    }),
  );

  // Định dạng header + bảo vệ header + định dạng toàn bộ ô là văn bản
  const sheetIds = new Map((created.data.sheets ?? []).map((s) => [s.properties!.title!, s.properties!.sheetId!]));
  const requests = tabs.flatMap(([name, headers]) => {
    const sheetId = sheetIds.get(name)!;
    return [
      {
        repeatCell: {
          range: { sheetId },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              backgroundColor: { red: 0.12, green: 0.31, blue: 0.47 },
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      },
      {
        addProtectedRange: {
          protectedRange: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            description: 'Header là hợp đồng dữ liệu — không đổi tên/thứ tự cột',
            warningOnly: true,
          },
        },
      },
    ];
  });
  await withRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));

  console.log(`  + ${title} (${tabs.length} tab)`);
  return spreadsheetId;
}

async function main() {
  const { email } = await clients.verify();
  console.log(`Tài khoản Google: ${email}\n`);

  const rootId = process.env.DRIVE_ROOT_FOLDER_ID || (await ensureFolder(drive, 'UMBM_HR_SYSTEM'));
  console.log('Thư mục Drive:');
  const folderIds: Record<string, string> = {};
  for (const [k, name] of Object.entries(DRIVE_FOLDERS)) {
    folderIds[k] = await ensureFolder(drive, name, rootId);
    console.log(`  + ${name}`);
  }

  console.log('\nSpreadsheet:');
  const out: Record<string, string> = {};
  for (const key of Object.keys(SPREADSHEETS) as SpreadsheetKey[]) {
    const existing = process.env[`SHEET_ID_${key}`];
    if (existing) {
      console.log(`  = ${SPREADSHEETS[key].title} đã có (${existing}), bỏ qua`);
      out[key] = existing;
      continue;
    }
    out[key] = await createSpreadsheet(key, folderIds.DATABASE!);
  }

  console.log('\nDán các dòng sau vào .env:\n');
  console.log(`DRIVE_ROOT_FOLDER_ID=${rootId}`);
  for (const [k, v] of Object.entries(out)) console.log(`SHEET_ID_${k}=${v}`);
  console.log('\nTiếp theo: pnpm seed:admin');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
