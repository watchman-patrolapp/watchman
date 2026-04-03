/**
 * Map UI should reflect the volunteer's current garage, not only active_patrols (which can lag after vehicle changes).
 */

export function groupUserVehiclesByUserId(rows) {
  const byUser = {};
  for (const v of rows || []) {
    const uid = v.user_id != null ? String(v.user_id) : '';
    if (!uid) continue;
    if (!byUser[uid]) byUser[uid] = [];
    byUser[uid].push(v);
  }
  for (const uid of Object.keys(byUser)) {
    byUser[uid].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
  }
  return byUser;
}

/** Match patrol.vehicle_id to a row; else primary; else first in list (already sorted). */
export function pickUserVehicleForPatrol(patrol, userVehicles) {
  if (!userVehicles?.length) return null;
  const pid = patrol?.vehicle_id != null ? String(patrol.vehicle_id) : '';
  if (pid) {
    const match = userVehicles.find((v) => String(v.id) === pid);
    if (match) return match;
  }
  return userVehicles.find((v) => v.is_primary) || userVehicles[0] || null;
}

/** Colour key for VehicleIcon / map (lowercase). */
export function resolvePatrolVehicleColorKey(patrol, userVehicles) {
  const live = pickUserVehicleForPatrol(patrol, userVehicles);
  const raw = (live?.color || patrol?.vehicle_color || 'blue').toString().toLowerCase();
  if (raw === 'silver') return 'gray';
  return raw;
}
