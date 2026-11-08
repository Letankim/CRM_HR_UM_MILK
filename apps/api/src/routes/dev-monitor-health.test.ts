import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../test-utils/build-test-app.js';

describe('GET /api/health PostgreSQL Keep-Alive & Developer System Monitor (/api/dev/*)', () => {
  it('GET /api/health gọi keep-alive pingPostgres để chống ngủ đông và luôn phản hồi 200 ổn định', async () => {
    const t = await buildTestApp('h');
    try {
      const resNoPg = await t.app.inject({ method: 'GET', url: '/api/health' });
      expect(resNoPg.statusCode).toBe(200);
      const bodyNoPg = resNoPg.json();
      expect(bodyNoPg.success).toBe(true);
      expect(bodyNoPg.data.status).toBe('ok');
      expect(bodyNoPg.data.postgres).toMatchObject({ enabled: false, alive: false, mode: 'DISABLED' });

      let pingCalled = 0;
      t.ctx.db.gateway.pingPostgres = async () => {
        pingCalled += 1;
        return {
          enabled: true,
          alive: true,
          mode: 'PG_PRIMARY',
          latency_ms: 14.5,
          checked_at: new Date().toISOString(),
        };
      };

      const resWithPg = await t.app.inject({ method: 'GET', url: '/api/health' });
      expect(resWithPg.statusCode).toBe(200);
      expect(pingCalled).toBe(1);
      const bodyWithPg = resWithPg.json();
      expect(bodyWithPg.success).toBe(true);
      expect(bodyWithPg.data.postgres).toMatchObject({
        enabled: true,
        alive: true,
        mode: 'PG_PRIMARY',
        latency_ms: 14.5,
      });
    } finally {
      await t.app.close();
    }
  });

  it('POST /api/dev/verify-key và GET /api/dev/system-stats xác thực chặt DEV_MONITOR_KEY phía Backend', async () => {
    const t = await buildTestApp('m');
    const validKey = t.ctx.env.DEV_MONITOR_KEY;
    try {
      const emptyRes = await t.app.inject({
        method: 'POST',
        url: '/api/dev/verify-key',
        payload: { key: '' },
      });
      expect(emptyRes.statusCode).toBe(400);
      expect(emptyRes.json().errors.code).toBe('VALIDATION_ERROR');

      const wrongKeyRes = await t.app.inject({
        method: 'POST',
        url: '/api/dev/verify-key',
        payload: { key: 'wrong-secret-key-999' },
      });
      expect(wrongKeyRes.statusCode).toBe(401);
      expect(wrongKeyRes.json().success).toBe(false);

      const okVerifyRes = await t.app.inject({
        method: 'POST',
        url: '/api/dev/verify-key',
        payload: { key: validKey },
      });
      expect(okVerifyRes.statusCode).toBe(200);
      expect(okVerifyRes.json().data.verified).toBe(true);

      const unauthorizedStats = await t.app.inject({ method: 'GET', url: '/api/dev/system-stats' });
      expect(unauthorizedStats.statusCode).toBe(401);

      const statsRes = await t.app.inject({
        method: 'GET',
        url: '/api/dev/system-stats?refresh=1',
        headers: { 'x-dev-monitor-key': validKey },
      });
      expect(statsRes.statusCode).toBe(200);
      const statsBody = statsRes.json();
      expect(statsBody.success).toBe(true);
      expect(statsBody.data.postgres.storage.quotaMb).toBe(1024);
      expect(statsBody.data.postgres.storage.freeMb).toBe(1024);
      expect(statsBody.data.domain.moduleGroups).toHaveLength(7);
      expect(statsBody.data.domain.totalStores).toBeGreaterThanOrEqual(37);
      expect(statsBody.data.domain.totalActiveRows).toBeGreaterThan(0);
      expect(statsBody.data.runtime.memory.rssMb).toBeGreaterThan(0);
      expect(statsBody.data.runtime.os.totalMemMb).toBeGreaterThan(0);

      const actionRes = await t.app.inject({
        method: 'POST',
        url: '/api/dev/actions',
        headers: { 'x-dev-monitor-key': validKey },
        payload: { action: 'RECONCILE_INTEGRITY' },
      });
      expect(actionRes.statusCode).toBe(200);
      expect(actionRes.json().success).toBe(true);
    } finally {
      await t.app.close();
    }
  });
});
