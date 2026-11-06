/**
 * Pure rules for the offline shell. The service worker, the read cache, and
 * the write guard all follow this file so a test can pin the edge cases.
 */

export const OFFLINE_CACHE_VERSION = 1;

export const OFFLINE_WRITE_MESSAGE = "You’re offline, try again when connected";

export const OFFLINE_READ_MESSAGE = "Couldn’t refresh just now. Try again when you are connected.";

/** Screens that keep a last-good copy. Profile and the area list are account-scoped. */
export const OFFLINE_SCREENS = Object.freeze({
  profile: "profile",
  organizations: "organizations",
  dashboard: "dashboard",
  incidents: "incidents",
  patrolStatus: "patrol-status",
  equipment: "equipment",
  cityHub: "city-hub",
});

/** Not a tenant. Profile and the area list belong to the signed-in account. */
export const ACCOUNT_SCOPE = "account";

export const FCM_PUSH_SCOPE = "/firebase-cloud-messaging-push-scope";

const DATA_PREFIX = "wm-offline-shell-v";
const INDEX_PREFIX = "wm-offline-index-v";

export const MAX_SNAPSHOT_CHARS = 350_000;

const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "password",
  "token",
  "provider_token",
  "provider_refresh_token",
]);

/** Equipment actions that already wait on the phone. Patrol points are a table insert. */
const QUEUED_EQUIPMENT_RPCS = new Set([
  "request_equipment_return",
  "report_equipment_issue",
  "confirm_equipment_handover_giver",
  "count_equipment_unit",
  "confirm_equipment_still_held",
  "submit_equipment_paper_claim",
]);

const PROFILE_FIELDS = [
  "fullName",
  "email",
  "address",
  "phone",
  "carType",
  "registrationNumber",
  "vehicleColor",
  "avatarUrl",
  "role",
  "sopVersionAccepted",
  "sopAcceptedAt",
  "createdAt",
  "organizationId",
  "activeOrganizationId",
  "homeSuburbId",
  "patrollerSuburbId",
  "homeLat",
  "homeLng",
  "homePinSetAt",
  "isVerifiedResident",
  "verificationMethod",
  "platformRole",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactUserId",
  "emergencyContactRelationship",
  "emergencyContact2Name",
  "emergencyContact2Phone",
  "emergencyContact2UserId",
  "emergencyContact2Relationship",
  "vehicles",
  "requiredSopVersion",
];

export function offlineIndexKey(version = OFFLINE_CACHE_VERSION) {
  return `${INDEX_PREFIX}${version}`;
}

export function screenCacheKey({ userId, organizationId, screen }, version = OFFLINE_CACHE_VERSION) {
  const org = organizationId || "none";
  return `${DATA_PREFIX}${version}:${userId}:${org}:${screen}`;
}

export function keyBelongsToUser(key, userId) {
  if (!userId) return false;
  const match = String(key).match(/^wm-offline-shell-v\d+:([^:]+):/);
  return Boolean(match && match[1] === String(userId));
}

export function isStaleOfflineKey(key, version = OFFLINE_CACHE_VERSION) {
  const data = String(key).match(/^wm-offline-shell-v(\d+):/);
  if (data) return Number(data[1]) !== version;
  const index = String(key).match(/^wm-offline-index-v(\d+)$/);
  if (index) return Number(index[1]) !== version;
  return false;
}

export function isSupabaseAuthUrl(url) {
  return /\/auth\/v1\//.test(String(url || ""));
}

export function isSignedMediaRequest(url) {
  const href = String(url || "");
  if (/\/storage\/v1\/object\/sign\//.test(href)) return true;
  if (/\/object\/sign\//.test(href)) return true;
  if (/[?&]token=/.test(href) && /\/storage\/v1\//.test(href)) return true;
  return false;
}

/** Service worker Cache API must not keep auth responses or signed media. */
export function serviceWorkerMayCache(url) {
  const href = String(url || "");
  if (!href) return false;
  if (isSupabaseAuthUrl(href)) return false;
  if (isSignedMediaRequest(href)) return false;
  if (/supabase\.co/i.test(href)) return false;
  if (/supabase\.in/i.test(href)) return false;
  return true;
}

export function isQueuedOfflineWrite(url, method) {
  const verb = String(method || "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD") return false;
  let path = "";
  try {
    path = new URL(String(url), "https://watchman.local").pathname;
  } catch {
    path = String(url || "");
  }
  if (verb === "POST" && /\/rest\/v1\/patrol_locations\/?$/.test(path)) return true;
  const rpc = path.match(/\/rest\/v1\/rpc\/([^/]+)/);
  if (rpc && QUEUED_EQUIPMENT_RPCS.has(decodeURIComponent(rpc[1]))) return true;
  return false;
}

function isReadMethod(method) {
  const verb = String(method || "GET").toUpperCase();
  return verb === "GET" || verb === "HEAD";
}

/**
 * What the Supabase fetch wrapper should do.
 * Queued patrol points and equipment actions are left alone so their own queues run.
 * Every other write while offline becomes the friendly message.
 * Nothing here is allowed into the HTTP cache.
 */
export function decideSupabaseFetch({ url, method, online }) {
  const href = String(url || "");
  const read = isReadMethod(method);
  if (isSupabaseAuthUrl(href)) {
    return { action: "passthrough", cache: "never" };
  }
  if (isSignedMediaRequest(href)) {
    if (online === false && !read) {
      return { action: "block", cache: "never", message: OFFLINE_WRITE_MESSAGE };
    }
    return { action: "passthrough", cache: "never" };
  }
  if (read || online !== false) {
    return { action: "passthrough", cache: "never" };
  }
  if (isQueuedOfflineWrite(href, method)) {
    return { action: "passthrough", cache: "never" };
  }
  return { action: "block", cache: "never", message: OFFLINE_WRITE_MESSAGE };
}

export function isOfflineOrNetworkError(error) {
  if (error?.code === "offline") return true;
  const msg = String(error?.message || error || "");
  return /failed to fetch|networkerror|network request failed|offline|timeout|load failed|you’re offline|you're offline|couldn’t refresh|couldn't refresh/i.test(msg);
}

export function userFacingWriteError(error, fallback = "That could not be saved. Try again when you are connected.") {
  if (isOfflineOrNetworkError(error)) return OFFLINE_WRITE_MESSAGE;
  return fallback;
}

export function userFacingReadError(error, fallback = OFFLINE_READ_MESSAGE) {
  if (isOfflineOrNetworkError(error)) return OFFLINE_WRITE_MESSAGE;
  const msg = String(error?.message || "").trim();
  if (!msg || msg.length > 180) return fallback;
  if (/syntax error|duplicate key|violates |SQLSTATE|permission denied|PGRST|JWT|TypeError|stack|relation "|column "/i.test(msg)) {
    return fallback;
  }
  return msg;
}

export function shellUpdateAction({ online, installedRevision, nextRevision }) {
  if (!nextRevision || nextRevision === installedRevision) return "current";
  if (online === false) return "keep-installed";
  return "activate-and-reload";
}

/**
 * A root-scoped FCM worker would replace the app-shell worker.
 * Move it to the push scope. Leave /sw.js in place so a deploy can update it.
 */
export function fcmRegistrationPlan({ scriptUrl = "", scopePath = "" } = {}) {
  const url = String(scriptUrl);
  const path = String(scopePath || "");
  if (url.includes("firebase-messaging-sw") && (path === "/" || path === "")) {
    return "move-to-push-scope";
  }
  if (url.includes("firebase-messaging-sw")) return "keep-push-worker";
  if (url.endsWith("/sw.js")) return "keep-shell";
  return "leave";
}

export function signedUrlExpiryMs(url) {
  try {
    const parsed = new URL(String(url));
    const token = parsed.searchParams.get("token");
    const expParam = parsed.searchParams.get("exp") || parsed.searchParams.get("expires");
    if (expParam && /^\d+$/.test(expParam)) {
      const n = Number(expParam);
      if (!Number.isFinite(n)) return null;
      return n > 1e12 ? n : n * 1000;
    }
    if (!token || token.split(".").length < 2) return null;
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const json = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

export function isSignedStorageUrl(value) {
  if (typeof value !== "string") return false;
  if (!/^https?:\/\//i.test(value)) return false;
  return /\/storage\/v1\/object\/sign\//.test(value) || (/[?&]token=/.test(value) && /\/storage\/v1\//.test(value));
}

export function redactForOfflineCache(value, now = Date.now(), depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    return value.map((item) => redactForOfflineCache(item, now, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEYS.has(key)) continue;
      out[key] = redactForOfflineCache(child, now, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && isSignedStorageUrl(value)) {
    const exp = signedUrlExpiryMs(value);
    if (exp == null || exp <= now) return null;
    return value;
  }
  return value;
}

function jsonSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return MAX_SNAPSHOT_CHARS + 1;
  }
}

function stripIncidentRows(data, mode) {
  if (!data || typeof data !== "object") return data;
  const pages = Array.isArray(data.pages) ? data.pages : null;
  if (!pages) return data;
  return {
    ...data,
    pages: pages.map((page) => ({
      ...page,
      rows: (page.rows || []).map((row) => {
        if (mode === "media") {
          return {
            ...row,
            evidenceRows: Array.isArray(row.evidenceRows)
              ? row.evidenceRows.map((item) => ({ ...item, media_urls: [] }))
              : row.evidenceRows,
          };
        }
        const next = { ...row };
        delete next.evidenceRows;
        delete next.sectionUpdates;
        return next;
      }),
    })),
  };
}

/** Drop signed URLs, then shrink a heavy incident page so it can stay on device. */
export function prepareSnapshot(screen, data, now = Date.now()) {
  let value = redactForOfflineCache(data, now);
  if (jsonSize(value) <= MAX_SNAPSHOT_CHARS) return value;
  if (screen === OFFLINE_SCREENS.incidents) {
    value = stripIncidentRows(value, "media");
    if (jsonSize(value) <= MAX_SNAPSHOT_CHARS) return value;
    value = stripIncidentRows(value, "rows");
    if (jsonSize(value) <= MAX_SNAPSHOT_CHARS) return value;
  }
  return null;
}

export function toProfileSnapshot(user, now = Date.now()) {
  if (!user || typeof user !== "object") return null;
  const out = { profileLoaded: true };
  for (const key of PROFILE_FIELDS) {
    if (user[key] !== undefined) out[key] = user[key];
  }
  return redactForOfflineCache(out, now);
}

export function formatLastUpdated(savedAt, now = Date.now()) {
  const t = new Date(savedAt).getTime();
  if (!Number.isFinite(t)) return "Last updated earlier";
  const delta = Math.max(0, now - t);
  if (delta < 60_000) return "Last updated just now";
  if (delta < 60 * 60_000) {
    const mins = Math.max(1, Math.floor(delta / 60_000));
    return `Last updated ${mins} min ago`;
  }
  try {
    const formatted = new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(t));
    return `Last updated ${formatted}`;
  } catch {
    return "Last updated earlier";
  }
}
