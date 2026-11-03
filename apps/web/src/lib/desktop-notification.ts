'use client';

import { useCallback, useEffect, useState } from 'react';

export const DESKTOP_NOTIF_STORAGE_KEY = 'umbm_desktop_notif_enabled';
const DESKTOP_NOTIF_CHANGE_EVENT = 'umbm:desktop-notif-change';
const LAST_POPUP_STORAGE_KEY = 'umbm_last_popup_notif_map';

export interface FloatingNotifPayload {
  id: string; code?: string; title: string; body?: string;
  targetLabel?: string; created_at?: string; link?: string;
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let autoPromptBound = false;
const inMemoryDispatched = new Map<string, number>();

export function getDesktopNotifEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(DESKTOP_NOTIF_STORAGE_KEY);
    return raw === null ? true : raw !== 'false' && raw !== '0';
  } catch { return true; }
}

export function setDesktopNotifEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DESKTOP_NOTIF_STORAGE_KEY, enabled ? 'true' : 'false'); } catch {}
  window.dispatchEvent(new CustomEvent<boolean>(DESKTOP_NOTIF_CHANGE_EVENT, { detail: enabled }));
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export function ensureNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register('/sw-notifications.js', { scope: '/' }).catch(() => null);
  }
  return swRegistrationPromise;
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  await ensureNotificationServiceWorker();
  if (window.Notification.permission === 'granted') return 'granted';
  try {
    const perm = await window.Notification.requestPermission();
    window.dispatchEvent(new CustomEvent<boolean>(DESKTOP_NOTIF_CHANGE_EVENT, { detail: getDesktopNotifEnabled() }));
    return perm;
  } catch { return window.Notification.permission; }
}

function isDuplicatePopup(notifId: string): boolean {
  const now = Date.now(), prevMem = inMemoryDispatched.get(notifId);
  if (prevMem && now - prevMem < 30_000) return true;
  inMemoryDispatched.set(notifId, now);
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LAST_POPUP_STORAGE_KEY);
      const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      if (map[notifId] && now - map[notifId]! < 15_000) return true;
      map[notifId] = now;
      const entries = Object.entries(map).filter(([, ts]) => now - ts < 120_000).slice(-60);
      window.localStorage.setItem(LAST_POPUP_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }
  return false;
}

export function buildNotificationCenterUrl(portal: 'backoffice' | 'employee', notifId?: string): string {
  const base = portal === 'employee' ? '/nv/thong-bao' : '/admin/notifications';
  return notifId ? `${base}?highlight=${encodeURIComponent(notifId)}` : base;
}

export function isUserOutsideCurrentTab(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

export async function dispatchOsDesktopNotification(
  item: FloatingNotifPayload,
  portal: 'backoffice' | 'employee',
  onClickNavigate: (notifId: string, targetUrl: string) => void,
  options?: { forceWhenVisible?: boolean },
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (!getDesktopNotifEnabled() || window.Notification.permission !== 'granted') return false;
  if (!options?.forceWhenVisible && !isUserOutsideCurrentTab()) return false;
  const targetUrl = buildNotificationCenterUrl(portal, item.id);
  const title = `[Ụm Bò Milk HR] ${item.title}`;
  const body = [item.code ? `[${item.code}]` : '', item.body || item.targetLabel || 'Bạn có thông báo mới trên hệ thống'].filter(Boolean).join(' ');
  const tag = `umbm-notif-${item.id || Date.now()}`;

  try {
    const reg = await ensureNotificationServiceWorker();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, { body, icon: '/logo-ahr-mark.svg', badge: '/favicon.svg', tag, data: { notificationId: item.id, targetUrl, portal } });
      return true;
    }
  } catch {}

  try {
    const nativeNotif = new window.Notification(title, { body, icon: '/logo-ahr-mark.svg', tag });
    nativeNotif.onclick = () => {
      try { window.focus(); } catch {}
      nativeNotif.close();
      onClickNavigate(item.id, targetUrl);
    };
    return true;
  } catch { return false; }
}

export function shouldTriggerFloatingPopup(notifId: string): boolean {
  return !isDuplicatePopup(notifId);
}

export function useDesktopNotifications(
  portal: 'backoffice' | 'employee',
  onNavigateFromNotification?: (notifId: string, targetUrl: string) => void,
) {
  const [desktopEnabled, setDesktopEnabledState] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setDesktopEnabledState(getDesktopNotifEnabled());
    setPermission(getBrowserNotificationPermission());
    void ensureNotificationServiceWorker();

    if (!autoPromptBound && typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
      autoPromptBound = true;
      const onFirstInteraction = () => {
        window.removeEventListener('click', onFirstInteraction);
        if (getDesktopNotifEnabled() && window.Notification.permission === 'default') {
          void requestDesktopNotificationPermission().then((p) => setPermission(p));
        }
      };
      window.addEventListener('click', onFirstInteraction, { once: true });
    }

    const onSyncState = () => {
      setDesktopEnabledState(getDesktopNotifEnabled());
      setPermission(getBrowserNotificationPermission());
    };
    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; notificationId?: string; targetUrl?: string } | undefined;
      if (data?.type === 'UMBM_NOTIFICATION_CLICK' && onNavigateFromNotification) {
        const url = data.targetUrl || buildNotificationCenterUrl(portal, data.notificationId);
        onNavigateFromNotification(data.notificationId || '', url);
      }
    };

    window.addEventListener(DESKTOP_NOTIF_CHANGE_EVENT, onSyncState);
    window.addEventListener('focus', onSyncState);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }
    return () => {
      window.removeEventListener(DESKTOP_NOTIF_CHANGE_EVENT, onSyncState);
      window.removeEventListener('focus', onSyncState);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
    };
  }, [portal, onNavigateFromNotification]);

  const toggleDesktopEnabled = useCallback(async (next: boolean) => {
    setDesktopEnabledState(next);
    setDesktopNotifEnabled(next);
    if (next && getBrowserNotificationPermission() === 'default') {
      const perm = await requestDesktopNotificationPermission();
      setPermission(perm);
    }
  }, []);

  const requestPermissionNow = useCallback(async () => {
    const perm = await requestDesktopNotificationPermission();
    setPermission(perm);
    if (perm === 'granted') {
      setDesktopEnabledState(true);
      setDesktopNotifEnabled(true);
    }
    return perm;
  }, []);

  return { desktopEnabled, permission, toggleDesktopEnabled, requestPermissionNow };
}
