'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const NOTIFICATION_SOUND_STORAGE_KEY = 'umbm_notification_sound_enabled';
const SOUND_CHANGE_EVENT = 'umbm:notification-sound-change';
const SOUND_SRC = '/thong_bao.mp3';
const AUTO_CHIME_COOLDOWN_MS = 1200;

let sharedAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let unlockListenersAttached = false;
let lastPlayedAt = 0;

function getAudioInstance(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio(SOUND_SRC);
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

function ensureAudioUnlockListeners(): void {
  if (typeof window === 'undefined' || unlockListenersAttached) return;
  unlockListenersAttached = true;

  const unlock = () => {
    if (audioUnlocked) return;
    const audio = getAudioInstance();
    if (!audio) return;
    const prevVolume = audio.volume;
    audio.volume = 0;
    const p = audio.play();
    if (p !== undefined) {
      p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVolume || 1;
        audioUnlocked = true;
      }).catch(() => {
        audio.volume = prevVolume || 1;
      });
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

export function getNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY);
    return raw === null ? true : raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  window.dispatchEvent(new CustomEvent<boolean>(SOUND_CHANGE_EVENT, { detail: enabled }));
  if (enabled) {
    playNotificationSound({ force: true });
  }
}

export function playNotificationSound(options?: { force?: boolean }): void {
  if (typeof window === 'undefined') return;
  if (!options?.force && !getNotificationSoundEnabled()) return;

  const now = Date.now();
  if (!options?.force && now - lastPlayedAt < AUTO_CHIME_COOLDOWN_MS) return;
  lastPlayedAt = now;

  try {
    const audio = getAudioInstance();
    if (!audio) return;
    audio.volume = 1;
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const fallback = new Audio(SOUND_SRC);
        fallback.volume = 1;
        void fallback.play().catch(() => {});
      });
    }
  } catch {
    // Ignore audio playback errors if browser blocks autoplay before interaction
  }
}

export function useNotificationSound() {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(true);

  useEffect(() => {
    ensureAudioUnlockListeners();
    setSoundEnabledState(getNotificationSoundEnabled());

    const onCustomChange = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      setSoundEnabledState(typeof custom.detail === 'boolean' ? custom.detail : getNotificationSoundEnabled());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIFICATION_SOUND_STORAGE_KEY) {
        setSoundEnabledState(getNotificationSoundEnabled());
      }
    };

    window.addEventListener(SOUND_CHANGE_EVENT, onCustomChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SOUND_CHANGE_EVENT, onCustomChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setSoundEnabled = useCallback((next: boolean) => {
    setSoundEnabledState(next);
    setNotificationSoundEnabled(next);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled(!getNotificationSoundEnabled());
  }, [setSoundEnabled]);

  const playTestSound = useCallback(() => {
    playNotificationSound({ force: true });
  }, []);

  return { soundEnabled, setSoundEnabled, toggleSound, playTestSound };
}

export function useTrackUnreadNotifications(userId: string | undefined, unreadKeys: string[], ready: boolean): void {
  const initializedRef = useRef(false);

  useEffect(() => {
    ensureAudioUnlockListeners();
  }, []);

  useEffect(() => {
    if (!userId || !ready || typeof window === 'undefined') return;
    const storageKey = `umbm_seen_notifs_${userId}`;
    let seenSet = new Set<string>();
    let hadStored = false;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        hadStored = true;
        seenSet = new Set(JSON.parse(raw) as string[]);
      }
    } catch {
      seenSet = new Set<string>();
    }

    if (!initializedRef.current && !hadStored) {
      initializedRef.current = true;
      unreadKeys.forEach((k) => seenSet.add(k));
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(seenSet).slice(-250)));
      } catch {}
      return;
    }

    initializedRef.current = true;
    const newKeys = unreadKeys.filter((k) => !seenSet.has(k));
    if (newKeys.length > 0) {
      newKeys.forEach((k) => seenSet.add(k));
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(seenSet).slice(-250)));
      } catch {}
      playNotificationSound();
    }
  }, [userId, unreadKeys, ready]);
}
