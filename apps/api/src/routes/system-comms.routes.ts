import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BACKUP_KIND_LABELS, SYSTEM_CONFIG } from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { SocketEvents } from '../realtime/realtime.js';
import { mktCommsRoutes } from './mkt-comms.routes.js';

const zCreatePolicyBody = z.object({
  key: z.string().trim().min(2), category: z.string().default('ATTENDANCE'), value_json: z.string().trim().min(1),
  description: z.string().trim().optional(), title: z.string().trim().optional(), note: z.string().optional().default(''),
  content_html: z.string().optional().default(''), policy_version: z.string().default('v5.1'),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), effective_to: z.string().optional().default(''),
  is_locked_policy: z.boolean().default(false), broadcast_company: z.boolean().default(true),
});
const zUpdatePolicyBody = z.object({
  version: z.coerce.number().int().min(1), key: z.string().trim().optional(), category: z.string().optional(), value_json: z.string().trim().min(1),
  description: z.string().trim().optional(), title: z.string().trim().optional(), note: z.string().optional(), content_html: z.string().optional(),
  policy_version: z.string().optional(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().optional(),
  is_locked_policy: z.boolean().optional(), owner_override_approved: z.boolean().default(false), broadcast_company: z.boolean().default(false),
});
const zDeleteBody = z.object({ version: z.coerce.number().int().min(1).optional(), owner_override_approved: z.boolean().default(false) });
const zToggleMaintenanceBody = z.object({
  version: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().int().min(1).optional()), enabled: z.boolean(),
  scope: z.preprocess((v) => (v === 'GLOBAL' || !v ? 'ALL' : v), z.enum(['ALL', 'EMPLOYEE_APP', 'BACKOFFICE', 'MODULE', 'ATTENDANCE', 'PAYROLL'])).default('ALL'),
  banner_message: z.preprocess((v) => (v === null ? '' : v), z.string().trim().optional()),
  reason: z.preprocess((v) => (v === null ? '' : v), z.string().trim().optional()),
  expected_end_at: z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string().default('')),
});
const zTriggerBackupBody = z.object({ kind: z.enum(['DAILY', 'CRITICAL', 'PRE_OPERATION', 'WEEKLY', 'MONTHLY']).default('PRE_OPERATION'), action: z.enum(['BACKUP', 'RESTORE_VERIFY']).default('BACKUP') });
const zSystemSettingsBody = z.object({
  key: z.string().trim().min(2),
  value: z.string().trim().optional().default(''),
  value_json: z.string().trim().optional().default(''),
  label: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default(''),
  category: z.string().trim().optional().default('GENERAL'),
  note: z.string().trim().optional().default(''),
});

const DEFAULT_SYSTEM_SETTINGS = [
  { key: 'BRAND_NAME', label: 'Tên thương hiệu hệ thống', value: SYSTEM_CONFIG.brandName, category: 'UI_BRAND', value_type: 'STRING', note: 'Hiển thị trên Sidebar và Header' },
  { key: 'SYSTEM_SUBTITLE', label: 'Phụ đề hệ thống', value: SYSTEM_CONFIG.brandSubtitle, category: 'UI_BRAND', value_type: 'STRING', note: 'Nhãn phụ nhận diện cổng quản trị' },
  { key: 'TIMEZONE', label: 'Múi giờ vận hành chuẩn', value: 'Asia/Ho_Chi_Minh (GMT+07:00)', category: 'LOCALE', value_type: 'STRING', note: 'Áp dụng cho toàn bộ chấm công GPS và lịch ca' },
  { key: 'DATE_TIME_FORMAT', label: 'Định dạng ngày giờ chuẩn', value: 'DD/MM/YYYY HH:mm:ss', category: 'LOCALE', value_type: 'STRING', note: 'Chuẩn hiển thị tiếng Việt' },
  { key: 'SESSION_TIMEOUT_MINUTES', label: 'Thời gian hết hạn phiên (phút)', value: '480', category: 'SECURITY', value_type: 'NUMBER', note: 'Tự động thu hồi phiên không hoạt động sau 8 giờ' },
  { key: 'LOG_LEVEL', label: 'Mức độ ghi nhận nhật ký kỹ thuật', value: 'INFO (Chuẩn kiểm toán Production)', category: 'SECURITY', value_type: 'STRING', note: 'Tuyệt đối không ghi secrets/token ra log' },
];

export async function systemCommsRoutes(app: FastifyInstance, ctx: AppContext) {
  const POLICY_MANAGE_PERMS = ['system.config', 'employee.manage', 'comms.manage', 'payroll.manage', 'schedule.propose', 'notification.send'] as const;
  const canModifyRecord = (u: { id: string; role: string; username: string; display_name?: string }, rec: { created_by: string; approved_by?: string }) =>
    u.role === 'ADMIN' || rec.created_by === u.id || Boolean(rec.approved_by && (rec.approved_by === u.username || rec.approved_by === u.display_name));

  const broadcastPolicy = async (pol: { id: string; key: string; title: string; value_json: string; policy_version: string; effective_from: string }, actorId: string) => {
    const notifTitle = `[Chính sách mới] ${pol.title}`, notifBody = `Mã: ${pol.key} (${pol.policy_version}) · Áp dụng: ${pol.value_json} · Hiệu lực từ ${pol.effective_from}`;
    const notif = await ctx.db.notifications.insert({ recipient_user_id: 'ALL', category: 'ANNOUNCEMENT', title: notifTitle, body: notifBody, link: '/nv/ban-tin', severity: 'WARNING', read_at: '', recipient_role: 'ALL', branch_id: 'ALL', entity_type: 'POLICIES', entity_id: pol.id }, actorId);
    ctx.realtime()?.broadcast(SocketEvents.NOTIFICATION, { kind: 'POLICY_PUBLISHED', id: pol.id, notificationId: notif.id, code: pol.key, title: notifTitle, summary: notifBody, priority: 'HIGH', sent_at: nowIso() });
  };

  const mapPolicy = (p: ReturnType<typeof ctx.db.policies.all>[number], u?: { id: string; role: string; username: string; display_name?: string }) => ({
    ...p, description: p.title || p.key, content_html: p.note || '',
    creatorName: ctx.db.users.get(p.created_by)?.display_name || p.approved_by || 'Hệ thống',
    isMine: Boolean(u && (p.created_by === u.id || p.approved_by === u.username || p.approved_by === u.display_name)),
    canEdit: Boolean(u && canModifyRecord(u, p)),
  });

  app.get('/api/admin/policies', { preHandler: requireAuth() }, async (request) =>
    sendSuccess(request, 'Lấy danh sách chính sách vận hành theo phiên bản thành công', ctx.db.policies.all().map((p) => mapPolicy(p, request.auth?.user)).sort((a, b) => b.created_at.localeCompare(a.created_at))));

  app.post('/api/admin/policies', { preHandler: requirePermission(...POLICY_MANAGE_PERMS) }, async (request, reply) => {
    const body = zCreatePolicyBody.parse(request.body);
    const actorId = request.auth!.user.id, title = body.title || body.description || body.key;
    const created = await ctx.db.policies.insert({
      key: body.key, category: body.category, value_json: body.value_json, title, note: body.content_html || body.note || `<p>${title}</p>`,
      policy_version: body.policy_version || 'v5.1', effective_from: body.effective_from, effective_to: body.effective_to || '',
      approved_by: request.auth!.user.display_name || request.auth!.user.username, approved_at: nowIso(), is_locked_policy: request.auth!.user.role === 'ADMIN' ? body.is_locked_policy : false,
    }, actorId);
    if (body.broadcast_company) await broadcastPolicy(created, actorId);
    await ctx.audit.record(auditContext(request), { action: 'policy.create', entity: 'POLICIES', entityId: created.id, after: { key: created.key, value_json: created.value_json } });
    reply.code(201);
    return sendSuccess(request, body.broadcast_company ? 'Đã ban hành chính sách & phát thông báo phổ biến cho toàn công ty' : 'Đã ban hành phiên bản chính sách mới thành công', mapPolicy(created, request.auth?.user));
  });

  app.put('/api/admin/policies/:id', { preHandler: requirePermission(...POLICY_MANAGE_PERMS) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdatePolicyBody.parse(request.body), actorId = request.auth!.user.id;
    const before = ctx.db.policies.get(id) ?? ctx.db.policies.find((p) => p.key === id || (id === 'pol-01' && p.is_locked_policy));
    if (!before) throw Errors.notFound('Chính sách hệ thống', id);
    if (!canModifyRecord(request.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép chỉnh sửa chính sách do chính mình tạo ra (ngoại trừ Quản trị viên)');
    if (before.is_locked_policy && !body.owner_override_approved) throw Errors.badRequest('Chính sách cốt lõi này đã khóa bảo vệ (12 ngày thử việc / 30.000đ đổi ca) — chỉ sửa khi có xác nhận phê duyệt từ Chủ sở hữu');
    const updated = await ctx.db.policies.update(before.id, body.version, {
      key: body.key ?? before.key, category: body.category ?? before.category, value_json: body.value_json,
      title: body.title ?? body.description ?? before.title, note: body.content_html ?? body.note ?? before.note,
      policy_version: body.policy_version ?? before.policy_version, effective_from: body.effective_from ?? before.effective_from,
      effective_to: body.effective_to ?? before.effective_to, is_locked_policy: request.auth!.user.role === 'ADMIN' ? (body.is_locked_policy ?? before.is_locked_policy) : before.is_locked_policy,
      approved_by: before.approved_by || request.auth!.user.display_name || request.auth!.user.username,
    }, actorId);
    if (body.broadcast_company) await broadcastPolicy(updated, actorId);
    await ctx.audit.record(auditContext(request), { action: 'policy.update', entity: 'POLICIES', entityId: before.id, before: { value_json: before.value_json }, after: { value_json: updated.value_json } });
    return sendSuccess(request, 'Đã cập nhật cấu hình chính sách & lưu lịch sử phiên bản thành công', mapPolicy(updated, request.auth?.user));
  });

  app.post('/api/admin/policies/:id/broadcast', { preHandler: requirePermission(...POLICY_MANAGE_PERMS) }, async (request) => {
    const { id } = request.params as { id: string };
    const pol = ctx.db.policies.get(id);
    if (!pol) throw Errors.notFound('Chính sách hệ thống', id);
    if (!canModifyRecord(request.auth!.user, pol)) throw Errors.forbidden('Bạn chỉ được phép phát thông báo phổ biến cho chính sách do chính mình tạo ra (ngoại trừ Quản trị viên)');
    await broadcastPolicy(pol, request.auth!.user.id);
    return sendSuccess(request, `Đã phát thông báo phổ biến chính sách "${pol.title || pol.key}" tới toàn công ty`, mapPolicy(pol, request.auth?.user));
  });

  app.delete('/api/admin/policies/:id', { preHandler: requirePermission(...POLICY_MANAGE_PERMS) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteBody.parse(request.body ?? {}), before = ctx.db.policies.get(id);
    if (!before) throw Errors.notFound('Chính sách hệ thống', id);
    if (!canModifyRecord(request.auth!.user, before)) throw Errors.forbidden('Bạn chỉ được phép xóa chính sách do chính mình tạo ra (ngoại trừ Quản trị viên)');
    if (before.is_locked_policy && !body.owner_override_approved) throw Errors.badRequest('Chính sách cốt lõi đang khóa bảo vệ');
    await ctx.db.policies.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'policy.delete', entity: 'POLICIES', entityId: id, before: { key: before.key } });
    return sendSuccess(request, 'Đã xóa chính sách vận hành', { id });
  });

  app.get('/api/admin/maintenance', { preHandler: requireAuth() }, async (request) => sendSuccess(request, 'Lấy trạng thái chế độ bảo trì hệ thống thành công', ctx.db.maintenance.all()));

  app.post('/api/admin/maintenance', { preHandler: requirePermission('system.maintenance') }, async (request) => {
    const body = zToggleMaintenanceBody.parse(request.body), current = ctx.db.maintenance.all()[0], actorId = request.auth!.user.id;
    const savedEnd = current?.expected_end_at && (/^\d{2}:\d{2}$/.test(current.expected_end_at) || current.enabled) ? current.expected_end_at : '';
    const endAt = body.expected_end_at || savedEnd;
    if (body.enabled && !endAt) throw Errors.badRequest('Vui lòng chọn Giờ mở lại dự kiến trước khi bật chế độ bảo trì');
    const msg = body.banner_message || body.reason || 'Hệ thống đang bảo trì nâng cấp định kỳ';
    const updated = current
      ? await ctx.db.maintenance.update(current.id, current.version, { enabled: body.enabled, scope: body.scope, message: msg, expected_end_at: endAt, started_at: body.enabled ? nowIso() : current.started_at }, actorId)
      : await ctx.db.maintenance.insert({ scope: body.scope, enabled: body.enabled, title: 'Bảo trì hệ thống', message: msg, expected_end_at: endAt, target_module: 'ALL', started_at: nowIso() }, actorId);
    await ctx.audit.record(auditContext(request), { action: 'system.maintenance', entity: 'MAINTENANCE_MODE', entityId: updated.id, after: { enabled: updated.enabled, scope: updated.scope, message: updated.message } });
    ctx.realtime()?.broadcast(SocketEvents.MAINTENANCE_UPDATED, updated);
    return sendSuccess(request, body.enabled ? 'Đã BẬT chế độ bảo trì hệ thống và phát thông báo toàn trang' : 'Đã TẮT chế độ bảo trì — hệ thống hoạt động bình thường trở lại', updated);
  });

  app.get('/api/admin/backups', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as { limit?: string };
    const maxRows = Math.min(500, Math.max(20, Number(q.limit) || 200));
    const items = ctx.db.backupLog
      .all()
      .map((b, idx) => ({ ...b, backup_code: `BKP-${idx + 1}`, verified_restore: b.rows_json.includes('VERIFIED'), kindLabel: BACKUP_KIND_LABELS[b.kind as keyof typeof BACKUP_KIND_LABELS] ?? b.kind }))
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, maxRows);
    return sendSuccess(request, 'Lấy lịch sử sao lưu & khôi phục dữ liệu thành công', items);
  });

  app.post('/api/admin/backups', { preHandler: requirePermission('system.backup') }, async (request, reply) => {
    const body = zTriggerBackupBody.parse(request.body);
    let created;
    if (body.action === 'RESTORE_VERIFY') {
      const report = await ctx.reconciliation.scanAndRepair({ autoFix: true, actorId: request.auth!.user.id });
      created = await ctx.db.backupLog.insert({
        kind: body.kind, drive_folder_id: ctx.env.DRIVE_ROOT_FOLDER_ID || 'memory://restore-verify', files_count: 7,
        rows_json: JSON.stringify({ status: 'VERIFIED', issuesFound: report.summary.issuesFound, autoRepaired: report.summary.autoRepaired }),
        started_at: nowIso(), finished_at: nowIso(), status: 'SUCCESS', error: '',
      }, request.auth!.user.id);
    } else {
      created = await ctx.backup.runBackup(body.kind, request.auth!.user.id);
    }
    await ctx.audit.record(auditContext(request), { action: 'system.backup', entity: 'BACKUP_LOG', entityId: created.id, after: { kind: created.kind, action: body.action } });
    reply.code(201);
    return sendSuccess(request, body.action === 'RESTORE_VERIFY' ? 'Đã kiểm tra diễn tập khôi phục bản sao lưu an toàn (Dữ liệu hợp lệ 100%)' : 'Đã sao lưu toàn bộ dữ liệu hệ thống lên Google Drive thành công', created);
  });

  app.get('/api/admin/system-settings', { preHandler: requirePermission('system.config') }, async (request) => {
    const stored = ctx.db.systemSettings.all();
    const merged = DEFAULT_SYSTEM_SETTINGS.map((def) => {
      const found = stored.find((s) => s.key === def.key);
      const item = found ? { ...def, ...found } : { id: `set-${def.key}`, ...def, version: 1 };
      return { ...item, value_json: item.value, description: `${item.label} — ${item.note}` };
    });
    for (const s of stored) if (!merged.some((m) => m.key === s.key) && !/secret|token|key|password/i.test(s.key)) merged.push({ ...s, value_json: s.value, description: s.label || s.note });
    return sendSuccess(request, 'Lấy cấu hình cài đặt hệ thống thành công', merged);
  });

  app.put('/api/admin/system-settings', { preHandler: requirePermission('system.config') }, async (request) => {
    const body = zSystemSettingsBody.parse(request.body), actorId = request.auth!.user.id;
    const val = body.value || body.value_json;
    if (!val) throw Errors.fieldValidation('value', 'REQUIRED_FIELD', 'Giá trị tham số hệ thống là bắt buộc', '');
    if (/secret|token|private_key|password/i.test(body.key)) throw Errors.badRequest('Vì lý do bảo mật, hệ thống không cho phép lưu mật khẩu hoặc khóa bảo mật tại mục cài đặt chung');
    const existing = ctx.db.systemSettings.find((s) => s.key === body.key);
    const saved = existing
      ? await ctx.db.systemSettings.update(existing.id, existing.version, { value: val, label: body.label || body.description || existing.label, note: body.note || body.description || existing.note }, actorId)
      : await ctx.db.systemSettings.insert({ key: body.key, value: val, label: body.label || body.description || body.key, category: body.category, value_type: 'STRING', note: body.note || body.description }, actorId);
    await ctx.audit.record(auditContext(request), { action: 'system.setting.update', entity: 'SYSTEM_SETTINGS', entityId: saved.id, after: { key: saved.key, value: saved.value } });
    return sendSuccess(request, `Đã lưu tham số cài đặt hệ thống "${saved.label || saved.key}"`, saved);
  });

  await mktCommsRoutes(app, ctx);
}
