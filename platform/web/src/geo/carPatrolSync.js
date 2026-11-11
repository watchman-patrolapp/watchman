import { registerPlugin } from '@capacitor/core';
import { distanceMeters } from '../utils/dataSaverProfile.js';
import { isAndroidNativePlatform } from './carSessionSync.js';

/**
 * Tells the Android Auto screen about the phone's current patrol (start time, session km, latest
 * GPS fix, including fixes still queued for upload), and listens for changes made from the car.
 *
 * Android native only. Failures are swallowed (console.debug); the patroller never sees them.
 */

const MAX_ACCURACY_M = 75;
const MIN_STEP_M = 5;
const MAX_SPEED_KMH = 200;
const THROTTLE_MS = 10_000;

let cachedPlugin = null;

function defaultPlugin() {
  if (!cachedPlugin) cachedPlugin = registerPlugin('WatchmanPatrol');
  return cachedPlugin;
}

function validCoord(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * Session distance, uncapped (the phone dashboard only sums the last 50 points).
 * Ignores poor fixes, jitter under 5 m, and jumps faster than 200 km/h.
 */
export function createDistanceAccumulator() {
  let startKey = null;
  let last = null;
  let meters = 0;

  return {
    reset(nextStartKey = null) {
      startKey = nextStartKey;
      last = null;
      meters = 0;
    },
    add(lat, lng, accuracy, atMs) {
      if (!validCoord(lat, lng)) return meters / 1000;
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return meters / 1000;
      const at = Number.isFinite(atMs) ? atMs : Date.now();
      if (!last) {
        last = { lat, lng, at };
        return meters / 1000;
      }
      const step = distanceMeters(last.lat, last.lng, lat, lng);
      if (step < MIN_STEP_M) return meters / 1000;
      const seconds = (at - last.at) / 1000;
      const kmh = seconds > 0 ? (step / seconds) * 3.6 : Infinity;
      // A teleport moves the anchor but adds nothing, so later fixes are measured from here.
      if (kmh <= MAX_SPEED_KMH) meters += step;
      last = { lat, lng, at };
      return meters / 1000;
    },
    get km() {
      return meters / 1000;
    },
    get startKey() {
      return startKey;
    },
  };
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Maps the lifecycle state to the argument of WatchmanPatrol.syncPatrolState. */
export function buildCarPatrolPayload({ activePatrol, startTime, location, distanceKm, userId }) {
  const startMs = toMs(startTime);
  if (!userId || !activePatrol || startMs === null) {
    return { active: false, userId: userId || '' };
  }
  const payload = {
    active: true,
    userId,
    startTime: startMs,
    sessionDistanceKm: Math.round((Number(distanceKm) || 0) * 100) / 100,
  };
  if (location && validCoord(location.lat, location.lng)) {
    payload.latitude = location.lat;
    payload.longitude = location.lng;
    if (Number.isFinite(location.accuracy)) payload.accuracy = location.accuracy;
    const recorded = toMs(location.timestamp);
    if (recorded !== null) payload.recordedAt = recorded;
  }
  return payload;
}

const moduleState = { lastSentAt: 0, lastActive: undefined, lastStartTime: undefined };

/**
 * At most one native call per 10 s, except that a change of `active` or startTime goes at once.
 * Resolves to 'skipped' | 'throttled' | 'synced' | 'failed'. It never rejects.
 */
export async function syncCarPatrolState(payload, deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative || !payload) return 'skipped';

  const state = deps.state ?? moduleState;
  const now = (deps.now ?? Date.now)();
  const active = Boolean(payload.active);
  const startTime = active ? payload.startTime : null;
  const changed = state.lastActive !== active || state.lastStartTime !== startTime;

  if (!changed) {
    // An inactive phone has nothing new to say, and an active one is rate limited.
    if (!active) return 'throttled';
    if (now - state.lastSentAt < (deps.throttleMs ?? THROTTLE_MS)) return 'throttled';
  }

  try {
    const plugin = deps.plugin ?? defaultPlugin();
    await plugin.syncPatrolState(payload);
    state.lastSentAt = now;
    state.lastActive = active;
    state.lastStartTime = startTime;
    return 'synced';
  } catch (err) {
    console.debug('carPatrolSync:', err);
    return 'failed';
  }
}

/**
 * A patrol started from the car: look up the patrol and start phone GPS right away. The patrol id
 * is active_patrols.user_id. Resolves to 'started' | 'ignored' | 'no_patrol' | 'failed'; never rejects.
 */
export async function startGpsForCarCheckIn(reason, { userId, fetchMine, startGps }) {
  if (reason !== 'patrol_started' || !userId) return 'ignored';
  try {
    const row = await fetchMine();
    if (!row?.user_id) return 'no_patrol';
    startGps({ patrolId: row.user_id, userId });
    return 'started';
  } catch (err) {
    console.debug('carPatrolSync gps:', err);
    return 'failed';
  }
}

/**
 * Calls handler(reason) whenever the car changed something. Android native only.
 * Returns a cleanup function; it never throws.
 */
export function listenForCarChanges(handler, deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return () => {};

  let removed = false;
  let handle = null;
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    Promise.resolve(plugin.addListener('carStateChanged', (event) => handler(event?.reason)))
      .then((added) => {
        handle = { remove: () => added?.remove?.() };
        if (removed) handle.remove();
      })
      .catch((err) => console.debug('carPatrolSync listen:', err));
  } catch (err) {
    console.debug('carPatrolSync listen:', err);
  }
  return () => {
    removed = true;
    try {
      handle?.remove();
    } catch {
      // Already gone.
    }
  };
}
