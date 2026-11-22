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
  monthLabel,
  roleGroupLabel,
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
  } else if (tab === "residents") {
    const s = section || {};
    const a = s.active || {};
    const sv = s.services || {};
    out.push(
      kv("Active members", [
        ["Tracking since", a.tracking_since || "not started"],
        ["As of", a.as_of],
        ["Daily active residents", a.dau?.residents],
        ["Daily active patrollers", a.dau?.patrollers],
        ["Average daily active residents", a.avg_dau?.residents],
        ["Weekly active residents (7 days)", a.wau?.residents],
        ["Weekly active patrollers (7 days)", a.wau?.patrollers],
        ["Monthly active residents (30 days)", a.mau?.residents],
        ["Monthly active patrollers (30 days)", a.mau?.patrollers],
        ["Residents active in period", a.in_period?.residents],
        ["Patrollers active in period", a.in_period?.patrollers],
      ]),
      {
        title: "Active members over time",
        columns: [
          { key: "bucket", label: "Period starting" },
          { key: "residents", label: "Active residents" },
          { key: "patrollers", label: "Active patrollers" },
          { key: "members", label: "All active members" },
        ],
        rows: a.series || [],
      },
      {
        title: "Reports by who raised them",
        columns: [
          { key: "group", label: "Raised by" },
          { key: "incidents", label: "Incidents" },
          { key: "approved", label: "Approved" },
          { key: "approve_median_seconds", label: "Median to approve (s)" },
          { key: "approve_p90_seconds", label: "90% approved within (s)" },
          { key: "sos", label: "SOS alerts" },
          { key: "sos_acknowledged", label: "SOS acknowledged" },
          { key: "sos_ack_median_seconds", label: "Median to acknowledge (s)" },
          { key: "sos_ack_p90_seconds", label: "90% acknowledged within (s)" },
        ],
        rows: (s.reports?.by_role || []).map((r) => ({ ...r, group: roleGroupLabel(r.role) })),
      },
      {
        title: "Residents and patrol coverage by suburb",
        columns: [
          { key: "suburb", label: "Suburb" },
          { key: "city", label: "City" },
          { key: "residents", label: "Residents" },
          { key: "patrols", label: "Patrols" },
          { key: "hours", label: "Patrol hours" },
          { key: "hours_per_100_residents", label: "Hours per 100 residents" },
          { key: "under", label: "Under-covered" },
        ],
        rows: (s.suburbs?.rows || []).map((r) => ({ ...r, under: r.under_covered ? "Yes" : "" })),
      },
      {
        title: "Retention by sign-up month",
        columns: [
          { key: "month_label", label: "Joined" },
          { key: "group_label", label: "Group" },
          { key: "joined", label: "Joined" },
          { key: "eligible_30", label: "Joined 30+ days ago" },
          { key: "retained_30", label: "Active after 30 days" },
          { key: "eligible_90", label: "Joined 90+ days ago" },
          { key: "retained_90", label: "Active after 90 days" },
        ],
        rows: (s.retention?.cohorts || []).map((r) => ({ ...r, month_label: monthLabel(r.month), group_label: roleGroupLabel(r.group) })),
      },
      kv("Local services", [
        ["Listings", sv.listings],
        ["Active (published)", sv.active],
        ["Inactive", sv.inactive],
        ["Awaiting review", sv.awaiting_review],
        ["New in period", sv.new_in_period],
        ["Providers", sv.providers],
        ["Providers with an active listing", sv.active_providers],
        ["Reviews", sv.reviews?.total],
        ["Average rating", sv.reviews?.avg_rating],
      ]),
      {
        title: "Local services by category",
        columns: [
          { key: "category", label: "Category" },
          { key: "listings", label: "Listings" },
          { key: "active", label: "Active" },
        ],
        rows: sv.by_category || [],
      }
    );
  } else if (tab === "security") {
    const s = section || {};
    out.push(
      kv("Security companies", [
        ["Companies", s.companies?.total],
        ["Active", s.companies?.active],
        ["New in period", s.companies?.new_in_period],
        ["Covering a whole city", s.companies?.city_wide],
        ["Assigned suburbs", s.areas?.assigned_suburbs],
        ["Watch areas covered", s.areas?.watch_areas_covered],
        ["Watch areas in scope", s.areas?.watch_areas_total],
        ["Clients linked", s.clients?.linked],
        ["Clients verified", s.clients?.verified],
        ["Clients awaiting verification", s.clients?.awaiting_verification],
        ["Clients won in period", s.movement?.won],
        ["Clients lost in period", s.movement?.lost],
        ["SOS in partner areas", s.safety?.sos],
        ["SOS acknowledged", s.safety?.sos_acknowledged],
        ["SOS acknowledged by security", s.safety?.sos_ack_by_security],
        ["Median SOS acknowledge (s)", s.safety?.sos_ack_median_seconds],
        ["SOS resolved by security", s.safety?.sos_resolved_by_security],
        ["Incidents in partner areas", s.safety?.incidents],
        ["Live patrols now", s.coverage?.live_patrols_now],
        ["Patrols scheduled today", s.coverage?.scheduled_today],
        ["Patrols scheduled next 7 days", s.coverage?.scheduled_next_7_days],
      ]),
      {
        title: "Onboarding over time",
        columns: [
          { key: "bucket", label: "Period starting" },
          { key: "companies", label: "Companies set up" },
          { key: "clients", label: "Client links" },
        ],
        rows: s.series || [],
      },
      {
        title: "Companies",
        columns: [
          { key: "name", label: "Company" },
          { key: "status", label: "Status" },
          { key: "clients", label: "Clients" },
          { key: "verified", label: "Verified" },
          { key: "suburbs", label: "Assigned suburbs" },
          { key: "watch_areas", label: "Watch areas" },
        ],
        rows: s.top_companies || [],
      },
      list("Client changes", "Change", countRows(s.movement?.by_event, "event", "events"))
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
