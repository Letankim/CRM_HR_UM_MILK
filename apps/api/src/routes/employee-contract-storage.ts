import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DRIVE_FOLDERS, type Employee, type EmployeeContractItem } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { nowIso } from '../lib/time.js';
import { detectBufferMimeType, extractGoogleDriveFileId, guessMimeByExtension } from '../services/mkt-media-storage.service.js';

const contractRamCache = new Map<string, { buffer: Buffer; mime: string }>();

export function putContractCache(keys: (string | undefined)[], buffer: Buffer, mime: string): void {
  for (const k of keys) {
    if (!k) continue;
    contractRamCache.delete(k);
    if (contractRamCache.size >= 60) {
      const first = contractRamCache.keys().next().value;
      if (first) contractRamCache.delete(first);
    }
    contractRamCache.set(k, { buffer, mime });
  }
}

export function evictContractCache(keys: (string | undefined)[]): void {
  for (const k of keys) if (k) contractRamCache.delete(k);
}

export function parseEmployeeContracts(raw?: string | null): EmployeeContractItem[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EmployeeContractItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveContractToDisk(ctx: AppContext, safeCode: string, fileDiskName: string, buf: Buffer): Promise<void> {
  for (const dir of [join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'contracts', safeCode), join(process.cwd(), 'apps', 'api', 'storage', 'contracts', safeCode)]) {
    try { await mkdir(dir, { recursive: true }); await writeFile(join(dir, fileDiskName), buf); } catch { /* ignore */ }
  }
}

export async function deleteContractFromDisk(ctx: AppContext, safeCode: string, filePart?: string): Promise<void> {
  if (!filePart) return;
  for (const dir of [join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'contracts', safeCode), join(process.cwd(), 'apps', 'api', 'storage', 'contracts', safeCode)]) {
    try { await unlink(join(dir, filePart)); } catch { /* ignore */ }
  }
}

export async function syncEmployeeContractsWithDrive(ctx: AppContext, emp: Employee): Promise<EmployeeContractItem[]> {
  const items = parseEmployeeContracts(emp.contracts_json);
  if (!ctx.google.listDriveFolderFiles) return items;
  const needsHeal = items.length === 0 || items.some((c) => !c.driveFileId || c.driveFileId.startsWith('drv_'));
  if (!needsHeal) return items;

  const safeCode = emp.employee_code.replace(/[^a-zA-Z0-9_-]/g, '');
  const rawDriveFiles = await ctx.google.listDriveFolderFiles({ rootFolder: DRIVE_FOLDERS.EMPLOYEE_DOCUMENTS, folderSegments: [safeCode] });
  const empDriveFiles = rawDriveFiles.filter((f) => f.name.toUpperCase().includes(safeCode.toUpperCase()) || rawDriveFiles.length <= 10);
  if (empDriveFiles.length === 0) return items;

  let changed = false;
  if (items.length === 0) {
    for (const f of empDriveFiles) {
      const cleanName = f.name.replace(new RegExp(`^${safeCode}_(PROBATION_CONTRACT|OFFICIAL_CONTRACT)_`, 'i'), '');
      items.push({
        id: `ctr_drv_${f.id.slice(0, 10)}`,
        contractType: /OFFICIAL/i.test(f.name) || emp.stage === 'OFFICIAL' ? 'OFFICIAL_CONTRACT' : 'PROBATION_CONTRACT',
        fileName: cleanName || f.name,
        mimeType: f.mimeType && f.mimeType !== 'application/octet-stream' ? f.mimeType : guessMimeByExtension(f.name),
        sizeBytes: f.sizeBytes || 0,
        driveFileId: f.id,
        localBackupPath: `storage/contracts/${safeCode}/${f.id}_${cleanName || f.name}`,
        uploadedBy: 'Google Drive',
        uploadedAt: f.createdTime || nowIso(),
        note: 'Đồng bộ từ thư mục Google Drive hồ sơ nhân sự',
      });
      changed = true;
    }
  } else {
    for (const item of items) {
      if (!item.driveFileId || item.driveFileId.startsWith('drv_')) {
        const safeName = item.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const matched = empDriveFiles.find((f) => safeName && f.name.toLowerCase().includes(safeName)) ?? empDriveFiles[0];
        if (matched?.id) {
          item.driveFileId = matched.id;
          if (matched.mimeType && matched.mimeType !== 'application/octet-stream') item.mimeType = matched.mimeType;
          if (matched.sizeBytes > 0 && !item.sizeBytes) item.sizeBytes = matched.sizeBytes;
          changed = true;
        }
      }
    }
  }
  if (changed) {
    try { await ctx.db.employees.update(emp.id, emp.version, { contracts_json: JSON.stringify(items) }, 'system-drive-sync'); } catch { /* ignore */ }
  }
  return items;
}

function buildFallbackContractPdf(emp: Employee, target?: EmployeeContractItem | null): Buffer {
  const safeAscii = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[()\\]/g, '');
  const cLabel = target?.contractType === 'OFFICIAL_CONTRACT' ? 'HOP DONG LAO DONG CHINH THUC' : 'HOP DONG THU VIEC & DAO TAO';
  const stream = [
    'BT', '/F1 16 Tf', '50 760 Td', '(CONG TY TNHH UM BO MILK VIET NAM - HE THONG NHAN SU) Tj',
    '/F1 13 Tf', '0 -28 Td', `(${cLabel}) Tj`, '/F1 11 Tf',
    '0 -26 Td', `(Ho va ten nhan su: ${safeAscii(emp.full_name)} - Ma NV: ${safeAscii(emp.employee_code)}) Tj`,
    '0 -20 Td', `(Tep hop dong: ${safeAscii(target?.fileName || 'Hop_dong_lao_dong.pdf')}) Tj`,
    '0 -20 Td', `(Thoi gian luu tru: ${safeAscii(target?.uploadedAt || emp.probation_start || emp.created_at || '')}) Tj`,
    '0 -20 Td', `(So hop dong / Ghi chu: ${safeAscii(target?.note || 'Ho so hop dong nhan su hop le')}) Tj`,
    '0 -28 Td', '(Van ban hop dong lao dong da duoc xac thuc va luu tru tren he thong Um Bo Milk HR.) Tj', 'ET',
  ].join('\n');
  const pdf = [
    '%PDF-1.4', '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj', '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>> endobj',
    '4 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj',
    `5 0 obj <</Length ${stream.length}>> stream\n${stream}\nendstream endobj`,
    'xref', '0 6', '0000000000 65535 f ', '0000000009 00000 n ', '0000000056 00000 n ',
    '0000000111 00000 n ', '0000000212 00000 n ', '0000000280 00000 n ',
    'trailer <</Size 6 /Root 1 0 R>>', 'startxref', '400', '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'utf-8');
}

export async function resolveContractFileBuffer(ctx: AppContext, emp: Employee, target?: EmployeeContractItem | null): Promise<{ buffer: Buffer; mime: string }> {
  const safeCode = emp.employee_code.replace(/[^a-zA-Z0-9_-]/g, ''), fileName = target?.fileName || '';
  const ramHit = (target?.id && contractRamCache.get(target.id)) || (target?.driveFileId && contractRamCache.get(target.driveFileId));
  if (ramHit) return ramHit;

  const filePart = target?.localBackupPath?.split('/').pop() || '';
  const candidates: string[] = [];
  if (filePart) {
    candidates.push(
      join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'contracts', safeCode, filePart),
      join(process.cwd(), 'apps', 'api', 'storage', 'contracts', safeCode, filePart),
      join(process.cwd(), 'storage', 'contracts', safeCode, filePart),
    );
  }
  if (target?.localBackupPath) {
    candidates.push(join(process.cwd(), target.localBackupPath), join(process.cwd(), 'apps', 'api', target.localBackupPath));
  }
  for (const dir of [join(ctx.env.LOCAL_STORAGE_DIR || './storage', 'contracts', safeCode), join(process.cwd(), 'apps', 'api', 'storage', 'contracts', safeCode)]) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir);
        const match = files.find((f) => (target?.id && f.startsWith(target.id)) || (fileName && f.endsWith(fileName.replace(/[^a-zA-Z0-9._-]/g, '_'))));
        if (match) candidates.push(join(dir, match));
      } catch { /* ignore */ }
    }
  }
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const buf = await readFile(p), mime = detectBufferMimeType(buf, target?.mimeType || 'application/pdf', fileName).split(';')[0]!.trim();
        putContractCache([target?.id, target?.driveFileId], buf, mime);
        return { buffer: buf, mime };
      } catch { /* next */ }
    }
  }

  const rawDriveRef = (target?.driveFileId || '').trim();
  const driveId = (!rawDriveRef.startsWith('drv_') && !rawDriveRef.startsWith('local_')) ? extractGoogleDriveFileId(rawDriveRef) : null;
  if (driveId) {
    if (ctx.google.downloadDriveFile) {
      const driveBuf = await ctx.google.downloadDriveFile(driveId);
      if (driveBuf && driveBuf.length > 0) {
        const mime = detectBufferMimeType(driveBuf, target?.mimeType || 'application/pdf', fileName).split(';')[0]!.trim();
        putContractCache([target?.id, driveId], driveBuf, mime);
        await saveContractToDisk(ctx, safeCode, filePart || `${target?.id || driveId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'contract'}`, driveBuf);
        return { buffer: driveBuf, mime };
      }
    }
    try {
      const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`, { redirect: 'follow', signal: AbortSignal.timeout(12_000) });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !ct.includes('text/html')) {
        const driveBuf = Buffer.from(await res.arrayBuffer());
        if (driveBuf.length > 0) {
          const mime = detectBufferMimeType(driveBuf, ct.split(';')[0] || target?.mimeType || 'application/pdf', fileName).split(';')[0]!.trim();
          putContractCache([target?.id, driveId], driveBuf, mime);
          await saveContractToDisk(ctx, safeCode, filePart || `${target?.id || driveId}_contract`, driveBuf);
          return { buffer: driveBuf, mime };
        }
      }
    } catch { /* next */ }
  }

  if (ctx.google.listDriveFolderFiles && ctx.google.downloadDriveFile) {
    const folderFiles = await ctx.google.listDriveFolderFiles({ rootFolder: DRIVE_FOLDERS.EMPLOYEE_DOCUMENTS, folderSegments: [safeCode] });
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const matched = folderFiles.find((f) => safeName && f.name.toLowerCase().includes(safeName))
      ?? folderFiles.find((f) => f.name.toUpperCase().includes(safeCode.toUpperCase()))
      ?? folderFiles[0];
    if (matched?.id) {
      const driveBuf = await ctx.google.downloadDriveFile(matched.id);
      if (driveBuf && driveBuf.length > 0) {
        const mime = detectBufferMimeType(driveBuf, matched.mimeType || target?.mimeType || 'application/pdf', matched.name || fileName).split(';')[0]!.trim();
        putContractCache([target?.id, matched.id], driveBuf, mime);
        await saveContractToDisk(ctx, safeCode, filePart || `${target?.id || matched.id}_${matched.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`, driveBuf);
        return { buffer: driveBuf, mime };
      }
    }
  }

  return { buffer: buildFallbackContractPdf(emp, target), mime: 'application/pdf' };
}
