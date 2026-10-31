import { AppError } from '../lib/errors.js';

/**
 * Tiện ích cho các tác vụ TỰ ĐỒNG BỘ chạy ngầm (đồng bộ chi nhánh, quét ca vắng mặt, ghi audit/thông báo):
 * - Chỉ một lượt chạy tại một thời điểm cho mỗi cơ sở dữ liệu (các request đến sau dùng chung kết quả),
 *   tránh nhiều request GET song song cùng sửa một dòng gây VERSION_CONFLICT.
 * - Dòng vừa bị nơi khác cập nhật (xung đột phiên bản / đã bị xóa) được bỏ qua và tự xử lý ở lượt sau,
 *   tuyệt đối không làm hỏng request tải danh sách của người dùng.
 */
export function isStaleWriteError(err: unknown): boolean {
  return err instanceof AppError && (err.code === 'VERSION_CONFLICT' || err.code === 'NOT_FOUND');
}

export async function tolerantWrite<T>(write: () => Promise<T>): Promise<T | undefined> {
  try {
    return await write();
  } catch (err) {
    if (isStaleWriteError(err)) return undefined;
    throw err;
  }
}

export function singleFlight<K extends object, T>(registry: WeakMap<K, Promise<T>>, key: K, run: () => Promise<T>): Promise<T> {
  const running = registry.get(key);
  if (running) return running;
  const task = run().finally(() => registry.delete(key));
  registry.set(key, task);
  return task;
}

/**
 * Thực thi tác vụ phụ trợ sau khi ghi nghiệp vụ chính:
 * - Khi chạy Vitest (`process.env.VITEST`), đợi tuần tự để kiểm thử tự động tất định 100%.
 * - Khi vận hành thực tế (Google Sheets / Render), tách chạy ngầm để trả phản hồi tức thì cho nhân viên.
 */
export async function runBackgroundSideEffect(task: () => Promise<unknown>): Promise<void> {
  if (Boolean(process.env.VITEST)) {
    await task();
    return;
  }
  void task().catch(() => undefined);
}
