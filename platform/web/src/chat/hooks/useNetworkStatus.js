// src/chat/hooks/useNetworkStatus.js
import { useState, useEffect, useCallback, useRef } from 'react';

const REACHABILITY_MS = 6000;
const FALSE_OFFLINE_RECHECK_MS = 2000;
const OFFLINE_PROBE_MS = 15000;

/**
 * True connectivity check. `navigator.onLine` is often wrong (false offline on VPN,
 * devtools, sleep/wake, localhost quirks). We treat the app origin as reachable if
 * a small same-origin fetch succeeds.
 */
async function pingAppOrigin() {
  if (typeof window === 'undefined') return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_MS);
  try {
    const res = await fetch(`${window.location.origin}/`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      credentials: 'same-origin',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const mounted = useRef(true);

  const verify = useCallback(async () => {
    const ok = await pingAppOrigin();
    if (mounted.current) setIsOnline(ok);
    return ok;
  }, []);

  useEffect(() => {
    mounted.current = true;

    const handleOnline = () => {
      setIsOnline(true);
      void verify();
    };

    const handleOffline = () => {
      setIsOnline(false);
      // Browser "offline" is often a false alarm — confirm with a real request.
      const t = window.setTimeout(() => {
        void verify();
      }, FALSE_OFFLINE_RECHECK_MS);
      return t;
    };

    let offlineRecheckTimer = 0;

    const onOffline = () => {
      if (offlineRecheckTimer) window.clearTimeout(offlineRecheckTimer);
      offlineRecheckTimer = handleOffline();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', onOffline);

    // Fix wrong initial navigator.onLine (common on first paint).
    void verify();

    return () => {
      mounted.current = false;
      if (offlineRecheckTimer) window.clearTimeout(offlineRecheckTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [verify]);

  // While UI thinks we're offline, keep probing — recovers from stuck false offline.
  useEffect(() => {
    if (isOnline) return undefined;
    const id = window.setInterval(() => {
      void verify();
    }, OFFLINE_PROBE_MS);
    return () => window.clearInterval(id);
  }, [isOnline, verify]);

  return { isOnline };
};
