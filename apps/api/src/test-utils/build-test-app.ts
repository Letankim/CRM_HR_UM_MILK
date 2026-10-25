import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { AuthService } from '../auth/auth.service.js';
import { ACCESS_COOKIE, TokenService } from '../auth/tokens.js';
import { loadEnv } from '../config/env.js';
import { Database } from '../data/database.js';
import { createMemoryGateway, DEMO_PASSWORD, MEMORY_IDS } from '../data/memory-seed.js';
import { AuditService } from '../services/audit.service.js';
import { BackupService } from '../services/backup.service.js';
import { EmailService } from '../services/email.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { WriteQueue } from '../sheets/write-queue.js';

export interface TestAppContext {
  app: FastifyInstance;
  db: Database;
  reconciliation: ReconciliationService;
  email: EmailService;
  /** Đăng nhập và trả về response gốc + chuỗi cookie access token. */
  login: (
    identifier: string,
    secretValue: string,
    appKind: 'backoffice' | 'employee',
  ) => Promise<{ res: Awaited<ReturnType<FastifyInstance['inject']>>; cookie: string }>;
  /** Đăng nhập backoffice bằng mật khẩu demo và trả về headers (cookie + CSRF). */
  loginHeaders: (username: string) => Promise<{ cookie: string; 'x-umbm-client': string }>;
}

/**
 * Dựng ứng dụng Fastify với backend bộ nhớ (memory) phục vụ kiểm thử tích hợp.
 * `secretChar` giúp mỗi file test dùng bộ khóa JWT riêng biệt.
 */
export async function buildTestApp(secretChar = 'x'): Promise<TestAppContext> {
  const secret = secretChar.repeat(40);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATA_BACKEND: 'memory',
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: `${secret}r`,
    INTERNAL_API_TOKEN: `${secret}i`,
  });
  const db = new Database(await createMemoryGateway(), new WriteQueue(), MEMORY_IDS);
  await db.loadAll();
  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET);
  const auth = new AuthService(db);
  const reconciliation = new ReconciliationService(db);
  const backup = new BackupService(env, db, reconciliation);
  const email = new EmailService();
  const app = await buildApp(
    {
      env,
      version: 'test',
      db,
      tokens,
      auth,
      audit: new AuditService(db, () => {}),
      reconciliation,
      backup,
      email,
      google: { mode: 'memory', check: async () => ({ ok: true, detail: '' }) },
      realtime: () => null,
    },
    { logger: false },
  );

  const login: TestAppContext['login'] = async (identifier, secretValue, appKind) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-umbm-client': 'web' },
      payload: { identifier, secret: secretValue, app: appKind },
    });
    const cookie = res.cookies.find((c) => c.name === ACCESS_COOKIE);
    return { res, cookie: cookie ? `${ACCESS_COOKIE}=${cookie.value}` : '' };
  };

  const loginHeaders: TestAppContext['loginHeaders'] = async (username) => {
    const { cookie } = await login(username, DEMO_PASSWORD, 'backoffice');
    return { cookie, 'x-umbm-client': 'web' };
  };

  return { app, db, reconciliation, email, login, loginHeaders };
}
