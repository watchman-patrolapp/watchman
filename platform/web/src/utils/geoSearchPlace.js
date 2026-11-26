/** Pure place hints for address search (no network, no Supabase), so they can be unit-tested. */

/** Place hints for the fallback bias only; any other city passes its own cityName / province. */
export const FALLBACK_PLACE = {
  city: 'Gqeberha',
  aliases: ['Port Elizabeth'],
  province: 'Eastern Cape',
  suburb: 'Theescombe',
};

/** Nominatim viewbox (west,north,east,south) about 25 km around a point. */
export function viewboxAround(lat, lng, deg = 0.22) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return '';
  const f = (n) => n.toFixed(2);
  return `${f(ln - deg)},${f(la + deg * 0.75)},${f(ln + deg)},${f(la - deg * 0.75)}`;
}

/** City hints for a search: the given city / province, else the fallback place. */
export function searchPlace(options = {}) {
  const city = String(options.cityName || '').trim();
  if (!city) return FALLBACK_PLACE;
  return {
    city,
    aliases: (Array.isArray(options.cityAliases) ? options.cityAliases : []).map((a) => String(a || '').trim()).filter(Boolean),
    province: String(options.province || '').trim(),
    suburb: String(options.suburb || '').trim(),
  };
}

/** "…, <suburb>" tried as "…, <city>": OSM rarely tags local streets with the suburb. */
export function swapSuburbForCity(query, place) {
  const q = String(query || '');
  const suburb = String(place?.suburb || '').trim();
  const city = String(place?.city || '').trim();
  if (!suburb || !city) return q;
  const re = new RegExp(`\\b${suburb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  return re.test(q) ? q.replace(re, city) : q;
}

/** Street-level retries for a city: "<street>, <city>", each alias, then the street alone. */
export function cityStreetVariants(street, place) {
  const s = String(street || '').trim();
  if (!s) return [];
  const out = [];
  if (place?.city) out.push(`${s}, ${place.city}`);
  for (const alias of place?.aliases || []) out.push(`${s}, ${alias}`);
  out.push(s);
  return out;
}
