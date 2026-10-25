/**
 * Retry với exponential backoff + jitter cho lỗi tạm thời của Google API
 * (429 quota, 5xx, timeout, mất mạng).
 */

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export function isRetryableGoogleError(error: unknown): boolean {
  const e = error as { code?: number | string; status?: number; response?: { status?: number } };
  const status = Number(e?.response?.status ?? e?.status ?? e?.code);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const code = String(e?.code ?? '');
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ESOCKETTIMEDOUT'].includes(code);
}

/** Lỗi do refresh token bị thu hồi / hết hạn — cần cấp lại bằng "pnpm google:auth". */
export function isAuthRevokedError(error: unknown): boolean {
  const e = error as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error === 'invalid_grant' || /invalid_grant/i.test(e?.message ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  // Mặc định chờ tổng cộng hơn 60 giây: đủ để vượt qua một cửa sổ quota "mỗi phút" (429)
  // khi toàn bộ hệ thống dùng chung quota của MỘT tài khoản Gmail.
  const retries = opts.retries ?? 7;
  const base = opts.baseDelayMs ?? 1_000;
  const max = opts.maxDelayMs ?? 32_000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryableGoogleError(error)) throw error;
      opts.onRetry?.(attempt, error);
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      // Jitter 50–100% để các request không cùng thử lại một lúc.
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
}
