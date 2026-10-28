import { z } from 'zod';

const zSecret = z.string().min(32, 'Secret phải dài tối thiểu 32 ký tự');

const zEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** google = dữ liệu thật trên Google Sheets; memory = dữ liệu mẫu trong RAM để dev giao diện. */
  DATA_BACKEND: z.enum(['google', 'memory']).default('google'),
  PORT: z.coerce.number().int().optional(),
  API_PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.trim().replace(/\/+$/, '')),
  JWT_ACCESS_SECRET: zSecret,
  JWT_REFRESH_SECRET: zSecret,
  INTERNAL_API_TOKEN: zSecret,
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().default(''),

  SHEET_ID_CORE: z.string().default(''),
  SHEET_ID_HR: z.string().default(''),
  SHEET_ID_SCHEDULE: z.string().default(''),
  SHEET_ID_ATTENDANCE: z.string().default(''),
  SHEET_ID_PAYROLL: z.string().default(''),
  SHEET_ID_COMMS: z.string().default(''),
  SHEET_ID_SYSTEM: z.string().default(''),
  DRIVE_ROOT_FOLDER_ID: z.string().default(''),

  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  CACHE_REFRESH_SECONDS: z.coerce.number().int().min(10).default(45),

  EMAIL_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  EMAIL_FROM_NAME: z.string().default('Ụm Bò Milk HR'),
  EMAIL_FROM_ADDRESS: z.string().default('3do.service.veo@gmail.com'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  GMAIL_APP_PASSWORD: z.string().default('bxkkbhjedhpiidbd'),
});

export type Env = z.infer<typeof zEnv>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = zEnv.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('Production bắt buộc COOKIE_SECURE=true (HTTPS).');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DATA_BACKEND !== 'google') {
    throw new Error('Production bắt buộc DATA_BACKEND=google.');
  }
  if (parsed.data.PORT) {
    parsed.data.API_PORT = parsed.data.PORT;
  }
  return parsed.data;
}

export function sheetIds(env: Env) {
  return {
    CORE: env.SHEET_ID_CORE,
    HR: env.SHEET_ID_HR,
    SCHEDULE: env.SHEET_ID_SCHEDULE,
    ATTENDANCE: env.SHEET_ID_ATTENDANCE,
    PAYROLL: env.SHEET_ID_PAYROLL,
    COMMS: env.SHEET_ID_COMMS,
    SYSTEM: env.SHEET_ID_SYSTEM,
  } as const;
}
