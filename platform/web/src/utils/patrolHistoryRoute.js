import { distanceMeters } from './dataSaverProfile';

/**
 * Stable key for a patrol log row (no DB id required).
 */
export function patrolLogKey(log) {
  return `${log.start_time}|${log.end_time}`;
}

/**
 * Unique key across volunteers (admin lists).
 */
export function patrolLogKeyScoped(log) {
  const uid = log.user_id != null ? String(log.user_id) : `name:${(log.user_name || '').trim()}`;
  return `${uid}|${log.start_time}|${log.end_time}`;
}

/**
 * Haversine sum of consecutive points → kilometers.
 */
export function distanceKmFromLatLngPoints(points) {
  if (!points || points.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    m += distanceMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return m / 1000;
}

/**
 * Match a patrol_routes row to a patrol_log by created_at ≈ end_time.
 */
export function matchRouteRowToLog(log, routeRows) {
  if (!routeRows?.length) return null;
  const end = new Date(log.end_time).getTime();
  let best = null;
  let bestDelta = Infinity;
  for (const row of routeRows) {
    if (log.user_id && row.user_id && row.user_id !== log.user_id) continue;
    if (!row.created_at) continue;
    const c = new Date(row.created_at).getTime();
    const d = Math.abs(c - end);
    if (d < bestDelta && d < 8 * 60 * 1000) {
      bestDelta = d;
      best = row;
    }
  }
  return best;
}

/**
 * GeoJSON LineString or Feature → [[lat,lng], ...]
 */
export function latLngsFromRouteGeoJson(geo) {
  if (!geo) return [];
  try {
    const g = typeof geo === 'string' ? JSON.parse(geo) : geo;
    const geom = g.type === 'Feature' ? g.geometry : g;
    if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return [];
    return geom.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch {
    return [];
  }
}

/**
 * Split into colored segments for Strava-style trail (Leaflet polylines).
 */
export function segmentLatLngsForDisplay(latlngs, maxSegments = 8) {
  if (!latlngs || latlngs.length < 2) return [];
  const palette = [
    '#0d9488',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#d946ef',
    '#f97316',
    '#eab308',
  ];
  const cap = Math.min(maxSegments, Math.max(1, Math.floor(latlngs.length / 2)));
  const segments = [];
  const step = Math.ceil((latlngs.length - 1) / cap);
  for (let i = 0; i < latlngs.length - 1; i += step) {
    const chunk = latlngs.slice(i, Math.min(i + step + 1, latlngs.length));
    if (chunk.length >= 2) {
      segments.push({
        positions: chunk,
        color: palette[segments.length % palette.length],
      });
    }
  }
  return segments;
}
