'use client';

import { App } from 'antd';
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { loginPath, type AppKind } from './auth';
import { isInSelfActionWindow } from './notification-sound';

let socket: Socket | null = null;
let currentToken: string | null = null;

/**
 * Hỗ trợ kết nối trực tiếp tới Render (`NEXT_PUBLIC_WS_URL`) khi Frontend đặt trên Vercel
 * (do Vercel rewrites không proxy WebSocket upgrade), hoặc kết nối cùng origin khi chạy local/Docker.
 */
function resolveWsOrigin(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
    return 'https://crm-hr-um-milk-api.onrender.com';
  }
  return undefined;
}

function getSocket(socketToken?: string | null): Socket {
  const wsUrl = resolveWsOrigin();
  if (socket && socketToken && socketToken !== currentToken) {
    currentToken = socketToken;
    socket.auth = { token: socketToken };
    if (socket.connected) socket.disconnect().connect();
  }
  if (!socket) {
    currentToken = socketToken ?? null;
    socket = io(wsUrl, {
      path: '/socket.io',
      withCredentials: true,
      auth: socketToken ? { token: socketToken } : undefined,
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
    });
  }
  return socket;
}

/**
 * Kết nối realtime. Khi Admin thu hồi tài khoản, server phát auth:forceLogout
 * -> xóa cache và chuyển về trang đăng nhập ngay (FLOW-01).
 */
export function useRealtime(app: AppKind, enabled: boolean, socketToken?: string | null, userId?: string) {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    const wsUrl = resolveWsOrigin();
    if (!enabled || (wsUrl && !socketToken)) return;
    const s = getSocket(socketToken);
    const onForceLogout = (payload: { reason?: string }) => {
      message.warning(payload?.reason ?? 'Phiên đăng nhập đã bị thu hồi');
      qc.clear();
      s.disconnect();
      socket = null;
      router.replace(loginPath(app));
    };
    const onMaintenance = (payload: { enabled?: boolean; message?: string }) => {
      qc.setQueryData(['maintenance'], [payload]);
      if (payload?.enabled) {
        message.warning(payload.message || 'Hệ thống đang chuyển sang chế độ bảo trì');
      } else {
        message.success('Hệ thống đã hoàn tất bảo trì và hoạt động bình thường trở lại');
      }
    };
    const isOutOfBranchOrDup = (() => {
      let lastSig = '';
      let lastAt = 0;
      return (eventKey: string, payload?: { actorId?: string; branchId?: string; entityId?: string; kind?: string; code?: string; title?: string; message?: string }) => {
        const meUser = qc.getQueryData<{ user?: { id?: string; role?: string; branchScope?: 'ALL' | string[] } }>(['me'])?.user;
        const outOfBranch = Boolean(
          meUser?.role === 'STORE' &&
          payload?.branchId &&
          payload.branchId !== 'ALL' &&
          (!Array.isArray(meUser.branchScope) || !meUser.branchScope.includes(payload.branchId)),
        );
        const sig = `${eventKey}:${payload?.kind || ''}:${payload?.entityId || ''}:${payload?.code || ''}:${payload?.title || ''}:${payload?.message || ''}`;
        const now = Date.now();
        const isDup = outOfBranch || (sig === lastSig && now - lastAt < 800);
        if (!outOfBranch) {
          lastSig = sig;
          lastAt = now;
        }
        return isDup;
      };
    })();

    const pendingKeys = new Map<string, QueryKey>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const queueInvalidate = (keys: QueryKey[]) => {
      for (const k of keys) pendingKeys.set(JSON.stringify(k), k);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const batch = Array.from(pendingKeys.values());
        pendingKeys.clear();
        const selfAction = isInSelfActionWindow();
        const now = Date.now();
        for (const queryKey of batch) {
          if (selfAction) {
            const matched = qc.getQueryCache().findAll({ queryKey });
            const activeMatched = matched.filter((q) => q.getObserversCount() > 0);
            if (activeMatched.length > 0 && activeMatched.every((q) => q.state.fetchStatus === 'fetching' || now - q.state.dataUpdatedAt < 1200)) {
              qc.invalidateQueries({ queryKey, refetchType: 'none' });
              continue;
            }
          }
          qc.invalidateQueries({ queryKey });
        }
      }, 250);
    };

    const onNotification = (payload?: { actorId?: string; kind?: string; title?: string; summary?: string; code?: string }) => {
      if (isOutOfBranchOrDup('ntf', payload)) return;
      queueInvalidate([['notifications'], ['mkt-comms'], ['nv-comms'], ['me', 'payslips']]);
    };
    const onAttendance = (payload?: { actorId?: string; branchId?: string; kind?: string; message?: string }) => {
      if (isOutOfBranchOrDup('att', payload)) return;
      queueInvalidate([
        ['notifications'], ['my-attendance'], ['attendance-all'], ['nv-attendance'], ['attendance-sessions'], ['attendance-sessions-count'],
        ['attendance-adjustments'], ['dashboard-attendance-adjustments'], ['schedules'], ['dashboard-schedules'], ['dashboard-shifts-full'],
        ['payroll-periods'], ['payroll-periods-report'], ['payroll-snapshots'], ['payroll-reconcile'],
      ]);
    };
    const onSchedule = (payload?: { actorId?: string; branchId?: string; kind?: string; message?: string }) => {
      if (isOutOfBranchOrDup('sched', payload)) return;
      queueInvalidate([
        ['notifications'], ['schedules'], ['my-attendance'], ['leave-requests'], ['shift-swaps'], ['shift-registrations'],
        ['schedule-planner-week'], ['schedule-planner-probation'], ['attendance-adjustments'], ['attendance-sessions'], ['attendance-sessions-count'],
        ['nv-schedules'], ['nv-swaps'], ['dashboard-schedules'], ['dashboard-leaves'], ['dashboard-swaps'], ['dashboard-attendance-adjustments'],
        ['payroll-periods'], ['payroll-periods-report'], ['payroll-snapshots'], ['payroll-reconcile'],
      ]);
    };
    const onAccountPending = () => queueInvalidate([['accounts'], ['notifications']]);
    const onPayrollUpdated = () => queueInvalidate([
      ['salary-profiles'], ['salary-history'], ['employees'], ['payroll-periods'], ['payroll-periods-report'],
      ['payroll-snapshots'], ['payroll-reconcile'], ['payroll-items'], ['notifications'], ['tickets'], ['me', 'payslips'],
    ]);
    const onTicketUpdated = (payload?: { actorId?: string; branchId?: string; entityId?: string; kind?: string }) => {
      if (isOutOfBranchOrDup('tck', payload)) return;
      queueInvalidate([['tickets'], ['ticket-detail'], ['notifications'], ['payroll-snapshots'], ['me', 'payslips']]);
    };

    s.on('auth:forceLogout', onForceLogout);
    s.on('system:maintenance', onMaintenance);
    s.on('notification:new', onNotification);
    s.on('attendance:event', onAttendance);
    s.on('schedule:published', onSchedule);
    s.on('swap:updated', onSchedule);
    s.on('account:pending', onAccountPending);
    s.on('payroll:updated', onPayrollUpdated);
    s.on('ticket:updated', onTicketUpdated);
    if (!s.connected) s.connect();
    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      s.off('auth:forceLogout', onForceLogout);
      s.off('system:maintenance', onMaintenance);
      s.off('notification:new', onNotification);
      s.off('attendance:event', onAttendance);
      s.off('schedule:published', onSchedule);
      s.off('swap:updated', onSchedule);
      s.off('account:pending', onAccountPending);
      s.off('payroll:updated', onPayrollUpdated);
      s.off('ticket:updated', onTicketUpdated);
    };
  }, [app, enabled, message, qc, router, socketToken, userId]);
}
