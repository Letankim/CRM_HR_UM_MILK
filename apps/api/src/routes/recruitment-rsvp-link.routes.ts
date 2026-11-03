import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { auditContext, requirePermission } from '../plugins/auth-context.js';
import { ensureInterviewRsvpUrl } from '../services/zalo-hr.service.js';

/** Tạo lại link xác nhận phỏng vấn mới (link cũ hết hạn sau 7 ngày) và lưu vào lịch phỏng vấn. */
export async function recruitmentRsvpLinkRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/admin/interviews/:id/rsvp-link', { preHandler: requirePermission('interview.manage', 'candidate.manage') }, async (request) => {
    const { id } = request.params as { id: string }, iv = ctx.db.interviews.get(id);
    if (!iv) throw Errors.notFound('Lịch phỏng vấn', id);
    const cand = ctx.db.candidates.get(iv.candidate_id) ?? ctx.db.candidates.find((c) => c.candidate_code === iv.candidate_id);
    const rsvp = ensureInterviewRsvpUrl(ctx, iv.id, cand?.id ?? iv.candidate_id, iv.rsvp_token, { forceNew: true });
    await ctx.db.interviews.update(iv.id, iv.version, { rsvp_token: rsvp.token }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'interview.rsvp_link_renew', entity: 'INTERVIEWS', entityId: iv.id, after: { renewed: true } });
    return sendSuccess(request, 'Đã tạo link xác nhận phỏng vấn mới, hiệu lực 7 ngày', { interview_id: iv.id, rsvp_url: rsvp.url });
  });
}
