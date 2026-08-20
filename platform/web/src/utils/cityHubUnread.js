import { parsePatrolTime } from "./watchTime";

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

export function markCityHubVisited(userId, seenAtIso = null) {
  const next = laterIso(seenAtIso, new Date().toISOString());
  if (!next) return;
  const current = laterIso(readCityHubLastSeen(userId), next);
  if (userId) writeKey(storageKey(userId), current);
  writeKey(SHARED_KEY, current);
  try {
    window.dispatchEvent(new Event(CITY_HUB_READ_EVENT));
  } catch {
    /* ignore */
  }
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
