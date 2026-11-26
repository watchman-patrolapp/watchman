/**
 * Patrol / schedule zone label used only when no watch is selected (the watch's name is used
 * otherwise). Neutral on purpose: no city or suburb is assumed (SA places P6).
 */
export const DEFAULT_PATROL_ZONE = 'Patrol area';

/**
 * Suburb + city, e.g. "Sea Point, Cape Town". Omits the city if empty.
 * @param {string} [zone]
 * @param {string | null | undefined} [city]
 */
export function formatPatrolPlaceLabel(zone = DEFAULT_PATROL_ZONE, city = null) {
  const z = (zone && String(zone).trim()) || DEFAULT_PATROL_ZONE;
  const c = city != null && String(city).trim();
  return c ? `${z}, ${c}` : z;
}

/** Legacy beta label stored in older rows; normalize for display and exports. */
const LEGACY_ZONE_A = /^zone\s*a$/i;
/** Beta rows said "Zone A" for the first (and then only) watch area. Historical data, not a default. */
const LEGACY_ZONE_A_LABEL = 'Theescombe';

/**
 * @param {string | null | undefined} zone raw `zone` from DB
 * @returns {string | null} display label, or null if empty
 */
export function displayPatrolZone(zone) {
  if (zone == null) return null;
  const t = String(zone).trim();
  if (!t) return null;
  if (LEGACY_ZONE_A.test(t)) return LEGACY_ZONE_A_LABEL;
  return t;
}

/**
 * Compact area label for pickers: "Sea Point Neighborhood Watch" → "Sea Point".
 */
export function displayWatchAreaName(name) {
  const t = String(name || "").trim();
  if (!t) return "";
  const stripped = t.replace(/\s+(neighbourhood|neighborhood)\s+watch\s*$/i, "").trim();
  return stripped || t;
}
