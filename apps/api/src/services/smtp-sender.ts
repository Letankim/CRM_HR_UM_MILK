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

function encodeMimeWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(html: string): string {
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  return b64.replace(/(.{76})/g, '$1\r\n');
}

/**
 * Gửi email HTML qua kết nối SMTPS (TLS cổng 465 của Gmail) dùng App Password.
 * Không phụ thuộc thư viện ngoài, mã hóa nội dung chuẩn Base64 UTF-8 an toàn cho tiếng Việt.
 */
export async function sendSmtpTlsMail(cfg: SmtpConfig, mail: SmtpSendInput): Promise<void> {
  const cleanPass = cfg.pass.replace(/\s+/g, '');
  if (!cfg.user || !cleanPass) {
    throw new Error('Chưa cấu hình EMAIL_FROM_ADDRESS hoặc GMAIL_APP_PASSWORD trong .env');
  }

  const socket = tls.connect({
    host: cfg.host || 'smtp.gmail.com',
    port: cfg.port || 465,
    servername: cfg.host || 'smtp.gmail.com',
  });

  socket.setEncoding('utf8');
  socket.setTimeout(15000);

  let buffer = '';
  let waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;

  const checkBuffer = () => {
    if (!waiter) return;
    const lines = buffer.split('\r\n');
    // Cần ít nhất 1 dòng hoàn chỉnh kết thúc bằng \r\n và dòng cuối trước '' có dạng "XYZ " (không có dấu gạch ngang ở ký tự thứ 4)
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
    socket.destroy(new Error('Quá thời gian kết nối tới máy chủ SMTP'));
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
