/**
 * Lấy refresh token cho Gmail hệ thống (chạy một lần trên máy dev).
 *
 *   pnpm google:auth
 *
 * Yêu cầu .env có GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET
 * (OAuth client loại "Desktop app"). Trình duyệt sẽ mở trang đăng nhập Google —
 * hãy đăng nhập bằng GMAIL HỆ THỐNG (không phải Gmail cá nhân).
 */
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { createOAuthClientForConsent, GOOGLE_SCOPES } from '@umbm/google';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
if (!clientId || !clientSecret) {
  console.error('Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET trong .env');
  process.exit(1);
}

const oauth = createOAuthClientForConsent(clientId, clientSecret, REDIRECT);
const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // luôn trả refresh_token
  scope: GOOGLE_SCOPES,
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Thiếu mã xác thực');
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p style="font-family:sans-serif">Đã cấp quyền. Quay lại cửa sổ terminal.</p>');
    if (!tokens.refresh_token) {
      console.error('\nKhông nhận được refresh_token. Vào https://myaccount.google.com/permissions gỡ quyền ứng dụng rồi chạy lại.');
    } else {
      console.log('\nThêm dòng sau vào .env:\n');
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (err) {
    res.writeHead(500).end('Lỗi lấy token');
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Mở đường dẫn sau trong trình duyệt nếu nó không tự mở:\n');
  console.log(url, '\n');
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${url}"`);
});
