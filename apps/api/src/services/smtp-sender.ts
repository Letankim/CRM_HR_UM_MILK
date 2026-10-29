import dns from 'node:dns';
import tls from 'node:tls';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
}

export interface SmtpSendInput {
  to: string;
  subject: string;
  html: string;
}

const relayOrigins = new Set<string>();
let preferHttpsRelay = false;

export function registerSmtpRelayOrigin(raw?: string): void {
  if (!raw) return;
  try {
    const normalized = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) return;
    relayOrigins.add(u.origin);
  } catch { /* Bỏ qua URL không hợp lệ */ }
}

export function hasSmtpRelayOrigin(): boolean { return relayOrigins.size > 0; }

export function getPublicFrontendOrigin(fallbackOrigin: string): string {
  const fb = (fallbackOrigin || '').trim().replace(/\/+$/, '');
  if (fb && !fb.includes('localhost') && !fb.includes('127.0.0.1') && !fb.includes('.onrender.com')) return fb;
  return Array.from(relayOrigins)[0] || fb || 'http://localhost:3000';
}

export function formatSmtpError(err: unknown): string {
  if (!err) return 'Lỗi kết nối SMTP';
  const e = err as Error & { code?: string; errors?: Array<Error & { code?: string }> };
  if (e.message && e.message.trim()) return e.message.trim();
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const parts = e.errors.map((sub) => sub?.message || sub?.code || '').filter(Boolean);
    if (parts.length > 0) return `Lỗi kết nối SMTP (${parts.join(' | ')})`;
  }
  if (e.code) return `Lỗi kết nối SMTP (${e.code})`;
  return 'Lỗi kết nối SMTP';
}

function encodeMimeWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(html: string): string {
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  return b64.replace(/(.{76})/g, '$1\r\n');
}

async function sendViaHttpsRelay(cfg: SmtpConfig, mail: SmtpSendInput): Promise<void> {
  const origins = Array.from(relayOrigins);
  if (origins.length === 0) {
    throw new Error('Không có trạm trung chuyển HTTPS khả dụng');
  }
  let lastErr = 'Lỗi kết nối trạm trung chuyển HTTPS';
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/smtp-relay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-umbm-relay': '1',
        },
        body: JSON.stringify({ smtp: cfg, mail }),
        signal: AbortSignal.timeout(14000),
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      lastErr = body.message || `Trạm trung chuyển trả mã ${res.status}`;
    } catch (err) {
      lastErr = formatSmtpError(err);
    }
  }
  throw new Error(lastErr);
}

/**
 * Gửi email HTML trực tiếp qua kết nối SMTPS (TLS cổng 465 của Gmail, ép IPv4 family=4).
 */
async function sendDirectSmtpTls(cfg: SmtpConfig, mail: SmtpSendInput): Promise<void> {
  const cleanPass = cfg.pass.replace(/\s+/g, '');
  if (!cfg.user || !cleanPass) {
    throw new Error('Chưa cấu hình EMAIL_FROM_ADDRESS hoặc GMAIL_APP_PASSWORD trong .env');
  }

  const socket = tls.connect({
    host: cfg.host || 'smtp.gmail.com',
    port: cfg.port || 465,
    servername: cfg.host || 'smtp.gmail.com',
    lookup: (hostname, opts, cb) => dns.lookup(hostname, { ...opts, family: 4 }, cb),
  });

  socket.setEncoding('utf8');
  socket.setTimeout(6500);

  let buffer = '';
  let waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;

  const checkBuffer = () => {
    if (!waiter) return;
    const lines = buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]!;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const consumed = lines.slice(0, i + 1).join('\r\n');
        buffer = lines.slice(i + 1).join('\r\n');
        const w = waiter;
        waiter = null;
        w.resolve(consumed);
        return;
      }
    }
  };

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    checkBuffer();
  });

  const readResponse = (): Promise<string> =>
    new Promise((resolve, reject) => {
      waiter = { resolve, reject };
      checkBuffer();
    });

  socket.on('error', (err) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.reject(new Error(formatSmtpError(err)));
    }
  });

  socket.on('timeout', () => {
    socket.destroy(new Error('Quá thời gian kết nối tới máy chủ SMTP cổng 465'));
  });

  const sendCmd = async (cmd: string, expectedCodes: number[]): Promise<string> => {
    socket.write(`${cmd}\r\n`);
    const resp = await readResponse();
    const lastLine = resp.split('\r\n').pop() ?? resp;
    const code = Number(lastLine.slice(0, 3));
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP lỗi (${code}): ${lastLine}`);
    }
    return resp;
  };

  try {
    const greeting = await readResponse();
    if (!greeting.startsWith('220')) {
      throw new Error(`Máy chủ SMTP từ chối kết nối: ${greeting}`);
    }

    await sendCmd('EHLO umbomilk.vn', [250]);
    await sendCmd('AUTH LOGIN', [334]);
    await sendCmd(Buffer.from(cfg.user, 'utf8').toString('base64'), [334]);
    await sendCmd(Buffer.from(cleanPass, 'utf8').toString('base64'), [235]);
    await sendCmd(`MAIL FROM:<${cfg.user}>`, [250]);
    await sendCmd(`RCPT TO:<${mail.to}>`, [250]);
    await sendCmd('DATA', [354]);

    const mimeMessage = [
      `From: ${encodeMimeWord(cfg.fromName)} <${cfg.user}>`,
      `To: <${mail.to}>`,
      `Subject: ${encodeMimeWord(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(mail.html),
      '.',
    ].join('\r\n');

    await sendCmd(mimeMessage, [250]);
    socket.write('QUIT\r\n');
    socket.end();
  } catch (err) {
    socket.destroy();
    throw new Error(formatSmtpError(err));
  }
}

/**
 * Gửi email doanh nghiệp thông minh:
 * 1. Thử kết nối SMTPS trực tiếp (cổng 465 IPv4).
 * 2. Khi triển khai trên Render Free Tier (chặn cổng 465 outbound), tự động chuyển tiếp qua HTTPS cổng 443 tới Vercel Relay.
 */
export async function sendSmtpTlsMail(cfg: SmtpConfig, mail: SmtpSendInput): Promise<void> {
  if (preferHttpsRelay && relayOrigins.size > 0) {
    try {
      await sendViaHttpsRelay(cfg, mail);
      return;
    } catch {
      // Nếu relay lỗi tạm thời, thử lại kết nối trực tiếp
    }
  }
  try {
    await sendDirectSmtpTls(cfg, mail);
  } catch (directErr) {
    if (relayOrigins.size > 0) {
      preferHttpsRelay = true;
      await sendViaHttpsRelay(cfg, mail);
      return;
    }
    throw directErr;
  }
}
