import cron from 'node-cron';
import { createGoogleClients, getStorageQuota, isAuthRevokedError } from '@umbm/google';
import { applyRetention, runBackup, type BackupKind } from './backup.js';
import { loadWorkerEnv } from './env.js';
import { alert, InternalApi } from './internal-api.js';

const env = loadWorkerEnv();
const google = createGoogleClients({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
});
const api = new InternalApi(env);
const TZ = 'Asia/Ho_Chi_Minh';

/** Không chạy chồng một job nếu lần trước chưa xong. */
const running = new Set<string>();
function schedule(name: string, expr: string, task: () => Promise<void>) {
  cron.schedule(
    expr,
    async () => {
      if (running.has(name)) return console.warn(`[${name}] lần trước chưa xong, bỏ qua`);
      running.add(name);
      try {
        await task();
      } catch (err) {
        console.error(`[${name}]`, err);
        if (isAuthRevokedError(err)) await alert(env, 'Refresh token Google đã bị thu hồi — chạy lại "pnpm google:auth" ngay.');
      } finally {
        running.delete(name);
      }
    },
    { timezone: TZ },
  );
  console.log(`[cron] ${name}: ${expr}`);
}

const backup = (kind: BackupKind) => () => runBackup(env, google, api, kind);

// 01:00 hằng ngày — full backup 7 spreadsheet + .xlsx
schedule('backup-daily', '0 1 * * *', backup('DAILY'));
// 06:00, 10:00, 14:00, 18:00, 22:00 — snapshot dữ liệu quan trọng (công, lương, tài khoản)
schedule('backup-critical', '0 6,10,14,18,22 * * *', backup('CRITICAL'));
// Chủ nhật 02:00 — bản tuần
schedule('backup-weekly', '0 2 * * 0', backup('WEEKLY'));
// Ngày 1 hằng tháng 03:00 — bản tháng
schedule('backup-monthly', '0 3 1 * *', backup('MONTHLY'));
// 04:00 hằng ngày — dọn bản cũ
schedule('backup-retention', '0 4 * * *', () => applyRetention(env, google));
// 08:00 hằng ngày — cảnh báo dung lượng Drive
schedule('drive-quota', '0 8 * * *', async () => {
  const { usage, limit } = await getStorageQuota(google.drive);
  if (!limit) return;
  const pct = Math.round((usage / limit) * 100);
  console.log(`[drive-quota] ${pct}% (${(usage / 1e9).toFixed(2)}GB / ${(limit / 1e9).toFixed(0)}GB)`);
  if (pct >= 80) await alert(env, `Dung lượng Google Drive đã dùng ${pct}%. Cần mua thêm Google One hoặc dọn dữ liệu.`);
});

google
  .verify()
  .then(({ email }) => console.log(`UMBM worker đã khởi động — Google: ${email}`))
  .catch(async (err) => {
    await alert(env, `Worker không kết nối được Google: ${(err as Error).message}`);
  });
