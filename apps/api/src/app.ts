import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { AppError, Errors } from './lib/errors.js';
import { buildErrorEnvelope, formatZodError } from './lib/response.js';
import { registerAuthContext } from './plugins/auth-context.js';
import { accountRoutes } from './routes/accounts.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { branchRoutes } from './routes/branches.routes.js';
import { employeeRoutes } from './routes/employees.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { internalRoutes } from './routes/internal.routes.js';
import { payrollRoutes } from './routes/payroll.routes.js';
import { scheduleRoutes } from './routes/schedules.routes.js';
import { leaveSwapRoutes } from './routes/leave-swap.routes.js';
import { attendanceRoutes } from './routes/attendance.routes.js';
import { myAttendanceRoutes } from './routes/my-attendance.routes.js';
import { recruitmentTestRoutes } from './routes/recruitment-test.routes.js';
import { systemCommsRoutes } from './routes/system-comms.routes.js';
import { notificationRoutes } from './routes/notifications.routes.js';
import { ticketRoutes } from './routes/tickets.routes.js';
import { registerSmtpRelayOrigin } from './services/smtp-sender.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  registerSmtpRelayOrigin(ctx.env.API_PUBLIC_ORIGIN);
  const isDev = ctx.env.NODE_ENV === 'development';
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => `req_${randomBytes(8).toString('hex')}`,
    logger:
      opts.logger === false
        ? false
        : {
            level: isDev ? 'debug' : 'info',
            redact: ['req.headers.cookie', 'req.headers["x-internal-token"]', 'res.headers["set-cookie"]'],
            transport: isDev ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } : undefined,
          },
  });

  // Hỗ trợ CORS cho mô hình triển khai Frontend trên Vercel + Backend trên Render
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const xfh = request.headers['x-forwarded-host'];
    const clientOrigin = request.headers['x-umbm-origin'];
    if (origin) registerSmtpRelayOrigin(origin);
    if (referer) registerSmtpRelayOrigin(referer);
    if (typeof clientOrigin === 'string' && clientOrigin) registerSmtpRelayOrigin(clientOrigin);
    if (typeof xfh === 'string' && xfh) registerSmtpRelayOrigin(`https://${xfh.split(',')[0]!.trim()}`);
    if (origin && (origin === ctx.env.API_PUBLIC_ORIGIN || origin.endsWith('.vercel.app') || isDev)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-umbm-client, x-umbm-origin, x-internal-token');
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
    if (request.url === '/' || request.url.startsWith('/api/health')) {
      return;
    }
    await ctx.db.waitReady();
  });

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  registerAuthContext(app, ctx.tokens, ctx.auth);

  app.addHook('preHandler', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.url.startsWith('/api/auth/') || request.url.startsWith('/api/internal/')) return;
    const mnt = ctx.db.maintenance.all()[0];
    if (mnt?.enabled && request.auth && request.auth.user.role !== 'ADMIN') {
      throw Errors.badRequest(mnt.message || 'Hệ thống đang trong chế độ bảo trì định kỳ, tạm thời khóa thao tác ghi dữ liệu mới.');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send(buildErrorEnvelope(request, error.code, error.message, error.details));
    }
    if (error instanceof ZodError) {
      const details = formatZodError(error, request);
      return reply
        .code(400)
        .send(buildErrorEnvelope(request, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không hợp lệ', details));
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    if (status === 429) {
      return reply
        .code(429)
        .send(buildErrorEnvelope(request, 'RATE_LIMITED', 'Quá nhiều yêu cầu trong thời gian ngắn, vui lòng thử lại sau'));
    }
    if (status < 500) {
      return reply
        .code(status)
        .send(buildErrorEnvelope(request, 'REQUEST_ERROR', err.message || 'Yêu cầu không hợp lệ'));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .code(500)
      .send(buildErrorEnvelope(request, 'INTERNAL_ERROR', 'Lỗi hệ thống nội bộ, vui lòng thử lại sau'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(buildErrorEnvelope(request, 'NOT_FOUND', 'Không tìm thấy đường dẫn API yêu cầu'));
  });

  await app.register(async (i) => healthRoutes(i, ctx));
  await app.register(async (i) => authRoutes(i, ctx));
  await app.register(async (i) => accountRoutes(i, ctx));
  await app.register(async (i) => employeeRoutes(i, ctx));
  await app.register(async (i) => branchRoutes(i, ctx));
  await app.register(async (i) => scheduleRoutes(i, ctx));
  await app.register(async (i) => leaveSwapRoutes(i, ctx));
  await app.register(async (i) => attendanceRoutes(i, ctx));
  await app.register(async (i) => myAttendanceRoutes(i, ctx));
  await app.register(async (i) => recruitmentTestRoutes(i, ctx));
  await app.register(async (i) => systemCommsRoutes(i, ctx));
  await app.register(async (i) => notificationRoutes(i, ctx));
  await app.register(async (i) => ticketRoutes(i, ctx));
  await app.register(async (i) => payrollRoutes(i, ctx));
  await app.register(async (i) => auditRoutes(i, ctx));
  await app.register(async (i) => internalRoutes(i, ctx));

  return app;
}
