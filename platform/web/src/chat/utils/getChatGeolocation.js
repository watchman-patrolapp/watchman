/**
 * Share-location: high-accuracy GPS first, optional short watchPosition refine.
 *
 * Chrome / Chromium throttle background tabs: timers and geolocation callbacks can
 * stall until the tab is focused again — not "console sleep", but tab throttling.
 * We bail early if the tab is hidden and stop refining when you switch away.
 *
 * Optional Screen Wake Lock (where supported) runs in parallel with GPS — never await it
 * before getCurrentPosition or Chrome will log a user-gesture violation and may deny GPS.
 *
 * Debug: add ?chatGeoDebug=1 to the URL or localStorage chatGeoDebug=1, then open the
 * console and trigger Share location or a +LOC quick template. Logs are prefixed [chat-geo].
 */

/** Aim to improve fixes worse than this (meters). */
const REFINE_IF_ACCURACY_M = 32;
const TARGET_ACCURACY_M = 28;
/** Cap refine phase so total wait stays reasonable (accurate + refine). */
const REFINE_MAX_MS = 6_000;

/** Share location: balance accuracy vs ~30s+ perceived stall from long browser timeouts. */
const TIMEOUT_ACCURATE_MS = 14_000;
const TIMEOUT_FAST_MS = 10_000;

/** Emergency quick templates: skip refine; timeouts tight but enough for weak GPS. */
const TIMEOUT_QUICK_ACCURATE_MS = 12_000;
const TIMEOUT_QUICK_FAST_MS = 10_000;

/** Non-standard code so UI can explain Chrome tab / background throttling. */
export const GEO_ERR_TAB_BACKGROUND = 4;

export const CHAT_GEO_DEBUG_LS_KEY = 'chatGeoDebug';

let chatGeoDebugHelpPrinted = false;

export function isChatGeoDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(CHAT_GEO_DEBUG_LS_KEY) === '1') return true;
  } catch {
    /* private mode */
  }
  try {
    return new URLSearchParams(window.location.search).get('chatGeoDebug') === '1';
  } catch {
    return false;
  }
}

export function setChatGeoDebug(enabled) {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(CHAT_GEO_DEBUG_LS_KEY, '1');
    else localStorage.removeItem(CHAT_GEO_DEBUG_LS_KEY);
  } catch (e) {
    console.warn('[chat-geo] setChatGeoDebug:', e);
  }
}

/** How to enable verbose `[chat-geo]` logs in the browser console. */
export function printChatGeoDebugHelp() {
  console.info(
    `[chat-geo] Verbose GPS trace\n` +
      `  • URL:     ?chatGeoDebug=1\n` +
      `  • Storage: localStorage.setItem("${CHAT_GEO_DEBUG_LS_KEY}","1"); location.reload()\n` +
      `  • Code:    import { setChatGeoDebug } from '…/getChatGeolocation'; setChatGeoDebug(true)\n` +
      `  Disable:   setChatGeoDebug(false) or remove the localStorage key.\n` +
      `  Then use Share location or a +LOC quick template.`
  );
}

function createGeoDebugSession() {
  if (!isChatGeoDebugEnabled()) return null;
  if (!chatGeoDebugHelpPrinted) {
    chatGeoDebugHelpPrinted = true;
    printChatGeoDebugHelp();
  }
  const t0 = performance.now();
  return {
    log(phase, payload = {}) {
      console.log(`[chat-geo] ${phase}`, { ms: Math.round(performance.now() - t0), ...payload });
    },
  };
}

function getOnceLabeled(geoOpts, label, log) {
  const t = performance.now();
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        log(`${label}:ok`, {
          elapsedMs: Math.round(performance.now() - t),
          accuracyM: pos.coords?.accuracy,
          lat: pos.coords?.latitude,
          lng: pos.coords?.longitude,
        });
        resolve(pos);
      },
      (err) => {
        log(`${label}:fail`, {
          elapsedMs: Math.round(performance.now() - t),
          code: err?.code,
          message: err?.message,
        });
        reject(err);
      },
      geoOpts
    );
  });
}

/**
 * @param {{ quick?: boolean }} [options] — `quick`: shorter timeouts, no watchPosition refine (templates).
 */
export function getChatGeolocationPosition(options = {}) {
  const quick = options.quick === true;
  const session = createGeoDebugSession();
  const log = session ? (p, d) => session.log(p, d) : () => {};

  const accurate = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: quick ? TIMEOUT_QUICK_ACCURATE_MS : TIMEOUT_ACCURATE_MS,
  };
  const fastFallback = {
    enableHighAccuracy: false,
    maximumAge: quick ? 600_000 : 120_000,
    timeout: quick ? TIMEOUT_QUICK_FAST_MS : TIMEOUT_FAST_MS,
  };
  const refineCapMs = quick ? 0 : REFINE_MAX_MS;

  const geoGet = session
    ? (opts, label) => getOnceLabeled(opts, label, log)
    : (opts) =>
        new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, opts);
        });

  log('start', {
    quick,
    accurate,
    fastFallback,
    refineCapMs,
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    hidden: typeof document !== 'undefined' && document.hidden,
  });

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    log('abort', { reason: 'insecure_context' });
    return Promise.reject(
      Object.assign(new Error('Geolocation needs HTTPS or localhost'), { code: 2 })
    );
  }

  if (!navigator.geolocation) {
    log('abort', { reason: 'no_geolocation_api' });
    return Promise.reject(Object.assign(new Error('Geolocation not supported'), { code: 0 }));
  }

  if (typeof document !== 'undefined' && document.hidden) {
    log('abort', { reason: 'document_hidden' });
    return Promise.reject(
      Object.assign(
        new Error('This tab is in the background. Open this tab and tap Share location again.'),
        { code: GEO_ERR_TAB_BACKGROUND }
      )
    );
  }

  const geoPromise = geoGet(accurate, 'accurate')
    .then((pos) => refinePositionIfNeeded(pos, { maxRefineMs: refineCapMs, log }))
    .catch((err) => {
      const code = err?.code;
      log('chain', { afterAccurateFail: true, code, message: err?.message });
      if (code === 1) throw err;
      return geoGet(fastFallback, 'fastFallback').then((pos) =>
        refinePositionIfNeeded(pos, { relaxTarget: true, maxRefineMs: refineCapMs, log })
      );
    });

  holdOptionalWakeLockUntil(geoPromise, session);

  return geoPromise.then(
    (pos) => {
      log('done:success', {
        accuracyM: pos.coords?.accuracy,
        lat: pos.coords?.latitude,
        lng: pos.coords?.longitude,
      });
      return pos;
    },
    (err) => {
      log('done:fail', { code: err?.code, message: err?.message });
      throw err;
    }
  );
}

function holdOptionalWakeLockUntil(donePromise, session) {
  const log = session ? (p, d) => session.log(p, d) : () => {};
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) {
    if (session) log('wakeLock', { skipped: true, reason: 'unsupported_or_no_navigator' });
    return;
  }
  void (async () => {
    let lock;
    try {
      lock = await navigator.wakeLock.request('screen');
      log('wakeLock', { acquired: true });
    } catch (e) {
      log('wakeLock', { acquired: false, error: e?.message || String(e) });
      return;
    }
    try {
      await donePromise;
    } catch {
      /* surfaced on geoPromise */
    } finally {
      try {
        await lock?.release?.();
        log('wakeLock', { released: true });
      } catch {
        /* ignore */
      }
    }
  })();
}

/**
 * If accuracy is poor, watch briefly and keep the reading with smallest accuracy radius.
 * Stops immediately if the tab goes to the background (Chrome throttles the rest).
 */
function refinePositionIfNeeded(
  initialPos,
  { relaxTarget = false, maxRefineMs = REFINE_MAX_MS, log = () => {} } = {}
) {
  if (maxRefineMs <= 0) {
    log('refine:skip', { reason: 'quick_mode_or_disabled', initialAccuracyM: initialPos.coords?.accuracy });
    return Promise.resolve(initialPos);
  }

  const acc = initialPos.coords?.accuracy;
  const target = relaxTarget ? 45 : TARGET_ACCURACY_M;
  const refineIf = relaxTarget ? 55 : REFINE_IF_ACCURACY_M;

  if (acc != null && acc <= refineIf) {
    log('refine:skip', { reason: 'already_good_enough', accuracyM: acc, refineIf });
    return Promise.resolve(initialPos);
  }

  if (typeof navigator.geolocation.watchPosition !== 'function') {
    log('refine:skip', { reason: 'no_watchPosition' });
    return Promise.resolve(initialPos);
  }

  log('refine:start', { initialAccuracyM: acc, targetM: target, maxRefineMs });

  return new Promise((resolve) => {
    let best = initialPos;
    let bestAcc = acc ?? 9999;
    let watchId = null;
    let done = false;
    const tRef = performance.now();

    const finish = (reason) => {
      if (done) return;
      done = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      log('refine:done', {
        reason,
        elapsedMs: Math.round(performance.now() - tRef),
        bestAccuracyM: bestAcc,
      });
      resolve(best);
    };

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        clearTimeout(timer);
        finish('tab_hidden');
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    const timer = setTimeout(() => finish('timeout'), maxRefineMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const a = pos.coords.accuracy ?? 9999;
        if (a < bestAcc) {
          best = pos;
          bestAcc = a;
        }
        if (a <= target) {
          clearTimeout(timer);
          finish('target_reached');
        }
      },
      () => {
        clearTimeout(timer);
        finish('watch_error');
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

/** Build a GeolocationPosition-shaped object for manual / pasted coordinates. */
export function buildManualGeolocationPosition(latitude, longitude) {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 100,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  };
}

/**
 * Parse "lat, lng", two lines, or a Google Maps URL fragment like @-33.9,25.5
 */
export function parseLatLngFromUserInput(latRaw, lngRaw) {
  const a = String(latRaw ?? '').trim();
  const b = String(lngRaw ?? '').trim();

  const fromMaps = a.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)\b/);
  if (fromMaps) {
    const lat = Number(fromMaps[1]);
    const lng = Number(fromMaps[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  if (a.includes(',') && !b) {
    const parts = a.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (isValidLatLng(lat, lng)) return { lat, lng };
    }
  }

  const lat = Number(a);
  const lng = Number(b);
  if (isValidLatLng(lat, lng)) return { lat, lng };
  return null;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
