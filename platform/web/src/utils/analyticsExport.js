/**
 * Platform analytics exports: CSV text for the current tab (plus the watch table) and the
 * header lines shared with the printable PDF. Pure functions; no DOM, no Supabase.
 */
import {
  WEEKDAYS,
  countRows,
  formatBucketLabel,
  hourLabel,
  labelize,
  roleRows,
  seriesRows,
  versionRows,
} from "./analyticsView.js";

/** One CSV cell. Text that a spreadsheet would run as a formula is prefixed with '. */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Sections -> CSV: a title row, a header row and data rows per section, blank line between. */
export function sectionsToCsv(meta, sections) {
  const lines = [];
  for (const [k, v] of meta) lines.push([csvCell(k), csvCell(v)].join(","));
  for (const section of sections) {
    if (!section?.rows?.length) continue;
    lines.push("");
    lines.push(csvCell(section.title));
    lines.push(section.columns.map((c) => csvCell(c.label)).join(","));
    for (const row of section.rows) lines.push(section.columns.map((c) => csvCell(row[c.key])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const n = (v) => {
  const x = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x;
};

function kv(title, pairs) {
  return {
    title,
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows: pairs.filter(([, v]) => v !== undefined).map(([metric, value]) => ({ metric, value: n(value) ?? value ?? "" })),
  };
}

function list(title, label, rows) {
  return { title, columns: [{ key: "name", label }, { key: "value", label: "Count" }], rows };
}

function seriesSection(overview, title = "Over time") {
  const grain = overview?.range?.grain || "day";
  return {
    title,
    columns: [
      { key: "bucket", label: "Period starting" },
      { key: "label", label: "Label" },
      { key: "patrols", label: "Patrols" },
      { key: "patrol_hours", label: "Patrol hours" },
      { key: "distance_km", label: "Distance km" },
      { key: "incidents", label: "Incidents" },
      { key: "sos_alerts", label: "SOS alerts" },
      { key: "signups", label: "Sign-ups" },
    ],
    rows: seriesRows(overview).map((r) => ({ ...r, label: formatBucketLabel(r.bucket, grain) })),
  };
}

export function watchesSection(watches) {
  return {
    title: "Watches",
    columns: [
      { key: "watch_name", label: "Watch" },
      { key: "watch_status", label: "Status" },
      { key: "city_name", label: "City" },
      { key: "suburb_name", label: "Suburb" },
      { key: "members", label: "Members" },
      { key: "patrollers", label: "Patrollers" },
      { key: "patrols", label: "Patrols" },
      { key: "patrol_hours", label: "Patrol hours" },
      { key: "previous_patrol_hours", label: "Previous period hours" },
      { key: "distance_km", label: "Distance km" },
      { key: "incidents", label: "Incidents" },
      { key: "sos_alerts", label: "SOS alerts" },
      { key: "last_activity_at", label: "Last activity" },
    ],
    rows: (Array.isArray(watches) ? watches : []).map((w) => ({
      ...w,
      members: n(w.members),
      patrollers: n(w.patrollers),
      patrols: n(w.patrols),
      patrol_hours: n(w.patrol_hours),
      previous_patrol_hours: n(w.previous_patrol_hours),
      distance_km: n(w.distance_km),
      incidents: n(w.incidents),
      sos_alerts: n(w.sos_alerts),
    })),
  };
}

/** CSV sections for a tab. `section` is that tab's phase 3 RPC result (or null). */
export function tabExportSections(tab, { overview, watches, section }) {
  const c = overview?.current || {};
  const out = [];
  if (tab === "overview") {
    out.push(
      kv("Summary", [
        ["Active watches", c.active_watches],
        ["Members", overview?.members_total],
        ["Patrols", c.patrols],
        ["Patrol hours", c.patrol_hours],
        ["Distance km", c.distance_km],
        ["Incidents", c.incidents],
        ["Incidents pending", c.incidents_pending],
        ["SOS alerts", c.sos_alerts],
        ["SOS acknowledged", c.sos_acknowledged],
        ["SOS median acknowledge seconds", c.sos_ack_median_seconds],
        ["New sign-ups", c.signups],
        ["WhatsApp sign-on share %", c.share_rate_start],
        ["WhatsApp sign-off share %", c.share_rate_end],
      ]),
      seriesSection(overview)
    );
  } else if (tab === "patrols") {
    const s = section || {};
    out.push(
      kv("Patrol summary", [
        ["Patrols", c.patrols],
        ["Patrol hours", c.patrol_hours],
        ["Volunteers", c.patrol_volunteers],
        ["Distance km", s.distance?.km ?? c.distance_km],
        ["GPS-tracked patrols", s.distance?.tracked_patrols],
        ["Sign-on shared %", c.share_rate_start],
        ["Sign-off shared %", c.share_rate_end],
        ["Camera checks during patrols", s.checks?.during_patrols],
        ["Camera checks per patrol", s.checks?.per_patrol],
        ["Longest streak (days)", s.streaks?.longest_days],
      ]),
      seriesSection(overview),
      {
        title: "Busiest times",
        columns: [
          { key: "day", label: "Day" },
          { key: "hour", label: "Hour" },
          { key: "patrols", label: "Patrols" },
          { key: "hours", label: "Hours" },
        ],
        rows: (s.heat || []).map((h) => ({ day: WEEKDAYS[h.dow] || "", hour: hourLabel(h.hour), patrols: n(h.patrols), hours: n(h.hours) })),
      },
      {
        title: "Coverage by suburb",
        columns: [
          { key: "suburb", label: "Suburb" },
          { key: "city", label: "City" },
          { key: "patrols", label: "Patrols" },
          { key: "hours", label: "Hours" },
          { key: "volunteers", label: "Volunteers" },
        ],
        rows: s.coverage_by_suburb || [],
      },
      {
        title: "Top patrollers",
        columns: [
          { key: "name", label: "Volunteer" },
          { key: "hours", label: "Hours" },
          { key: "patrols", label: "Patrols" },
          { key: "days", label: "Days on patrol" },
          { key: "longest_streak_days", label: "Longest streak (days)" },
        ],
        rows: s.top_patrollers || [],
      },
      list("Vehicles", "Vehicle", countRows(s.vehicles, "vehicle", "patrols"))
    );
  } else if (tab === "safety") {
    const s = section || {};
    out.push(
      kv("Safety summary", [
        ["Incidents", s.incidents ?? c.incidents],
        ["Approved", s.moderation?.approved],
        ["Median time to approve (seconds)", s.moderation?.approve_median_seconds],
        ["90% approved within (seconds)", s.moderation?.approve_p90_seconds],
        ["Pending now", s.moderation?.pending_now],
        ["SOS alerts", c.sos_alerts],
        ["SOS median acknowledge seconds", c.sos_ack_median_seconds],
        ["Suspect profiles", s.profiles?.total],
        ["New suspect profiles", s.profiles?.new_in_period],
        ["Match queue pending", s.match_queue?.pending],
      ]),
      list("Incidents by type", "Type", (s.by_type || []).map((t) => ({ name: t.type, value: n(t.incidents) }))),
      {
        title: "Incidents by area",
        columns: [
          { key: "suburb", label: "Suburb" },
          { key: "city", label: "City" },
          { key: "incidents", label: "Incidents" },
        ],
        rows: s.by_area || [],
      },
      list("Suspect profiles by status", "Status", countRows(s.profiles?.by_status, "status", "profiles")),
      list("Suspect profiles by risk", "Risk", countRows(s.profiles?.by_risk, "risk", "profiles"))
    );
  } else if (tab === "people") {
    const s = section || {};
    out.push(
      kv("People summary", [
        ["Members", overview?.members_total],
        ["New sign-ups", s.signups ?? c.signups],
        ["Sign-ups not in a watch yet", s.signups_without_watch],
        ["Residents verified", s.residents?.verified],
        ["Residents pending", s.residents?.pending],
        ["Vouches", s.vouches?.total],
        ["Patroller requests", s.patroller_requests?.in_period],
        ["Patroller requests pending now", s.patroller_requests?.pending_now],
        ["Account deletions", s.deletions?.total],
        ["Members on current terms", overview?.terms?.on_latest],
      ]),
      list("Members by role", "Role", roleRows(overview?.members_by_role)),
      list("Sign-ups by watch", "Watch", (s.signups_by_watch || []).map((w) => ({ name: w.watch, value: n(w.signups) }))),
      list("Android app versions", "Version", versionRows(overview?.app_versions).map((v) => ({ name: v.name, value: v.value }))),
      list("Deletions by role", "Role", countRows(s.deletions?.by_role, "role", "deletions"))
    );
  } else if (tab === "community") {
    const s = section || {};
    out.push(
      kv("Community summary", [
        ["Needs posted", s.needs?.items_created],
        ["Needs met", s.needs?.items_acquired],
        ["Offers", s.needs?.offers],
        ["Offers accepted or fulfilled", s.needs?.offers_converted],
        ["Offer conversion %", s.needs?.conversion_rate],
        ["Rand raised", n(s.ledger?.raised_cents) === null ? null : n(s.ledger.raised_cents) / 100],
        ["Rand spent", n(s.ledger?.spent_cents) === null ? null : n(s.ledger.spent_cents) / 100],
        ["City Hub posts", s.hub_posts?.total],
        ["Chat messages", s.chat?.messages],
        ["Broadcasts", s.broadcasts?.total],
        ["Community reports", s.reports?.total],
        ["Feedback received", s.feedback?.total],
      ]),
      {
        title: "Over time",
        columns: [
          { key: "bucket", label: "Period starting" },
          { key: "offers", label: "Offers" },
          { key: "offers_converted", label: "Offers converted" },
          { key: "raised_rand", label: "Rand raised" },
          { key: "spent_rand", label: "Rand spent" },
          { key: "chat_messages", label: "Chat messages" },
        ],
        rows: (s.series || []).map((r) => ({ ...r, raised_rand: n(r.raised_rand), spent_rand: n(r.spent_rand) })),
      },
      list("City Hub posts by kind", "Kind", countRows(s.hub_posts?.by_type, "type", "posts")),
      list("Reports by reason", "Reason", countRows(s.reports?.by_reason, "reason", "reports"))
    );
  }
  out.push(watchesSection(watches));
  return out;
}

export function exportFileName(tab, from, to, ext) {
  const safe = (v) => String(v || "").replace(/[^0-9a-z-]/gi, "");
  return `watchman-analytics-${safe(tab)}-${safe(from)}-to-${safe(to)}.${ext}`;
}

export { labelize };
