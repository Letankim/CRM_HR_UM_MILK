import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { sweepDueScheduledAnnouncements } from '../services/announcement-scheduler.service.js';

const zBackupStart = z.object({
  kind: z.enum(['DAILY', 'CRITICAL', 'PRE_OPERATION', 'WEEKLY', 'MONTHLY']),
  startedAt: z.string(),
});
const zBackupFinish = z.object({
  id: z.string(),
  status: z.enum(['SUCCESS', 'FAILED']),
  finishedAt: z.string(),
  driveFolderId: z.string().default(''),
  filesCount: z.number().int().default(0),
  rows: z.record(z.number()).default({}),
  error: z.string().default(''),
});

/**
 * API nội bộ cho worker & cron job (Render Free Tier / GitHub Actions).
 * Worker không ghi Google Sheets trực tiếp để giữ nguyên nguyên tắc "một nơi ghi duy nhất" (api giữ WriteQueue).
 */
export async function internalRoutes(app: FastifyInstance, ctx: AppContext) {
  const expected = Buffer.from(ctx.env.INTERNAL_API_TOKEN);

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/internal/')) return;
    const got = Buffer.from(String(request.headers['x-internal-token'] ?? ''));
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw Errors.forbidden();
  });

  app.get('/api/internal/spreadsheets', async (request) =>
    sendSuccess(request, 'Lấy danh sách Spreadsheet ID thành công', {
      spreadsheets: {
        CORE: ctx.env.SHEET_ID_CORE,
        HR: ctx.env.SHEET_ID_HR,
        SCHEDULE: ctx.env.SHEET_ID_SCHEDULE,
        ATTENDANCE: ctx.env.SHEET_ID_ATTENDANCE,
        PAYROLL: ctx.env.SHEET_ID_PAYROLL,
        COMMS: ctx.env.SHEET_ID_COMMS,
        SYSTEM: ctx.env.SHEET_ID_SYSTEM,
      },
    }),
  );

  app.post('/api/internal/backups/start', async (request) => {
    const body = zBackupStart.parse(request.body);
    const row = await ctx.db.backupLog.insert(
      {
        kind: body.kind,
        started_at: body.startedAt,
        finished_at: '',
        status: 'RUNNING',
        drive_folder_id: '',
        files_count: 0,
        rows_json: '',
        error: '',
      },
      'worker',
    );
    return sendSuccess(request, 'Khởi tạo nhật ký sao lưu thành công', { id: row.id });
  });

  app.post('/api/internal/backups/finish', async (request) => {
    const body = zBackupFinish.parse(request.body);
    const row = ctx.db.backupLog.get(body.id);
    if (!row) throw Errors.notFound('Bản ghi sao lưu', body.id);
    await ctx.db.backupLog.update(
      row.id,
      row.version,
      {
        status: body.status,
        finished_at: body.finishedAt,
        drive_folder_id: body.driveFolderId,
        files_count: body.filesCount,
        rows_json: JSON.stringify(body.rows),
        error: body.error.slice(0, 2000),
      },
      'worker',
    );
    return sendSuccess(request, 'Cập nhật kết quả sao lưu thành công', { ok: true });
  });

  /**
   * Cron trigger cho phép gọi từ cron-job.org / GitHub Actions khi deploy trên Render Free Tier
   * để tự động sao lưu Google Sheets lên Drive, dọn bản cũ, đối soát dữ liệu và làm mới bộ nhớ đệm.
   */
  app.post('/api/internal/cron/:job', async (request) => {
    const { job } = request.params as { job: string };
    switch (job) {
      case 'reconcile': {
        const publishedAnnouncements = await sweepDueScheduledAnnouncements(ctx, 'cron-reconciler');
        const report = await ctx.reconciliation.scanAndRepair({ autoFix: true, actorId: 'cron-reconciler' });
        return sendSuccess(request, 'Thực thi cron đối soát tự động thành công', { ...report, publishedAnnouncements });
      }
      case 'publish-announcements': {
        const publishedAnnouncements = await sweepDueScheduledAnnouncements(ctx, 'cron-announcements');
        return sendSuccess(request, 'Quét và phát hành bản tin hẹn giờ thành công', { publishedAnnouncements });
      }
      case 'backup-daily': {
        const log = await ctx.backup.runBackup('DAILY', 'cron-daily');
        return sendSuccess(request, 'Thực thi sao lưu hàng ngày (DAILY) thành công', log);
      }
      case 'backup-critical': {
        const log = await ctx.backup.runBackup('CRITICAL', 'cron-critical');
        return sendSuccess(request, 'Thực thi sao lưu khẩn yếu (CRITICAL) thành công', log);
      }
      case 'backup-weekly': {
        const log = await ctx.backup.runBackup('WEEKLY', 'cron-weekly');
        return sendSuccess(request, 'Thực thi sao lưu hàng tuần (WEEKLY) thành công', log);
      }
      case 'backup-monthly': {
        const log = await ctx.backup.runBackup('MONTHLY', 'cron-monthly');
        return sendSuccess(request, 'Thực thi sao lưu hàng tháng (MONTHLY) thành công', log);
      }
      case 'backup-retention': {
        const res = await ctx.backup.applyRetention();
        return sendSuccess(request, 'Thực thi dọn dẹp bản sao lưu cũ thành công', res);
      }
      default:
        throw Errors.notFound('Cron job', job);
    }
  });
}
