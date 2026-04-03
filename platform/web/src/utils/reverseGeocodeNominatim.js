/**
 * Reverse geocode to "Street, Suburb" style labels (OpenStreetMap Nominatim).
 * https://operations.osmfoundation.org/policies/nominatim/ — throttle: ~1 req/s; identify via User-Agent.
 */
const USER_AGENT = 'NeighbourhoodWatchPlatform/1.0 (patrol route history; contact: local admin)';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Skip electoral wards / metro ward noise (e.g. "Nelson Mandela Bay Ward 10"). */
function isUnwantedAreaLabel(s) {
  if (!s || typeof s !== 'string') return true;
  const t = s.trim();
  if (/\b[WW]ard\s*\d+\b/i.test(t)) return true;
  if (/Nelson Mandela Bay\s+Ward/i.test(t)) return true;
  if (/Buffalo City\s+Ward/i.test(t)) return true;
  if (/metropolitan.*\bward\b/i.test(t)) return true;
  if (t.length > 120) return true;
  return false;
}

function pickStreet(a) {
  const s =
    a.road ||
    a.pedestrian ||
    a.residential ||
    a.path ||
    a.footway ||
    a.cycleway ||
    '';
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Prefer suburb / neighbourhood over city_district (often = ward boundaries in OSM).
 */
function pickLocalArea(a) {
  const order = [
    a.suburb,
    a.neighbourhood,
    a.quarter,
    a.hamlet,
    a.village,
    a.town,
    a.city_district,
    a.city,
  ];
  for (const c of order) {
    if (!c || typeof c !== 'string') continue;
    const t = c.trim();
    if (isUnwantedAreaLabel(t)) continue;
    return t;
  }
  return '';
}

function formatFromAddress(a) {
  const street = pickStreet(a);
  const area = pickLocalArea(a);
  if (street && area) return `${street}, ${area}`;
  if (street) return street;
  if (area) return area;
  return '';
}

function fallbackFromDisplayName(displayName) {
  if (typeof displayName !== 'string' || !displayName.length) return '';
  const parts = displayName.split(',').map((p) => p.trim()).filter(Boolean);
  const useful = parts.filter((p) => !isUnwantedAreaLabel(p));
  if (useful.length >= 2) return `${useful[0]}, ${useful[1]}`;
  if (useful.length === 1) return useful[0];
  return '';
}

/**
 * @returns {Promise<string>} e.g. "Liebenberg Road, Gelvandale" or "Kragga Kamma Road, Theescombe"
 */
export async function reverseGeocodeRoadName(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return '—';
  }
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&addressdetails=1&zoom=18`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) return '—';
    const data = await res.json();
    const a = data.address || {};
    const formatted = formatFromAddress(a);
    if (formatted) return formatted;
    const fb = fallbackFromDisplayName(data.display_name);
    return fb || '—';
  } catch {
    return '—';
  }
}

/**
 * Sequential lookups with delay between calls (Nominatim fair-use).
 */
export async function reverseGeocodeStartEnd(latlngs) {
  if (!latlngs || latlngs.length < 2) {
    return { start: '—', end: '—' };
  }
  const [sLat, sLng] = latlngs[0];
  const [eLat, eLng] = latlngs[latlngs.length - 1];
  const start = await reverseGeocodeRoadName(sLat, sLng);
  await delay(1100);
  const end = await reverseGeocodeRoadName(eLat, eLng);
  return { start, end };
}
