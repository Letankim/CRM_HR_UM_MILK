import { createGoogleClients, downloadFile, ensureFolderPath, isAuthRevokedError, uploadFile } from '@umbm/google';
import { DRIVE_FOLDERS } from '@umbm/shared';
import { readFileSync } from 'node:fs';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/tokens.js';
import { buildApp } from './app.js';
import { loadEnv, sheetIds } from './config/env.js';
import type { AppContext, GoogleStatus } from './context.js';
import { Database } from './data/database.js';
import { createMemoryGateway, DEMO_PASSWORD, DEMO_PIN, MEMORY_IDS } from './data/memory-seed.js';
import { Realtime } from './realtime/realtime.js';
import { AuditService } from './services/audit.service.js';
import { BackupService } from './services/backup.service.js';
import { EmailService } from './services/email.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';
import { sendSmtpTlsMail } from './services/smtp-sender.js';
import { GoogleSheetsGateway, type SheetsGateway } from './sheets/gateway.js';
import { WriteQueue } from './sheets/write-queue.js';

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function main() {
  const env = loadEnv();

  let gateway: SheetsGateway;
  let ids = sheetIds(env);
  let google: GoogleStatus;
  let googleClients: ReturnType<typeof createGoogleClients> | undefined;
  let mailSender: ((payload: { to: string; subject: string; html: string }) => Promise<void>) | undefined;
  const smtpSender = env.GMAIL_APP_PASSWORD.trim()
    ? (payload: { to: string; subject: string; html: string }) =>
        sendSmtpTlsMail(
          {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.EMAIL_FROM_ADDRESS,
            pass: env.GMAIL_APP_PASSWORD,
            fromName: env.EMAIL_FROM_NAME,
          },
          payload,
        )
    : undefined;

  if (env.DATA_BACKEND === 'google') {
    const clients = createGoogleClients({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
    googleClients = clients;
    const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => `SHEET_ID_${k}`);
    if (missing.length) throw new Error(`Thiếu ${missing.join(', ')}. Chạy "pnpm sheets:bootstrap" rồi điền vào .env.`);
    gateway = new GoogleSheetsGateway(clients.sheets);
    if (env.EMAIL_ENABLED) {
      mailSender = async (payload) => {
        if (smtpSender) {
          await smtpSender(payload);
          return;
        }
        await clients.sendMail({
          ...payload,
          fromName: env.EMAIL_FROM_NAME,
          fromAddress: env.EMAIL_FROM_ADDRESS,
        });
      };
    }
    const driveFolderCache = new Map<string, string>();
    google = {
      mode: 'google',
      async check() {
        try {
          const { email } = await clients.verify();
          return { ok: true, detail: `Đã kết nối tài khoản Google cá nhân: ${email ?? 'không rõ'}` };
        } catch (err) {
          return {
            ok: false,
            detail: isAuthRevokedError(err)
              ? 'Refresh token đã bị thu hồi — chạy lại "pnpm google:auth"'
              : (err as Error).message,
          };
        }
      },
      async uploadAttendancePhoto(params) {
        if (!env.DRIVE_ROOT_FOLDER_ID) throw new Error('Thiếu cấu hình DRIVE_ROOT_FOLDER_ID');
        let folderId = driveFolderCache.get(params.monthFolder);
        if (!folderId) {
          folderId = await ensureFolderPath(clients.drive, env.DRIVE_ROOT_FOLDER_ID, [DRIVE_FOLDERS.ATTENDANCE_PHOTOS, params.monthFolder]);
          driveFolderCache.set(params.monthFolder, folderId);
        }
        const uploaded = await uploadFile(clients.drive, {
          name: params.fileName,
          mimeType: params.mimeType,
          parentId: folderId,
          data: params.data,
        });
        return { fileId: uploaded.id };
      },
      async downloadDriveFile(fileId) {
        try {
          return await downloadFile(clients.drive, fileId);
        } catch {
          return null;
        }
      },
    };
  } else {
    gateway = await createMemoryGateway();
    ids = MEMORY_IDS;
    if (env.EMAIL_ENABLED && smtpSender) {
      mailSender = smtpSender;
    }
    google = { mode: 'memory', check: async () => ({ ok: true, detail: 'Chế độ dữ liệu mẫu trong RAM (không nối Google)' }) };
  }

  const queue = new WriteQueue();
  const db = new Database(gateway, queue, ids);
  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET);
  const auth = new AuthService(db);
  const reconciliation = new ReconciliationService(db);
  const backup = new BackupService(env, db, reconciliation, googleClients);
  const email = new EmailService(mailSender);
  email.attachDatabase(db);

  let realtime: Realtime | null = null;
  // eslint-disable-next-line prefer-const
  let app: Awaited<ReturnType<typeof buildApp>>;
  const audit = new AuditService(db, (err) => app?.log.error({ err }, 'Ghi audit log thất bại'));

  const ctx: AppContext = {
    env,
    version,
    db,
    tokens,
    auth,
    audit,
    reconciliation,
    backup,
    email,
    google,
    realtime: () => realtime,
  };
  app = await buildApp(ctx);
  realtime = new Realtime(app, tokens, auth, env.API_PUBLIC_ORIGIN);

  const loadPromise = db.loadAll();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  await loadPromise;
  await reconciliation.scanAndRepair({ autoFix: true, actorId: 'startup-sync' }).catch(() => undefined);
  db.startAutoRefresh(env.CACHE_REFRESH_SECONDS, app.log);
  backup.startEmbeddedScheduler(app.log);

  app.log.info(`UMBM API v${version} — dữ liệu: ${google.mode}`);
  if (google.mode === 'memory') {
    app.log.warn(
      `DỮ LIỆU MẪU: backoffice dùng admin | hr | store1 | finance | mkt, mật khẩu "${DEMO_PASSWORD}". ` +
        `App nhân viên: 0901000001 (thử việc) / 0901000002 (chính thức), PIN "${DEMO_PIN}".`,
    );
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Nhận ${signal}, đang dừng — chờ hàng đợi ghi hoàn tất...`);
    await backup.stopEmbeddedScheduler();
    db.stopAutoRefresh();
    await realtime?.close();
    await app.close();
    await queue.drain();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
