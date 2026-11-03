import { z } from 'zod';
import { SYSTEM_CONFIG } from '@umbm/shared';
import type { AppContext } from '../context.js';

export const zTestBankBody = z.object({
  code: z.string().trim().min(2, 'Mã bộ đề tối thiểu 2 ký tự'),
  title: z.string().trim().min(3, 'Tên bộ đề tối thiểu 3 ký tự'),
  staff_group: z.string().default('BARISTA'),
  target_stage: z.enum(['PROBATION', 'OFFICIAL', 'ALL']).default('PROBATION'),
  duration_minutes: z.coerce.number().int().min(5).max(180).default(8),
  pass_percent: z.coerce.number().min(10).max(100).default(80),
  max_attempts: z.coerce.number().int().min(1).max(10).default(3),
  exam_sample_size: z.coerce.number().int().min(1).max(500).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']).default('APPROVED'),
  questions_json: z.string().default('[]'),
});

export const zUpdateTestBankBody = zTestBankBody.partial().extend({ version: z.coerce.number().int().min(1) });

export const zAssignTestBody = z.object({
  test_id: z.string().trim().min(1),
  employee_id: z.string().trim().optional(),
  employee_ids: z.array(z.string().trim()).optional(),
  max_attempts: z.coerce.number().int().min(1).max(20).optional(),
  exam_sample_size: z.coerce.number().int().min(1).max(500).optional(),
  due_at: z.string().trim().optional(),
  close_at: z.string().trim().optional(),
  note: z.string().trim().optional().default(''),
});

export const zUpdateAssignmentBody = z.object({
  version: z.coerce.number().int().min(1),
  test_id: z.string().trim().optional(),
  employee_id: z.string().trim().optional(),
  max_attempts: z.coerce.number().int().min(1).max(20).optional(),
  exam_sample_size: z.coerce.number().int().min(1).max(500).optional(),
  due_at: z.string().trim().optional(),
  close_at: z.string().trim().optional(),
  reset_attempts: z.boolean().optional(),
  note: z.string().trim().optional(),
});

export const zSubmitAttemptBody = z.object({
  version: z.coerce.number().int().min(1).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export const zDeleteVersionBody = z.object({
  version: z.coerce.number().int().min(1).optional(),
});

export interface RawQuestion {
  id: string;
  category?: string;
  q?: string;
  question?: string;
  options?: string[];
  answer?: number | string;
  correct?: string;
}

export const sampledQuestionsByAttemptId = new Map<string, RawQuestion[]>();

export function parseRawQuestions(rawJson?: string): RawQuestion[] {
  try {
    const arr = JSON.parse(rawJson || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function cleanQuestionText(raw?: string): string {
  return String(raw ?? '').replace(/^\[[A-Z0-9.-]+\]\s*/, '').replace(/\s*\(FULL_SHIFT\)/g, '').replace(/\s*\(ABSENT\)/g, '').trim();
}

export function sanitizeQuestionList(list: readonly RawQuestion[]) {
  return list.map((q, i) => ({
    id: q.id || `q${i + 1}`,
    category: q.category ?? 'SOP',
    q: cleanQuestionText(q.q ?? q.question),
    options: Array.isArray(q.options) ? q.options.map((o) => cleanQuestionText(o)) : [],
  }));
}

export function sanitizeQuestions(rawJson?: string) {
  return sanitizeQuestionList(parseRawQuestions(rawJson));
}

export function resolveBankSampleSize(t: { exam_sample_size?: number }, totalCount: number): number {
  const total = Math.max(1, totalCount);
  const raw = Number(t.exam_sample_size || 0);
  if (raw >= 1) return Math.min(total, raw);
  return total >= SYSTEM_CONFIG.defaults.testQuestionsPerExam ? SYSTEM_CONFIG.defaults.testQuestionsPerExam : total;
}

export function resolveAsgSampleSize(asg: { exam_sample_size?: number }, bankSampleSize: number, totalCount: number): number {
  const total = Math.max(1, totalCount);
  const raw = Number(asg.exam_sample_size || 0);
  return Math.max(1, Math.min(total, raw >= 1 ? raw : bankSampleSize));
}

export function recoverSampledQuestions(attemptId: string, answersJson: string | undefined, allQuestions: RawQuestion[]): RawQuestion[] {
  const cached = sampledQuestionsByAttemptId.get(attemptId);
  if (cached && cached.length > 0) return cached;
  try {
    const parsed = JSON.parse(answersJson || '{}') as { __sampled_ids?: string[] };
    if (Array.isArray(parsed.__sampled_ids) && parsed.__sampled_ids.length > 0) {
      const byId = new Map(allQuestions.map((q) => [q.id, q]));
      const recovered = parsed.__sampled_ids.map((qid) => byId.get(qid)).filter((q): q is RawQuestion => Boolean(q));
      if (recovered.length > 0) return recovered;
    }
  } catch { /* ignore */ }
  return allQuestions;
}

export function buildReviewItems(questions: readonly RawQuestion[], answersJson: string | undefined, revealCorrect: boolean) {
  let ansMap: Record<string, string | number> = {};
  try { ansMap = JSON.parse(answersJson || '{}'); } catch { ansMap = {}; }
  return questions.map((q, i) => {
    const expected = String(q.correct ?? q.answer ?? '0');
    const selected = ansMap[q.id] !== undefined ? String(ansMap[q.id]) : '';
    return {
      id: q.id || `q${i + 1}`,
      q: cleanQuestionText(q.q ?? q.question),
      options: Array.isArray(q.options) ? q.options.map((o) => cleanQuestionText(o)) : [],
      selectedAnswer: selected,
      isCorrect: selected !== '' && selected === expected,
      ...(revealCorrect ? { correctAnswer: expected } : {}),
    };
  });
}

export function resolveEmp(ctx: AppContext, rawId?: string) {
  return rawId ? (ctx.db.employees.get(rawId) ?? ctx.db.employees.find((e) => e.employee_code === rawId || e.user_id === rawId)) : undefined;
}

export function isSameEmployee(ctx: AppContext, user: { id: string; employee_id?: string; phone?: string } | undefined, targetEmpId: string): boolean {
  if (!user || !targetEmpId) return false;
  if (user.id === targetEmpId || user.employee_id === targetEmpId) return true;
  const callerEmp = resolveEmp(ctx, user.employee_id) ?? resolveEmp(ctx, user.id) ?? (user.phone ? ctx.db.employees.find((e) => e.phone === user.phone) : undefined);
  const targetEmp = resolveEmp(ctx, targetEmpId);
  return Boolean(
    (callerEmp && targetEmp && callerEmp.id === targetEmp.id)
    || (callerEmp && (callerEmp.id === targetEmpId || callerEmp.employee_code === targetEmpId))
    || (targetEmp && (targetEmp.user_id === user.id || (user.employee_id && (targetEmp.id === user.employee_id || targetEmp.employee_code === user.employee_id)))),
  );
}
