/**
 * Hàng đợi ghi tuần tự theo từng spreadsheet.
 *
 * Google Sheets không có transaction hay khóa dòng. Nếu hai request cùng ghi vào
 * một file, dòng sau có thể ghi đè dòng trước. Mọi thao tác ghi vào cùng một
 * spreadsheet vì vậy được xếp hàng và chạy lần lượt (single writer).
 *
 * Điều kiện đúng: toàn hệ thống chỉ có MỘT process api giữ hàng đợi này.
 */
export class WriteQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, number>();
  private lastError: { at: string; key: string; message: string } | null = null;

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined) // lỗi của task trước không chặn task sau
      .then(task)
      .catch((err: unknown) => {
        this.lastError = { at: new Date().toISOString(), key, message: (err as Error)?.message ?? String(err) };
        throw err;
      })
      .finally(() => {
        const left = (this.pending.get(key) ?? 1) - 1;
        if (left <= 0) this.pending.delete(key);
        else this.pending.set(key, left);
      });
    this.chains.set(key, run);
    return run;
  }

  isIdle(key: string): boolean {
    return !this.pending.has(key);
  }

  stats() {
    let total = 0;
    for (const n of this.pending.values()) total += n;
    return { pending: total, byKey: Object.fromEntries(this.pending), lastError: this.lastError };
  }

  /** Chờ toàn bộ hàng đợi chạy xong (dùng khi tắt server). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }
}
