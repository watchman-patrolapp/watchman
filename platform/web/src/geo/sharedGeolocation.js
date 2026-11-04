/**
 * Single navigator.geolocation.watchPosition shared by the threat banner and
 * patrol tracking.
 *
 * - Banner consumers use a low-accuracy, high maximumAge watch.
 * - Any patrol consumer upgrades that one watch (it is restarted, not doubled).
 * - While the tab is hidden the watch stops unless a patrol consumer is held.
 *   Patrol options themselves come from the caller, so data-saver throttling
 *   still applies during a patrol.
 */

export const BANNER_WATCH_OPTIONS = Object.freeze({
  enableHighAccuracy: false,
  maximumAge: 120000,
  timeout: 30000,
});

function optionsKey(options) {
  return JSON.stringify(options);
}

export function createSharedGeolocation({
  watchPosition,
  clearWatch,
  getCurrentPosition,
  isHidden = () => false,
  getPatrolOptions,
  getBannerOptions = () => ({ ...BANNER_WATCH_OPTIONS }),
  supported = true,
} = {}) {
  if (typeof watchPosition !== 'function' || typeof clearWatch !== 'function') {
    throw new Error('createSharedGeolocation requires watchPosition and clearWatch');
  }
  if (typeof getPatrolOptions !== 'function') {
    throw new Error('createSharedGeolocation requires getPatrolOptions');
  }

  const consumers = new Map();
  let nextId = 1;
  let watchId = null;
  let activeKey = null;
  let lastPosition = null;

  function hasPurpose(purpose) {
    for (const consumer of consumers.values()) {
      if (consumer.purpose === purpose) return true;
    }
    return false;
  }

  function desired() {
    if (!supported || consumers.size === 0) return null;
    const patrol = hasPurpose('patrol');
    if (isHidden() && !patrol) return null;
    if (patrol) return { purpose: 'patrol', options: getPatrolOptions() };
    if (hasPurpose('banner')) return { purpose: 'banner', options: getBannerOptions() };
    return null;
  }

  function stopWatch() {
    if (watchId == null) return;
    const id = watchId;
    watchId = null;
    activeKey = null;
    try {
      clearWatch(id);
    } catch (err) {
      console.error('shared geolocation clearWatch failed', err);
    }
  }

  function emitPosition(position) {
    lastPosition = position;
    for (const consumer of consumers.values()) {
      try {
        consumer.onPosition?.(position);
      } catch (err) {
        console.error('shared geolocation listener failed', err);
      }
    }
  }

  function emitError(error) {
    for (const consumer of consumers.values()) {
      try {
        consumer.onError?.(error);
      } catch (err) {
        console.error('shared geolocation error listener failed', err);
      }
    }
  }

  function startWatch(plan) {
    const key = `${plan.purpose}:${optionsKey(plan.options)}`;
    if (watchId != null && activeKey === key) return;
    stopWatch();
    activeKey = key;
    if (plan.purpose === 'patrol' && typeof getCurrentPosition === 'function') {
      try {
        getCurrentPosition((position) => emitPosition(position), (error) => emitError(error), plan.options);
      } catch (err) {
        console.error('shared geolocation getCurrentPosition failed', err);
      }
    }
    watchId = watchPosition((position) => emitPosition(position), (error) => emitError(error), plan.options);
  }

  function sync() {
    const plan = desired();
    if (!plan) {
      stopWatch();
      return;
    }
    startWatch(plan);
  }

  function acquire(consumer = {}) {
    const id = nextId++;
    const purpose = consumer.purpose === 'patrol' ? 'patrol' : 'banner';
    consumers.set(id, { ...consumer, purpose });
    sync();
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      consumers.delete(id);
      sync();
    };
  }

  return {
    acquire,
    onVisibilityChange() {
      sync();
    },
    getWatchCount() {
      return watchId == null ? 0 : 1;
    },
    getMode() {
      return desired()?.purpose ?? 'idle';
    },
    getLastLocation() {
      const latitude = lastPosition?.coords?.latitude;
      const longitude = lastPosition?.coords?.longitude;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
      return { lat: latitude, lng: longitude };
    },
  };
}
