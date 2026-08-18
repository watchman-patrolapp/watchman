import { reverseGeocodeRoadName } from './reverseGeocodeNominatim';

const USER_AGENT = 'NeighbourhoodWatchPlatform/1.0 (hotspots; contact: local admin)';

/** Theescombe / western Gqeberha — OSM rarely tags local streets with the suburb name. */
export const SEARCH_BIAS = { lat: -33.978, lng: 25.505 };

/** Nominatim viewbox: west,north,east,south around Greater Gqeberha. */
const VIEWBOX = '25.40,-33.88,25.72,-34.05';

const STREET_SUFFIX =
  /\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|way|crescent|cres|close|boulevard|blvd)\b/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function expandAbbreviations(q) {
  return String(q || '')
    .replace(/\bRd\.?\b/gi, 'Road')
    .replace(/\bSt\.?\b/gi, 'Street')
    .replace(/\bAve\.?\b/gi, 'Avenue')
    .replace(/\bDr\.?\b/gi, 'Drive')
    .replace(/\bLn\.?\b/gi, 'Lane')
    .replace(/\bCres\.?\b/gi, 'Crescent')
    .replace(/\bBlvd\.?\b/gi, 'Boulevard')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingHouseNumber(q) {
  return q.replace(/^\d+[a-zA-Z]?\s+/, '').trim();
}

function extractHouseNumber(q) {
  const m = String(q || '').trim().match(/^(\d+[a-zA-Z]?)\b/);
  return m ? m[1] : '';
}

function streetCore(name) {
  return expandAbbreviations(name)
    .replace(STREET_SUFFIX, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function ensureStreetSuffix(name) {
  const t = expandAbbreviations(name);
  if (!t) return t;
  if (STREET_SUFFIX.test(t)) return t;
  return `${t} Road`;
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  const rows = Array.from({ length: s.length + 1 }, (_, i) => {
    const row = new Array(t.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= t.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[s.length][t.length];
}

function namesLikelySame(queryName, hitName) {
  const q = streetCore(queryName);
  const h = streetCore(hitName);
  if (!q || !h) return false;
  if (q === h || h.includes(q) || q.includes(h)) return true;
  return levenshtein(q, h) <= 2;
}

function looksLikeStreet(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (STREET_SUFFIX.test(t)) return true;
  return t.split(/\s+/).length <= 3;
}

/** "corner of Christian Road and Montmedy", "Christian & Montmedy", "X / Y" */
export function parseIntersectionQuery(raw) {
  const q = expandAbbreviations(raw);
  const corner = q.match(/^(?:the\s+)?corners?\s+of\s+(.+)$/i);
  const body = corner ? corner[1] : q;
  const parts = body
    .split(/\s+(?:and|&|\/|x|at)\s+|\s*[&/×]\s*/i)
    .map((p) => String(p || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (corner) return [a, b];
  if (looksLikeStreet(a) || looksLikeStreet(b)) return [a, b];
  return null;
}

function queryVariants(raw) {
  const q = expandAbbreviations(raw);
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    const t = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[,\s]+|[,\s]+$/g, '');
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    variants.push(t);
  };

  const street = ensureStreetSuffix(stripLeadingHouseNumber(q.split(',')[0] || ''));
  const swapped = /\btheescombe\b/i.test(q)
    ? q.replace(/\btheescombe\b/gi, 'Gqeberha')
    : q;

  if (street) {
    add(`${street}, Gqeberha`);
    add(`${street}, Port Elizabeth`);
    add(street);
  }
  add(stripLeadingHouseNumber(swapped));
  add(swapped);
  add(q);
  if (street) add(`${street}, Eastern Cape`);

  return variants;
}

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

function extractLines(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
    return [geojson.coordinates];
  }
  if (geojson.type === 'MultiLineString' && Array.isArray(geojson.coordinates)) {
    return geojson.coordinates;
  }
  return [];
}

function rowToHit(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lon ?? row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const display = typeof row.display_name === 'string' ? row.display_name : '';
  const name = row.name || row.address?.road || '';
  const label =
    (display && display.split(',').slice(0, 3).join(',').trim()) || name || '';
  return {
    lat,
    lng,
    label,
    name,
    className: row.class || '',
    type: row.type || '',
    lines: extractLines(row.geojson),
  };
}

function scoreHit(hit, { bias, streetHint }) {
  const km = haversineKm(bias, hit);
  let score = km;
  const isRoad = hit.className === 'highway' || /road|residential|tertiary|secondary|primary/i.test(hit.type);
  if (isRoad) score -= 8;
  if (streetHint && hit.name && namesLikelySame(streetHint, hit.name)) score -= 14;
  else if (streetHint && hit.name && hit.name.toLowerCase().includes(streetHint.toLowerCase())) score -= 8;
  if (streetHint && hit.label && hit.label.toLowerCase().includes(streetHint.toLowerCase())) score -= 4;
  if (km > 35) score += 80;
  return score;
}

function pickBest(hits, rawQuery, bias) {
  const streetHint = stripLeadingHouseNumber(expandAbbreviations(rawQuery).split(',')[0] || '');
  const streetHintCore = streetCore(streetHint) || streetHint;
  const ranked = hits
    .map((hit) => ({
      hit,
      score: scoreHit(hit, { bias, streetHint: streetHintCore }),
    }))
    .sort((a, b) => a.score - b.score);
  return ranked[0]?.hit || null;
}

function withHouseNumber(label, rawQuery) {
  const num = extractHouseNumber(rawQuery);
  if (!num) return label;
  if (new RegExp(`^${num}\\b`).test(label)) return label;
  return `${num} ${label}`;
}

function segmentIntersection(p1, p2, p3, p4) {
  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];
  const x3 = p3[0];
  const y3 = p3[1];
  const x4 = p4[0];
  const y4 = p4[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-18) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { lng: x1 + t * (x2 - x1), lat: y1 + t * (y2 - y1) };
}

function nearestCorner(linesA, linesB) {
  let bestCross = null;
  for (const la of linesA) {
    for (let i = 0; i < la.length - 1; i += 1) {
      for (const lb of linesB) {
        for (let j = 0; j < lb.length - 1; j += 1) {
          const hit = segmentIntersection(la[i], la[i + 1], lb[j], lb[j + 1]);
          if (hit) return hit;
        }
      }
    }
  }

  let best = null;
  let bestKm = Infinity;
  for (const la of linesA) {
    for (const pa of la) {
      for (const lb of linesB) {
        for (const pb of lb) {
          const km = haversineKm({ lat: pa[1], lng: pa[0] }, { lat: pb[1], lng: pb[0] });
          if (km < bestKm) {
            bestKm = km;
            best = { lat: (pa[1] + pb[1]) / 2, lng: (pa[0] + pb[0]) / 2 };
          }
        }
      }
    }
  }
  if (!best || bestKm > 0.45) return bestCross;
  return best;
}

async function nominatimSearch(q, { polygon = false } = {}) {
  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    countrycodes: 'za',
    limit: '8',
    q,
    viewbox: VIEWBOX,
    bounded: '0',
  });
  if (polygon) params.set('polygon_geojson', '1');
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error('Address search failed');
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map(rowToHit).filter(Boolean);
}

async function photonSearch(q, bias) {
  const params = new URLSearchParams({
    q,
    lat: String(bias.lat),
    lon: String(bias.lng),
    limit: '8',
    lang: 'en',
  });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return [];
  const body = await res.json();
  const features = Array.isArray(body?.features) ? body.features : [];
  return features
    .map((f) => {
      const coords = f?.geometry?.coordinates;
      const lng = Number(coords?.[0]);
      const lat = Number(coords?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const p = f.properties || {};
      if (p.countrycode && String(p.countrycode).toUpperCase() !== 'ZA') return null;
      const name = p.name || p.street || '';
      const bits = [name, p.district, p.city].filter(Boolean);
      const extent = Array.isArray(p.extent) ? p.extent : null;
      return {
        lat,
        lng,
        label: bits.slice(0, 3).join(', '),
        name,
        className: p.osm_key === 'highway' ? 'highway' : p.osm_key || '',
        type: p.osm_value || p.type || '',
        lines: [],
        extent,
      };
    })
    .filter(Boolean);
}

async function collectHits(query, bias, { polygon = false } = {}) {
  const variants = queryVariants(query);
  const collected = [];
  let nominatimCalls = 0;

  for (const variant of variants) {
    if (nominatimCalls >= 3) break;
    if (nominatimCalls > 0) await sleep(1100);
    const rows = await nominatimSearch(variant, { polygon });
    nominatimCalls += 1;
    collected.push(...rows);
    if (collected.length) break;
  }

  if (!collected.length) {
    const photonHits = await photonSearch(variants[0] || query, bias);
    collected.push(...photonHits);
    if (!photonHits.length && variants[1]) {
      collected.push(...(await photonSearch(variants[1], bias)));
    }
  }

  return collected;
}

async function streetGeometry(query, bias) {
  let hits = await collectHits(query, bias, { polygon: true });
  let named = hits.filter((h) => namesLikelySame(query, h.name || h.label));
  if (!named.length) named = hits;

  let lines = named.flatMap((h) => h.lines || []);
  if (!lines.length && named[0]?.name) {
    await sleep(1100);
    const retry = await nominatimSearch(`${named[0].name}, Gqeberha`, { polygon: true });
    lines = retry.flatMap((h) => h.lines || []);
    if (retry[0]?.name) named = retry;
  }

  return {
    name: named[0]?.name || ensureStreetSuffix(query),
    lines,
    point: named[0] ? { lat: named[0].lat, lng: named[0].lng } : null,
  };
}

async function searchIntersection(streets, bias) {
  const a = await streetGeometry(streets[0], bias);
  await sleep(1100);
  const b = await streetGeometry(streets[1], bias);
  const corner = nearestCorner(a.lines, b.lines);
  const pin = corner || (a.point && b.point
    ? { lat: (a.point.lat + b.point.lat) / 2, lng: (a.point.lng + b.point.lng) / 2 }
    : a.point || b.point);
  if (!pin) return null;
  return {
    lat: pin.lat,
    lng: pin.lng,
    label: `Corner of ${a.name} and ${b.name}`,
  };
}

/**
 * Forward-geocode an address. Biased to Theescombe / Gqeberha.
 * OSM often omits the suburb on local streets, so "…, Theescombe" is retried as Gqeberha / street-only.
 * @returns {Promise<{ lat: number, lng: number, label: string } | null>}
 */
export async function searchNominatim(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  const bias = {
    lat: Number(options.biasLat) || SEARCH_BIAS.lat,
    lng: Number(options.biasLng) || SEARCH_BIAS.lng,
  };

  const intersection = parseIntersectionQuery(q);
  if (intersection) {
    return searchIntersection(intersection, bias);
  }

  const collected = await collectHits(q, bias);
  const best = pickBest(collected, q, bias);
  if (!best) return null;
  return {
    lat: best.lat,
    lng: best.lng,
    label: withHouseNumber(best.label || q, q),
  };
}

export async function reverseLabel(lat, lng) {
  const name = await reverseGeocodeRoadName(lat, lng);
  return name && name !== '—' ? name : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
