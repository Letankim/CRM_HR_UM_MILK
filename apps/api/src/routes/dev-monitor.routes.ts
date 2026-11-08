import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { collectDevDomainAndRuntimeTelemetry } from '../services/dev-domain-telemetry.js';
import { collectDevPostgresTelemetry } from '../services/dev-postgres-telemetry.js';

const zVerifyKeyBody = z.object({
  key: z.string({ required_error: 'Vui lòng nhập mã truy cập' }).trim().min(1, 'Vui lòng nhập mã truy cập'),
});

const zDevActionBody = z.object({
  action: z.enum(['PING_POSTGRES', 'FLUSH_OUTBOX', 'RECONCILE_PG_SHEETS', 'RECONCILE_INTEGRITY'], {
    errorMap: () => ({ message: 'Thao tác kỹ thuật yêu cầu không hợp lệ' }),
  }),
});

function isValidDevKey(provided: string, expected: string): boolean {
  const clean = provided.trim();
  if (!clean || !expected) return false;
  const hashA = createHash('sha256').update(clean, 'utf8').digest();
  const hashB = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

function assertDevMonitorHeader(request: FastifyRequest, expectedKey: string): void {
  const headerVal = String(request.headers['x-dev-monitor-key'] ?? '');
  if (!isValidDevKey(headerVal, expectedKey)) {
    throw Errors.unauthorized('Mã truy cập không chính xác hoặc đã hết hiệu lực');
  }
}

export async function devMonitorRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/dev/verify-key', async (request) => {
    const headerKey = String(request.headers['x-dev-monitor-key'] ?? '').trim();
    const parsed = headerKey ? { key: headerKey } : zVerifyKeyBody.parse(request.body ?? {});
    if (!isValidDevKey(parsed.key, ctx.env.DEV_MONITOR_KEY)) {
      throw Errors.unauthorized('Mã truy cập không chính xác');
    }
    return sendSuccess(request, 'Xác thực khóa giám sát kỹ thuật thành công', {
      verified: true,
      version: ctx.version,
      serverTime: nowIso(),
      pgEnabled: Boolean(ctx.env.DATABASE_URL.trim()),
      maxStorageMb: ctx.env.POSTGRES_MAX_STORAGE_MB,
    });
  });

  app.get('/api/dev/system-stats', async (request) => {
    assertDevMonitorHeader(request, ctx.env.DEV_MONITOR_KEY);
    const q = request.query as { refresh?: string } | undefined;
    if (q?.refresh === '1' || q?.refresh === 'true') {
      await Promise.all(ctx.db.allStores().map((s) => s.refreshIfIdle(0).catch(() => false)));
    }
    const [postgres, domainAndRuntime] = await Promise.all([
      collectDevPostgresTelemetry(ctx),
      collectDevDomainAndRuntimeTelemetry(ctx),
    ]);
    return sendSuccess(request, 'Lấy toàn bộ chỉ số giám sát kỹ thuật hệ thống thành công', {
      generatedAt: nowIso(),
      postgres,
      domain: domainAndRuntime.domain,
      runtime: domainAndRuntime.runtime,
    });
  });

  app.post('/api/dev/actions', async (request) => {
    assertDevMonitorHeader(request, ctx.env.DEV_MONITOR_KEY);
    const { action } = zDevActionBody.parse(request.body ?? {});

    if (action === 'PING_POSTGRES') {
      const ping = ctx.db.gateway.pingPostgres
        ? await ctx.db.gateway.pingPostgres(4000)
        : { enabled: false, alive: false, mode: 'DISABLED', latency_ms: null, checked_at: nowIso() };
      return sendSuccess(
        request,
        ping.alive
          ? `Kết nối PostgreSQL hoạt động tốt (độ trễ ${ping.latency_ms} ms)`
          : ping.enabled
            ? 'Không thể ping PostgreSQL lúc này, hệ thống đang chạy dự phòng'
            : 'Chưa cấu hình kết nối PostgreSQL trên môi trường này',
        { action, ping },
      );
    }

    if (action === 'FLUSH_OUTBOX') {
      await ctx.db.flushAllWrites();
      const flushed = (await ctx.db.gateway.flushOutbox?.()) ?? 0;
      return sendSuccess(request, `Đã đẩy toàn bộ hàng đợi ghi và đồng bộ Outbox (${flushed} lô dữ liệu)`, {
        action,
        flushedCount: flushed,
        completedAt: nowIso(),
      });
    }

    if (action === 'RECONCILE_PG_SHEETS') {
      if (!ctx.db.gateway.reconcileParity) {
        return sendSuccess(request, 'Môi trường hiện tại không bật đồng bộ kép PostgreSQL', { action, report: null });
      }
      const report = await ctx.db.gateway.reconcileParity();
      return sendSuccess(request, 'Đã đối soát đồng bộ 2 chiều PostgreSQL và Google Sheets thành công', { action, report });
    }

    const integrity = await ctx.reconciliation.scanAndRepair({ autoFix: true, actorId: 'dev-monitor' });
    return sendSuccess(
      request,
      `Quét toàn vẹn nghiệp vụ hoàn tất: phát hiện ${integrity.summary.issuesFound} điểm lệch, đã tự động sửa ${integrity.summary.autoRepaired} mục`,
      { action, integrity },
    );
  });
}
