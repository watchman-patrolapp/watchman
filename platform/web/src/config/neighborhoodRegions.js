/**
 * Default patrol / schedule zone label (matches DB `zone` text).
 * Later: load per neighbourhood watch from config (e.g. Supabase).
 */
export const DEFAULT_PATROL_ZONE = 'Theescombe';

/** City / metro for display only (headers, copy). Not the same as DB `zone`. */
export const DEFAULT_PATROL_CITY = 'Gqeberha';

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
