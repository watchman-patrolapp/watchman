/**
 * Mobile data–aware polling and patrol location upload cadence.
 * Optional Profile toggle (`watchman_reduce_mobile_data` in localStorage) layers on top of the Network Information API.
 */

export const REDUCE_MOBILE_DATA_STORAGE_KEY = 'watchman_reduce_mobile_data';

export function getUserReduceMobileData() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(REDUCE_MOBILE_DATA_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUserReduceMobileData(enabled) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REDUCE_MOBILE_DATA_STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('watchman-reduce-mobile-data-changed'));
}

export function getDataBudgetHints() {
  if (typeof navigator === 'undefined') {
    return {
      saveData: false,
      effectiveType: '4g',
      slow: false,
      moderate: false,
      documentHidden: false,
      userReduceMobileData: getUserReduceMobileData(),
    };
  }
  const c = navigator.connection;
  const saveData = !!(c && c.saveData);
  const effectiveType = (c && c.effectiveType) || '4g';
  const slow = saveData || effectiveType === 'slow-2g' || effectiveType === '2g';
  const moderate = slow || effectiveType === '3g';
  const documentHidden = typeof document !== 'undefined' && document.hidden;
  const userReduceMobileData = getUserReduceMobileData();
  return { saveData, effectiveType, slow, moderate, documentHidden, userReduceMobileData };
}

/**
 * @param {number} baseMs - Interval on good 4g/Wi‑Fi with tab visible
 * @param {{ hiddenMultiplier?: number, maxMs?: number, minMs?: number }} [opts]
 */
export function adaptivePollIntervalMs(baseMs, opts = {}) {
  const { hiddenMultiplier = 2.2, maxMs = 180000, minMs } = opts;
  const h = getDataBudgetHints();
  let ms = baseMs;
  // Manual “use less data”: same polling backoff as a slow network (saves API calls only; chat Realtime + GPS uploads unchanged).
  if (h.slow || h.userReduceMobileData) ms = Math.round(baseMs * 3);
  else if (h.moderate) ms = Math.round(baseMs * 1.6);
  if (h.documentHidden) ms = Math.round(ms * hiddenMultiplier);
  if (minMs != null) ms = Math.max(ms, minMs);
  return Math.min(Math.max(ms, baseMs), maxMs);
}

/** Network / tab–based throttle only (Profile “use less data” does not change GPS uploads). */
function gpsThrottleFromNetworkAndTab(h) {
  if (h.documentHidden) {
    return {
      minIntervalMs: 120000,
      minDistanceM: 100,
      enableHighAccuracy: false,
      maximumAge: 120000,
    };
  }
  if (h.slow) {
    return {
      minIntervalMs: 60000,
      minDistanceM: 80,
      enableHighAccuracy: false,
      maximumAge: 60000,
    };
  }
  if (h.moderate) {
    return {
      minIntervalMs: 30000,
      minDistanceM: 40,
      enableHighAccuracy: false,
      maximumAge: 45000,
    };
  }
  return {
    minIntervalMs: 15000,
    minDistanceM: 15,
    enableHighAccuracy: true,
    maximumAge: 10000,
  };
}

/**
 * Limits patrol_locations inserts — local map UI still updates every fix.
 * Profile “use less data” affects polling only; GPS cadence follows network + tab visibility.
 */
export function getGpsUploadThrottle() {
  return gpsThrottleFromNetworkAndTab(getDataBudgetHints());
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function subscribeDataBudgetHints(onChange) {
  if (typeof window === 'undefined') return () => {};
  const fire = () => onChange(getDataBudgetHints());
  const c = navigator.connection;
  if (c && typeof c.addEventListener === 'function') {
    c.addEventListener('change', fire);
  }
  const onVis = () => fire();
  document.addEventListener('visibilitychange', onVis);
  const onPreference = () => fire();
  window.addEventListener('watchman-reduce-mobile-data-changed', onPreference);
  const onStorage = (e) => {
    if (e.key === REDUCE_MOBILE_DATA_STORAGE_KEY) fire();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    if (c && typeof c.removeEventListener === 'function') {
      c.removeEventListener('change', fire);
    }
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('watchman-reduce-mobile-data-changed', onPreference);
    window.removeEventListener('storage', onStorage);
  };
}
