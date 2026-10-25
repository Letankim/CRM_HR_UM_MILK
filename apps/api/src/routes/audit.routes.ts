import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AUDIT_ACTION_LABELS,
  ROLE_LABELS,
  TABLE_DISPLAY_LABELS,
  zListQueryBase,
  type Role,
} from '@umbm/shared';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { paginateAndSort } from '../lib/list-query.js';
import { sendPaginated, sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { requirePermission } from '../plugins/auth-context.js';

const zAuditListQuery = zListQueryBase.extend({
  entity: z.string().max(64).optional(),
  actor_role: z.string().max(32).optional(),
  view: z.enum(['ACTIVE', 'ARCHIVED']).optional().default('ACTIVE'),
  refresh: z.enum(['0', '1', 'true', 'false']).optional(),
});

const zArchiveAuditBody = z.object({
  mode: z.enum(['SELECTED', 'ALL_ACTIVE', 'RESTORE']).default('SELECTED'),
  ids: z.array(z.string().min(1)).optional().default([]),
  reason: z.string().trim().max(300).optional().default('Lưu trữ định kỳ và làm trống danh sách phiên hiện hành'),
});

function safeParseJson(raw: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

export async function auditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    '/api/admin/audit-logs',
    { preHandler: requirePermission('system.audit.read') },
    async (request) => {
      const query = zAuditListQuery.parse(request.query);
      const auditStore = await ctx.db.audit();

      if (query.refresh === '1' || query.refresh === 'true') {
        await auditStore.refreshIfIdle();
      }

      const userMap = new Map(ctx.db.users.all(true).map((u) => [u.id, u]));
      const allRows = auditStore.all(true);
      const filteredByView =
        query.view === 'ARCHIVED'
          ? allRows.filter((r) => r.is_deleted)
          : allRows.filter((r) => !r.is_deleted);

      const mapped = filteredByView.map((row) => {
        const actor = userMap.get(row.actor_user_id);
        const roleLabel =
          ROLE_LABELS[row.actor_role as Role] ??
          (row.actor_role === 'SYSTEM' ? 'Hệ thống tự động' : 'Chưa xác định');

        return {
          id: row.id,
          version: row.version,
          isArchived: row.is_deleted,
          actorUserId: row.actor_user_id,
          actorUsername: actor?.username ?? (row.actor_user_id === 'seed' ? 'system' : row.actor_user_id),
          actorDisplayName: actor?.display_name ?? 'Hệ thống',
          actorRole: row.actor_role,
          actorRoleLabel: roleLabel,
          action: row.action,
          actionLabel: AUDIT_ACTION_LABELS[row.action] ?? row.action,
          entity: row.entity,
          entityLabel: TABLE_DISPLAY_LABELS[row.entity] ?? row.entity,
          entityId: row.entity_id,
          beforeData: safeParseJson(row.before_json),
          afterData: safeParseJson(row.after_json),
          ip: row.ip,
          requestId: row.request_id,
          created_at: row.created_at,
        };
      });

      const result = paginateAndSort(mapped, {
        page: query.page,
        perPage: query.per_page,
        sortBy: query.sort_by,
        sortOrder: query.sort_order,
        defaultSortBy: 'created_at',
        defaultSortOrder: 'desc',
        allowedSortFields: ['created_at', 'action', 'entity', 'actorUsername'],
        q: query.q,
        searchExtractor: (item) => [
          item.actorUsername,
          item.actorDisplayName,
          item.actionLabel,
          item.entityLabel,
          item.entityId,
          item.requestId,
        ],
        filters: {
          entity: query.entity,
          actor_role: query.actor_role,
        },
        filterPredicates: {
          actor_role: (item, val) => item.actorRole === val,
        },
      });

      return sendPaginated(request, 'Lấy nhật ký kiểm toán hệ thống thành công', result);
    },
  );

  app.post(
    '/api/admin/audit-logs/archive',
    { preHandler: requirePermission('system.audit.read', 'system.config') },
    async (request) => {
      const body = zArchiveAuditBody.parse(request.body ?? {});
      const auditStore = await ctx.db.audit();
      const actorId = request.auth!.user.id;
      const allRows = auditStore.all(true);

      const targets =
        body.mode === 'ALL_ACTIVE'
          ? allRows.filter((r) => !r.is_deleted)
          : body.mode === 'RESTORE'
            ? allRows.filter((r) => r.is_deleted && (body.ids.length === 0 || body.ids.includes(r.id)))
            : allRows.filter((r) => !r.is_deleted && body.ids.includes(r.id));

      if (targets.length === 0) {
        throw Errors.badRequest('Không có bản ghi kiểm toán nào phù hợp để thực hiện thao tác');
      }

      const nextDeletedState = body.mode !== 'RESTORE';
      for (const row of targets) {
        if (nextDeletedState) {
          await auditStore.softDelete(row.id, row.version, actorId);
        } else {
          await auditStore.restore(row.id, row.version, actorId);
        }
      }

      if (nextDeletedState) {
        const now = nowIso();
        await ctx.db.backupLog.insert(
          {
            kind: 'PRE_OPERATION',
            started_at: now,
            finished_at: now,
            status: 'SUCCESS',
            drive_folder_id: 'AUDIT_ARCHIVE',
            files_count: 1,
            rows_json: JSON.stringify({
              type: 'AUDIT_LOG_ARCHIVE',
              archived_count: targets.length,
              reason: body.reason,
              sample_ids: targets.slice(0, 10).map((t) => t.id),
            }),
            error: '',
          },
          actorId,
        );
      }

      return sendSuccess(
        request,
        body.mode === 'RESTORE'
          ? `Đã khôi phục ${targets.length} bản ghi kiểm toán về danh sách hiện hành`
          : `Đã lưu trữ an toàn vào Kho Lưu Trữ và làm trống ${targets.length} bản ghi kiểm toán`,
        { processedCount: targets.length, mode: body.mode },
      );
    },
  );

  app.delete(
    '/api/admin/audit-logs/:id',
    { preHandler: requirePermission('system.audit.read', 'system.config') },
    async (request) => {
      const { id } = request.params as { id: string };
      const auditStore = await ctx.db.audit();
      const target = auditStore.all(true).find((r) => r.id === id);
      if (!target) throw Errors.notFound('Bản ghi kiểm toán', id);
      const actorId = request.auth!.user.id;
      const now = nowIso();
      await auditStore.softDelete(id, target.version, actorId);
      await ctx.db.backupLog.insert(
        {
          kind: 'PRE_OPERATION',
          started_at: now,
          finished_at: now,
          status: 'SUCCESS',
          drive_folder_id: 'AUDIT_ARCHIVE',
          files_count: 1,
          rows_json: JSON.stringify({ type: 'AUDIT_LOG_SINGLE_ARCHIVE', archived_id: id, action: target.action }),
          error: '',
        },
        actorId,
      );
      return sendSuccess(request, 'Đã chuyển bản ghi kiểm toán vào Kho Lưu Trữ và làm trống khỏi danh sách hiện hành', { id });
    },
  );
}
