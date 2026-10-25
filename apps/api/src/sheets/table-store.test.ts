import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zSystemColumns } from '@umbm/shared';
import { InMemorySheetsGateway } from './gateway.js';
import { TableStore } from './table-store.js';
import { WriteQueue } from './write-queue.js';

const zItem = zSystemColumns.extend({ name: z.string().min(1), qty: z.coerce.number().int() });
const HEADERS = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'is_deleted', 'name', 'qty'];

function setup() {
  const gw = new InMemorySheetsGateway();
  gw.seed('s1', 'ITEMS', [HEADERS]);
  const queue = new WriteQueue();
  const store = new TableStore(gw, queue, { spreadsheetKey: 'T', spreadsheetId: 's1', tab: 'ITEMS', headers: HEADERS, schema: zItem });
  return { gw, queue, store };
}

describe('WriteQueue', () => {
  it('chạy tuần tự theo đúng thứ tự gửi vào', async () => {
    const q = new WriteQueue();
    const order: number[] = [];
    const delays = [30, 5, 15];
    await Promise.all(
      delays.map((d, i) =>
        q.enqueue('k', async () => {
          await new Promise((r) => setTimeout(r, d));
          order.push(i);
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2]);
    expect(q.isIdle('k')).toBe(true);
  });

  it('lỗi của task trước không chặn task sau', async () => {
    const q = new WriteQueue();
    const a = q.enqueue('k', async () => {
      throw new Error('boom');
    });
    const b = q.enqueue('k', async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });
});

describe('TableStore', () => {
  it('insert ghi lên Sheets, đọc lại cho ra đúng dữ liệu (kể cả boolean FALSE)', async () => {
    const { gw, store } = setup();
    await store.load();
    const rec = await store.insert({ name: 'Sữa', qty: 3 }, 'u1');
    expect(rec.version).toBe(1);
    expect(rec.is_deleted).toBe(false);

    const fresh = new TableStore(gw, new WriteQueue(), { spreadsheetKey: 'T', spreadsheetId: 's1', tab: 'ITEMS', headers: HEADERS, schema: zItem });
    await fresh.load();
    expect(fresh.get(rec.id)).toEqual(rec);
  });

  it('update tăng version và từ chối version cũ (optimistic lock)', async () => {
    const { store } = setup();
    await store.load();
    const rec = await store.insert({ name: 'Sữa', qty: 3 }, 'u1');
    const v2 = await store.update(rec.id, 1, { qty: 5 }, 'u2');
    expect(v2.version).toBe(2);
    await expect(store.update(rec.id, 1, { qty: 9 }, 'u3')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('phát hiện dòng bị sửa tay trên Google Sheets trước khi ghi đè', async () => {
    const { gw, store } = setup();
    await store.load();
    const rec = await store.insert({ name: 'Sữa', qty: 3 }, 'u1');
    gw.editCell('s1', 'ITEMS', 2, HEADERS.indexOf('version'), '7'); // ai đó sửa tay
    await expect(store.update(rec.id, 1, { qty: 4 }, 'u2')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('từ chối nạp khi header bị đổi thứ tự', async () => {
    const gw = new InMemorySheetsGateway();
    gw.seed('s1', 'ITEMS', [[...HEADERS.slice(0, 7), 'qty', 'name']]);
    const store = new TableStore(gw, new WriteQueue(), { spreadsheetKey: 'T', spreadsheetId: 's1', tab: 'ITEMS', headers: HEADERS, schema: zItem });
    await expect(store.load()).rejects.toThrow(/Header/);
  });

  it('dòng sai dữ liệu bị loại khỏi cache và được báo cáo', async () => {
    const { gw, store } = setup();
    gw.seed('s1', 'ITEMS', [HEADERS, ['01JABCDEFGHJKMNPQRSTVWXYZ0', '2026-10-23T08:00:00+07:00', 'x', '2026-10-23T08:00:00+07:00', 'x', '1', 'FALSE', '', 'abc']]);
    await store.load();
    expect(store.all()).toHaveLength(0);
    expect(store.stats().invalidRows).toBe(1);
  });

  it('không cập nhật cache nếu ghi Google thất bại', async () => {
    const { gw, store } = setup();
    await store.load();
    gw.appendRows = async () => {
      throw new Error('quota');
    };
    await expect(store.insert({ name: 'Sữa', qty: 1 }, 'u1')).rejects.toThrow('quota');
    expect(store.all()).toHaveLength(0);
  });

  it('gộp nhiều insert đồng thời thành ít request (tiết kiệm quota)', async () => {
    const { gw, store } = setup();
    await store.load();
    const before = gw.calls.write;
    const records = await Promise.all(
      Array.from({ length: 30 }, (_, i) => store.insert({ name: `NV ${i}`, qty: i }, 'u1')),
    );
    expect(gw.calls.write - before).toBeLessThanOrEqual(2);
    expect(store.all()).toHaveLength(30);

    // Số dòng trong chỉ mục phải đúng: cập nhật bản ghi cuối không đụng bản ghi khác.
    const last = records[29]!;
    await store.update(last.id, 1, { qty: 999 }, 'u2');
    const fresh = new TableStore(gw, new WriteQueue(), { spreadsheetKey: 'T', spreadsheetId: 's1', tab: 'ITEMS', headers: HEADERS, schema: zItem });
    await fresh.load();
    expect(fresh.get(last.id)?.qty).toBe(999);
    expect(fresh.get(records[28]!.id)?.qty).toBe(28);
  });

  it('một insert lỗi trong lô làm cả lô báo lỗi, không lô nào được ghi nửa vời vào cache', async () => {
    const { gw, store } = setup();
    await store.load();
    gw.appendRows = async () => {
      throw new Error('timeout');
    };
    const results = await Promise.allSettled([1, 2, 3].map((i) => store.insert({ name: `x${i}`, qty: i }, 'u1')));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(store.all()).toHaveLength(0);
  });

  it('từ chối ô vượt giới hạn 50.000 ký tự của Google Sheets', async () => {
    const { store } = setup();
    await store.load();
    await expect(store.insert({ name: 'x'.repeat(46_000), qty: 1 }, 'u1')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('Audit log theo tháng', () => {
  it('tự tạo tab AUDIT_LOG_YYYY_MM và ghi vào đó', async () => {
    const { Database } = await import('../data/database.js');
    const { createMemoryGateway, MEMORY_IDS } = await import('../data/memory-seed.js');
    const { AuditService } = await import('../services/audit.service.js');
    const gw = await createMemoryGateway();
    const db = new Database(gw, new WriteQueue(), MEMORY_IDS);
    await db.loadAll();

    const audit = new AuditService(db, (e) => {
      throw e;
    });
    await audit.record({ actorUserId: 'u1', actorRole: 'ADMIN' }, { action: 'test', entity: 'X', entityId: '1', after: { password_hash: 'secret', ok: true } });

    const tab = (await import('@umbm/shared')).monthlyTabName('AUDIT_LOG');
    expect(gw.hasTab(MEMORY_IDS.SYSTEM, tab)).toBe(true);
    const rows = await gw.readTab(MEMORY_IDS.SYSTEM, tab);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.join('|')).toContain('[REDACTED]');
    expect(rows[1]!.join('|')).not.toContain('secret');
  });
});
