import { supabase } from "../supabase/client";

export async function getMyAway(userId) {
  if (!userId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("resident_away_periods")
    .select("starts_on, ends_on, note")
    .eq("user_id", userId)
    .maybeSingle();
  return { data, error };
}

export async function setResidentAway({ startsOn, endsOn, note }) {
  const { data, error } = await supabase.rpc("set_resident_away", {
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_note: note || null,
  });
  return { data, error };
}

export async function clearResidentAway() {
  const { error } = await supabase.rpc("clear_resident_away");
  return { error };
}

export async function listHouseholdsAway() {
  const { data, error } = await supabase.rpc("list_households_away");
  return { data: data || [], error };
}

export function isAwayNow(row, today = new Date()) {
  if (!row?.starts_on || !row?.ends_on) return false;
  const start = String(row.starts_on).slice(0, 10);
  const end = String(row.ends_on).slice(0, 10);
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  return iso >= start && iso <= end;
}

export function formatAwayRange(row) {
  if (!row?.starts_on || !row?.ends_on) return "";
  const fmt = (value) => {
    try {
      return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      });
    } catch {
      return String(value);
    }
  };
  return `${fmt(row.starts_on)} – ${fmt(row.ends_on)}`;
}
