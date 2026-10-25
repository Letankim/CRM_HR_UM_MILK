'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { isEmployeeRole, type Permission, type PublicUser } from '@umbm/shared';
import { api, ApiClientError, markSessionActive } from './api';

export type AppKind = 'backoffice' | 'employee';

export const loginPath = (app: AppKind) => (app === 'employee' ? '/nv/login' : '/login');

export function canAccessPath(user: PublicUser, pathname: string, section?: string | null): boolean {
  const [cleanPath, queryStr] = pathname.split('?');
  const effectiveSection = section ?? (queryStr ? new URLSearchParams(queryStr).get('section') : null);
  const path = cleanPath || pathname;

  if (path === '/nv' || path.startsWith('/nv/')) {
    return isEmployeeRole(user.role);
  }
  if (isEmployeeRole(user.role)) return false;

  if (path.startsWith('/admin/employees')) {
    if (effectiveSection === 'recruitment') {
      return user.permissions.includes('candidate.manage') || user.permissions.includes('interview.manage');
    }
    if (effectiveSection === 'tests') {
      return user.permissions.includes('test.manage') || user.permissions.includes('system.config');
    }
    return user.permissions.includes('employee.read');
  }
  if (path.startsWith('/admin/accounts')) {
    return user.permissions.includes('account.read');
  }
  if (path.startsWith('/admin/schedules')) {
    return user.permissions.includes('schedule.read');
  }
  if (path.startsWith('/admin/payroll')) {
    return user.permissions.includes('payroll.read') || user.permissions.includes('system.config');
  }
  if (path.startsWith('/admin/branches')) {
    return user.permissions.includes('system.config') || user.permissions.includes('employee.manage');
  }
  if (path.startsWith('/admin/audit-logs')) {
    return user.permissions.includes('system.audit.read');
  }
  if (path.startsWith('/admin/integrations')) {
    if (effectiveSection === 'governance' || effectiveSection === 'comms') {
      return (
        user.permissions.includes('integration.read') ||
        user.permissions.includes('comms.manage') ||
        user.permissions.includes('notification.send') ||
        user.permissions.includes('employee.read') ||
        user.permissions.includes('schedule.read') ||
        user.permissions.includes('payroll.read')
      );
    }
    return user.permissions.includes('integration.read');
  }
  return true;
}

export function resolveLandingRoute(
  user: PublicUser,
  app: AppKind,
  nextParam?: string | null,
): string {
  if (app === 'employee' || isEmployeeRole(user.role)) {
    if (
      nextParam &&
      nextParam.startsWith('/nv') &&
      !nextParam.startsWith('/nv/login') &&
      !nextParam.startsWith('//')
    ) {
      return nextParam;
    }
    return '/nv';
  }

  if (
    nextParam &&
    nextParam.startsWith('/') &&
    !nextParam.startsWith('//') &&
    nextParam !== '/' &&
    !nextParam.startsWith('/login') &&
    !nextParam.startsWith('/nv') &&
    canAccessPath(user, nextParam)
  ) {
    return nextParam;
  }

  if (user.role === 'MKT') {
    return '/admin/integrations?section=comms';
  }
  if (user.role === 'HR') {
    return user.permissions.includes('employee.read') ? '/admin/employees' : '/admin/accounts';
  }
  if (user.role === 'FINANCE') {
    return '/admin/payroll';
  }
  if (user.role === 'STORE') {
    return '/admin/schedules';
  }
  return '/dashboard';
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: PublicUser; app: AppKind; socketToken?: string | null }>('/auth/me'),
    staleTime: 60_000,
    retry: (failureCount, err) => !isUnauthorized(err) && failureCount < 2,
    enabled,
  });
}

export function useCan() {
  const { data } = useMe();
  return useCallback(
    (...perms: Permission[]) => !!data && perms.some((p) => data.user.permissions.includes(p)),
    [data],
  );
}

export function useLogout(app: AppKind) {
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(async () => {
    markSessionActive(false);
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace(loginPath(app));
  }, [app, qc, router]);
}

export function isUnauthorized(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}
