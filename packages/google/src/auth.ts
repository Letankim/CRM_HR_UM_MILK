import { google, type Auth, type sheets_v4, type drive_v3 } from 'googleapis';

/**
 * Xác thực Google bằng OAuth của MỘT Gmail riêng dành cho hệ thống
 * (ví dụ umbomilk.hrsystem@gmail.com — không dùng Gmail cá nhân của chủ).
 *
 * Vì sao không dùng service account: service account có dung lượng Drive = 0,
 * không tạo được file (ảnh, backup). Với OAuth, mọi file thuộc sở hữu Gmail
 * này và dùng dung lượng của nó (15GB miễn phí, mua thêm Google One khi cần).
 *
 * Scope:
 *  - drive.file: chỉ truy cập file/thư mục do chính ứng dụng tạo ra (an toàn nhất,
 *    không cần Google xác minh app). Vì vậy toàn bộ spreadsheet và thư mục phải
 *    được tạo bằng script bootstrap của hệ thống.
 *  - spreadsheets: đọc/ghi nội dung Google Sheets.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleClients {
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
  /** Gọi API nhẹ để kiểm tra token còn sống. Ném lỗi nếu token đã bị thu hồi. */
  verify: () => Promise<{ email: string | null }>;
  /** Gửi email HTML qua Gmail API bằng cùng OAuth2 của hệ thống. */
  sendMail: (input: { to: string; subject: string; html: string; fromName?: string; fromAddress?: string }) => Promise<void>;
}

export function createGoogleClients(config: GoogleOAuthConfig): GoogleClients {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error(
      'Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN. Chạy "pnpm google:auth" để lấy refresh token.',
    );
  }
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  const gmail = google.gmail({ version: 'v1', auth });

  return {
    sheets,
    drive,
    async verify() {
      const res = await drive.about.get({ fields: 'user(emailAddress)' });
      return { email: res.data.user?.emailAddress ?? null };
    },
    async sendMail({ to, subject, html, fromName = 'Ụm Bò Milk HR', fromAddress }) {
      const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
      const encodedFromName = `=?UTF-8?B?${Buffer.from(fromName, 'utf8').toString('base64')}?=`;
      const fromLine = fromAddress ? `From: ${encodedFromName} <${fromAddress}>` : `From: ${encodedFromName}`;
      const rawMessage = [
        fromLine,
        `To: ${to}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        '',
        html,
      ].join('\r\n');
      const raw = Buffer.from(rawMessage, 'utf8').toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    },
  };
}

export function createOAuthClientForConsent(clientId: string, clientSecret: string, redirectUri: string): Auth.OAuth2Client {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
