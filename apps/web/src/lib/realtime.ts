'use client';

import { App } from 'antd';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { loginPath, type AppKind } from './auth';

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
      qc.invalidateQueries({ queryKey: ['maintenance'] });
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
    const onNotification = (payload?: { actorId?: string; kind?: string; title?: string; summary?: string; code?: string }) => {
      if (isOutOfBranchOrDup('ntf', payload)) return;
      ['notifications', 'mkt-comms', 'nv-comms'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
    };
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerScheduleSync = () => {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(() => {
        [
          'notifications', 'schedules', 'my-attendance', 'leave-requests', 'shift-swaps', 'emergency-leaves',
          'attendance-adjustments', 'attendance-sessions', 'attendance-sessions-count', 'nv-schedules', 'nv-swaps',
          'dashboard-schedules', 'dashboard-leaves', 'dashboard-leaves-full', 'dashboard-swaps', 'dashboard-emergencies', 'dashboard-attendance-adjustments',
          'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile',
        ].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }, 250);
    };

    const onAttendance = (payload?: { actorId?: string; branchId?: string; kind?: string; message?: string }) => {
      if (isOutOfBranchOrDup('att', payload)) return;
      [
        'notifications', 'my-attendance', 'attendance-all', 'nv-attendance', 'attendance-sessions', 'attendance-sessions-count',
        'attendance-adjustments', 'dashboard-attendance-adjustments', 'schedules', 'dashboard-shifts-full',
        'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile',
      ].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    };
    const onSchedule = (payload?: { actorId?: string; branchId?: string; kind?: string; message?: string }) => {
      if (isOutOfBranchOrDup('sched', payload)) return;
      triggerScheduleSync();
    };
    const onEmergency = (payload?: { actorId?: string; branchId?: string; message?: string }) => {
      if (isOutOfBranchOrDup('emg', payload)) return;
      triggerScheduleSync();
    };
    const onAccountPending = () => {
      ['accounts', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    };
    const onPayrollUpdated = () => {
      ['salary-profiles', 'salary-history', 'employees', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile', 'payroll-items', 'notifications'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
    };
    s.on('auth:forceLogout', onForceLogout);
    s.on('system:maintenance', onMaintenance);
    s.on('notification:new', onNotification);
    s.on('attendance:event', onAttendance);
    s.on('schedule:published', onSchedule);
    s.on('swap:updated', onSchedule);
    s.on('emergency:new', onEmergency);
    s.on('account:pending', onAccountPending);
    s.on('payroll:updated', onPayrollUpdated);
    if (!s.connected) s.connect();
    return () => {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      s.off('auth:forceLogout', onForceLogout);
      s.off('system:maintenance', onMaintenance);
      s.off('notification:new', onNotification);
      s.off('attendance:event', onAttendance);
      s.off('schedule:published', onSchedule);
      s.off('swap:updated', onSchedule);
      s.off('emergency:new', onEmergency);
      s.off('account:pending', onAccountPending);
      s.off('payroll:updated', onPayrollUpdated);
    };
  }, [app, enabled, message, qc, router, socketToken, userId]);
}
