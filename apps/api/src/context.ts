import type { Env } from './config/env.js';
import type { Database } from './data/database.js';
import type { AuthService } from './auth/auth.service.js';
import type { TokenService } from './auth/tokens.js';
import type { AuditService } from './services/audit.service.js';
import type { ReconciliationService } from './services/reconciliation.service.js';
import type { BackupService } from './services/backup.service.js';
import type { EmailService } from './services/email.service.js';
import type { Realtime } from './realtime/realtime.js';

export interface GoogleStatus {
  mode: 'google' | 'memory';
  check: () => Promise<{ ok: boolean; detail: string }>;
  uploadAttendancePhoto?: (params: { fileName: string; mimeType: string; data: Buffer; monthFolder: string }) => Promise<{ fileId: string }>;
  uploadMktMedia?: (params: { fileName: string; mimeType: string; data: Buffer; monthFolder: string }) => Promise<{ fileId: string }>;
  getDriveFileMeta?: (fileId: string) => Promise<{ name: string; mimeType: string; sizeBytes: number } | null>;
  downloadDriveFile?: (fileId: string) => Promise<Buffer | null>;
}

/** Các phụ thuộc dùng chung, truyền vào từng nhóm route (dependency injection thủ công). */
export interface AppContext {
  env: Env;
  version: string;
  db: Database;
  tokens: TokenService;
  auth: AuthService;
  audit: AuditService;
  reconciliation: ReconciliationService;
  backup: BackupService;
  email: EmailService;
  google: GoogleStatus;
  realtime: () => Realtime | null;
}
