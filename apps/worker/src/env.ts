import { z } from 'zod';

const zEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, 'Thiếu GOOGLE_OAUTH_CLIENT_ID'),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, 'Thiếu GOOGLE_OAUTH_CLIENT_SECRET'),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().min(1, 'Thiếu GOOGLE_OAUTH_REFRESH_TOKEN'),
  DRIVE_ROOT_FOLDER_ID: z.string().min(1, 'Thiếu DRIVE_ROOT_FOLDER_ID'),
  API_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4000'),
  INTERNAL_API_TOKEN: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  BACKUP_DAILY_RETENTION: z.coerce.number().int().default(30),
  BACKUP_CRITICAL_RETENTION_DAYS: z.coerce.number().int().default(7),
  BACKUP_WEEKLY_RETENTION: z.coerce.number().int().default(12),
  BACKUP_MONTHLY_RETENTION: z.coerce.number().int().default(12),
});

export type WorkerEnv = z.infer<typeof zEnv>;

export function loadWorkerEnv(): WorkerEnv {
  const parsed = zEnv.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Cấu hình worker không hợp lệ:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}
