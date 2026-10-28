import { NextResponse, type NextRequest } from 'next/server';
import dns from 'node:dns';
import tls from 'node:tls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SmtpRelayBody {
  smtp?: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    fromName?: string;
  };
  mail?: {
    to?: string;
    subject?: string;
    html?: string;
  };
}

function encodeMimeWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(html: string): string {
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  return b64.replace(/(.{76})/g, '$1\r\n');
}

async function deliverSmtpTls(
  cfg: { host: string; port: number; user: string; pass: string; fromName: string },
  mail: { to: string; subject: string; html: string },
): Promise<void> {
  const cleanPass = cfg.pass.replace(/\s+/g, '');
  const socket = tls.connect({
    host: cfg.host || 'smtp.gmail.com',
    port: cfg.port || 465,
    servername: cfg.host || 'smtp.gmail.com',
    lookup: (hostname, opts, cb) => dns.lookup(hostname, { ...opts, family: 4 }, cb),
  });

  socket.setEncoding('utf8');
  socket.setTimeout(12000);

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
      w.reject(err);
    }
  });

  socket.on('timeout', () => {
    socket.destroy(new Error('Quá thời gian kết nối tới máy chủ SMTP Gmail'));
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
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('x-umbm-relay') !== '1') {
      return NextResponse.json({ success: false, message: 'Từ chối truy cập trạm trung chuyển' }, { status: 403 });
    }
    const body = (await req.json()) as SmtpRelayBody;
    const to = body.mail?.to?.trim();
    const subject = body.mail?.subject?.trim();
    const html = body.mail?.html ?? '';
    if (!to || !subject || !html) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin người nhận hoặc nội dung email' }, { status: 400 });
    }

    const user = (body.smtp?.user || process.env.EMAIL_FROM_ADDRESS || '3do.service.veo@gmail.com').trim();
    const pass = (body.smtp?.pass || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    if (!user || !pass) {
      return NextResponse.json({ success: false, message: 'Chưa cấu hình thông tin xác thực SMTP' }, { status: 500 });
    }

    await deliverSmtpTls(
      {
        host: body.smtp?.host || 'smtp.gmail.com',
        port: body.smtp?.port || 465,
        user,
        pass,
        fromName: body.smtp?.fromName || 'Ụm Bò Milk HR',
      },
      { to, subject, html },
    );

    return NextResponse.json({ success: true, message: 'Đã gửi email qua trạm trung chuyển HTTPS thành công' });
  } catch (err) {
    const msg = (err as Error)?.message || 'Lỗi kết nối SMTP tại trạm trung chuyển';
    return NextResponse.json({ success: false, message: msg }, { status: 502 });
  }
}
