import { supabase } from "../supabase/client";
import { parsePatrolTime } from "./watchTime";

export const NOTICE_PIN_MS = 12 * 60 * 60 * 1000;
export const NOTICE_LIFE_MS = 24 * 60 * 60 * 1000;

function timeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = parsePatrolTime(value)?.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function noticePinnedUntil(row) {
  return timeMs(row?.pinned_until) || (timeMs(row?.created_at) ? timeMs(row.created_at) + NOTICE_PIN_MS : 0);
}

export function noticeActivityUntil(row) {
  return timeMs(row?.activity_until) || (timeMs(row?.created_at) ? timeMs(row.created_at) + NOTICE_LIFE_MS : 0);
}

export function isPinnedAreaBroadcast(row, now = Date.now()) {
  const created = timeMs(row?.created_at);
  if (!created) return false;
  return now >= created && now < noticePinnedUntil(row) && now < noticeActivityUntil(row);
}

export function isActivityAreaBroadcast(row, now = Date.now()) {
  const created = timeMs(row?.created_at);
  if (!created) return false;
  return now >= noticePinnedUntil(row) && now < noticeActivityUntil(row);
}

export function formatClockTime(value) {
  const ms = typeof value === "number" ? value : timeMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-ZA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
}

export function formatNoticeRemaining(untilMs, now = Date.now()) {
  const left = untilMs - now;
  if (left <= 0) return "";
  const minutes = Math.max(1, Math.round(left / 60000));
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `${hours}h left`;
}

export function areaBroadcastAsActivityRow(row) {
  return {
    id: row.id,
    incident_type: row.headline || "Neighbourhood notice",
    description: row.body,
    status: "notice",
    submitted_at: row.created_at,
    created_at: row.created_at,
    location_label: null,
    reporter_label: row.author_name || "Neighbourhood watch",
    is_sos: false,
    is_notice: true,
    resolved_at: null,
    pinned_until: row.pinned_until,
    activity_until: row.activity_until,
  };
}

export async function listAreaBroadcasts(limit = 20) {
  const { data, error } = await supabase.rpc("list_area_broadcasts", { p_limit: limit });
  return { data: data || [], error };
}

export async function postAreaBroadcast({ headline, body }) {
  const { data, error } = await supabase.rpc("post_area_broadcast", {
    p_headline: headline,
    p_body: body,
  });
  return { data, error };
}

export function subscribeAreaBroadcasts(organizationId, onChange) {
  const filter = organizationId ? { filter: `organization_id=eq.${organizationId}` } : {};
  const channel = supabase
    .channel(`area-broadcasts-${organizationId || "all"}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "area_broadcasts", ...filter },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function notifyResidentEvent(payload) {
  try {
    await supabase.functions.invoke("notify-resident-event", { body: payload });
  } catch (err) {
    console.warn("notify-resident-event:", err?.message || err);
  }
}
