import { Capacitor } from '@capacitor/core';

/**
 * Bump this integer when you ship an update and want **every** user to see the
 * permissions primer again (new copy, new Android permission flow, etc.).
 * Each version uses a fresh storage key; older keys are left unused (harmless).
 */
export const PERMISSIONS_PRIMER_STORAGE_VERSION = 4;

const STORAGE_KEY = `nw_permissions_primer_dismissed_v${PERMISSIONS_PRIMER_STORAGE_VERSION}`;

export async function permissionsPrimerWasDismissed() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value === '1') return true;
    }
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export async function dismissPermissionsPrimer() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: STORAGE_KEY, value: '1' });
    }
  } catch {
    /* ignore */
  }
}

/**
 * Runs the OS/browser location permission flow and obtains one fix (for primer only).
 * @returns {'granted' | 'denied' | 'no_fix' | 'unavailable'}
 */
export async function primeLocationPermission() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        perm = await Geolocation.requestPermissions();
      }
      if (perm.location === 'granted') {
        await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        });
        return 'granted';
      }
      return 'denied';
    } catch {
      return 'unavailable';
    }
  }

  if (!navigator.geolocation) return 'unavailable';

  const readCode = (err) =>
    err && typeof err === 'object' && 'code' in err ? err.code : null;

  const getOnce = (opts) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });

  // High accuracy first (phones / outdoor). Desktop Chrome often has no GPS and times out here.
  try {
    await getOnce({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
    return 'granted';
  } catch (e) {
    const code = readCode(e);
    if (code === 1) return 'denied'; // PERMISSION_DENIED

    // Same permission, but no fix yet: Wi‑Fi / IP coarse location (works on many desktops).
    try {
      await getOnce({
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: 120000,
      });
      return 'granted';
    } catch (e2) {
      const code2 = readCode(e2);
      if (code2 === 1) return 'denied';
      // TIMEOUT (3) or POSITION_UNAVAILABLE (2) — not an IDE-specific failure
      return 'no_fix';
    }
  }
}

/**
 * Android/iOS: notification permission for push (Capacitor).
 * @returns {'granted' | 'denied' | 'unavailable'}
 */
export async function primePushNotifications() {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    return perm.receive === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Web: browser notification permission (chat / alerts).
 * @returns {'granted' | 'denied' | 'unavailable'}
 */
export async function primeWebNotifications() {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unavailable';
    }
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}
