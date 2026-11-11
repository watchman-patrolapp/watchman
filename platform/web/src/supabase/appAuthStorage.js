import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { hybridAuthStorage } from './authStorage';
import { isAndroidNativePlatform, readNativeSession } from '../geo/carSessionSync';
import { mergeNativeSession } from './nativeSessionMerge';

const MIGRATION_FLAG = 'nw_sb_auth_migrated_from_local';
const AUTH_TOKEN_KEY = /^sb-.*-auth-token$/;

function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

let migratePromise;

async function migrateLocalStorageToPreferencesOnce() {
  if (!isNative()) return;
  const { value: done } = await Preferences.get({ key: MIGRATION_FLAG });
  if (done === '1') return;

  try {
    const toCopy = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-')) {
        const v = localStorage.getItem(k);
        if (v) toCopy.push([k, v]);
      }
    }
    for (const [k, v] of toCopy) {
      await Preferences.set({ key: k, value: v });
    }
    await Preferences.set({ key: MIGRATION_FLAG, value: '1' });
  } catch (e) {
    console.warn('Auth storage migration skipped:', e);
  }
}

function ensureMigrated() {
  if (!isNative()) return Promise.resolve();
  if (!migratePromise) migratePromise = migrateLocalStorageToPreferencesOnce();
  return migratePromise;
}

/**
 * Web: hybrid localStorage / sessionStorage (respects "shared computer" mode).
 * Native: Capacitor Preferences — survives app restarts more reliably than WebView localStorage.
 */
export const appAuthStorage = {
  async getItem(key) {
    if (!isNative()) return hybridAuthStorage.getItem(key);
    await ensureMigrated();
    const { value } = await Preferences.get({ key });
    if (value && isAndroidNativePlatform() && AUTH_TOKEN_KEY.test(key)) {
      // Adopt tokens the car refreshed (single-use refresh token). Errors fall back to `value`.
      const native = await readNativeSession();
      const merged = native ? mergeNativeSession(value, native) : null;
      if (merged) {
        await Preferences.set({ key, value: merged });
        return merged;
      }
    }
    return value ?? null;
  },

  async setItem(key, value) {
    if (!isNative()) {
      hybridAuthStorage.setItem(key, value);
      return;
    }
    await ensureMigrated();
    await Preferences.set({ key, value });
  },

  async removeItem(key) {
    if (!isNative()) {
      hybridAuthStorage.removeItem(key);
      return;
    }
    await Preferences.remove({ key });
  },
};
