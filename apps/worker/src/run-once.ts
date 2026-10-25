/**
 * Chạy backup ngay lập tức (diễn tập / kiểm tra cấu hình):
 *   pnpm --filter @umbm/worker backup:now -- DAILY
 */
import { createGoogleClients } from '@umbm/google';
import { runBackup, type BackupKind } from './backup.js';
import { loadWorkerEnv } from './env.js';
import { InternalApi } from './internal-api.js';

const kind = (process.argv[2] ?? 'DAILY') as BackupKind;
const env = loadWorkerEnv();
const google = createGoogleClients({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
});

runBackup(env, google, new InternalApi(env), kind)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
