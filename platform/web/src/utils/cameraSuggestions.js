import { distanceMeters } from './dataSaverProfile';
import {
  initialBearingDeg,
  smallestAngleDiff,
  distancePointToSegmentM,
  TRAVEL_GAP_MS,
} from './hotspotGeometry';

/** Extra slack beyond the camera’s stated range. */
export const DISTANCE_SLACK_M = 120;

/** Assumed horizontal field of view when ranking “facing this street”. */
export const DEFAULT_FOV_DEG = 75;

const PATH_CORRIDOR_M = 150;

function formatClock(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function compassLabel(bearing) {
  if (!Number.isFinite(bearing)) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(bearing / 45) % 8;
  return dirs[i];
}

/**
 * Time window copy for requesting footage.
 * Known time: ±15 minutes. Date-only: the whole calendar day.
 */
export function formatFootageWindow(event) {
  if (!event?.occurred_at) return 'Time unknown — ask for the day of the incident.';
  const at = new Date(event.occurred_at);
  if (Number.isNaN(at.getTime())) return 'Time unknown — ask for the day of the incident.';
  if (!event.time_known) {
    return `Any time on ${formatDate(at)}`;
  }
  const start = new Date(at.getTime() - 15 * 60 * 1000);
  const end = new Date(at.getTime() + 15 * 60 * 1000);
  return `${formatClock(start)}–${formatClock(end)} on ${formatDate(at)}`;
}

function rankCameraForEvent(camera, event) {
  const dist = distanceMeters(event.latitude, event.longitude, camera.latitude, camera.longitude);
  const range = Number(camera.range_meters) || 50;
  const maxDist = range + DISTANCE_SLACK_M;
  if (dist > maxDist) return null;

  const bearingToIncident = initialBearingDeg(
    camera.latitude,
    camera.longitude,
    event.latitude,
    event.longitude
  );
  const facing = camera.facing_bearing;
  const hasFacing = Number.isFinite(facing);
  const inCone = hasFacing ? smallestAngleDiff(facing, bearingToIncident) <= DEFAULT_FOV_DEG / 2 : null;

  let rank = 2;
  let label = 'Nearby';
  let reason = `${Math.round(dist)} m from the pin`;
  if (inCone === true) {
    rank = 1;
    label = 'Likely view';
    reason = `${Math.round(dist)} m, facing ${compassLabel(facing) || 'this street'}`;
  } else if (inCone === false) {
    rank = 3;
    label = 'Possible, not facing this street';
    reason = `${Math.round(dist)} m, camera faces ${compassLabel(facing)}`;
  } else {
    reason = `${Math.round(dist)} m (facing unknown)`;
  }

  return {
    camera,
    dist,
    rank,
    label,
    reason,
    inCone,
    source: 'pin',
  };
}

function pathCameras(event, cameras, allEvents) {
  const sorted = [...(allEvents || [])]
    .filter((e) => e.time_known && e.occurred_at && Number.isFinite(e.latitude))
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const idx = sorted.findIndex((e) => e.id === event.id);
  if (idx < 0) return [];

  const neighbors = [];
  if (idx > 0) neighbors.push(sorted[idx - 1]);
  if (idx < sorted.length - 1) neighbors.push(sorted[idx + 1]);

  const extra = [];
  for (const other of neighbors) {
    const gap = Math.abs(new Date(event.occurred_at) - new Date(other.occurred_at));
    if (gap > TRAVEL_GAP_MS) continue;
    for (const cam of cameras) {
      const d = distancePointToSegmentM(
        cam.latitude,
        cam.longitude,
        event.latitude,
        event.longitude,
        other.latitude,
        other.longitude
      );
      if (d <= PATH_CORRIDOR_M) {
        extra.push({
          camera: cam,
          dist: d,
          rank: 4,
          label: 'Along possible route',
          reason: `Within ${Math.round(d)} m of the path to the next/previous pin`,
          inCone: null,
          source: 'path',
        });
      }
    }
  }
  return extra;
}

/**
 * Rank cameras that might have captured a hotspot. Deterministic — no live AI.
 */
export function suggestCamerasForEvent(event, cameras, allEvents = []) {
  if (!event || !Number.isFinite(event.latitude)) return [];
  const list = cameras || [];
  const byPin = list.map((c) => rankCameraForEvent(c, event)).filter(Boolean);
  const seen = new Set(byPin.map((s) => s.camera.id));
  const alongPath = pathCameras(event, list, allEvents).filter((s) => !seen.has(s.camera.id));
  return [...byPin, ...alongPath].sort((a, b) => a.rank - b.rank || a.dist - b.dist);
}

export function suggestionCopy(suggestion, event) {
  const name = suggestion.camera.name || 'Camera';
  const window = formatFootageWindow(event);
  return `Check ${name}${suggestion.camera.address ? ` (${suggestion.camera.address})` : ''} — ${window}.`;
}
