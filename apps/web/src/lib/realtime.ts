'use client';

import { App } from 'antd';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { loginPath, type AppKind } from './auth';
import { playNotificationSound } from './notification-sound';

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
export function useRealtime(app: AppKind, enabled: boolean, socketToken?: string | null) {
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
    const isSelfOrDup = (() => {
      let lastSig = '';
      let lastAt = 0;
      return (eventKey: string, payload?: { actorId?: string; kind?: string; code?: string; title?: string; message?: string }) => {
        const myId = qc.getQueryData<{ user?: { id?: string } }>(['auth', 'me'])?.user?.id;
        const isSelf = Boolean(payload?.actorId && myId && payload.actorId === myId);
        const sig = `${eventKey}:${payload?.kind || ''}:${payload?.code || ''}:${payload?.title || ''}:${payload?.message || ''}`;
        const now = Date.now();
        const isDup = sig === lastSig && now - lastAt < 1500;
        lastSig = sig;
        lastAt = now;
        return { isSelf, isDup };
      };
    })();
    const onNotification = (payload?: { actorId?: string; kind?: string; title?: string; summary?: string; code?: string }) => {
      const { isSelf, isDup } = isSelfOrDup('ntf', payload);
      if (isDup) return;
      ['notifications', 'mkt-comms', 'nv-comms'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (isSelf) return;
      playNotificationSound();
      if (payload?.title) {
        message.info({ key: `rt-ntf-${payload.code || payload.title}`, content: `${payload.kind === 'ANNOUNCEMENT' ? `Bản tin mới (${payload.code || 'Nội bộ'})` : 'Thông báo mới'}: ${payload.title}` });
      }
    };
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerScheduleSync = () => {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(() => {
        [
          'notifications', 'schedules', 'my-attendance', 'leave-requests', 'shift-swaps', 'emergency-leaves',
          'attendance-adjustments', 'attendance-sessions', 'attendance-sessions-count', 'nv-schedules', 'nv-swaps',
          'dashboard-schedules', 'dashboard-leaves', 'dashboard-leaves-full', 'dashboard-swaps', 'dashboard-emergencies', 'dashboard-attendance-adjustments',
        ].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }, 350);
    };

    const onAttendance = (payload?: { actorId?: string; kind?: string; message?: string }) => {
      const { isSelf, isDup } = isSelfOrDup('att', payload);
      if (isDup) return;
      ['notifications', 'my-attendance', 'attendance-all', 'nv-attendance', 'attendance-sessions', 'attendance-sessions-count', 'attendance-adjustments', 'dashboard-attendance-adjustments', 'schedules', 'dashboard-shifts-full'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      if (!isSelf && app === 'backoffice' && payload?.message) {
        playNotificationSound();
        if (payload.kind === 'ADJUSTMENT_CREATED' || payload.kind === 'ADJUSTMENT_DECIDED') {
          message.info({ key: 'rt-att-alert', content: payload.message });
        } else {
          message.warning({ key: 'rt-att-alert', content: payload.message });
        }
      } else if (!isSelf && app === 'employee' && payload?.kind === 'ADJUSTMENT_DECIDED' && payload?.message) {
        playNotificationSound();
        message.info({ key: 'rt-att-emp', content: payload.message });
      }
    };
    const onSchedule = (payload?: { actorId?: string; kind?: string; message?: string }) => {
      const { isSelf, isDup } = isSelfOrDup('sched', payload);
      if (isDup) return;
      triggerScheduleSync();
      if (isSelf) return;
      if (app === 'employee' && payload?.message && ['SHIFT_APPROVED', 'SHIFT_ASSIGNED', 'LEAVE_DECIDED', 'SWAP_PEER', 'SWAP_DECIDED', 'EMERGENCY_HANDLED'].includes(payload.kind || '')) {
        playNotificationSound();
        message.info({ key: 'rt-schedule-emp', content: payload.message });
      } else if (app === 'backoffice' && payload?.kind && ['SHIFT_REGISTERED', 'LEAVE_CREATED', 'SWAP_CREATED', 'SWAP_PEER', 'SWAP_PEER_ACCEPTED'].includes(payload.kind)) {
        playNotificationSound();
        if (payload.message) message.info({ key: 'rt-schedule-bo', content: payload.message });
      }
    };
    const onEmergency = (payload?: { actorId?: string; message?: string }) => {
      const { isSelf, isDup } = isSelfOrDup('emg', payload);
      if (isDup) return;
      triggerScheduleSync();
      if (!isSelf && app === 'backoffice') {
        playNotificationSound();
        if (payload?.message) message.warning({ key: 'rt-emergency-mgr', content: payload.message });
      }
    };
    const onAccountPending = () => {
      if (app === 'backoffice') playNotificationSound();
      ['accounts', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    };
    s.on('auth:forceLogout', onForceLogout);
    s.on('system:maintenance', onMaintenance);
    s.on('notification:new', onNotification);
    s.on('attendance:event', onAttendance);
    s.on('schedule:published', onSchedule);
    s.on('swap:updated', onSchedule);
    s.on('emergency:new', onEmergency);
    s.on('account:pending', onAccountPending);
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
    };
  }, [app, enabled, message, qc, router, socketToken]);
}
