import { z } from 'zod';

const zSecret = z.string().min(32, 'Secret phải dài tối thiểu 32 ký tự');

const zEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** google = dữ liệu thật trên Google Sheets; memory = dữ liệu mẫu trong RAM để dev giao diện. */
  DATA_BACKEND: z.enum(['google', 'memory']).default('google'),
  /** Chuỗi kết nối PostgreSQL (URI hoặc Host=...;Port=...;Database=...;Username=...;Password=...). */
  DATABASE_URL: z.string().default(''),
  POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  POSTGRES_SYNC_INTERVAL_MS: z.coerce.number().int().min(100).default(1200),
  /** Dung lượng lưu trữ tối đa của gói PostgreSQL tính theo MB (mặc định 1024 MB = 1 GB Aiven Free). */
  POSTGRES_MAX_STORAGE_MB: z.coerce.number().int().min(64).default(1024),
  /** Mã khóa bảo mật mặc định để truy cập trang Giám sát Kỹ thuật (/dev-monitor), xác thực phía Backend. */
  DEV_MONITOR_KEY: z.string().trim().min(6, 'DEV_MONITOR_KEY phải dài tối thiểu 6 ký tự').default('umbm-dev-monitor-2026'),
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
