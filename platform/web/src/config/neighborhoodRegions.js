/**
 * Default patrol / schedule zone label (matches DB `zone` text).
 * Later: load per neighbourhood watch from config (e.g. Supabase).
 */
export const DEFAULT_PATROL_ZONE = 'Theescombe';

/** Compact city label for headers (Theescombe, Gqeberha). */
export const DEFAULT_PATROL_CITY = 'Gqeberha';

/** Parent city shown above every area picker. All neighborhoods sit under this one city. */
export const DEFAULT_CITY_FULL_NAME = 'Gqeberha (Port Elizabeth)';

/**
 * Suburb + city, e.g. "Theescombe, Gqeberha". Omits city if empty.
 * @param {string} [zone]
 * @param {string | null | undefined} [city]
 */
export function formatPatrolPlaceLabel(zone = DEFAULT_PATROL_ZONE, city = DEFAULT_PATROL_CITY) {
  const z = (zone && String(zone).trim()) || DEFAULT_PATROL_ZONE;
  const c = city != null && String(city).trim();
  return c ? `${z}, ${c}` : z;
}

/** Legacy beta label stored in older rows; normalize for display and exports. */
const LEGACY_ZONE_A = /^zone\s*a$/i;

/**
 * @param {string | null | undefined} zone raw `zone` from DB
 * @returns {string | null} display label, or null if empty
 */
export function displayPatrolZone(zone) {
  if (zone == null) return null;
  const t = String(zone).trim();
  if (!t) return null;
  if (LEGACY_ZONE_A.test(t)) return DEFAULT_PATROL_ZONE;
  return t;
}

/**
 * Compact area label for pickers: "Theescombe Neighborhood Watch" → "Theescombe".
 */
export function displayWatchAreaName(name) {
  const t = String(name || "").trim();
  if (!t) return "";
  const stripped = t.replace(/\s+(neighbourhood|neighborhood)\s+watch\s*$/i, "").trim();
  return stripped || t;
}

/** Map open / weather bias when a suburb row has no coordinates yet. */
export const WATCH_AREA_CENTERS = {
  theescombe: { lat: -33.978, lng: 25.505 },
  lorraine: { lat: -33.992, lng: 25.494 },
  "lovemore park": { lat: -33.985, lng: 25.518 },
  "kamma park": { lat: -33.972, lng: 25.512 },
  "kamma creek": { lat: -33.968, lng: 25.5 },
  "mount pleasant": { lat: -33.973, lng: 25.545 },
  "charlo": { lat: -33.978, lng: 25.545 },
  "sunridge park": { lat: -33.955, lng: 25.545 },
  "walmer": { lat: -33.977, lng: 25.585 },
};

export function watchAreaCenterFromName(name) {
  const key = displayWatchAreaName(name).toLowerCase();
  if (!key) return null;
  if (WATCH_AREA_CENTERS[key]) return { ...WATCH_AREA_CENTERS[key] };
  const match = Object.keys(WATCH_AREA_CENTERS).find((area) => key.includes(area));
  return match ? { ...WATCH_AREA_CENTERS[match] } : null;
}
