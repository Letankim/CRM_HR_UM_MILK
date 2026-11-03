import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { ensureInterviewRsvpUrl } from '../services/zalo-hr.service.js';

const zRenewBody = z.object({
  interview_id: z.string().trim().optional(),
  candidate_id: z.string().trim().optional(),
});

/** Tạo lại link xác nhận phỏng vấn mới (hiệu lực 7 ngày) và mở khóa để ứng viên phản hồi lại. */
export async function recruitmentRsvpLinkRoutes(app: FastifyInstance, ctx: AppContext) {
  const renewHandler = async (request: FastifyRequest, rawIvId?: string) => {
    const body = zRenewBody.parse(request.body ?? {});
    const reqOrigin = String(request.headers['x-umbm-origin'] || request.headers.origin || '').trim();
    const ivId = rawIvId || body.interview_id || '';
    const candId = body.candidate_id || '';
    const cand = candId ? (ctx.db.candidates.get(candId) ?? ctx.db.candidates.find((c) => c.candidate_code === candId)) : undefined;
    const iv = (ivId ? ctx.db.interviews.get(ivId) : undefined)
      ?? (cand ? ctx.db.interviews.find((x) => (x.candidate_id === cand.id || x.candidate_id === cand.candidate_code) && x.status !== 'CANCELLED') : undefined);
    if (!iv && !cand) throw Errors.notFound('Lịch phỏng vấn hoặc ứng viên', ivId || candId);

    const effCandId = cand?.id ?? iv?.candidate_id ?? candId;
    const rsvp = ensureInterviewRsvpUrl(ctx, iv?.id ?? '', effCandId, iv?.rsvp_token, { forceNew: true, originOverride: reqOrigin });
    if (iv) {
      await ctx.db.interviews.update(iv.id, iv.version, {
        rsvp_token: rsvp.token,
        ...(iv.status === 'RESCHEDULE_NEEDED' ? { status: 'SCHEDULED', reschedule_requested: false } : {}),
      }, request.auth!.user.id);
      await ctx.audit.record(auditContext(request), { action: 'interview.rsvp_link_renew', entity: 'INTERVIEWS', entityId: iv.id, after: { renewed: true } });
    }
    return sendSuccess(request, 'Đã tạo link xác nhận phỏng vấn mới, hiệu lực 7 ngày', {
      interview_id: iv?.id ?? '',
      candidate_id: effCandId,
      rsvp_token: rsvp.token,
      rsvp_url: rsvp.url,
    });
  };

  app.post('/api/admin/interviews/:id/rsvp-link', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    return renewHandler(request, id);
  });

  app.post('/api/admin/recruitment/rsvp-link', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    return renewHandler(request);
  });
}
