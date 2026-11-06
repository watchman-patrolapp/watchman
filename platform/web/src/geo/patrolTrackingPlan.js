/** Pure decisions for patrol GPS: row shape, offline queue, and permission outcome. */

export const QUEUE_STORAGE_KEY = 'watchman_patrol_location_queue_v1';
export const QUEUE_LIMIT = 2000;

export const PATROL_NOTIFICATION_TITLE = 'Watchman: patrol in progress';
export const PATROL_NOTIFICATION_TEXT =
  'Watchman is recording your route. Tap to return. Stop in the app to end tracking.';

const MESSAGES = {
  denied: 'Location is off for Watchman. Turn it on in system settings to record this patrol.',
  'background-unavailable':
    'Watchman will record your route while the app is open. To keep recording with the screen off, choose Allow all the time.',
  notifications:
    'Notifications are off, so Android cannot keep the patrol notification. Your route is recorded while Watchman is open.',
  'background-failed':
    'Background tracking could not start. Your route is recorded while Watchman is open.',
  signal: 'GPS signal dropped. The route will continue when it returns.',
};

export function friendlyTrackingMessage(kind) {
  return MESSAGES[kind] || MESSAGES.signal;
}

export function createPointId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (symbol) => {
    const rand = Math.floor(Math.random() * 16);
    const value = symbol === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function pluginLocationToPosition(location) {
  return {
    coords: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      altitude: location.altitude ?? null,
      heading: location.bearing ?? null,
      speed: location.speed ?? null,
    },
    timestamp: location.time || Date.now(),
  };
}

export function recordedAtFromFix(timestampMs) {
  const ms = Number(timestampMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/**
 * Same columns as the existing patrol_locations insert, plus a client id so a
 * retry of the same fix cannot create a second row.
 */
export function buildQueuedPoint({
  id,
  patrolId,
  userId,
  coords,
  organizationId,
  recordedAt,
}) {
  return {
    id: id || createPointId(),
    patrol_id: patrolId,
    user_id: userId,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null,
    altitude: coords.altitude ?? null,
    speed: coords.speed ?? null,
    organization_id: organizationId ?? null,
    recorded_at: recordedAt || null,
  };
}

export function insertBodyFromPoint(point, { includeTimestamp = false } = {}) {
  const body = {
    id: point.id,
    patrol_id: point.patrol_id,
    user_id: point.user_id,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    organization_id: point.organization_id,
  };
  if (includeTimestamp && point.recorded_at) {
    body.timestamp = point.recorded_at;
  }
  return body;
}

export function classifyInsertResult({ ok = false, status, code, message } = {}) {
  if (ok) return 'sent';
  const blob = `${code || ''} ${status || ''} ${message || ''}`;
  if (status === 409 || String(code) === '23505' || /23505|duplicate key|already exists/i.test(blob)) {
    return 'duplicate';
  }
  // A bad row or a patrol that has already ended will never succeed. Drop it
  // so the queue cannot fill with permanent failures. 401/408/429 stay queued.
  const numeric = Number(status);
  if (numeric === 400 || numeric === 422 || (String(code).startsWith('23') && String(code) !== '23505')) {
    return 'drop';
  }
  return 'retry';
}

export function parseQueue(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.patrol_id === 'string' &&
        typeof item.user_id === 'string' &&
        typeof item.latitude === 'number' &&
        typeof item.longitude === 'number'
    );
  } catch {
    return [];
  }
}

export function enqueuePoint(queue, point, limit = QUEUE_LIMIT) {
  const list = Array.isArray(queue) ? queue : [];
  if (list.some((item) => item.id === point.id)) return list;
  const next = [...list, point];
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

/** Sign-out drops this person's unsent points so the next account cannot upload them. */
export function dropQueuedPointsForUser(queue, userId) {
  const list = Array.isArray(queue) ? queue : [];
  if (!userId) return list;
  return list.filter((item) => item?.user_id !== userId);
}

export function createPatrolLocationQueue({ load, save, insertRow }) {
  let chain = Promise.resolve();

  function run(task) {
    const next = chain.then(task, task);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  return {
    enqueue(point) {
      return run(async () => {
        const current = await load();
        await save(enqueuePoint(current, point));
      });
    },
    flush() {
      return run(async () => {
        const items = await load();
        const kept = [];
        let sent = 0;
        for (const item of items) {
          let result = 'retry';
          try {
            result = await insertRow(item);
          } catch {
            result = 'retry';
          }
          if (result === 'sent' || result === 'duplicate' || result === 'drop') sent += 1;
          else kept.push(item);
        }
        await save(kept);
        return { sent, kept: kept.length };
      });
    },
    clearUser(userId) {
      return run(async () => {
        const items = await load();
        await save(dropQueuedPointsForUser(items, userId));
      });
    },
  };
}

/**
 * Android asks for while-in-use location, then "Allow all the time".
 * Web and any non-Android platform stay on the foreground watch.
 * A declined or failed background grant never blocks the open-app watch.
 */
export async function runPatrolPermissionFlow(deps) {
  if (!deps || deps.platform !== 'android') return { mode: 'foreground' };
  try {
    let status = await deps.readStatus();
    const sdkInt = Number(status?.sdkInt) || 0;

    if (status?.foreground !== 'granted') {
      const proceed = deps.askForeground ? await deps.askForeground() : true;
      if (!proceed) return { mode: 'denied', message: friendlyTrackingMessage('denied') };
      status = { ...status, ...(await deps.requestForeground()) };
    }
    if (status?.foreground !== 'granted') {
      return { mode: 'denied', message: friendlyTrackingMessage('denied') };
    }

    const notificationsOk = sdkInt < 33 || status?.notifications === 'granted';
    if (status?.background === 'granted' && notificationsOk) {
      await offerBatteryExemption(deps);
      return { mode: 'background' };
    }

    const accepted = deps.askDisclosure ? await deps.askDisclosure() : false;
    if (!accepted) {
      return { mode: 'foreground', message: friendlyTrackingMessage('background-unavailable') };
    }

    if (status?.background !== 'granted') {
      status = { ...status, ...(await deps.requestBackground()) };
    }
    if (status?.background !== 'granted') {
      return { mode: 'foreground', message: friendlyTrackingMessage('background-unavailable') };
    }

    if (sdkInt >= 33 && status?.notifications !== 'granted') {
      status = { ...status, ...(await deps.requestNotifications()) };
    }
    if (sdkInt >= 33 && status?.notifications !== 'granted') {
      return { mode: 'foreground', message: friendlyTrackingMessage('notifications') };
    }

    await offerBatteryExemption(deps);
    return { mode: 'background' };
  } catch {
    return { mode: 'foreground', message: friendlyTrackingMessage('background-failed') };
  }
}

async function offerBatteryExemption(deps) {
  let ignoring = true;
  try {
    ignoring = await deps.isIgnoringBattery();
  } catch {
    return;
  }
  if (ignoring) return;
  const allow = deps.askBattery ? await deps.askBattery() : false;
  if (!allow) return;
  try {
    await deps.requestBatteryExemption();
  } catch {
    /* The patrol still runs. The explainer already told them why. */
  }
}
