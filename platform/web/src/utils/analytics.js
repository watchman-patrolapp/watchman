/**
 * Platform analytics dashboard: pure helpers (no React, no Supabase), unit-tested.
 * Dates are calendar days in Africa/Johannesburg ("YYYY-MM-DD"); bounds sent to the
 * analytics RPCs are ISO instants with an exclusive end (next SAST midnight).
 */
import { addCalendarDays, combineWatchDateTime, watchDayStamp } from "./watchTime.js";

export const ANALYTICS_PRESETS = ["7d", "30d", "90d", "12m", "custom"];
export const ANALYTICS_GRAINS = ["day", "week", "month"];
/** Matches the server cap (analytics_bounds): 24 months. */
export const ANALYTICS_MAX_DAYS = 731;

const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdToUtcMs(ymd) {
  if (!YMD.test(String(ymd || ""))) return NaN;
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Inclusive number of calendar days from `fromYmd` to `toYmd`, or NaN. */
export function daysInRange(fromYmd, toYmd) {
  const a = ymdToUtcMs(fromYmd);
  const b = ymdToUtcMs(toYmd);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

/** A preset window ending today (SAST). Unknown presets fall back to 30 days. */
export function rangeForAnalyticsPreset(preset, now = new Date()) {
  const key = PRESET_DAYS[preset] ? preset : "30d";
  const to = watchDayStamp(now);
  return { preset: key, from: addCalendarDays(to, -(PRESET_DAYS[key] - 1)), to };
}

/** A sensible chart grouping for a window length. */
export function defaultGrainForDays(days) {
  if (!Number.isFinite(days) || days <= 31) return "day";
  if (days <= 186) return "week";
  return "month";
}

/**
 * Validates a {from, to} day range and returns RPC bounds.
 * Returns { ok: true, from, to, days } or { ok: false, error } with a friendly message.
 */
export function analyticsBounds(range) {
  let from = String(range?.from || "");
  let to = String(range?.to || "");
  if (!YMD.test(from) || !YMD.test(to)) return { ok: false, error: "Pick a start and end date." };
  if (from > to) [from, to] = [to, from];
  const days = daysInRange(from, to);
  if (days > ANALYTICS_MAX_DAYS) return { ok: false, error: "Pick a date range of 24 months or less." };
  const fromIso = combineWatchDateTime(from, "00:00");
  const toIso = combineWatchDateTime(addCalendarDays(to, 1), "00:00");
  if (!fromIso || !toIso) return { ok: false, error: "Pick a start and end date." };
  return { ok: true, from: fromIso, to: toIso, days };
}

/** The window of the same length immediately before [fromIso, toIso). */
export function previousPeriod(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return { from: new Date(a - (b - a)).toISOString(), to: new Date(a).toISOString() };
}

/** Bucket start for a SAST day: weeks start on Monday, months on the 1st (as Postgres date_trunc). */
export function bucketStart(ymd, grain) {
  const ms = ymdToUtcMs(ymd);
  if (Number.isNaN(ms)) return "";
  if (grain === "month") return `${ymd.slice(0, 7)}-01`;
  if (grain === "week") {
    const dow = new Date(ms).getUTCDay(); // 0 = Sunday
    return addCalendarDays(ymd, -((dow + 6) % 7));
  }
  return ymd;
}

/** Every bucket key from `fromYmd` to `toYmd` (inclusive days) for a grain. */
export function bucketKeys(fromYmd, toYmd, grain) {
  if (!ANALYTICS_GRAINS.includes(grain)) return [];
  const first = bucketStart(fromYmd, grain);
  const last = bucketStart(toYmd, grain);
  if (!first || !last || first > last) return [];
  const keys = [];
  let cur = first;
  while (cur && cur <= last && keys.length < 1000) {
    keys.push(cur);
    if (grain === "day") cur = addCalendarDays(cur, 1);
    else if (grain === "week") cur = addCalendarDays(cur, 7);
    else {
      const [y, m] = cur.split("-").map(Number);
      cur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
  }
  return keys;
}

/** Series rows for every key, in order; missing buckets and fields become 0. */
export function fillBuckets(series, keys, fields) {
  const byKey = new Map();
  for (const row of Array.isArray(series) ? series : []) {
    if (row && typeof row.bucket === "string") byKey.set(row.bucket.slice(0, 10), row);
  }
  return keys.map((bucket) => {
    const row = byKey.get(bucket) || {};
    const out = { bucket };
    for (const f of fields) {
      const n = Number(row[f]);
      out[f] = Number.isFinite(n) ? n : 0;
    }
    return out;
  });
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trimNumber(n, digits) {
  // Plain digits with a "." decimal point (en-ZA locale formatting would use ",").
  return String(Number(n.toFixed(digits)));
}

/**
 * Change vs the previous period for a KPI card.
 * mode: "percent" (default), "points" (for rates already in %) or "absolute".
 * Returns { text, direction: "up" | "down" | "flat" | "none", good: true | false | null }.
 */
export function formatDelta(current, previous, { mode = "percent", higherIsBetter = true, digits = 1 } = {}) {
  const cur = toNumber(current);
  const prev = toNumber(previous);
  if (cur === null || prev === null) return { text: "—", direction: "none", good: null };
  const diff = cur - prev;
  let value;
  let suffix = "";
  if (mode === "points") {
    value = diff;
    suffix = " pts";
  } else if (mode === "absolute") {
    value = diff;
  } else {
    if (prev === 0) {
      if (cur === 0) return { text: "0%", direction: "flat", good: null };
      return { text: "New", direction: "up", good: higherIsBetter };
    }
    value = (diff / Math.abs(prev)) * 100;
    suffix = "%";
  }
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return { text: `0${suffix}`, direction: "flat", good: null };
  const direction = rounded > 0 ? "up" : "down";
  const sign = rounded > 0 ? "+" : "−";
  return {
    text: `${sign}${trimNumber(Math.abs(rounded), digits)}${suffix}`,
    direction,
    good: direction === "up" ? higherIsBetter : !higherIsBetter,
  };
}

/** "2m 40s", "1h 05m", "45s"; null-safe ("—"). */
export function formatSeconds(seconds) {
  const s = toNumber(seconds);
  if (s === null || s < 0) return "—";
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const r = total % 60;
    return r ? `${m}m ${String(r).padStart(2, "0")}s` : `${m}m`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** RPC arguments for analytics_overview / analytics_watch_table. Empty filters become null. */
export function analyticsRpcArgs({ from, to, cityIds, suburbIds, orgIds, grain } = {}) {
  const list = (v) => {
    const ids = (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x);
    return ids.length ? ids : null;
  };
  return {
    p_from: from || null,
    p_to: to || null,
    p_city_ids: list(cityIds),
    p_suburb_ids: list(suburbIds),
    p_org_ids: list(orgIds),
    p_grain: ANALYTICS_GRAINS.includes(grain) ? grain : "week",
  };
}
