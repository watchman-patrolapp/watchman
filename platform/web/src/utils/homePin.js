import { supabase } from "../supabase/client";

export const SECTOR_RADIUS_M = 1200;

export function hasHomePin(userOrPin) {
  const lat = Number(userOrPin?.homeLat ?? userOrPin?.home_lat ?? userOrPin?.lat);
  const lng = Number(userOrPin?.homeLng ?? userOrPin?.home_lng ?? userOrPin?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function formatDistanceM(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 50) return "Nearby";
  if (n < 1000) return `${Math.round(n)} m away`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km away`;
}

export async function setMyHomePin(pin) {
  if (!pin) {
    return supabase.rpc("set_my_home_pin", { p_clear: true });
  }
  return supabase.rpc("set_my_home_pin", {
    p_lat: Number(pin.lat),
    p_lng: Number(pin.lng),
    p_clear: false,
  });
}

export async function listResidentSector(limit = 10) {
  const { data, error } = await supabase.rpc("list_resident_sector", { p_limit: limit });
  if (error) return { data: [], error, needsPin: false };
  const rows = Array.isArray(data)
    ? data.filter((row) => {
        if (!row?.user_id) return false;
        if (row.is_self) return true;
        const meters = Number(row.distance_m);
        if (!Number.isFinite(meters)) return true;
        return meters <= SECTOR_RADIUS_M;
      })
    : [];
  const needsPin = Array.isArray(data) && data.length === 1 && data[0]?.caller_has_pin === false;
  return { data: rows, error: null, needsPin };
}
