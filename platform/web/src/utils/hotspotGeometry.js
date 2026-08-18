import { distanceMeters } from './dataSaverProfile';

/** Group pins within this neighborhood-scale distance into one hot zone. */
export const CLUSTER_RADIUS_M = 3000;

/** Expand hull slightly so the polygon does not sit on the pins. */
export const HULL_BUFFER_M = 80;

/** Half-width of the translucent thread along the travel path. */
export const THREAD_HALF_WIDTH_M = 70;

/** Do not draw a travel segment across gaps larger than this. */
export const TRAVEL_GAP_MS = 21 * 24 * 60 * 60 * 1000;

const EARTH_M = 6371000;

function toRad(d) {
  return (d * Math.PI) / 180;
}

function toDeg(r) {
  return (r * 180) / Math.PI;
}

export function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(lat, lng, bearingDeg, distM) {
  const δ = distM / EARTH_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

export function smallestAngleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Destination of a view cone: camera at origin, arc at range.
 * @returns {[number, number][]} Leaflet latlngs including the camera as first/last
 */
export function viewConeLatLngs(lat, lng, bearingDeg, rangeM, fovDeg = 75, steps = 12) {
  const half = fovDeg / 2;
  const pts = [[lat, lng]];
  for (let i = 0; i <= steps; i += 1) {
    const b = bearingDeg - half + (fovDeg * i) / steps;
    const p = destinationPoint(lat, lng, (b + 360) % 360, rangeM);
    pts.push([p.lat, p.lng]);
  }
  pts.push([lat, lng]);
  return pts;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew’s monotone chain. Input [{lat,lng}], output same (lng=x, lat=y). */
export function convexHull(points) {
  if (!points || points.length < 3) return points ? [...points] : [];
  const pts = points
    .map((p) => ({ lat: p.lat, lng: p.lng, x: p.lng, y: p.lat }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper).map((p) => ({ lat: p.lat, lng: p.lng }));
}

export function expandHull(hull, meters = HULL_BUFFER_M) {
  if (!hull?.length) return [];
  if (hull.length === 1) {
    const ring = [];
    for (let i = 0; i < 8; i += 1) {
      ring.push(destinationPoint(hull[0].lat, hull[0].lng, i * 45, meters));
    }
    return ring;
  }
  const cLat = hull.reduce((s, p) => s + p.lat, 0) / hull.length;
  const cLng = hull.reduce((s, p) => s + p.lng, 0) / hull.length;
  return hull.map((p) => {
    const d = distanceMeters(cLat, cLng, p.lat, p.lng);
    if (d < 1) return destinationPoint(p.lat, p.lng, 0, meters);
    const bearing = initialBearingDeg(cLat, cLng, p.lat, p.lng);
    return destinationPoint(p.lat, p.lng, bearing, meters);
  });
}

function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/**
 * Union-find clusters of events within CLUSTER_RADIUS_M.
 * @returns {{ events: object[], hull: {lat,lng}[], polygon: [number, number][] }[]}
 */
export function clusterHotZones(events, radiusM = CLUSTER_RADIUS_M) {
  const pts = (events || []).filter(
    (e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude)
  );
  const n = pts.length;
  if (n === 0) return [];

  const parent = pts.map((_, i) => i);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (distanceMeters(pts[i].latitude, pts[i].longitude, pts[j].latitude, pts[j].longitude) <= radiusM) {
        const a = find(parent, i);
        const b = find(parent, j);
        if (a !== b) parent[a] = b;
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = find(parent, i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pts[i]);
  }

  const zones = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const hullPts = group.map((e) => ({ lat: e.latitude, lng: e.longitude }));
    const hull = convexHull(hullPts);
    if (hull.length < 3) {
      const cLat = hullPts.reduce((s, p) => s + p.lat, 0) / hullPts.length;
      const cLng = hullPts.reduce((s, p) => s + p.lng, 0) / hullPts.length;
      let r = HULL_BUFFER_M;
      for (const p of hullPts) {
        r = Math.max(r, distanceMeters(cLat, cLng, p.lat, p.lng) + HULL_BUFFER_M);
      }
      const ring = [];
      for (let i = 0; i < 16; i += 1) {
        ring.push(destinationPoint(cLat, cLng, i * (360 / 16), r));
      }
      zones.push({
        events: group,
        hull: ring,
        polygon: ring.map((p) => [p.lat, p.lng]),
        thread: threadLatLngs(group),
        corridor: bufferPathCorridor(threadLatLngs(group)),
      });
      continue;
    }
    const expanded = expandHull(hull);
    const thread = threadLatLngs(group);
    zones.push({
      events: group,
      hull: expanded,
      polygon: expanded.map((p) => [p.lat, p.lng]),
      thread,
      corridor: bufferPathCorridor(thread),
    });
  }
  return zones;
}

function threadLatLngs(group) {
  return [...group]
    .filter((e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude))
    .sort((a, b) => {
      const ta = new Date(a.occurred_at || 0).getTime();
      const tb = new Date(b.occurred_at || 0).getTime();
      return ta - tb;
    })
    .map((e) => [e.latitude, e.longitude]);
}

/**
 * Translucent sausage along a thread: offset each segment left/right.
 * @returns {[number, number][][]}
 */
export function bufferPathCorridor(latlngs, halfWidthM = THREAD_HALF_WIDTH_M) {
  if (!latlngs || latlngs.length < 2) return [];
  const rings = [];
  for (let i = 0; i < latlngs.length - 1; i += 1) {
    const [aLat, aLng] = latlngs[i];
    const [bLat, bLng] = latlngs[i + 1];
    const bearing = initialBearingDeg(aLat, aLng, bLat, bLng);
    const left = (bearing + 270) % 360;
    const right = (bearing + 90) % 360;
    const aL = destinationPoint(aLat, aLng, left, halfWidthM);
    const aR = destinationPoint(aLat, aLng, right, halfWidthM);
    const bL = destinationPoint(bLat, bLng, left, halfWidthM);
    const bR = destinationPoint(bLat, bLng, right, halfWidthM);
    rings.push([
      [aL.lat, aL.lng],
      [bL.lat, bL.lng],
      [bR.lat, bR.lng],
      [aR.lat, aR.lng],
    ]);
  }
  return rings;
}

/**
 * Time-ordered travel path, split when the gap between pins is too large.
 * @returns {[number, number][][]} Leaflet polyline segments
 */
export function travelPathSegments(events, maxGapMs = TRAVEL_GAP_MS) {
  const sorted = [...(events || [])]
    .filter((e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude) && e.occurred_at)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const segments = [];
  let current = [];

  const pushCurrent = () => {
    if (current.length >= 2) segments.push(current.map((e) => [e.latitude, e.longitude]));
    current = [];
  };

  for (let i = 0; i < sorted.length; i += 1) {
    const ev = sorted[i];
    if (current.length === 0) {
      current.push(ev);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = new Date(ev.occurred_at).getTime() - new Date(prev.occurred_at).getTime();
    if (gap > maxGapMs) {
      pushCurrent();
      current.push(ev);
    } else {
      current.push(ev);
    }
  }
  pushCurrent();
  return segments;
}

/** Approximate distance from a point to a lat/lng segment (metres). */
export function distancePointToSegmentM(lat, lng, aLat, aLng, bLat, bLng) {
  const ab = distanceMeters(aLat, aLng, bLat, bLng);
  if (ab < 1) return distanceMeters(lat, lng, aLat, aLng);
  const toXY = (la, ln) => {
    const x = toRad(ln - aLng) * Math.cos(toRad((la + aLat) / 2)) * EARTH_M;
    const y = toRad(la - aLat) * EARTH_M;
    return { x, y };
  };
  const p = toXY(lat, lng);
  const b = toXY(bLat, bLng);
  const t = Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / (b.x * b.x + b.y * b.y)));
  const proj = { x: b.x * t, y: b.y * t };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}
