import { Capacitor } from '@capacitor/core';

const PREFER_SESSION_KEY = 'nw_prefer_session_auth';

function isNativeCapacitor() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPreferSessionAuth() {
  if (isNativeCapacitor()) return false;
  try {
    return localStorage.getItem(PREFER_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function clearSupabaseKeys(store) {
  try {
    const toRemove = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith('sb-')) toRemove.push(k);
    }
    toRemove.forEach((k) => store.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Session-only auth (shared computer): tokens in sessionStorage only.
 * Persistent (default): localStorage.
 */
export function setPreferSessionAuth(preferSession) {
  try {
    if (preferSession) {
      clearSupabaseKeys(localStorage);
      localStorage.setItem(PREFER_SESSION_KEY, '1');
    } else {
      clearSupabaseKeys(sessionStorage);
      localStorage.removeItem(PREFER_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function clearAllSupabaseAuthKeys() {
  clearSupabaseKeys(localStorage);
  clearSupabaseKeys(sessionStorage);
}

export const hybridAuthStorage = {
  getItem(key) {
    try {
      if (getPreferSessionAuth()) return sessionStorage.getItem(key);
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      if (getPreferSessionAuth()) sessionStorage.setItem(key, value);
      else localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  removeItem(key) {
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
