import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BACKUP_KIND_LABELS,
  BACKUP_STATUS_LABELS,
  EMAIL_TEMPLATE_CODES,
  EMAIL_TEMPLATE_LABELS,
  type Health,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';

const zPreviewQuery = z.object({
  template: z.enum(EMAIL_TEMPLATE_CODES).default('ACCOUNT_ACTIVATED'),
});

const zSendTestEmailBody = z.object({
  to: z.string({ required_error: 'Địa chỉ email người nhận là bắt buộc' }).trim().email('Định dạng địa chỉ email không hợp lệ'),
  recipient_name: z.string().trim().min(2, 'Tên người nhận tối thiểu 2 ký tự').max(80).default('Nhân sự Ụm Bò Milk'),
  template: z.enum(EMAIL_TEMPLATE_CODES).default('ACCOUNT_ACTIVATED'),
  summary: z.string().trim().max(300).optional(),
});

export async function healthRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Probe gốc cho Render port scanner (HEAD / hoặc GET /) — phản hồi tức thì, ẩn log định kỳ. */
  app.get('/', { logLevel: 'silent' }, async (request) => {
    const ready = ctx.db.isReady();
    return sendSuccess(request, 'Hệ thống API Ụm Bò Milk HR V5.1 đang hoạt động', {
      status: 'ok',
      ready,
      version: ctx.version,
      time: nowIso(),
    });
  });

  /** Health công khai: chỉ trạng thái tổng, không lộ chi tiết nội bộ. */
  app.get('/api/health', { logLevel: 'silent' }, async (request) => {
    const ready = ctx.db.isReady();
    return sendSuccess(
      request,
      ready ? 'Hệ thống hoạt động ổn định' : 'Hệ thống đang nạp dữ liệu khởi tạo',
      { status: ready ? 'ok' : 'warming_up', ready, version: ctx.version, time: nowIso() },
    );
  });

  /** Health chi tiết cho tab Tích hợp & Đồng bộ (ADM-08). */
  app.get(
    '/api/admin/integrations/health',
    { preHandler: requirePermission('integration.read') },
    async (request) => {
      const q = request.query as { refresh?: string } | undefined;
      if (q?.refresh === '1' || q?.refresh === 'true') {
        await Promise.all([
          ctx.db.users.refreshIfIdle(),
          ctx.db.branches.refreshIfIdle(),
          ctx.db.deadLetters.refreshIfIdle(),
          ctx.db.operationJournal.refreshIfIdle(),
        ]);
      }
      const google = await ctx.google.check();
      const stats = ctx.db.stats();
      const lastBackup = ctx.db.backupLog.all().reverse()[0];
      const recentSagas = ctx.db.operationJournal.all().reverse().slice(0, 10);

      const checks: Health['checks'] = {
        google: { status: google.ok ? 'ok' : 'down', detail: google.detail },
        sheetsCache: {
          status: stats.ready && !stats.lastRefreshError ? 'ok' : 'degraded',
          detail: stats.lastRefreshError ?? `${stats.tables.length} bảng đã nạp đồng bộ`,
        },
        writeQueue: {
          status: stats.queue.pending > 20 ? 'degraded' : 'ok',
          detail: `${stats.queue.pending} thao tác đang chờ ghi`,
        },
        deadLetters: {
          status: stats.unresolvedDeadLetters > 0 ? 'degraded' : 'ok',
          detail: `${stats.unresolvedDeadLetters} bản ghi đang chờ đối soát`,
        },
        realtime: {
          status: ctx.realtime() ? 'ok' : 'down',
          detail: `${ctx.realtime()?.connectionCount() ?? 0} kết nối trực tuyến`,
        },
        backup: {
          status: !lastBackup ? 'degraded' : lastBackup.status === 'SUCCESS' ? 'ok' : 'down',
          detail: lastBackup
            ? `${BACKUP_KIND_LABELS[lastBackup.kind as keyof typeof BACKUP_KIND_LABELS] ?? lastBackup.kind} (${BACKUP_STATUS_LABELS[lastBackup.status as keyof typeof BACKUP_STATUS_LABELS] ?? lastBackup.status}) lúc ${lastBackup.started_at}`
            : 'Chưa ghi nhận bản sao lưu',
        },
      };
      const values = Object.values(checks).map((c) => c.status);
      const status = values.includes('down') ? 'down' : values.includes('degraded') ? 'degraded' : 'ok';

      return sendSuccess(request, 'Lấy trạng thái tích hợp và đồng bộ thành công', {
        status, version: ctx.version, time: nowIso(), checks,
        data: { ...stats, recentSagas, recentEmails: ctx.email.recent(15), emailQueueStats: ctx.email.queueStats() },
      });
    },
  );

  /** Quét kiểm tra toàn vẹn dữ liệu trên Google Sheets (tự động sửa các lệch khóa/trùng lặp an toàn). */
  app.get('/api/admin/integrations/reconcile', { preHandler: requirePermission('integration.read') }, async (request) => {
    const actorId = request.auth?.user.id ?? 'auto-reconcile';
    const report = await ctx.reconciliation.scanAndRepair({ autoFix: true, actorId });
    return sendSuccess(request, 'Kiểm tra đối soát toàn vẹn dữ liệu thành công', report);
  });

  /** Thực thi đối soát và tự động sửa các bất biến an toàn. */
  app.post('/api/admin/integrations/reconcile', { preHandler: requirePermission('integration.read') }, async (request) => {
    const actorId = request.auth!.user.id;
    await Promise.all([ctx.db.users.refreshIfIdle(), ctx.db.employees.refreshIfIdle(), ctx.db.branches.refreshIfIdle(), ctx.db.payRates.refreshIfIdle(), ctx.db.deadLetters.refreshIfIdle(), ctx.db.operationJournal.refreshIfIdle()]);
    const report = await ctx.reconciliation.scanAndRepair({ autoFix: true, actorId });
    await ctx.audit.record(auditContext(request), { action: 'system.reconcile', entity: 'SYSTEM', entityId: 'reconcile', after: report.summary });
    const actorUser = request.auth!.user;
    ctx.email.enqueue({ to: actorUser.email || `${actorUser.username}@umbomilk.vn`, template: 'SYSTEM_RECONCILIATION_REPORT', recipientName: actorUser.display_name, referenceCode: `REC-${nowIso().slice(0, 10)}`, summary: `Báo cáo đối soát toàn vẹn dữ liệu: Quét ${report.summary.tablesScanned} bảng (${report.summary.rowsScanned} bản ghi), phát hiện ${report.summary.issuesFound} điểm lệch, đã tự động sửa ${report.summary.autoRepaired} mục.`, metadata: [{ label: 'Số bảng / dòng đã quét', value: `${report.summary.tablesScanned} bảng (${report.summary.rowsScanned} dòng)` }, { label: 'Điểm lệch / Tự động sửa', value: `${report.summary.issuesFound} phát hiện / ${report.summary.autoRepaired} đã sửa` }, { label: 'Trạng thái toàn vẹn', value: report.status === 'ok' ? 'Đạt chuẩn 100%' : 'Cần kiểm tra' }] });
    return sendSuccess(request, `Hoàn tất đối soát dữ liệu: phát hiện ${report.summary.issuesFound} điểm lệch, đã tự động sửa ${report.summary.autoRepaired} mục`, report);
  });

  /** Xem trước mẫu Email doanh nghiệp & Hàng đợi gửi Email. */
  app.get('/api/admin/integrations/email-templates', { preHandler: requirePermission('integration.read') }, async (request) => {
    const query = zPreviewQuery.parse(request.query);
    const preview = ctx.email.previewTemplate(query.template, ctx.env.API_PUBLIC_ORIGIN);
    const templates = EMAIL_TEMPLATE_CODES.map((code) => ({ code, label: EMAIL_TEMPLATE_LABELS[code] }));
    return sendSuccess(request, 'Lấy mẫu thông báo email doanh nghiệp thành công', {
      templates, preview, recentEmails: ctx.email.recent(50), queueStats: ctx.email.queueStats(),
    });
  });

  /** Quét & gửi ngay lô tiếp theo trong hàng đợi Email (Anti-Spam Batch Flush). */
  app.post('/api/admin/integrations/email-queue/flush', { preHandler: requirePermission('integration.read', 'notification.send') }, async (request) => {
    await ctx.db.deliveryLogs.refreshIfIdle();
    const retryRes = await ctx.email.retryFailed();
    const batchRes = await ctx.email.processQueueBatch(5);
    const stats = ctx.email.queueStats();
    return sendSuccess(request, `Đã quét hàng đợi Email: xử lý ${retryRes.processed + batchRes.processed} thư, còn ${stats.queuedCount} thư đang chờ`, {
      processed: retryRes.processed + batchRes.processed, queueStats: stats, recentEmails: ctx.email.recent(50),
    });
  });

  /** Gửi thử hoặc gửi thông báo Email doanh nghiệp trực tiếp từ giao diện Quản trị. */
  app.post(
    '/api/admin/integrations/send-test-email',
    { preHandler: requirePermission('integration.read', 'notification.send') },
    async (request) => {
      const body = zSendTestEmailBody.parse(request.body);
      const record = await ctx.email.send({
        to: body.to,
        template: body.template,
        recipientName: body.recipient_name,
        referenceCode: `MAIL-${Date.now().toString().slice(-6)}`,
        summary: body.summary || `Thông báo hành chính từ hệ thống nhân sự — Mẫu: ${EMAIL_TEMPLATE_LABELS[body.template]}.`,
        metadata: [
          { label: 'Loại thông báo', value: EMAIL_TEMPLATE_LABELS[body.template] },
          { label: 'Người nhận', value: `${body.recipient_name} (${body.to})` },
          { label: 'Người gửi', value: request.auth!.user.display_name },
        ],
      });
      await ctx.audit.record(auditContext(request), {
        action: 'email.send_manual',
        entity: 'SYSTEM',
        entityId: record.id,
        after: { to: record.to, template: record.template, status: record.status },
      });
      if (record.status === 'FAILED') {
        throw Errors.badRequest(`Gửi email tới ${body.to} thất bại: ${record.error ?? 'Lỗi kết nối máy chủ SMTP'}`);
      }
      return sendSuccess(request, `Đã gửi thông báo email tới ${body.to} thành công`, {
        email: record,
        recentEmails: ctx.email.recent().slice(0, 15),
      });
    },
  );

  /** Kích hoạt sao lưu dữ liệu thủ công lên Google Drive ngay từ trang Tích hợp & Đồng bộ (ADM-08). */
  app.post(
    '/api/admin/integrations/backup',
    { preHandler: requirePermission('integration.read') },
    async (request) => {
      const body = z.object({ kind: z.enum(['DAILY', 'CRITICAL', 'PRE_OPERATION', 'WEEKLY', 'MONTHLY']).default('DAILY') }).parse(request.body ?? {});
      const log = await ctx.backup.runBackup(body.kind, request.auth!.user.id);
      await ctx.audit.record(auditContext(request), {
        action: 'system.backup',
        entity: 'BACKUP_LOG',
        entityId: log.id,
        after: { kind: log.kind, status: log.status, files_count: log.files_count },
      });
      return sendSuccess(request, `Đã thực thi sao lưu dữ liệu (${BACKUP_KIND_LABELS[log.kind as keyof typeof BACKUP_KIND_LABELS] ?? log.kind}) thành công`, log);
    },
  );
}
