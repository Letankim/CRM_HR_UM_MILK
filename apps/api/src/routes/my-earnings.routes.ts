import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { dayjs } from '../lib/time.js';
import { requireAuth } from '../plugins/auth-context.js';
import { buildMyEarningsSummary } from '../services/my-earnings.service.js';
import { getVnNowDateAndHm } from '../services/shift-absent-scanner.js';
import { ensurePersonalProfile } from './my-attendance.routes.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateIsoDateField(field: 'from_date' | 'to_date', raw: string): string {
  const trimmed = raw.trim();
  if (!DATE_RE.test(trimmed) || dayjs(trimmed).format('YYYY-MM-DD') !== trimmed) {
    throw Errors.fieldValidation(
      field,
      'INVALID_FORMAT',
      field === 'from_date' ? 'Ngày bắt đầu không đúng định dạng hợp lệ (YYYY-MM-DD)' : 'Ngày kết thúc không đúng định dạng hợp lệ (YYYY-MM-DD)',
      raw,
    );
  }
  return trimmed;
}

export async function myEarningsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/me/earnings', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const { todayStr } = getVnNowDateAndHm();
    const defaultFrom = dayjs(todayStr).startOf('month').format('YYYY-MM-DD');
    const defaultTo = dayjs(todayStr).endOf('month').format('YYYY-MM-DD');

    const fromDate = typeof q.from_date === 'string' && q.from_date.trim()
      ? validateIsoDateField('from_date', q.from_date)
      : defaultFrom;
    const toDate = typeof q.to_date === 'string' && q.to_date.trim()
      ? validateIsoDateField('to_date', q.to_date)
      : defaultTo;

    if (fromDate > toDate) {
      throw Errors.fieldValidation('to_date', 'OUT_OF_RANGE', 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu', q.to_date ?? toDate);
    }
    const spanDays = dayjs(toDate).diff(dayjs(fromDate), 'day') + 1;
    if (spanDays > 370) {
      throw Errors.fieldValidation('to_date', 'OUT_OF_RANGE', 'Khoảng thời gian lọc tối đa không vượt quá 370 ngày', q.to_date ?? toDate);
    }

    if (q.refresh === '1' || q.refresh === 'true') {
      await Promise.all([
        ...ctx.db.monthlyStores().map((m) => m.store.refreshIfIdle(0)),
        ctx.db.employees.refreshIfIdle(0),
        ctx.db.payRates.refreshIfIdle(0),
        ctx.db.payrollItems.refreshIfIdle(0),
        ctx.db.payPeriods.refreshIfIdle(0),
        ctx.db.payrollSnapshots.refreshIfIdle(0),
      ]);
    }

    const user = request.auth!.user;
    const emp = await ensurePersonalProfile(ctx, user);
    const summary = await buildMyEarningsSummary(ctx, emp, fromDate, toDate, user.id);
    return sendSuccess(request, 'Lấy thống kê ca đã làm và thu nhập hiện tại thành công', summary);
  });
}
