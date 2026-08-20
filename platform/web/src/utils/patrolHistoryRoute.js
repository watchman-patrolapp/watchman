import { distanceMeters } from './dataSaverProfile.js';
import { logOverlapsSince, parsePatrolTime, durationMinutesFromLog } from './watchTime.js';

/** Ignore GPS crumbs shorter than a driveway shuffle. */
export const MIN_ROUTE_KM = 0.05;

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
 * Tight window first (map cards), then a looser overlap so late-saved routes still count.
 */
export function matchRouteRowToLog(log, routeRows) {
  if (!routeRows?.length) return null;
  const end = parsePatrolTime(log.end_time)?.getTime();
  if (!Number.isFinite(end)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const row of routeRows) {
    if (log.user_id && row.user_id && row.user_id !== log.user_id) continue;
    if (!row.created_at) continue;
    const c = parsePatrolTime(row.created_at)?.getTime();
    if (!Number.isFinite(c)) continue;
    const d = Math.abs(c - end);
    if (d < bestDelta && d < 8 * 60 * 1000) {
      bestDelta = d;
      best = row;
    }
  }
  if (best) return best;

  const start = parsePatrolTime(log.start_time)?.getTime();
  const looseEnd = end + 45 * 60 * 1000;
  const looseStart = Number.isFinite(start) ? start - 15 * 60 * 1000 : end - 4 * 60 * 60 * 1000;
  bestDelta = Infinity;
  for (const row of routeRows) {
    if (log.user_id && row.user_id && row.user_id !== log.user_id) continue;
    if (!row.created_at) continue;
    const c = parsePatrolTime(row.created_at)?.getTime();
    if (!Number.isFinite(c) || c < looseStart || c > looseEnd) continue;
    const d = Math.abs(c - end);
    if (d < bestDelta) {
      bestDelta = d;
      best = row;
    }
  }
  return best;
}

/**
 * GeoJSON LineString, MultiLineString, Feature, or FeatureCollection → [[lat,lng], ...]
 */
export function latLngsFromRouteGeoJson(geo) {
  if (!geo) return [];
  try {
    const g = typeof geo === "string" ? JSON.parse(geo) : geo;
    if (!g) return [];
    if (g.type === "FeatureCollection" && Array.isArray(g.features)) {
      return g.features.flatMap((feature) => latLngsFromRouteGeoJson(feature));
    }
    const geom = g.type === "Feature" ? g.geometry : g;
    if (!geom || !Array.isArray(geom.coordinates)) return [];
    if (geom.type === "LineString") return lineCoordsToLatLngs(geom.coordinates);
    if (geom.type === "MultiLineString") {
      return geom.coordinates.flatMap((line) => lineCoordsToLatLngs(line));
    }
    return [];
  } catch {
    return [];
  }
}

function lineCoordsToLatLngs(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  return coords
    .filter((pair) => Array.isArray(pair) && pair.length >= 2)
    .map(([lng, lat]) => [lat, lng]);
}

function pointTimeMs(row) {
  const t = parsePatrolTime(row?.timestamp)?.getTime();
  if (Number.isFinite(t)) return t;
  const c = parsePatrolTime(row?.created_at)?.getTime();
  return Number.isFinite(c) ? c : NaN;
}

function asLatLng(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function locationKmForLog(log, locationPoints) {
  const start = parsePatrolTime(log?.start_time)?.getTime();
  const end = parsePatrolTime(log?.end_time)?.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const from = start - 15 * 60 * 1000;
  const to = end + 2 * 60 * 60 * 1000;
  const pts = [];
  for (const row of Array.isArray(locationPoints) ? locationPoints : []) {
    const t = pointTimeMs(row);
    if (!Number.isFinite(t) || t < from || t > to) continue;
    const ll = asLatLng(row);
    if (ll) pts.push(ll);
  }
  if (pts.length < 2) return 0;
  return distanceKmFromLatLngPoints(pts);
}

function routeRowKey(row) {
  if (!row) return "";
  if (row.id != null) return `id:${row.id}`;
  return `${row.created_at || ""}|${Number(row.total_distance_km) || 0}`;
}

/**
 * GPS km for one completed patrol: the longer of stored/GeoJSON route vs live points.
 */
export function logDistanceKm(log, routeRows = [], locationPoints = []) {
  const matched = matchRouteRowToLog(log, routeRows);
  const fromRoute = routeRowDistanceKm(matched);
  const fromPts = locationKmForLog(log, locationPoints);
  return Math.max(fromRoute, fromPts);
}

/**
 * Same kilometre figure Patrol routes uses: stored total, else GeoJSON track.
 */
export function routeRowDistanceKm(row) {
  if (!row) return 0;
  const stored = Number(row.total_distance_km);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const latlngs = latLngsFromRouteGeoJson(row.route_geojson);
  if (latlngs.length < 2) return 0;
  return distanceKmFromLatLngPoints(latlngs.map(([lat, lng]) => ({ lat, lng })));
}

/**
 * GPS kilometres for logs in a leaderboard window (week / month / all time).
 * Per patrol uses the longer of route vs live points; unmatched GPS routes in the
 * window are still counted so late-saved tracks are not dropped.
 */
export function summarizeGpsMileage(logs, routeRows, since = null, locationPoints = []) {
  const inPeriodLogs = (Array.isArray(logs) ? logs : []).filter((log) => {
    if (!since) return true;
    return logOverlapsSince(log, since);
  });

  const counted = new Set();
  let km = 0;
  let tracks = 0;

  for (const log of inPeriodLogs) {
    const matched = matchRouteRowToLog(log, routeRows);
    if (matched) counted.add(routeRowKey(matched));
    const d = Math.max(routeRowDistanceKm(matched), locationKmForLog(log, locationPoints));
    if (d >= MIN_ROUTE_KM) {
      km += d;
      tracks += 1;
    }
  }

  for (const row of Array.isArray(routeRows) ? routeRows : []) {
    const key = routeRowKey(row);
    if (!key || counted.has(key)) continue;
    if (since) {
      if (!row?.created_at) continue;
      const created = parsePatrolTime(row.created_at);
      if (!created || created < since) continue;
    }
    const d = routeRowDistanceKm(row);
    if (d >= MIN_ROUTE_KM) {
      counted.add(key);
      km += d;
      tracks += 1;
    }
  }

  return {
    km,
    tracks,
    patrols: inPeriodLogs.length,
    minutes: inPeriodLogs.reduce((sum, log) => sum + durationMinutesFromLog(log), 0),
  };
}

async function fetchLocationPages(client, table, userId, fromIso, toIso, limit) {
  const pageSize = 1000;
  const out = [];
  let offset = 0;
  while (offset < limit) {
    const { data, error } = await client
      .from(table)
      .select("latitude, longitude, timestamp, created_at")
      .eq("user_id", userId)
      .gte("timestamp", fromIso)
      .lte("timestamp", toIso)
      .order("timestamp", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

/**
 * Live GPS crumbs for fuel + maps. Includes soft-deleted rows (cleanup marks
 * them after a week) and the archive table so all-time mileage is not only
 * the last few days.
 */
export async function fetchPatrolLocationPoints(client, { userId, logs, limit = 80000 } = {}) {
  if (!client || !userId || !Array.isArray(logs) || logs.length === 0) return [];
  const times = [];
  for (const log of logs) {
    const start = parsePatrolTime(log.start_time)?.getTime();
    const end = parsePatrolTime(log.end_time)?.getTime();
    if (Number.isFinite(start)) times.push(start - 15 * 60 * 1000);
    if (Number.isFinite(end)) times.push(end + 2 * 60 * 60 * 1000);
  }
  if (!times.length) return [];
  const fromIso = new Date(Math.min(...times)).toISOString();
  const toIso = new Date(Math.max(...times)).toISOString();

  const [live, archived] = await Promise.all([
    fetchLocationPages(client, "patrol_locations", userId, fromIso, toIso, limit),
    fetchLocationPages(client, "patrol_locations_archive", userId, fromIso, toIso, limit).catch(() => []),
  ]);
  return [...live, ...archived];
}

/**
 * Every saved patrol_routes row for a volunteer (not a 200-row slice).
 */
export async function fetchPatrolRouteRows(client, userId, limit = 2000) {
  if (!client || !userId) return [];
  const pageSize = 200;
  const out = [];
  let offset = 0;
  while (offset < limit) {
    const { data, error } = await client
      .from("patrol_routes")
      .select("id, user_id, total_distance_km, total_duration_seconds, route_geojson, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
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
