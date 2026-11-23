/**
 * Platform analytics page: pure view helpers (URL state, KPI cards, attention items,
 * table sorting, labels). No React, no Supabase; unit-tested.
 */
import {
  ANALYTICS_GRAINS,
  ANALYTICS_PRESETS,
  analyticsBounds,
  analyticsRpcArgs,
  daysInRange,
  defaultGrainForDays,
  formatDelta,
  formatSeconds,
  rangeForAnalyticsPreset,
} from "./analytics.js";

export const ANALYTICS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "patrols", label: "Patrols" },
  { id: "safety", label: "Safety" },
  { id: "people", label: "People" },
  { id: "residents", label: "Residents" },
  { id: "community", label: "Community" },
  { id: "security", label: "Security" },
  { id: "watches", label: "Watches" },
];
const TAB_IDS = ANALYTICS_TABS.map((t) => t.id);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const PRESET_LABELS = { "7d": "7d", "30d": "30d", "90d": "90d", "12m": "12m", custom: "Custom" };
export const GRAIN_LABELS = { day: "Day", week: "Week", month: "Month" };

function uuidParam(params, key) {
  const v = params.get(key);
  return v && UUID.test(v) ? v : "";
}

/** Page state from the URL query (tab, range, filters, grain). Bad values fall back to defaults. */
export function parseAnalyticsSearch(search, now = new Date()) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const tab = TAB_IDS.includes(params.get("tab")) ? params.get("tab") : "overview";
  let preset = ANALYTICS_PRESETS.includes(params.get("range")) ? params.get("range") : "30d";
  let from = "";
  let to = "";
  if (preset === "custom") {
    from = params.get("from") || "";
    to = params.get("to") || "";
    if (!YMD.test(from) || !YMD.test(to)) preset = "30d";
  }
  if (preset !== "custom") ({ from, to } = rangeForAnalyticsPreset(preset, now));
  if (from > to) [from, to] = [to, from];
  const grainParam = params.get("grain");
  const grainIsDefault = !ANALYTICS_GRAINS.includes(grainParam);
  return {
    tab,
    preset,
    from,
    to,
    grain: grainIsDefault ? defaultGrainForDays(daysInRange(from, to)) : grainParam,
    grainIsDefault,
    cityId: uuidParam(params, "city"),
    suburbId: uuidParam(params, "suburb"),
    orgId: uuidParam(params, "watch"),
  };
}

/** URL query for a state plus a patch. Defaults are left out to keep links short. */
export function analyticsSearchString(state, patch = {}) {
  const next = { ...state, ...patch };
  const params = new URLSearchParams();
  if (next.tab && next.tab !== "overview") params.set("tab", next.tab);
  if (next.preset && next.preset !== "30d") params.set("range", next.preset);
  if (next.preset === "custom") {
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
  }
  if (!next.grainIsDefault && ANALYTICS_GRAINS.includes(next.grain)) params.set("grain", next.grain);
  if (next.cityId) params.set("city", next.cityId);
  if (next.suburbId) params.set("suburb", next.suburbId);
  if (next.orgId) params.set("watch", next.orgId);
  return params.toString();
}

/** RPC arguments for the current state, or a friendly validation error. */
export function analyticsRequest(state) {
  const bounds = analyticsBounds({ from: state?.from, to: state?.to });
  if (!bounds.ok) return { ok: false, error: bounds.error };
  return {
    ok: true,
    days: bounds.days,
    args: analyticsRpcArgs({
      from: bounds.from,
      to: bounds.to,
      cityIds: state.cityId ? [state.cityId] : [],
      suburbIds: state.suburbId ? [state.suburbId] : [],
      orgIds: state.orgId ? [state.orgId] : [],
      grain: state.grain,
    }),
  };
}

function num(v) {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/** "3,482", "7.5", "1,946"; null-safe ("—"). */
export function formatCount(value, digits = 0) {
  const n = num(value);
  if (n === null) return "—";
  const fixed = n.toFixed(digits);
  const [int, dec] = fixed.split(".");
  const sign = int.startsWith("-") ? "−" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = dec && /[1-9]/.test(dec) ? `.${dec.replace(/0+$/, "")}` : "";
  return `${sign}${grouped}${decimals}`;
}

/** "2h 24m", "45m"; null-safe. */
export function formatMinutes(minutes) {
  const n = num(minutes);
  if (n === null || n <= 0) return "—";
  const total = Math.round(n);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

export const ROLE_LABELS = {
  resident: "Residents",
  user: "Residents",
  patroller: "Patrollers",
  volunteer: "Patrollers",
  nw_admin: "NW admins",
  committee: "Committee",
  security_admin: "Security staff",
  security_company: "Security staff",
  admin: "Global admins",
  technical_support: "Support",
  unknown: "Not set",
};

export function roleLabel(role) {
  const key = String(role || "unknown").toLowerCase().replace(/-/g, "_");
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** [{ name, value }] for a role count object, labels merged (resident + user), largest first. */
export function roleRows(counts) {
  const merged = new Map();
  for (const [role, value] of Object.entries(counts && typeof counts === "object" ? counts : {})) {
    const n = num(value) || 0;
    if (!n) continue;
    const name = roleLabel(role);
    merged.set(name, (merged.get(name) || 0) + n);
  }
  return [...merged.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** "2,911 residents · 571 patrollers" (top two roles). */
export function roleSummary(counts) {
  const rows = roleRows(counts).slice(0, 2);
  if (!rows.length) return "No members yet";
  return rows.map((r) => `${formatCount(r.value)} ${r.name.toLowerCase()}`).join(" · ");
}

/** [{ name, value, code }] for the Android version spread, newest first. */
export function versionRows(appVersions) {
  const list = Array.isArray(appVersions?.versions) ? appVersions.versions : [];
  return list
    .map((v) => {
      const code = num(v?.code);
      const name = typeof v?.name === "string" && v.name ? v.name : null;
      return {
        code,
        name: code === null ? "Unknown" : name ? `${name} (${code})` : `Build ${code}`,
        value: num(v?.devices) || 0,
      };
    })
    .filter((v) => v.value > 0)
    .sort((a, b) => (b.code ?? -1) - (a.code ?? -1));
}

/** Chart rows: every bucket with numeric fields. */
export function seriesRows(overview) {
  const list = Array.isArray(overview?.series) ? overview.series : [];
  return list.map((b) => ({
    bucket: String(b?.bucket || "").slice(0, 10),
    patrols: num(b?.patrols) || 0,
    patrol_hours: num(b?.patrol_hours) || 0,
    distance_km: num(b?.distance_km) || 0,
    incidents: num(b?.incidents) || 0,
    sos_alerts: num(b?.sos_alerts) || 0,
    signups: num(b?.signups) || 0,
  }));
}

export function hasAnyValue(rows, key) {
  return Array.isArray(rows) && rows.some((r) => Number(r?.[key]) > 0);
}

/** Axis label for a bucket start: "2 Nov" for days and weeks, "Nov 2026" for months. */
export function formatBucketLabel(bucket, grain) {
  if (!YMD.test(String(bucket || ""))) return "";
  const [y, m, d] = bucket.split("-").map(Number);
  if (grain === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]}`;
}

export function distanceSub(c) {
  const tracked = num(c?.distance_tracked_patrols);
  if (tracked === null) return "from routes and GPS tracks";
  return tracked ? `GPS-tracked on ${formatCount(tracked)} of ${formatCount(c.patrols)} patrols` : "no GPS-tracked patrols";
}

/** The eight overview KPI cards. */
export function buildKpis(overview) {
  const c = overview?.current;
  if (!c) return [];
  const p = overview.previous || {};
  const signups = num(c.signups) || 0;
  return [
    {
      key: "watches",
      label: "Active watches",
      value: formatCount(c.active_watches),
      delta: formatDelta(c.active_watches, p.active_watches, { mode: "absolute", digits: 0 }),
      sub: `patrolled · of ${formatCount(overview.watches?.total ?? 0)} watches`,
      spark: "patrols",
    },
    {
      key: "members",
      label: "Members",
      value: formatCount(overview.members_total),
      delta: signups ? { text: `+${formatCount(signups)} new`, direction: "up", good: true } : { text: "No new", direction: "flat", good: null },
      sub: roleSummary(overview.members_by_role),
      spark: "signups",
    },
    {
      key: "hours",
      label: "Patrol hours",
      value: `${formatCount(c.patrol_hours, 1)} h`,
      delta: formatDelta(c.patrol_hours, p.patrol_hours),
      sub: `${formatCount(c.patrols)} patrols · avg ${formatMinutes(c.avg_patrol_minutes)}`,
      spark: "patrol_hours",
    },
    {
      key: "distance",
      label: "Distance patrolled",
      value: `${formatCount(c.distance_km, 1)} km`,
      delta: formatDelta(c.distance_km, p.distance_km),
      sub: distanceSub(c),
      spark: "distance_km",
    },
    {
      key: "incidents",
      label: "Incidents reported",
      value: formatCount(c.incidents),
      delta: formatDelta(c.incidents, p.incidents, { higherIsBetter: false }),
      sub: `${formatCount(c.incidents_approved)} approved · ${formatCount(c.incidents_pending)} pending`,
      spark: "incidents",
    },
    {
      key: "sos",
      label: "SOS alerts",
      value: formatCount(c.sos_alerts),
      delta: formatDelta(c.sos_alerts, p.sos_alerts, { mode: "absolute", digits: 0, higherIsBetter: false }),
      sub: `median acknowledge ${formatSeconds(c.sos_ack_median_seconds)}`,
      spark: "sos_alerts",
    },
    {
      key: "signups",
      label: "New sign-ups",
      value: formatCount(signups),
      delta: formatDelta(signups, p.signups),
      sub: roleRows(c.signups_by_role).length ? roleSummary(c.signups_by_role) : "No sign-ups in this period",
      spark: "signups",
    },
    {
      key: "share",
      label: "WhatsApp share rate",
      value: num(c.share_rate_start) === null ? "—" : `${formatCount(c.share_rate_start, 1)}%`,
      delta: formatDelta(c.share_rate_start, p.share_rate_start, { mode: "points", digits: 1 }),
      sub: num(c.share_rate_end) === null ? "no patrols in this period" : `sign-on shared · ${formatCount(c.share_rate_end, 1)}% sign-off`,
      spark: null,
    },
  ];
}

function plural(n, one, many) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Items for the "Needs attention" card, most urgent first. */
export function buildNeedsAttention(overview) {
  const c = overview?.current;
  if (!c) return [];
  const p = overview.previous || {};
  const items = [];
  const unacked = (num(c.sos_alerts) || 0) - (num(c.sos_acknowledged) || 0);
  if (unacked > 0) {
    items.push({ key: "sos", tone: "red", title: `${plural(unacked, "SOS alert", "SOS alerts")} never acknowledged`, detail: "In the selected period" });
  }
  const pending = num(c.incidents_pending) || 0;
  if (pending > 0) {
    items.push({ key: "pending", tone: "amber", title: `${plural(pending, "incident", "incidents")} waiting for approval`, detail: "Reported in the selected period" });
  }
  const shareNow = num(c.share_rate_start);
  const sharePrev = num(p.share_rate_start);
  if (shareNow !== null && sharePrev !== null && shareNow - sharePrev <= -3) {
    items.push({
      key: "share",
      tone: "red",
      title: `WhatsApp share rate down ${formatCount(sharePrev - shareNow, 1)} pts`,
      detail: num(c.share_rate_end) === null ? "Sign-on shares" : `Sign-off shared on ${formatCount(c.share_rate_end, 1)}% of patrols`,
    });
  }
  const versions = versionRows(overview.app_versions);
  const devices = versions.reduce((s, v) => s + v.value, 0);
  if (versions.length > 1 && devices > 0) {
    const older = devices - versions[0].value;
    const pct = Math.round((older / devices) * 100);
    if (older > 0) {
      const min = num(overview.app_versions?.min_supported_version_code) || 0;
      items.push({
        key: "versions",
        tone: "sky",
        title: `${pct}% of Android devices aren't on ${versions[0].name}`,
        detail: min > 0 ? `Forced-update minimum is build ${min}` : "No forced-update minimum is set",
      });
    }
  }
  const latest = overview.terms?.latest_version;
  const notAccepted = (num(overview.members_total) || 0) - (num(overview.terms?.on_latest) || 0);
  if (latest && notAccepted > 0) {
    items.push({ key: "terms", tone: "gray", title: `${plural(notAccepted, "member hasn't", "members haven't")} accepted the current terms`, detail: `Version ${latest}` });
  }
  return items;
}

/** Sort watch rows by a column; nulls last; ties by name. */
export function sortWatches(rows, key = "patrol_hours", dir = "desc") {
  const list = Array.isArray(rows) ? [...rows] : [];
  const factor = dir === "asc" ? 1 : -1;
  const value = (r) => {
    if (key === "delta") {
      const cur = num(r?.patrol_hours) || 0;
      const prev = num(r?.previous_patrol_hours) || 0;
      return prev === 0 ? (cur > 0 ? Infinity : 0) : (cur - prev) / prev;
    }
    if (key === "last_activity_at") {
      const t = r?.last_activity_at ? new Date(r.last_activity_at).getTime() : NaN;
      return Number.isFinite(t) ? t : null;
    }
    const v = r?.[key];
    if (typeof v === "string" && num(v) === null) return v.toLowerCase();
    return num(v);
  };
  return list.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return String(a?.watch_name || "").localeCompare(String(b?.watch_name || ""));
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -1 * factor;
    if (x > y) return 1 * factor;
    return String(a?.watch_name || "").localeCompare(String(b?.watch_name || ""));
  });
}

/** "12 min ago", "3 h ago", "5 d ago", or a date; "—" when unknown. */
export function formatAgo(iso, nowMs) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return "—";
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} d ago`;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Cities worth offering in the analytics City filter: only those with a suburb or a watch.
 * The cities table holds every South African town, so listing all of it would be thousands of rows.
 */
export function cityIdsInUse({ suburbs = [], watches = [] } = {}) {
  const ids = new Set();
  for (const s of suburbs) if (s?.city_id) ids.add(s.city_id);
  for (const w of watches) if (w?.city_id) ids.add(w.city_id);
  return [...ids].sort();
}

/** Filter options for the Suburb and Watch pickers, narrowed by the chosen city / suburb. */
export function narrowFilterOptions({ suburbs = [], watches = [], orgSuburbs = [] } = {}, { cityId = "", suburbId = "" } = {}) {
  const suburbCity = new Map(suburbs.map((s) => [s.id, s.city_id]));
  const linked = new Map();
  for (const link of orgSuburbs) {
    if (!linked.has(link.organization_id)) linked.set(link.organization_id, new Set());
    linked.get(link.organization_id).add(link.suburb_id);
  }
  const watchSuburbs = (w) => new Set([w.primary_suburb_id, ...(linked.get(w.id) || [])].filter(Boolean));
  const visibleSuburbs = cityId ? suburbs.filter((s) => s.city_id === cityId) : suburbs;
  const visibleWatches = watches.filter((w) => {
    const subs = watchSuburbs(w);
    if (cityId && w.city_id !== cityId && ![...subs].some((s) => suburbCity.get(s) === cityId)) return false;
    if (suburbId && !subs.has(suburbId)) return false;
    return true;
  });
  return { suburbs: visibleSuburbs, watches: visibleWatches };
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 7 x 24 matrix of patrol counts (rows Mon..Sun, columns 00..23) plus the busiest cell. */
export function heatMatrix(heat) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ patrols: 0, hours: 0 })));
  let max = 0;
  let busiest = null;
  for (const cell of Array.isArray(heat) ? heat : []) {
    const d = Number(cell?.dow);
    const h = Number(cell?.hour);
    if (!Number.isInteger(d) || !Number.isInteger(h) || d < 0 || d > 6 || h < 0 || h > 23) continue;
    const patrols = num(cell.patrols) || 0;
    grid[d][h] = { patrols, hours: num(cell.hours) || 0 };
    if (patrols > max) {
      max = patrols;
      busiest = { dow: d, hour: h, patrols };
    }
  }
  return { grid, max, busiest };
}

export function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "R 1,234.50" from cents; "R 0" when empty. */
export function formatRand(cents) {
  const n = num(cents);
  if (n === null) return "—";
  const rand = n / 100;
  const text = formatCount(Math.abs(rand), 2);
  const withCents = text.includes(".") && text.split(".")[1].length === 1 ? `${text}0` : text;
  return `${rand < 0 ? "−" : ""}R ${withCents}`;
}

const WORD_FIXES = { sos: "SOS", nw: "NW", id: "ID", ugc: "UGC" };

/** "contribute_cost" -> "Contribute cost"; "false_info" -> "False info". */
export function labelize(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  const words = raw.replace(/[_-]+/g, " ").split(/\s+/).map((w) => WORD_FIXES[w.toLowerCase()] || w.toLowerCase());
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/** [{ key: x, value: n }] rows from an RPC list, labelled and sorted by value. */
export function countRows(list, key, valueKey) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({ name: labelize(r?.[key]), value: num(r?.[valueKey]) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** Seconds -> "2h 05m" / "3 d 4 h" for turnaround figures. */
export function formatDuration(seconds) {
  const n = num(seconds);
  if (n === null || n < 0) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const minutes = Math.round(n / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

export function percent(part, whole) {
  const a = num(part);
  const b = num(whole);
  if (a === null || !b) return null;
  return Math.round((a / b) * 1000) / 10;
}

const ROLE_GROUP_LABELS = {
  resident: "Residents",
  patroller: "Patrollers",
  watch_admin: "Watch admins",
  security: "Security staff",
  staff: "Global admins and support",
  other: "Other roles",
  unknown: "Not recorded",
};

/** "Residents", "Patrollers", ... for analytics_role_group() values. */
export function roleGroupLabel(group) {
  return ROLE_GROUP_LABELS[group] || labelize(group);
}

/** "Sep 2026" from "2026-09". */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return String(ym || "");
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
