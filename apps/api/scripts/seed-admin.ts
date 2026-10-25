/**
 * Tạo tài khoản ADMIN đầu tiên trên Google Sheets.
 *
 *   pnpm seed:admin -- --username admin --name "Quản trị hệ thống"
 *
 * Mật khẩu được nhập từ terminal (không lưu trong lịch sử lệnh) và băm argon2id.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createGoogleClients } from '@umbm/google';
import { hashSecret } from '../src/auth/password.js';
import { loadEnv, sheetIds } from '../src/config/env.js';
import { Database } from '../src/data/database.js';
import { GoogleSheetsGateway } from '../src/sheets/gateway.js';
import { WriteQueue } from '../src/sheets/write-queue.js';
import { nowIso } from '../src/lib/time.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const env = loadEnv();
  const username = arg('username', 'admin');
  const displayName = arg('name', 'Quản trị hệ thống');

  const clients = createGoogleClients({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });
  const db = new Database(new GoogleSheetsGateway(clients.sheets), new WriteQueue(), sheetIds(env));
  await db.loadAll();

  const existing = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  const rl = createInterface({ input: stdin, output: stdout });
  const password = await rl.question(
    existing
      ? `Tài khoản "${username}" đã tồn tại. Nhập mật khẩu mới để cập nhật (tối thiểu 8 ký tự): `
      : 'Mật khẩu (tối thiểu 8 ký tự): ',
  );
  rl.close();
  if (password.length < 8) {
    console.error('Mật khẩu quá ngắn (yêu cầu tối thiểu 8 ký tự).');
    process.exit(1);
  }

  if (existing) {
    const updated = await db.users.update(
      existing.id,
      existing.version,
      {
        password_hash: await hashSecret(password),
        status: 'ACTIVE',
        failed_login_count: 0,
        locked_until: '',
      },
      'seed',
    );
    console.log(`Đã cập nhật mật khẩu ADMIN "${updated.username}" (${updated.id}) trên Google Sheets.`);
    return;
  }

  const user = await db.users.insert(
    {
      username,
      phone: '',
      display_name: displayName,
      password_hash: await hashSecret(password),
      role: 'ADMIN',
      permissions_json: '[]',
      branch_scope: 'ALL',
      employee_id: '',
      status: 'ACTIVE',
      session_version: 1,
      failed_login_count: 0,
      locked_until: '',
      last_login_at: '',
      activated_by: 'seed',
      activated_at: nowIso(),
      revoked_at: '',
      email: '',
      revoked_by: '',
      revoke_reason: '',
    },
    'seed',
  );
  console.log(`Đã tạo ADMIN "${user.username}" (${user.id}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
