import { describe, expect, it } from 'vitest';
import { Errors } from '../lib/errors.js';
import { isStaleWriteError, singleFlight, tolerantWrite } from './background-write.js';

describe('Tác vụ tự đồng bộ chạy ngầm không được làm hỏng request tải danh sách', () => {
  it('bỏ qua xung đột phiên bản / bản ghi đã bị xóa, nhưng vẫn ném các lỗi khác', async () => {
    expect(isStaleWriteError(Errors.conflict(undefined, 4))).toBe(true);
    expect(isStaleWriteError(Errors.notFound())).toBe(true);
    await expect(tolerantWrite(async () => { throw Errors.conflict(undefined, 4); })).resolves.toBeUndefined();
    await expect(tolerantWrite(async () => 'ok')).resolves.toBe('ok');
    await expect(tolerantWrite(async () => { throw new Error('Mất kết nối Google'); })).rejects.toThrow('Mất kết nối Google');
  });

  it('nhiều request song song chỉ chạy 1 lượt đồng bộ và dùng chung kết quả', async () => {
    const registry = new WeakMap<object, Promise<number>>();
    const key = {};
    let runs = 0;
    const job = () => new Promise<number>((resolve) => { runs++; setTimeout(() => resolve(runs), 20); });
    const results = await Promise.all([singleFlight(registry, key, job), singleFlight(registry, key, job), singleFlight(registry, key, job)]);
    expect(runs).toBe(1);
    expect(results).toEqual([1, 1, 1]);
    await singleFlight(registry, key, job);
    expect(runs).toBe(2);
  });
});
