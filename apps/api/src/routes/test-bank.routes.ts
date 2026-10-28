import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { Errors } from '../lib/errors.js';
import { sendSuccess } from '../lib/response.js';
import { nowIso } from '../lib/time.js';
import { auditContext, requireAuth, requirePermission } from '../plugins/auth-context.js';
import { queueTestAssignedEmail } from '../services/action-email-dispatcher.js';
import { resolveStaffGroupLabel } from './employee-mapper.js';

const DEFAULT_SOP_QUESTIONS = JSON.stringify([
  { id: 'q1', q: 'Nhiệt độ bảo quản sữa tươi thanh trùng chuẩn tại quầy pha chế Ụm Bò Milk là bao nhiêu?', options: ['Từ 2°C đến 6°C', 'Từ 10°C đến 15°C', 'Nhiệt độ phòng 25°C', 'Dưới -5°C'], answer: 0 },
  { id: 'q2', q: 'Thời hạn đăng ký lịch nghỉ phép OFF định kỳ trước khi tuần mới bắt đầu là khi nào?', options: ['Trước tối thiểu 2 ngày (T-2)', 'Báo ngay trong ca làm', 'Sau khi kết thúc ca', 'Không cần đăng ký'], answer: 0 },
  { id: 'q3', q: 'Khi điểm danh vào ca trên Cổng Nhân Viên, quy định bắt buộc về vị trí và hình ảnh là gì?', options: ['Đứng trong bán kính GPS cho phép của cửa hàng và chụp ảnh trực tiếp từ Camera', 'Tải ảnh có sẵn từ thư viện điện thoại ở bất kỳ đâu', 'Nhờ đồng nghiệp điểm danh hộ bằng mã PIN', 'Chỉ cần bật Wi-Fi tại nhà'], answer: 0 },
]);

const zTestBankBody = z.object({
  code: z.string().trim().min(2, 'Mã bộ đề tối thiểu 2 ký tự'), title: z.string().trim().min(3, 'Tên bộ đề tối thiểu 3 ký tự'),
  staff_group: z.string().default('BARISTA'), target_stage: z.enum(['PROBATION', 'OFFICIAL', 'ALL']).default('PROBATION'),
  duration_minutes: z.coerce.number().int().min(5).max(180).default(15), pass_percent: z.coerce.number().min(10).max(100).default(80),
  max_attempts: z.coerce.number().int().min(1).max(10).default(3), status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']).default('APPROVED'), questions_json: z.string().default('[]'),
});
const zUpdateTestBankBody = zTestBankBody.partial().extend({ version: z.coerce.number().int().min(1) });
const zAssignTestBody = z.object({ test_id: z.string().trim().min(1), employee_id: z.string().trim().optional(), employee_ids: z.array(z.string().trim()).optional(), max_attempts: z.coerce.number().int().min(1).max(20).optional(), due_at: z.string().trim().optional(), close_at: z.string().trim().optional(), note: z.string().trim().optional().default('') });
const zUpdateAssignmentBody = z.object({ version: z.coerce.number().int().min(1), test_id: z.string().trim().optional(), employee_id: z.string().trim().optional(), max_attempts: z.coerce.number().int().min(1).max(20).optional(), due_at: z.string().trim().optional(), close_at: z.string().trim().optional(), reset_attempts: z.boolean().optional(), note: z.string().trim().optional() });
const zSubmitAttemptBody = z.object({ version: z.coerce.number().int().min(1), answers: z.record(z.string(), z.union([z.string(), z.number()])).default({}) });
const zDeleteVersionBody = z.object({ version: z.coerce.number().int().min(1).optional() });

interface RawQuestion { id: string; q?: string; question?: string; options?: string[]; answer?: number | string; correct?: string }
function parseRawQuestions(rawJson?: string): RawQuestion[] { try { const arr = JSON.parse(rawJson || '[]'); return Array.isArray(arr) ? arr : []; } catch { return []; } }
function sanitizeQuestions(rawJson?: string) { return parseRawQuestions(rawJson).map((q, i) => ({ id: q.id || `q${i + 1}`, q: q.q ?? q.question ?? '', options: Array.isArray(q.options) ? q.options : [] })); }
function buildReviewItems(rawJson: string | undefined, answersJson: string | undefined, revealCorrect: boolean) {
  let ansMap: Record<string, string | number> = {};
  try { ansMap = JSON.parse(answersJson || '{}'); } catch { ansMap = {}; }
  return parseRawQuestions(rawJson).map((q, i) => {
    const expected = String(q.correct ?? q.answer ?? '0');
    const selected = ansMap[q.id] !== undefined ? String(ansMap[q.id]) : '';
    return { id: q.id || `q${i + 1}`, q: q.q ?? q.question ?? '', options: Array.isArray(q.options) ? q.options : [], selectedAnswer: selected, isCorrect: selected !== '' && selected === expected, ...(revealCorrect ? { correctAnswer: expected } : {}) };
  });
}

function resolveEmp(ctx: AppContext, rawId?: string) { return rawId ? (ctx.db.employees.get(rawId) ?? ctx.db.employees.find((e) => e.employee_code === rawId || e.user_id === rawId)) : undefined; }
function isSameEmployee(ctx: AppContext, user: { id: string; employee_id?: string; phone?: string } | undefined, targetEmpId: string): boolean {
  if (!user || !targetEmpId) return false;
  if (user.id === targetEmpId || user.employee_id === targetEmpId) return true;
  const callerEmp = resolveEmp(ctx, user.employee_id) ?? resolveEmp(ctx, user.id) ?? (user.phone ? ctx.db.employees.find((e) => e.phone === user.phone) : undefined);
  const targetEmp = resolveEmp(ctx, targetEmpId);
  return Boolean((callerEmp && targetEmp && callerEmp.id === targetEmp.id) || (callerEmp && (callerEmp.id === targetEmpId || callerEmp.employee_code === targetEmpId)) || (targetEmp && (targetEmp.user_id === user.id || (user.employee_id && (targetEmp.id === user.employee_id || targetEmp.employee_code === user.employee_id)))));
}

export async function testBankRoutes(app: FastifyInstance, ctx: AppContext) {
  const ensureDefaultTestBank = async (actorId: string) => {
    if (ctx.db.testBank.all(true).length > 0) return;
    await ctx.db.testBank.insert({ code: 'SOP-BARISTA-01', title: 'Quy chuẩn Pha chế, Bảo quản Sữa tươi & Nội quy Chấm công GPS', staff_group: 'BARISTA', target_stage: 'PROBATION', duration_minutes: 15, pass_percent: 80, total_questions: 3, max_attempts: 3, questions_json: DEFAULT_SOP_QUESTIONS, status: 'APPROVED', approved_by: actorId, approved_at: nowIso() }, actorId);
  };
  app.get('/api/admin/tests/bank', { preHandler: requirePermission('employee.read', 'system.config', 'test.manage', 'self.test') }, async (request) => {
    const q = (request.query ?? {}) as { include_answers?: string; refresh?: string };
    if (q.refresh === '1') await Promise.all([ctx.db.testBank.refreshIfIdle(), ctx.db.testAssignments.refreshIfIdle(), ctx.db.testAttempts.refreshIfIdle()]);
    await ensureDefaultTestBank(request.auth?.user.id ?? 'system');
    const perms = request.auth?.permissions, canManage = Boolean(perms?.has('test.manage')), includeAnswers = canManage && q.include_answers === '1';
    const tests = ctx.db.testBank.all().reverse().map((t) => {
      const safeList = sanitizeQuestions(t.questions_json);
      return { ...t, questions_json: includeAnswers ? t.questions_json : JSON.stringify(safeList), duration_min: t.duration_minutes, questionsCount: safeList.length || t.total_questions, staffGroupLabel: resolveStaffGroupLabel(ctx, t.staff_group, t.staff_group) };
    });
    const assignments = ctx.db.testAssignments.all().map((a, idx) => {
      const test = ctx.db.testBank.get(a.test_id), emp = resolveEmp(ctx, a.employee_id);
      return { ...a, assignment_code: `TEST-ASG-${idx + 1}`, testTitle: test?.title ?? a.test_id, testCode: test?.code ?? '', durationMinutes: test?.duration_minutes ?? 15, passPercent: test?.pass_percent ?? 80, employeeName: emp?.full_name ?? a.employee_id, employeeCode: emp?.employee_code ?? '', isMine: isSameEmployee(ctx, request.auth?.user, a.employee_id) };
    }).reverse();
    const attempts = ctx.db.testAttempts.all().filter((att) => Boolean(att.submitted_at)).reverse().map((att) => {
      const test = ctx.db.testBank.get(att.test_id), emp = resolveEmp(ctx, att.employee_id), asg = ctx.db.testAssignments.get(att.assignment_id);
      const revealCorrect = Boolean(canManage || asg?.passed || (asg && asg.attempts_used >= asg.max_attempts));
      return { ...att, testTitle: test?.title ?? att.test_id, testCode: test?.code ?? '', passPercent: test?.pass_percent ?? 80, employeeName: emp?.full_name ?? att.employee_id, employeeCode: emp?.employee_code ?? '', isMine: isSameEmployee(ctx, request.auth?.user, att.employee_id), reviewItems: buildReviewItems(test?.questions_json, att.answers_json, revealCorrect) };
    });
    return sendSuccess(request, 'Lấy ngân hàng đề thi, đợt giao bài và kết quả bài làm thành công', { tests, assignments, attempts });
  });

  app.post('/api/admin/tests/bank', { preHandler: requirePermission('test.manage') }, async (request, reply) => {
    const body = zTestBankBody.parse(request.body);
    if (ctx.db.testBank.find((t) => t.code.toUpperCase() === body.code.toUpperCase())) throw Errors.fieldValidation('code', 'DUPLICATE_VALUE', 'Mã bộ đề kiểm tra đã tồn tại', body.code);
    const created = await ctx.db.testBank.insert({ ...body, code: body.code.toUpperCase(), total_questions: Math.max(1, parseRawQuestions(body.questions_json).length), approved_by: request.auth!.user.id, approved_at: nowIso() }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'test_bank.create', entity: 'TEST_BANK', entityId: created.id, after: { code: created.code, title: created.title } });
    reply.code(201);
    return sendSuccess(request, 'Đã tạo bộ đề kiểm tra nghiệp vụ mới thành công', created);
  });

  app.put('/api/admin/tests/bank/:id', { preHandler: requirePermission('test.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateTestBankBody.parse(request.body);
    const before = ctx.db.testBank.get(id);
    if (!before) throw Errors.notFound('Bộ đề kiểm tra', id);
    const questionsJson = body.questions_json ?? before.questions_json;
    const updated = await ctx.db.testBank.update(id, body.version, { code: body.code ? body.code.toUpperCase() : before.code, title: body.title ?? before.title, staff_group: body.staff_group ?? before.staff_group, target_stage: body.target_stage ?? before.target_stage, duration_minutes: body.duration_minutes ?? before.duration_minutes, pass_percent: body.pass_percent ?? before.pass_percent, max_attempts: body.max_attempts ?? before.max_attempts, status: body.status ?? before.status, questions_json: questionsJson, total_questions: Math.max(1, parseRawQuestions(questionsJson).length) }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'test_bank.update', entity: 'TEST_BANK', entityId: id, before: { title: before.title, status: before.status }, after: { title: updated.title, status: updated.status } });
    return sendSuccess(request, 'Đã cập nhật bộ đề kiểm tra thành công', updated);
  });

  app.delete('/api/admin/tests/bank/:id', { preHandler: requirePermission('test.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteVersionBody.parse(request.body ?? {});
    const before = ctx.db.testBank.get(id);
    if (!before) throw Errors.notFound('Bộ đề kiểm tra', id);
    await ctx.db.testBank.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'test_bank.delete', entity: 'TEST_BANK', entityId: id, before: { code: before.code, title: before.title } });
    return sendSuccess(request, 'Đã xóa bộ đề kiểm tra khỏi ngân hàng đề', { id });
  });

  app.post('/api/admin/tests/assignments', { preHandler: requirePermission('test.manage') }, async (request, reply) => {
    const body = zAssignTestBody.parse(request.body);
    const test = ctx.db.testBank.get(body.test_id) ?? ctx.db.testBank.find((t) => t.code === body.test_id);
    if (!test) throw Errors.notFound('Đề kiểm tra', body.test_id);
    if (test.status && test.status !== 'APPROVED') throw Errors.badRequest('Chỉ được phép giao bộ đề kiểm tra đã được phê duyệt (APPROVED)');
    const empIds = body.employee_ids?.length ? body.employee_ids : body.employee_id ? [body.employee_id] : [];
    if (empIds.length === 0) throw Errors.fieldValidation('employee_id', 'REQUIRED_FIELD', 'Vui lòng chọn ít nhất 1 nhân sự nhận đề', '');
    const resolvedEmps = empIds.map((rawEmpId) => {
      const emp = ctx.db.employees.get(rawEmpId) ?? ctx.db.employees.find((e) => e.employee_code === rawEmpId);
      if (!emp) throw Errors.notFound('Nhân sự', rawEmpId);
      return emp;
    });
    const now = nowIso(), closeAt = body.close_at || body.due_at || '2026-11-30T23:59:59+07:00', actorId = request.auth!.user.id;
    const createdList = await Promise.all(resolvedEmps.map((emp) => ctx.db.testAssignments.insert({ test_id: test.id, employee_id: emp.id, branch_id: emp.branch_id, open_at: now, close_at: closeAt, assigned_by: actorId, status: 'ASSIGNED', max_attempts: body.max_attempts ?? test.max_attempts, attempts_used: 0, best_score_percent: 0, passed: false, note: body.note ?? '' }, actorId)));
    createdList.forEach((created, i) => queueTestAssignedEmail(ctx, { empId: resolvedEmps[i]!.id, testTitle: test.title, durationMinutes: test.duration_minutes, passScore: test.pass_percent, code: `ASG-${created.id.slice(0, 6)}` }));
    return reply.code(201), sendSuccess(request, `Đã giao bài kiểm tra nghiệp vụ cho ${empIds.length} nhân sự thành công`, createdList[0] ?? null);
  });

  app.put('/api/admin/tests/assignments/:id', { preHandler: requirePermission('test.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zUpdateAssignmentBody.parse(request.body);
    const before = ctx.db.testAssignments.get(id);
    if (!before) throw Errors.notFound('Đợt giao bài kiểm tra', id);
    const nextTestId = body.test_id ?? before.test_id;
    const nextEmpId = body.employee_id ?? before.employee_id;
    const emp = ctx.db.employees.get(nextEmpId) ?? ctx.db.employees.find((e) => e.employee_code === nextEmpId);
    const nextCloseAt = body.close_at || body.due_at || before.close_at;
    const nextMaxAttempts = body.max_attempts ?? before.max_attempts;
    const nextAttemptsUsed = body.reset_attempts ? 0 : before.attempts_used;
    const nextStatus = before.passed ? 'PASSED' : nextAttemptsUsed === 0 ? 'ASSIGNED' : nextAttemptsUsed < nextMaxAttempts ? 'IN_PROGRESS' : 'FAILED';
    const updated = await ctx.db.testAssignments.update(id, body.version, { test_id: nextTestId, employee_id: emp?.id ?? nextEmpId, branch_id: emp?.branch_id ?? before.branch_id, max_attempts: nextMaxAttempts, close_at: nextCloseAt, attempts_used: nextAttemptsUsed, status: nextStatus, note: body.note ?? before.note }, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'test_assignment.update', entity: 'TEST_ASSIGNMENTS', entityId: id, before: { max_attempts: before.max_attempts, close_at: before.close_at }, after: { max_attempts: updated.max_attempts, close_at: updated.close_at } });
    return sendSuccess(request, 'Đã cập nhật đợt giao bài kiểm tra thành công', updated);
  });

  app.delete('/api/admin/tests/assignments/:id', { preHandler: requirePermission('test.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteVersionBody.parse(request.body ?? {});
    const before = ctx.db.testAssignments.get(id);
    if (!before) throw Errors.notFound('Đợt giao bài kiểm tra', id);
    await ctx.db.testAssignments.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    await ctx.audit.record(auditContext(request), { action: 'test_assignment.delete', entity: 'TEST_ASSIGNMENTS', entityId: id, before: { test_id: before.test_id, employee_id: before.employee_id } });
    return sendSuccess(request, 'Đã thu hồi đợt giao bài kiểm tra', { id });
  });

  app.delete('/api/admin/tests/attempts/:id', { preHandler: requirePermission('test.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zDeleteVersionBody.parse(request.body ?? {});
    const before = ctx.db.testAttempts.get(id);
    if (!before) throw Errors.notFound('Phiên làm bài kiểm tra', id);
    await ctx.db.testAttempts.softDelete(id, body.version ?? before.version, request.auth!.user.id);
    const asg = ctx.db.testAssignments.get(before.assignment_id);
    if (asg) {
      const rem = ctx.db.testAttempts.all().filter((a) => a.assignment_id === asg.id && Boolean(a.submitted_at));
      const used = rem.length, best = rem.reduce((m, a) => Math.max(m, a.score_percent), 0), isPassed = rem.some((a) => a.passed);
      await ctx.db.testAssignments.update(asg.id, asg.version, { attempts_used: used, best_score_percent: best, passed: isPassed, status: isPassed ? 'PASSED' : used === 0 ? 'ASSIGNED' : used >= asg.max_attempts ? 'FAILED' : 'IN_PROGRESS' }, request.auth!.user.id);
    }
    await ctx.audit.record(auditContext(request), { action: 'test_attempt.delete', entity: 'TEST_ATTEMPTS', entityId: id, before: { assignment_id: before.assignment_id, employee_id: before.employee_id, score_percent: before.score_percent } });
    return sendSuccess(request, 'Đã xóa phiên làm bài kiểm tra thành công', { id });
  });

  app.post('/api/tests/assignments/:id/start', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const asg = ctx.db.testAssignments.get(id) ?? ctx.db.testAssignments.all()[0];
    if (!asg) throw Errors.notFound('Đợt giao bài kiểm tra', id);
    const canManage = Boolean(request.auth?.permissions?.has('test.manage'));
    if (!canManage && !isSameEmployee(ctx, request.auth?.user, asg.employee_id)) throw Errors.forbidden('Chỉ nhân sự được giao bài kiểm tra này mới có quyền bắt đầu làm bài');
    if (asg.attempts_used >= asg.max_attempts) throw Errors.badRequest(`Bạn đã sử dụng hết số lần thi tối đa (${asg.max_attempts} lần) cho bài kiểm tra này`);
    if (asg.close_at && Date.now() > new Date(asg.close_at).getTime()) throw Errors.badRequest('Đợt giao bài kiểm tra này đã quá hạn nộp bài');
    const test = ctx.db.testBank.get(asg.test_id) ?? ctx.db.testBank.all()[0];
    if (!test) throw Errors.notFound('Đề kiểm tra', asg.test_id);
    if (test.status && test.status !== 'APPROVED') throw Errors.badRequest('Bộ đề kiểm tra này chưa được phê duyệt nên chưa thể bắt đầu làm bài');
    const startedMs = Date.now(), expiresMs = startedMs + test.duration_minutes * 60 * 1000;
    const attempt = await ctx.db.testAttempts.insert({ test_id: test.id, assignment_id: asg.id, employee_id: asg.employee_id, attempt_no: asg.attempts_used + 1, started_at: new Date(startedMs).toISOString(), expires_at: new Date(expiresMs).toISOString(), submitted_at: '', duration_seconds: 0, answers_json: '{}', correct_count: 0, total_questions: test.total_questions, score_percent: 0, passed: false, auto_submitted: false, client_ip: request.ip ?? '127.0.0.1' }, request.auth!.user.id);
    return reply.code(201), sendSuccess(request, 'Đã bắt đầu tính giờ làm bài trên máy chủ (Server-side Timer)', { ...attempt, testTitle: test.title, testCode: test.code, durationMinutes: test.duration_minutes, passPercent: test.pass_percent, questions: sanitizeQuestions(test.questions_json) });
  });

  app.post('/api/tests/attempts/:id/submit', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    const body = zSubmitAttemptBody.parse(request.body);
    const attempt = ctx.db.testAttempts.get(id);
    if (!attempt) throw Errors.notFound('Lượt làm bài thi', id);
    if (attempt.submitted_at) throw Errors.badRequest('Bài làm này đã được nộp trước đó');
    const test = ctx.db.testBank.get(attempt.test_id);
    if (!test) throw Errors.notFound('Đề kiểm tra', attempt.test_id);
    const nowMs = Date.now();
    const isExpired = nowMs > new Date(attempt.expires_at).getTime() + 5_000;
    const questions = parseRawQuestions(test.questions_json);
    const totalQ = questions.length || 1;
    let correct = 0;
    for (const q of questions) if (body.answers[q.id] !== undefined && String(body.answers[q.id]) === String(q.correct ?? q.answer ?? '0')) correct++;
    const scorePercent = Math.round((correct / totalQ) * 100);
    const passed = scorePercent >= test.pass_percent;
    const durationSec = Math.max(1, Math.round((nowMs - new Date(attempt.started_at).getTime()) / 1000));
    const answersStr = JSON.stringify(body.answers);
    const updated = await ctx.db.testAttempts.update(id, body.version, {
      submitted_at: new Date(nowMs).toISOString(), duration_seconds: durationSec, answers_json: answersStr,
      correct_count: correct, total_questions: totalQ, score_percent: scorePercent, passed, auto_submitted: isExpired,
    }, request.auth!.user.id);
    const asg = ctx.db.testAssignments.get(attempt.assignment_id);
    let revealCorrect = passed;
    if (asg) {
      const used = asg.attempts_used + 1;
      const isPassed = asg.passed || passed;
      revealCorrect = isPassed || used >= asg.max_attempts;
      await ctx.db.testAssignments.update(asg.id, asg.version, { attempts_used: used, best_score_percent: Math.max(asg.best_score_percent, scorePercent), passed: isPassed, status: isPassed ? 'PASSED' : used >= asg.max_attempts ? 'FAILED' : 'IN_PROGRESS' }, request.auth!.user.id);
    }
    return sendSuccess(request, isExpired ? 'Đã quá hạn đồng hồ máy chủ — hệ thống tự động thu bài và chấm điểm' : passed ? 'Nộp bài thành công: Chúc mừng bạn đã ĐẠT bài kiểm tra' : 'Đã nộp bài kiểm tra: Chưa đạt điểm chuẩn, vui lòng ôn tập lại', {
      ...updated, testTitle: test.title, testCode: test.code, passPercent: test.pass_percent, reviewItems: buildReviewItems(test.questions_json, answersStr, revealCorrect),
    });
  });
}
