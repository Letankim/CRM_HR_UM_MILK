import type { WorkerEnv } from './env.js';

/** Gọi API nội bộ — worker không ghi Google Sheets trực tiếp. */
export class InternalApi {
  constructor(private readonly env: WorkerEnv) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.env.API_INTERNAL_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-token': this.env.INTERNAL_API_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API nội bộ ${path} lỗi ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: T } & T;
    return (json && typeof json === 'object' && 'data' in json && json.data !== undefined ? json.data : json) as T;
  }

  spreadsheets() {
    return this.call<{ spreadsheets: Record<string, string> }>('GET', '/api/internal/spreadsheets');
  }

  startBackup(kind: string, startedAt: string) {
    return this.call<{ id: string }>('POST', '/api/internal/backups/start', { kind, startedAt });
  }

  finishBackup(payload: {
    id: string;
    status: 'SUCCESS' | 'FAILED';
    finishedAt: string;
    driveFolderId?: string;
    filesCount?: number;
    rows?: Record<string, number>;
    error?: string;
  }) {
    return this.call<{ ok: boolean }>('POST', '/api/internal/backups/finish', payload);
  }
}

/** Cảnh báo qua Telegram (tùy chọn). Không cấu hình thì chỉ ghi log. */
export async function alert(env: WorkerEnv, message: string): Promise<void> {
  console.error(`[ALERT] ${message}`);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `[UMBM HR] ${message}` }),
    });
  } catch (err) {
    console.error('Gửi Telegram thất bại', err);
  }
}
