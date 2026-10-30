import type { Campaign, MediaAsset } from '@umbm/shared';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { parseMediaIds } from './comms-media-helper.js';

function toBoolFlag(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const norm = val.trim().toLowerCase();
    return norm === 'true' || norm === '1';
  }
  return false;
}

export function parseCascadeDeleteFlag(req: FastifyRequest): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  return (
    toBoolFlag(body.delete_related)
    || toBoolFlag(body.cascade_delete)
    || toBoolFlag(query.delete_related)
    || toBoolFlag(query.cascade_delete)
  );
}

export async function deleteAnnouncementNotifications(
  ctx: AppContext,
  announcementId: string,
  actorId: string,
): Promise<void> {
  const relatedNotifs = ctx.db.notifications.filter(
    (n) => (n.entity_type === 'ANNOUNCEMENTS' || n.entity_type === 'ANNOUNCEMENT') && n.entity_id === announcementId,
  );
  for (const n of relatedNotifs) {
    await ctx.db.notifications.softDelete(n.id, n.version, actorId);
  }
}

export async function deleteCampaignWithCascade(
  ctx: AppContext,
  campaign: Campaign,
  deleteRelated: boolean,
  actorId: string,
): Promise<{ id: string; deletedAnnouncementsCount: number; unlinkedAnnouncementsCount: number }> {
  await ctx.db.campaigns.softDelete(campaign.id, campaign.version, actorId);
  const relatedAncs = ctx.db.announcements.filter(
    (a) => a.campaign_id === campaign.id || (Boolean(campaign.code) && a.campaign_id === campaign.code),
  );
  let deletedAnnouncementsCount = 0;
  let unlinkedAnnouncementsCount = 0;

  for (const anc of relatedAncs) {
    if (deleteRelated) {
      await ctx.db.announcements.softDelete(anc.id, anc.version, actorId);
      await deleteAnnouncementNotifications(ctx, anc.id, actorId);
      deletedAnnouncementsCount++;
    } else {
      await ctx.db.announcements.update(anc.id, anc.version, { campaign_id: '' }, actorId);
      unlinkedAnnouncementsCount++;
    }
  }
  return { id: campaign.id, deletedAnnouncementsCount, unlinkedAnnouncementsCount };
}

export async function deleteMediaWithCascade(
  ctx: AppContext,
  media: MediaAsset,
  deleteRelated: boolean,
  actorId: string,
): Promise<{ id: string; deletedAnnouncementsCount: number; detachedAnnouncementsCount: number }> {
  await ctx.db.mediaAssets.softDelete(media.id, media.version, actorId);
  const isTargetRef = (ref: string) =>
    ref === media.id
    || (Boolean(media.code) && ref === media.code)
    || (Boolean(media.file_name) && ref === media.file_name);

  const referencingAncs = ctx.db.announcements.filter((a) => parseMediaIds(a.media_ids).some(isTargetRef));
  let deletedAnnouncementsCount = 0;
  let detachedAnnouncementsCount = 0;

  for (const anc of referencingAncs) {
    if (deleteRelated) {
      await ctx.db.announcements.softDelete(anc.id, anc.version, actorId);
      await deleteAnnouncementNotifications(ctx, anc.id, actorId);
      deletedAnnouncementsCount++;
    } else {
      const remainingIds = parseMediaIds(anc.media_ids).filter((ref) => !isTargetRef(ref));
      await ctx.db.announcements.update(anc.id, anc.version, { media_ids: JSON.stringify(remainingIds) }, actorId);
      detachedAnnouncementsCount++;
    }
  }
  return { id: media.id, deletedAnnouncementsCount, detachedAnnouncementsCount };
}
