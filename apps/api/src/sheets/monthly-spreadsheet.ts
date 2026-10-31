import { ensureFolderPath, withRetry, type drive_v3, type sheets_v4 } from '@umbm/google';

export interface CreateMonthlySpreadsheetParams {
  monthKey: string;
  title: string;
  folderSegments: string[];
  tabs: { name: string; headers: readonly string[] }[];
}

export interface CreatedMonthlySpreadsheet {
  spreadsheetId: string;
  fileName: string;
  folderId: string;
  folderPath: string;
  webViewLink: string;
}

export interface GoogleDrivePlacementOpts {
  drive: drive_v3.Drive;
  rootFolderId: string;
}

const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const escapeDriveQuery = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Tạo (hoặc tái sử dụng nếu đã tồn tại cùng tên trong thư mục tháng) 1 File Google Spreadsheet độc lập
 * cho phân vùng dữ liệu tháng, chứa đúng 5 bảng nghiệp vụ sạch với dòng tiêu đề đóng băng và bảo vệ.
 */
export async function createGoogleMonthlySpreadsheet(
  sheets: sheets_v4.Sheets,
  driveOpts: GoogleDrivePlacementOpts | undefined,
  params: CreateMonthlySpreadsheetParams,
  onRetry?: (attempt: number, error: unknown) => void,
): Promise<CreatedMonthlySpreadsheet> {
  const folderPath = params.folderSegments.join('/');
  let folderId = '';

  if (driveOpts?.drive && driveOpts.rootFolderId) {
    folderId = await ensureFolderPath(driveOpts.drive, driveOpts.rootFolderId, params.folderSegments);
    const q = `mimeType='${SPREADSHEET_MIME}' and name='${escapeDriveQuery(params.title)}' and '${escapeDriveQuery(folderId)}' in parents and trashed=false`;
    const found = await withRetry(
      () => driveOpts.drive.files.list({ q, fields: 'files(id,name,webViewLink)', pageSize: 1 }),
      { onRetry },
    );
    const existing = found.data.files?.[0];
    if (existing?.id) {
      return {
        spreadsheetId: existing.id,
        fileName: params.title,
        folderId,
        folderPath,
        webViewLink: existing.webViewLink || `https://docs.google.com/spreadsheets/d/${existing.id}/edit`,
      };
    }
  }

  const created = await withRetry(
    () =>
      sheets.spreadsheets.create({
        requestBody: {
          properties: { title: params.title, locale: 'vi_VN', timeZone: 'Asia/Ho_Chi_Minh' },
          sheets: params.tabs.map((t) => ({
            properties: {
              title: t.name,
              gridProperties: { frozenRowCount: 1, columnCount: Math.max(t.headers.length, 26) },
            },
          })),
        },
      }),
    { onRetry },
  );

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error(`Không thể khởi tạo file Google Sheets ${params.title}`);
  let webViewLink = created.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  if (driveOpts?.drive && folderId) {
    const meta = await withRetry(() => driveOpts.drive.files.get({ fileId: spreadsheetId, fields: 'parents,webViewLink' }), { onRetry });
    const removeParents = (meta.data.parents ?? []).join(',');
    const moved = await withRetry(
      () =>
        driveOpts.drive.files.update({
          fileId: spreadsheetId,
          addParents: folderId,
          removeParents: removeParents || undefined,
          fields: 'id,webViewLink',
        }),
      { onRetry },
    );
    if (moved.data.webViewLink) webViewLink = moved.data.webViewLink;
  }

  await withRetry(
    () =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: params.tabs.map((t) => ({ range: `${quoteTab(t.name)}!A1`, values: [[...t.headers]] })),
        },
      }),
    { onRetry },
  );

  const sheetIds = new Map((created.data.sheets ?? []).map((s) => [s.properties?.title ?? '', s.properties?.sheetId]));
  const requests = params.tabs.flatMap((t) => {
    const sheetId = sheetIds.get(t.name);
    if (sheetId === undefined || sheetId === null) return [];
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
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: t.headers.length },
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
            description: 'Dòng tiêu đề chuẩn hệ thống — không đổi tên hoặc thứ tự cột',
            warningOnly: true,
          },
        },
      },
    ];
  });
  if (requests.length > 0) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }), { onRetry });
  }

  return { spreadsheetId, fileName: params.title, folderId, folderPath, webViewLink };
}
