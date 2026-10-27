import { parsePatrolTime } from "./watchTime";
import { supabase } from "../supabase/client";

export const CITY_HUB_READ_EVENT = "city-hub-read-updated";

const SHARED_KEY = "nwp.cityHub.lastSeen";
const storageKey = (userId) => `nwp.cityHub.lastSeen.${userId || "anon"}`;

export function cityHubActorId(user) {
  return user?.id || user?.uid || "";
}

function readKey(key) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key) || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null);
  } catch {
    return null;
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function writeLocalLastSeen(userId, iso) {
  if (!iso) return;
  if (userId) writeKey(storageKey(userId), iso);
  writeKey(SHARED_KEY, iso);
}

export function readCityHubLastSeen(userId) {
  if (userId) {
    const perUser = readKey(storageKey(userId));
    if (perUser) return perUser;
  }
  return readKey(SHARED_KEY);
}

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = parsePatrolTime(a)?.getTime() ?? Date.parse(a);
  const tb = parsePatrolTime(b)?.getTime() ?? Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta >= tb ? a : b;
}

function emitReadUpdated() {
  try {
    window.dispatchEvent(new Event(CITY_HUB_READ_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Push last-seen to Supabase. No-ops quietly if the migration is not applied yet.
 */
async function pushCityHubLastSeen(userId, iso) {
  if (!userId || !iso) return null;
  try {
    const { data, error } = await supabase.rpc("mark_city_hub_visited", {
      p_seen_at: iso,
    });
    if (error) throw error;
    if (data) {
      const merged = laterIso(readCityHubLastSeen(userId), data);
      writeLocalLastSeen(userId, merged);
      return merged;
    }
  } catch {
    /* offline / RPC missing — local cache still works on this device */
  }
  return null;
}

/**
 * Merge server last-seen into local cache (and upload local if it is newer).
 * Call on dashboard load so the badge survives sign-in / other devices.
 */
export async function hydrateCityHubLastSeen(userId) {
  if (!userId) return readCityHubLastSeen(userId);
  const local = readCityHubLastSeen(userId);
  try {
    const { data, error } = await supabase.rpc("get_city_hub_last_seen");
    if (error) throw error;
    const server = data || null;
    const merged = laterIso(local, server);
    if (merged) {
      writeLocalLastSeen(userId, merged);
      if (local && local !== server && laterIso(local, server) === local) {
        void pushCityHubLastSeen(userId, local);
      }
    }
    return merged || null;
  } catch {
    return local;
  }
}

export function markCityHubVisited(userId, seenAtIso = null) {
  const next = laterIso(seenAtIso, new Date().toISOString());
  if (!next) return null;
  const current = laterIso(readCityHubLastSeen(userId), next);
  writeLocalLastSeen(userId, current);
  emitReadUpdated();
  if (userId) {
    void pushCityHubLastSeen(userId, current).then((serverMerged) => {
      if (serverMerged && serverMerged !== current) {
        emitReadUpdated();
      }
    });
  }
  return current;
}

export function isCityHubPath(pathname = "") {
  return pathname === "/city-hub" || pathname.startsWith("/city-hub/");
}

export function isCityHubPostUnread(post, lastSeenIso) {
  if (!post || post.status !== "published") return false;
  if (!lastSeenIso) return true;
  const created =
    parsePatrolTime(post.created_at || post.updated_at)?.getTime() ??
    Date.parse(post.created_at || post.updated_at || "");
  if (!Number.isFinite(created)) return false;
  const seen = parsePatrolTime(lastSeenIso)?.getTime() ?? Date.parse(lastSeenIso);
  if (!Number.isFinite(seen)) return true;
  return created > seen;
}
