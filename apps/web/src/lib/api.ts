import type {
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  ListMeta,
  ValidationErrorDetail,
} from '@umbm/shared';
import { markSelfAction } from './notification-sound';

export const SESSION_STORAGE_FLAG = 'umbm_has_session';

export function markSessionActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) window.localStorage.setItem(SESSION_STORAGE_FLAG, '1');
    else window.localStorage.removeItem(SESSION_STORAGE_FLAG);
  } catch {
    // ignore storage errors
  }
}

export function hasSessionFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Lỗi gọi API phía Client, giữ nguyên danh sách lỗi từng trường (details)
 * để hiển thị trực tiếp dưới từng ô nhập liệu của Ant Design Form.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ValidationErrorDetail[] = [],
    public readonly requestId: string = '',
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

let refreshing: Promise<boolean> | null = null;
let redirectingToLogin = false;
const latestVersionByPath = new Map<string, number>();

export type VersionConflictPrompter = (latestVersion: number) => Promise<boolean>;
let versionConflictPrompter: VersionConflictPrompter | null = null;

export function setVersionConflictPrompter(prompter: VersionConflictPrompter | null): void {
  versionConflictPrompter = prompter;
}

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-umbm-client': 'web' },
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

function handleUnauthorizedRedirect(): void {
  markSessionActive(false);
  if (typeof window === 'undefined' || redirectingToLogin) return;
  const pathname = window.location.pathname;
  if (pathname === '/login' || pathname === '/nv/login') return;

  redirectingToLogin = true;
  void fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-umbm-client': 'web' },
  })
    .catch(() => undefined)
    .finally(() => {
      const isEmployee = pathname === '/nv' || pathname.startsWith('/nv/');
      const loginUrl = isEmployee ? '/nv/login' : '/login';
      const nextParam =
        pathname !== '/' && pathname !== '/nv' ? `?next=${encodeURIComponent(pathname)}` : '';
      window.location.replace(`${loginUrl}${nextParam}`);
    });
}

async function requestEnvelope<TData, TMeta = Record<string, unknown> | null>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
  versionRetryCount = 0,
): Promise<ApiSuccessEnvelope<TData, TMeta>> {
  let effectiveBody = body;
  if (
    effectiveBody &&
    typeof effectiveBody === 'object' &&
    !Array.isArray(effectiveBody) &&
    typeof (effectiveBody as Record<string, unknown>).version === 'number'
  ) {
    const knownVersion = latestVersionByPath.get(path);
    const currentVersion = (effectiveBody as Record<string, unknown>).version as number;
    if (knownVersion && knownVersion > currentVersion) {
      effectiveBody = { ...(effectiveBody as Record<string, unknown>), version: knownVersion };
    }
  }

  const isAuthEndpoint = path === '/auth/login' || path === '/auth/refresh' || path === '/auth/logout';
  const isUserMutation = method !== 'GET' && !isAuthEndpoint && !path.endsWith('/read') && !path.endsWith('/mark-all-read');
  if (isUserMutation) markSelfAction();

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'x-umbm-client': 'web',
      ...(typeof window !== 'undefined' ? { 'x-umbm-origin': window.location.origin } : {}),
      ...(effectiveBody === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: effectiveBody === undefined ? undefined : JSON.stringify(effectiveBody),
    cache: 'no-store',
  });
  if (isUserMutation) markSelfAction();

  if (res.status === 401 && !retried && !isAuthEndpoint) {
    if (await refreshSession()) return requestEnvelope<TData, TMeta>(method, path, effectiveBody, true, versionRetryCount);
  }

  const payload = (await res.json().catch(() => null)) as
    | ApiSuccessEnvelope<TData, TMeta>
    | ApiErrorEnvelope
    | null;

  if (!res.ok || !payload || payload.success === false) {
    const errPayload = payload as ApiErrorEnvelope | null;
    const code = errPayload?.errors?.code ?? 'HTTP_ERROR';
    const message = errPayload?.message ?? `Yêu cầu thất bại (Mã HTTP ${res.status})`;
    const details = errPayload?.errors?.details ?? [];
    const reqId = errPayload?.request_id ?? '';

    if (res.status === 401 && !isAuthEndpoint) {
      handleUnauthorizedRedirect();
    }

    if (
      res.status === 409 &&
      code === 'VERSION_CONFLICT' &&
      versionRetryCount < 2 &&
      effectiveBody &&
      typeof effectiveBody === 'object' &&
      !Array.isArray(effectiveBody) &&
      'version' in effectiveBody
    ) {
      const latestVersion = Number(details.find((d) => d.field === 'version')?.rejected_value);
      if (Number.isInteger(latestVersion) && latestVersion > 0) {
        latestVersionByPath.set(path, latestVersion);
        const shouldApply = versionConflictPrompter ? await versionConflictPrompter(latestVersion) : true;
        if (shouldApply) {
          const nextBody = { ...(effectiveBody as Record<string, unknown>), version: latestVersion };
          return requestEnvelope<TData, TMeta>(method, path, nextBody, retried, versionRetryCount + 1);
        }
        throw new ApiClientError(
          409,
          code,
          'Đã giữ nguyên nội dung bạn đang nhập trên biểu mẫu. Bấm Lưu lần nữa khi bạn sẵn sàng áp dụng.',
          [],
          reqId,
        );
      }
    }

    throw new ApiClientError(res.status, code, message, details, reqId);
  }

  latestVersionByPath.delete(path);
  redirectingToLogin = false;
  if (path === '/auth/me' || path === '/auth/login') {
    markSessionActive(true);
  }
  return payload;
}

export const api = {
  get: async <T>(path: string): Promise<T> => {
    const env = await requestEnvelope<T>('GET', path);
    return env.data;
  },
  list: async <TItem>(path: string): Promise<ApiSuccessEnvelope<TItem[], ListMeta>> => {
    return requestEnvelope<TItem[], ListMeta>('GET', path);
  },
  post: async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const env = await requestEnvelope<T>('POST', path, body ?? {});
    return env.data;
  },
  put: async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const env = await requestEnvelope<T>('PUT', path, body ?? {});
    return env.data;
  },
  del: async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const env = await requestEnvelope<T>('DELETE', path, body);
    return env.data;
  },
  delete: async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const env = await requestEnvelope<T>('DELETE', path, body);
    return env.data;
  },
};
