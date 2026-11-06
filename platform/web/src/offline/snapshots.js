import {
  ACCOUNT_SCOPE,
  OFFLINE_SCREENS,
  isStaleOfflineKey,
  keyBelongsToUser,
  offlineIndexKey,
  prepareSnapshot,
  redactForOfflineCache,
  screenCacheKey,
  toProfileSnapshot,
} from "./policy.js";
import { offlineStore } from "./store.js";

const chains = new Map();

function resolveStore(store) {
  return store || offlineStore();
}

async function readIndex(store) {
  const raw = await store.get(offlineIndexKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(store, keys) {
  const unique = [...new Set(keys)];
  await store.set(offlineIndexKey(), JSON.stringify(unique));
}

async function rememberKey(store, key) {
  const keys = await readIndex(store);
  if (keys.includes(key)) return;
  keys.push(key);
  await writeIndex(store, keys);
}

async function knownKeys(store) {
  const indexed = await readIndex(store);
  const scanned = typeof store.keys === "function" ? await store.keys() : [];
  return [...new Set([...indexed, ...scanned])];
}

export async function writeScreenSnapshot(scope, data, now = Date.now(), store = resolveStore()) {
  if (!scope?.userId || !scope?.screen) return null;
  const prepared = prepareSnapshot(scope.screen, data, now);
  if (prepared == null) return null;
  const key = screenCacheKey(scope);
  const record = { savedAt: new Date(now).toISOString(), data: prepared };
  try {
    await store.set(key, JSON.stringify(record));
    await rememberKey(store, key);
  } catch {
    return null;
  }
  return record;
}

export async function readScreenSnapshot(scope, now = Date.now(), store = resolveStore()) {
  if (!scope?.userId || !scope?.screen) return null;
  const key = screenCacheKey(scope);
  let raw = null;
  try {
    raw = await store.get(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.savedAt) return null;
    return {
      savedAt: parsed.savedAt,
      data: redactForOfflineCache(parsed.data, now),
    };
  } catch {
    return null;
  }
}

export function patchScreenSnapshot(scope, patch, now = Date.now(), store = resolveStore()) {
  const key = screenCacheKey(scope);
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    const current = await readScreenSnapshot(scope, now, store);
    const data = patch(current?.data ?? null);
    return writeScreenSnapshot(scope, data, now, store);
  });
  chains.set(key, next);
  return next;
}

export async function clearOfflineUser(userId, store = resolveStore()) {
  if (!userId) return;
  const keys = await knownKeys(store);
  const kept = [];
  for (const key of keys) {
    if (key === offlineIndexKey()) continue;
    if (keyBelongsToUser(key, userId)) {
      try {
        await store.remove(key);
      } catch {
        /* still drop it from the index */
      }
    } else if (String(key).startsWith("wm-offline-shell-v")) {
      kept.push(key);
    }
  }
  try {
    await writeIndex(store, kept);
  } catch {
    /* the per-key delete already happened */
  }
}

export async function purgeStaleOfflineCache(store = resolveStore()) {
  const keys = await knownKeys(store);
  const kept = [];
  for (const key of keys) {
    if (!isStaleOfflineKey(key)) {
      if (key !== offlineIndexKey() && String(key).startsWith("wm-offline-shell-v")) kept.push(key);
      continue;
    }
    try {
      await store.remove(key);
    } catch {
      /* ignore */
    }
  }
  try {
    await writeIndex(store, kept);
  } catch {
    /* ignore */
  }
}

export function profileSnapshotScope(userId) {
  return { userId, organizationId: ACCOUNT_SCOPE, screen: OFFLINE_SCREENS.profile };
}

export async function saveProfileSnapshot(user, now = Date.now(), store = resolveStore()) {
  const userId = user?.uid || user?.id;
  if (!userId) return null;
  const data = toProfileSnapshot(user, now);
  if (!data?.role) return null;
  return writeScreenSnapshot(profileSnapshotScope(userId), data, now, store);
}

export async function readProfileSnapshot(userId, now = Date.now(), store = resolveStore()) {
  if (!userId) return null;
  const record = await readScreenSnapshot(profileSnapshotScope(userId), now, store);
  if (!record?.data?.role) return null;
  return record;
}
