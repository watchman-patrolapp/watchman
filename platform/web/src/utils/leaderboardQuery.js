import { supabase } from "../supabase/client";
import { applyWorkingOrganizationScope } from "./organizationScope";
import { fetchAllQueryPages } from "./fetchPagedRows";
import { fetchPatrolRouteRows } from "./patrolHistoryRoute";
import { activePatrolAsLog, parsePatrolTime } from "./watchTime";

export function leaderboardStatsQueryKey(organizationId, fromIso, toIso) {
  return ["leaderboard", organizationId || null, fromIso || null, toIso || null];
}

export function leaderboardSelfQueryKey(userId, organizationId) {
  return ["leaderboard-self", userId || null, organizationId || null];
}

export function leaderboardVolunteerQueryKey(userId) {
  return ["leaderboard-volunteer", userId || null];
}

function patrolIdentityKey(userId, startTime) {
  const t = parsePatrolTime(startTime);
  return `${userId || ""}|${t ? t.toISOString() : String(startTime || "")}`;
}

export function mapLeaderboardRows(rows) {
  return (rows || [])
    .map((row) => ({
      userId: row.user_id || null,
      name: String(row.display_name || "").trim() || "Volunteer",
      totalMinutes: Number(row.total_minutes) || 0,
      patrols: Number(row.patrol_count) || 0,
      avatarUrl: row.avatar_url || null,
      carType: row.car_type || null,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function fetchLeaderboardStats(organizationId, fromIso, toIso) {
  if (!organizationId) return [];
  const { data, error } = await supabase.rpc("leaderboard_patrol_stats", {
    p_organization_id: organizationId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return mapLeaderboardRows(data);
}

/** This volunteer's logs only — never the whole neighbourhood. */
export async function fetchUserPatrolLogs(userId) {
  if (!userId) return [];
  const selectWithCreated = "user_name, duration_minutes, start_time, end_time, zone, user_id, created_at";
  const selectWithoutCreated = "user_name, duration_minutes, start_time, end_time, zone, user_id";
  let logs;
  try {
    logs = await fetchAllQueryPages(() =>
      applyWorkingOrganizationScope(supabase.from("patrol_logs").select(selectWithCreated))
        .eq("user_id", userId)
        .order("start_time", { ascending: false })
    );
  } catch (err) {
    if (!/created_at/i.test(String(err?.message || err))) throw err;
    logs = await fetchAllQueryPages(() =>
      applyWorkingOrganizationScope(supabase.from("patrol_logs").select(selectWithoutCreated))
        .eq("user_id", userId)
        .order("start_time", { ascending: false })
    );
  }

  try {
    const { data: active, error } = await applyWorkingOrganizationScope(
      supabase.from("active_patrols").select("user_name, start_time, user_id, zone")
    ).eq("user_id", userId);
    if (!error && Array.isArray(active) && active.length) {
      const now = new Date();
      const started = new Set(logs.map((log) => patrolIdentityKey(log.user_id, log.start_time)));
      const activeLogs = active
        .map((row) => activePatrolAsLog(row, now))
        .filter((row) => !started.has(patrolIdentityKey(row.user_id, row.start_time)));
      logs = [...activeLogs, ...logs];
    }
  } catch {
    /* an in-progress patrol is optional for the personal charts */
  }
  return logs;
}

export async function fetchSelfPatrolBundle(user) {
  const logs = user?.id ? await fetchUserPatrolLogs(user.id) : [];
  let routeRows = [];
  if (user?.id) {
    try {
      routeRows = await fetchPatrolRouteRows(supabase, user.id);
    } catch {
      routeRows = [];
    }
  }
  let fuelVehicles = [];
  try {
    const { data, error } = await supabase.rpc("list_watch_fuel_vehicles");
    fuelVehicles = error ? [] : data || [];
  } catch {
    fuelVehicles = [];
  }
  return { logs, routeRows, fuelVehicles };
}
