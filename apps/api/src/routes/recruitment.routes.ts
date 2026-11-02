import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { recruitmentRsvpRoutes } from './recruitment-rsvp.routes.js';
import { recruitmentTestRoutes } from './recruitment-test.routes.js';

export { recruitmentRsvpRoutes, recruitmentTestRoutes };

export async function recruitmentRoutes(app: FastifyInstance, ctx: AppContext) {
  await recruitmentTestRoutes(app, ctx);
}
