/**
 * One ref-counted chat_messages INSERT subscription, fanned out in process.
 *
 * Supabase realtime accepts a single filter per binding. Rooms are the
 * `visibility` column (`patrol` | `resident`, NOT NULL). Subscribers that
 * together need more than one room share one channel:
 *   visibility=in.(patrol,resident)
 * A single room uses visibility=eq.<room>.
 * Organisation is not a second server filter (the API allows only one). Rows
 * for another neighbourhood are dropped here, before any subscriber runs.
 */

export const CHAT_REALTIME_ROOMS = Object.freeze(['patrol', 'resident']);

const ROOM_SET = new Set(CHAT_REALTIME_ROOMS);

export function scopeAcceptsMessage(message, scope) {
  if (!scope || !scope.organizationId) return false;
  if (message?.organization_id === scope.organizationId) return true;
  return Boolean(scope.includeUnscoped && message?.organization_id == null);
}

export function channelSpecForRooms(rooms) {
  const sorted = [...rooms].sort();
  if (sorted.length === 1) {
    const room = sorted[0];
    return {
      key: `visibility:${room}`,
      topic: `chat-messages-visibility-${room}`,
      filter: `visibility=eq.${room}`,
    };
  }
  return {
    key: `visibility:${sorted.join(',')}`,
    topic: `chat-messages-visibility-${sorted.join('-')}`,
    filter: `visibility=in.(${sorted.join(',')})`,
  };
}

function normalizeRooms(rooms) {
  if (rooms == null) return null;
  const list = [];
  for (const room of rooms) {
    if (ROOM_SET.has(room) && !list.includes(room)) list.push(room);
  }
  return list;
}

function demandedRooms(subscribers) {
  const set = new Set();
  for (const sub of subscribers.values()) {
    if (sub.rooms == null) {
      for (const room of CHAT_REALTIME_ROOMS) set.add(room);
    } else {
      for (const room of sub.rooms) set.add(room);
    }
  }
  return set;
}

function roomAccepts(sub, message) {
  if (sub.rooms == null) return true;
  const visibility = message?.visibility || 'patrol';
  return sub.rooms.includes(visibility);
}

export function createChatRealtimeHub({ openChannel, schedule = queueMicrotask } = {}) {
  if (typeof openChannel !== 'function') {
    throw new Error('createChatRealtimeHub requires openChannel');
  }

  const subscribers = new Map();
  const channels = new Map();
  let nextId = 1;
  let generation = 0;

  function closeChannel(key) {
    const entry = channels.get(key);
    if (!entry) return;
    channels.delete(key);
    try {
      entry.close();
    } catch (err) {
      console.error('chat realtime channel close failed', err);
    }
  }

  function syncChannels() {
    const demanded = demandedRooms(subscribers);
    const specs = demanded.size ? [channelSpecForRooms(demanded)] : [];
    const wanted = new Set(specs.map((spec) => spec.key));

    for (const key of channels.keys()) {
      if (!wanted.has(key)) closeChannel(key);
    }

    for (const spec of specs) {
      if (channels.has(spec.key)) continue;
      let closed = false;
      const handle = openChannel({
        topic: spec.topic,
        filter: spec.filter,
        onInsert(message) {
          if (closed) return;
          dispatch(message);
        },
      });
      channels.set(spec.key, {
        spec,
        close() {
          if (closed) return;
          closed = true;
          handle?.close?.();
        },
      });
    }
  }

  function scheduleIdleClose() {
    const token = ++generation;
    schedule(() => {
      if (token !== generation) return;
      if (subscribers.size === 0) {
        for (const key of [...channels.keys()]) closeChannel(key);
      } else {
        syncChannels();
      }
    });
  }

  function dispatch(message) {
    for (const sub of subscribers.values()) {
      const scope = sub.getScope() || null;
      if (scope && !scopeAcceptsMessage(message, scope)) continue;
      if (!roomAccepts(sub, message)) continue;
      try {
        sub.handler(message);
      } catch (err) {
        console.error('chat realtime subscriber failed', err);
      }
    }
  }

  function subscribe(handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('chat realtime handler must be a function');
    }
    const id = nextId++;
    generation += 1;
    subscribers.set(id, {
      handler,
      rooms: normalizeRooms(options.rooms),
      getScope: typeof options.getScope === 'function' ? options.getScope : () => options.scope || null,
    });
    syncChannels();

    let released = false;
    return function unsubscribe() {
      if (released) return;
      released = true;
      subscribers.delete(id);
      if (subscribers.size === 0) scheduleIdleClose();
      else syncChannels();
    };
  }

  return {
    subscribe,
    getChannelCount() {
      return channels.size;
    },
    getChannels() {
      return [...channels.values()].map((entry) => ({ ...entry.spec }));
    },
    getSubscriberCount() {
      return subscribers.size;
    },
    flush() {
      generation += 1;
      if (subscribers.size === 0) {
        for (const key of [...channels.keys()]) closeChannel(key);
      } else {
        syncChannels();
      }
    },
  };
}
