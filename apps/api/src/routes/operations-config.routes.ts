import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateOffWindow } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { listPartitions, monthKeyLabel, rolloverToMonth, switchPartition } from '../services/data-partition.service.js';
import { ensureSyncedNotifications } from '../services/notification-sync.service.js';
import { describeOperationSettings, getOperationSettings, saveOperationSettings } from '../services/operations-settings.service.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải theo định dạng HH:mm');
const weekday = z.coerce.number().int().min(1, 'Ngày trong tuần từ 1 (Thứ 2) đến 7 (Chủ nhật)').max(7, 'Ngày trong tuần từ 1 (Thứ 2) đến 7 (Chủ nhật)');
const zUpdateOperationsBody = z.object({
  pin_rotation_days: z.coerce.number().int().min(0, 'Chu kỳ đổi PIN không được âm').max(3650, 'Chu kỳ đổi PIN tối đa 3650 ngày').optional(),
  off_window_open_weekday: weekday.optional(),
  off_window_open_time: hm.optional(),
  off_window_close_weekday: weekday.optional(),
  off_window_close_time: hm.optional(),
  official_weekly_off_limit: z.coerce.number().int().min(0, 'Số ngày OFF tối thiểu là 0').max(7, 'Số ngày OFF tối đa là 7').optional(),
  max_shifts_per_day: z.coerce.number().int().min(1, 'Tối thiểu 1 ca/ngày').max(4, 'Tối đa 4 ca/ngày').optional(),
  checkout_max_late_hours: z.coerce.number().int().min(0, 'Thời hạn Ra ca không được âm').max(12, 'Thời hạn Ra ca tối đa 12 giờ').optional(),
});
const zMonthKey = z.string().trim().regex(/^(\d{4}_(0[1-9]|1[0-2]))?$/, 'Mã tháng phải theo định dạng YYYY_MM (ví dụ 2026_11)');

export async function operationsConfigRoutes(app: FastifyInstance, ctx: AppContext) {
  const buildPayload = () => {
    const settings = getOperationSettings(ctx.db);
    const { todayStr, nowHm } = getVnNowDateAndHm();
    return { settings, fields: describeOperationSettings(settings), offWindow: evaluateOffWindow(settings, todayStr, nowHm), partitionLabel: monthKeyLabel(ctx.db.partitionMonth) };
  };

  app.get('/api/admin/operations-config', { preHandler: requireAuth() }, async (request) =>
    sendSuccess(request, 'Lấy cấu hình vận hành hệ thống thành công', buildPayload()));

  app.put('/api/admin/operations-config', { preHandler: requirePermission('system.config') }, async (request) => {
    const body = zUpdateOperationsBody.parse(request.body ?? {});
    const before = getOperationSettings(ctx.db);
    const after = await saveOperationSettings(ctx.db, {
      pinRotationDays: body.pin_rotation_days, offWindowOpenWeekday: body.off_window_open_weekday, offWindowOpenTime: body.off_window_open_time,
      offWindowCloseWeekday: body.off_window_close_weekday, offWindowCloseTime: body.off_window_close_time,
      officialWeeklyOffLimit: body.official_weekly_off_limit, maxShiftsPerDay: body.max_shifts_per_day, checkoutMaxLateHours: body.checkout_max_late_hours,
    }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'system.operations.update', entity: 'SYSTEM_SETTINGS', entityId: 'operations-config', before: { ...before }, after: { ...after } });
    return sendSuccess(request, 'Đã lưu cấu hình vận hành hệ thống', buildPayload());
  });

  app.get('/api/schedule/off-window', { preHandler: requireAuth() }, async (request) => {
    const { offWindow, settings } = buildPayload();
    return sendSuccess(request, offWindow.message, { ...offWindow, officialWeeklyOffLimit: settings.officialWeeklyOffLimit, maxShiftsPerDay: settings.maxShiftsPerDay });
  });

  app.get('/api/admin/data-partitions', { preHandler: requirePermission('system.config', 'integration.read') }, async (request) => {
    const q = (request.query ?? {}) as { refresh?: string };
    if (q.refresh === '1' || q.refresh === 'true') {
      await Promise.all([ctx.db.systemSettings.load(), ...ctx.db.monthlyStores().map((m) => m.store.load())]);
    }
    return sendSuccess(request, 'Lấy danh sách dữ liệu theo tháng thành công', await listPartitions(ctx.db));
  });

  app.post('/api/admin/data-partitions/rollover', { preHandler: requirePermission('system.config') }, async (request, reply) => {
    const body = z.object({ month_key: zMonthKey.refine((v) => v !== '', 'Vui lòng chọn tháng cần tạo tệp Google Sheets mới'), carry_forward: z.boolean().optional().default(true) }).parse(request.body ?? {});
    const actor = request.auth!.user, before = ctx.db.partitionMonth;
    const result = await rolloverToMonth(ctx.db, body.month_key, actor.id, body.carry_forward);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'system.partition.rollover', entity: 'SYSTEM_SETTINGS', entityId: body.month_key, before: { month: before }, after: result });
    const listing = await listPartitions(ctx.db);
    const carriedTotal = Object.values(result.carried).reduce((a, b) => a + b, 0);
    ctx.realtime()?.broadcast(SocketEvents.DATA_PARTITION_CHANGED, {
      kind: 'ROLLOVER',
      activeMonth: listing.activeMonth,
      activeLabel: listing.activeLabel,
      previousMonth: before,
      previousLabel: monthKeyLabel(before),
      carriedTotal,
      actorId: actor.id,
      actorName: actor.display_name || actor.username,
      switchedAt: nowIso(),
      message: `Hệ thống vừa khởi tạo và chuyển sang dữ liệu ${listing.activeLabel} — Đã tự động tải lại dữ liệu mới nhất`,
    });
    reply.code(201);
    return sendSuccess(request, `Đã khởi tạo tệp Google Sheets ${result.label} trên Google Drive và chuyển tiếp ${carriedTotal} bản ghi từ đầu tháng trở đi`, { ...result, ...listing });
  });

  app.put('/api/admin/data-partitions/active', { preHandler: requirePermission('system.config') }, async (request) => {
    const body = z.object({ month_key: zMonthKey }).parse(request.body ?? {});
    const actor = request.auth!.user, before = ctx.db.partitionMonth;
    await switchPartition(ctx.db, body.month_key, actor.id);
    await ensureSyncedNotifications(ctx);
    await ctx.audit.record(auditContext(request), { action: 'system.partition.switch', entity: 'SYSTEM_SETTINGS', entityId: body.month_key || 'BASE', before: { month: before }, after: { month: body.month_key } });
    const listing = await listPartitions(ctx.db);
    ctx.realtime()?.broadcast(SocketEvents.DATA_PARTITION_CHANGED, {
      kind: 'SWITCH',
      activeMonth: listing.activeMonth,
      activeLabel: listing.activeLabel,
      previousMonth: before,
      previousLabel: monthKeyLabel(before),
      actorId: actor.id,
      actorName: actor.display_name || actor.username,
      switchedAt: nowIso(),
      message: `Hệ thống vừa chuyển sang sử dụng dữ liệu ${listing.activeLabel} — Đã tự động tải lại dữ liệu mới nhất`,
    });
    return sendSuccess(request, `Đã chuyển hệ thống sang sử dụng dữ liệu ${listing.activeLabel}`, listing);
  });
}
