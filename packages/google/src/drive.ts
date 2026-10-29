import type { drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { withRetry } from './retry.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Tìm thư mục con theo tên; tạo mới nếu chưa có. Trả về folder id. */
export async function ensureFolder(drive: drive_v3.Drive, name: string, parentId?: string): Promise<string> {
  const parentClause = parentId ? ` and '${escapeQuery(parentId)}' in parents` : '';
  const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(name)}' and trashed=false${parentClause}`;
  const found = await withRetry(() => drive.files.list({ q, fields: 'files(id,name)', pageSize: 1 }));
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await withRetry(() =>
    drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
      fields: 'id',
    }),
  );
  if (!created.data.id) throw new Error(`Không tạo được thư mục ${name}`);
  return created.data.id;
}

/** Đảm bảo một đường dẫn thư mục lồng nhau, ví dụ ['90_BACKUPS','daily','2026-10-23']. */
export async function ensureFolderPath(drive: drive_v3.Drive, rootId: string, segments: string[]): Promise<string> {
  let current = rootId;
  for (const seg of segments) current = await ensureFolder(drive, seg, current);
  return current;
}

export async function uploadFile(
  drive: drive_v3.Drive,
  params: { name: string; mimeType: string; parentId: string; data: Buffer },
): Promise<{ id: string; size: number }> {
  const res = await withRetry(() =>
    drive.files.create({
      requestBody: { name: params.name, parents: [params.parentId] },
      media: { mimeType: params.mimeType, body: Readable.from(params.data) },
      fields: 'id,size',
    }),
  );
  if (!res.data.id) throw new Error(`Upload thất bại: ${params.name}`);
  return { id: res.data.id, size: Number(res.data.size ?? params.data.length) };
}

export async function copyFile(
  drive: drive_v3.Drive,
  fileId: string,
  params: { name: string; parentId: string },
): Promise<string> {
  const res = await withRetry(() =>
    drive.files.copy({ fileId, requestBody: { name: params.name, parents: [params.parentId] }, fields: 'id' }),
  );
  if (!res.data.id) throw new Error(`Copy thất bại: ${fileId}`);
  return res.data.id;
}

/** Xuất Google Sheets ra .xlsx (Buffer). */
export async function exportSpreadsheetXlsx(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await withRetry(() =>
    drive.files.export(
      { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' },
    ),
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function downloadFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await withRetry(() =>
    drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }),
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function listChildFolders(drive: drive_v3.Drive, parentId: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      drive.files.list({
        q: `mimeType='${FOLDER_MIME}' and '${escapeQuery(parentId)}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id,name)',
        pageSize: 200,
        pageToken,
      }),
    );
    for (const f of res.data.files ?? []) if (f.id && f.name) out.push({ id: f.id, name: f.name });
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** Đưa vào thùng rác (khôi phục được trong 30 ngày) thay vì xóa vĩnh viễn. */
export async function trashFile(drive: drive_v3.Drive, fileId: string): Promise<void> {
  await withRetry(() => drive.files.update({ fileId, requestBody: { trashed: true } }));
}

export async function getStorageQuota(drive: drive_v3.Drive): Promise<{ usage: number; limit: number | null }> {
  const res = await withRetry(() => drive.about.get({ fields: 'storageQuota(usage,limit)' }));
  const q = res.data.storageQuota;
  return { usage: Number(q?.usage ?? 0), limit: q?.limit ? Number(q.limit) : null };
}
