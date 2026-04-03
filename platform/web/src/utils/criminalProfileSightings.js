/**
 * @typedef {{
 *   id: string,
 *   seen_at: string | null,
 *   location: string,
 *   lat?: number | null,
 *   lng?: number | null,
 *   seen_by_user_id?: string | null,
 *   seen_by_other_name?: string | null,
 *   seen_by_name?: string | null,
 *   seen_by_avatar_url?: string | null,
 * }} CriminalProfileSightingEntry
 */

export function newSightingId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** @returns {CriminalProfileSightingEntry[]} */
export function normalizeSightingsLog(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      id: String(x.id || newSightingId()),
      seen_at: x.seen_at != null && x.seen_at !== '' ? String(x.seen_at) : null,
      location: typeof x.location === 'string' ? x.location : '',
      lat: x.lat != null && x.lat !== '' ? Number(x.lat) : null,
      lng: x.lng != null && x.lng !== '' ? Number(x.lng) : null,
      seen_by_user_id: x.seen_by_user_id || null,
      seen_by_other_name:
        x.seen_by_other_name != null && String(x.seen_by_other_name).trim()
          ? String(x.seen_by_other_name).trim()
          : null,
      seen_by_name: x.seen_by_name != null && String(x.seen_by_name).trim() ? String(x.seen_by_name).trim() : null,
      seen_by_avatar_url: x.seen_by_avatar_url || null,
    }));
}

/**
 * Include legacy single last_seen_* as a virtual row when sightings_log is empty.
 * @returns {CriminalProfileSightingEntry[]}
 */
export function mergedSightingsForDisplay(profile) {
  const fromLog = normalizeSightingsLog(profile?.sightings_log);
  if (fromLog.length > 0) return fromLog;
  const at = profile?.last_seen_at;
  const loc = profile?.last_seen_location;
  if (!at && !(typeof loc === 'string' && loc.trim())) return [];
  return [
    {
      id: 'legacy',
      seen_at: at ? String(at) : null,
      location: typeof loc === 'string' ? loc : '',
      lat: null,
      lng: null,
      seen_by_user_id: null,
      seen_by_other_name: null,
      seen_by_name: null,
    },
  ];
}

/** Strip virtual legacy id before persisting */
export function sanitizeSightingsLogForDb(entries) {
  const list = normalizeSightingsLog(entries).filter((s) => {
    if (s.id === 'legacy') return false;
    const hasWhen = s.seen_at != null && String(s.seen_at).trim() !== '';
    const hasWhere = (s.location || '').trim() !== '';
    const hasObserver = Boolean(s.seen_by_user_id) || Boolean((s.seen_by_other_name || '').trim());
    return hasWhen || hasWhere || hasObserver;
  });
  return list.slice(0, 80);
}

/**
 * Derive legacy columns from the newest sighting (by seen_at).
 * @returns {{ last_seen_at: string | null, last_seen_location: string | null, last_seen_coordinates: string | null }}
 */
export function syncLegacyLastSeenFromSightings(sightingsLog) {
  const list = sanitizeSightingsLogForDb(sightingsLog);
  if (list.length === 0) {
    return { last_seen_at: null, last_seen_location: null, last_seen_coordinates: null };
  }
  const sorted = [...list].sort((a, b) => {
    const ta = new Date(a.seen_at || 0).getTime();
    const tb = new Date(b.seen_at || 0).getTime();
    return tb - ta;
  });
  const top = sorted[0];
  const lat = top.lat != null ? Number(top.lat) : NaN;
  const lng = top.lng != null ? Number(top.lng) : NaN;
  const coords =
    Number.isFinite(lat) && Number.isFinite(lng) ? `(${lat},${lng})` : null;
  return {
    last_seen_at: top.seen_at || null,
    last_seen_location: (top.location || '').trim() || null,
    last_seen_coordinates: coords,
  };
}

/** For edit form: start from DB + legacy if log empty */
export function initialSightingsLogForForm(profile) {
  const n = normalizeSightingsLog(profile?.sightings_log);
  if (n.length > 0) return n;
  const merged = mergedSightingsForDisplay(profile);
  if (merged.length === 0) return [];
  return merged.map((s) => (s.id === 'legacy' ? { ...s, id: newSightingId() } : s));
}

export function emptySightingTemplate() {
  return {
    id: newSightingId(),
    seen_at: null,
    location: '',
    lat: null,
    lng: null,
    seen_by_user_id: null,
    seen_by_other_name: null,
    seen_by_name: null,
    seen_by_avatar_url: null,
  };
}
