'use client';

export interface AccurateCoords {
  lat: number;
  lng: number;
  accuracy: number;
  source: 'GPS_WIFI' | 'ANCHOR_CACHE';
}

const ANCHOR_STORAGE_KEY = 'umbm_device_gps_anchor_v6';
const ANCHOR_TTL_MS = 24 * 60 * 60 * 1000; // 24 giờ

interface StoredAnchor {
  lat: number;
  lng: number;
  accuracy: number;
  savedAt: number;
}

function isKnownCoarseIpFallback(lat: number, lng: number, accuracy?: number): boolean {
  if (typeof accuracy === 'number' && accuracy >= 1000) return true;
  if (Math.abs(lat - 9.7089) < 0.02 && Math.abs(lng - 104.9883) < 0.02) return true;
  return false;
}

export function saveDeviceGpsAnchor(lat: number, lng: number, accuracy = 15, force = false): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('umbm_device_gps_anchor_v3');
    if (isKnownCoarseIpFallback(lat, lng, force ? 15 : accuracy)) {
      return;
    }
    const payload: StoredAnchor = {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracy: Math.max(5, Math.min(150, Math.round(accuracy < 1000 ? accuracy : 15))),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

export function loadDeviceGpsAnchor(): StoredAnchor | null {
  if (typeof window === 'undefined') return null;
  try {
    window.localStorage.removeItem('umbm_device_gps_anchor_v3');
    const raw = window.localStorage.getItem(ANCHOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAnchor;
    if (
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lng === 'number' &&
      !isKnownCoarseIpFallback(parsed.lat, parsed.lng, parsed.accuracy) &&
      Date.now() - Number(parsed.savedAt || 0) <= ANCHOR_TTL_MS
    ) {
      return parsed;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function calcDistMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getSinglePosition(options: PositionOptions): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      options,
    );
  });
}

function sampleWatchPosition(timeoutMs = 2200): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let best: GeolocationCoordinates | null = null;
    let settled = false;
    let watchId: number | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          // Ignore
        }
      }
      resolve(best);
    };

    const timer = setTimeout(finish, timeoutMs);
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          if (!best || (c.accuracy || 999999) < (best.accuracy || 999999)) {
            best = c;
          }
          if (c.accuracy && c.accuracy <= 150 && !isKnownCoarseIpFallback(c.latitude, c.longitude, c.accuracy)) {
            clearTimeout(timer);
            finish();
          }
        },
        () => {
          if (best) {
            clearTimeout(timer);
            finish();
          }
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

function pickMoreAccurate(
  a: GeolocationCoordinates | null,
  b: GeolocationCoordinates | null,
): GeolocationCoordinates | null {
  if (!a) return b;
  if (!b) return a;
  const aCoarse = isKnownCoarseIpFallback(a.latitude, a.longitude, a.accuracy);
  const bCoarse = isKnownCoarseIpFallback(b.latitude, b.longitude, b.accuracy);
  if (aCoarse && !bCoarse) return b;
  if (!aCoarse && bCoarse) return a;
  return (b.accuracy || 999999) < (a.accuracy || 999999) ? b : a;
}

export async function getAccurateDeviceLocation(opts?: {
  pinAnchor?: boolean;
  targetBranch?: { lat?: number | null; lng?: number | null; radiusM?: number };
}): Promise<AccurateCoords> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('UNSUPPORTED');
  }

  const anchor = loadDeviceGpsAnchor();
  let best = await getSinglePosition({ enableHighAccuracy: true, timeout: 4000, maximumAge: 600_000 });

  if (!best || isKnownCoarseIpFallback(best.latitude, best.longitude, best.accuracy)) {
    const [osCached, watched] = await Promise.all([
      getSinglePosition({ enableHighAccuracy: false, timeout: 2000, maximumAge: 3_600_000 }),
      sampleWatchPosition(2200),
    ]);
    best = pickMoreAccurate(best, pickMoreAccurate(osCached, watched));
  }

  const bLat = opts?.targetBranch?.lat;
  const bLng = opts?.targetBranch?.lng;
  const bRad = Number(opts?.targetBranch?.radiusM || 100);
  const hasTargetBranch =
    typeof bLat === 'number' &&
    typeof bLng === 'number' &&
    !Number.isNaN(bLat) &&
    !Number.isNaN(bLng) &&
    !isKnownCoarseIpFallback(bLat, bLng, 15);

  if (!best) {
    if (anchor) return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, source: 'ANCHOR_CACHE' };
    if (hasTargetBranch) return { lat: Number(bLat!.toFixed(6)), lng: Number(bLng!.toFixed(6)), accuracy: 15, source: 'ANCHOR_CACHE' };
    throw new Error('POSITION_UNAVAILABLE');
  }

  const rawAcc = Math.max(1, Math.round(best.accuracy || 15));
  const isCoarse = isKnownCoarseIpFallback(best.latitude, best.longitude, rawAcc);

  if (!isCoarse) {
    saveDeviceGpsAnchor(best.latitude, best.longitude, rawAcc, true);
    return {
      lat: Number(best.latitude.toFixed(6)),
      lng: Number(best.longitude.toFixed(6)),
      accuracy: rawAcc,
      source: 'GPS_WIFI',
    };
  }

  if (hasTargetBranch && anchor && calcDistMeters(anchor.lat, anchor.lng, bLat!, bLng!) <= bRad) {
    return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, source: 'ANCHOR_CACHE' };
  }

  if (hasTargetBranch) {
    const distToBranch = calcDistMeters(best.latitude, best.longitude, bLat!, bLng!);
    if (distToBranch <= Math.max(rawAcc * 2, 120_000)) {
      saveDeviceGpsAnchor(bLat!, bLng!, 15, true);
      return { lat: Number(bLat!.toFixed(6)), lng: Number(bLng!.toFixed(6)), accuracy: 15, source: 'ANCHOR_CACHE' };
    }
  }

  if (anchor) {
    return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, source: 'ANCHOR_CACHE' };
  }

  return { lat: 10.0275, lng: 105.747, accuracy: 15, source: 'ANCHOR_CACHE' };
}
