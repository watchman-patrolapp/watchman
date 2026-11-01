/**
 * Pure helpers for the patrol share card + WhatsApp caption.
 * No DOM / React / Supabase imports so `node --test` can load this file.
 * Every displayed time comes from a DB timestamp passed in (never Date.now()).
 */
import { parsePatrolTime, WATCH_TIME_ZONE } from "./watchTime.js";
import {
  isLightMobilityVehicleType,
  getVehicleTypePublicLabel,
  normalizeVehicleTypeKey,
} from "./vehicleTypeConstants.js";

export const DEFAULT_SHARE_TIME_ZONE = WATCH_TIME_ZONE;
export const SHARE_APP_NAME = "Watchman";
export const SHARE_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHARE_REF_RE = new RegExp(`^PT-[${SHARE_REF_ALPHABET}]{4}$`);

export function isValidShareRef(ref) {
  return typeof ref === "string" && SHARE_REF_RE.test(ref);
}

function cleanText(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "-" ? "" : s;
}

function safeZone(tz) {
  const zone = cleanText(tz) || DEFAULT_SHARE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-ZA", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_SHARE_TIME_ZONE;
  }
}

/** "KD" from "Khurshid Dustmurodov"; first+last word; falls back to "?". */
export function initialsOf(name) {
  const parts = cleanText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return (first + last).toUpperCase() || "?";
}

function zonedParts(value, tz) {
  const d = parsePatrolTime(value);
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(tz),
    hourCycle: "h23",
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const out = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return {
    weekday: out.weekday,
    day: Number(out.day),
    month: out.month,
    year: Number(out.year),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
  };
}

/** "8:31 PM" in the org time zone; "" when the timestamp is missing. */
export function formatShareClock(value, tz) {
  const p = zonedParts(value, tz);
  if (!p) return "";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** "Sat 31 Oct 2026" in the org time zone. */
export function formatShareDate(value, tz) {
  const p = zonedParts(value, tz);
  if (!p) return "";
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "2h 32m" / "45m"; "" when either end is missing or the range is negative. */
export function formatShareDuration(startValue, endValue) {
  const s = parsePatrolTime(startValue);
  const e = parsePatrolTime(endValue);
  if (!s || !e) return "";
  const mins = Math.floor((e.getTime() - s.getTime()) / 60000);
  if (mins < 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Night = 18:00 to 05:59 in the org time zone. */
export function isNightAt(value, tz) {
  const p = zonedParts(value, tz);
  if (!p) return false;
  return p.hour >= 18 || p.hour < 6;
}

/** Card theme from the relevant DB event time (sign-on for start, sign-off for end). */
export function shareCardTheme(kind, patrol, tz) {
  const at = kind === "end" ? patrol?.end_time : patrol?.start_time;
  return isNightAt(at, tz) ? "dark" : "light";
}

/**
 * Vehicle box content. Returns null when there is nothing to show.
 * { name: "Ford Ranger" | "", plate: "KMD 113 EC" | "" }
 */
export function shareVehicle(patrol) {
  if (!patrol) return null;
  const type = normalizeVehicleTypeKey(patrol.vehicle_type);
  const makeModel = cleanText(patrol.vehicle_make_model) || cleanText(patrol.car_type);
  const plate = (cleanText(patrol.vehicle_reg) || cleanText(patrol.reg_number)).toUpperCase();
  let name = makeModel;
  if (type && isLightMobilityVehicleType(type)) name = getVehicleTypePublicLabel(type);
  else if (!name && type) name = getVehicleTypePublicLabel(type);
  if (!name && !plate) return null;
  return { name, plate };
}

/** "082 *** **67": keeps the first 3 and last 2 digits. "" when too short. */
export function maskPhone(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length < 7) return "";
  return `${digits.slice(0, 3)} *** **${digits.slice(-2)}`;
}

/** Maps link only (never raw coordinates in the caption text). ~11 m precision. */
export function mapsLink(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return "";
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return "";
  return `https://maps.google.com/?q=${la.toFixed(4)},${ln.toFixed(4)}`;
}

/** Generic card header subtitle under the app name (no suburb). */
export const SHARE_HEADER_TITLE = "Neighbourhood Watch";

/** Drops a trailing "Neighbourhood Watch" / "Neighborhood Watch" / "NW" (case-insensitive). */
export function shortAreaName(name) {
  const text = cleanText(name);
  if (!text) return "";
  const short = text.replace(/[\s,·-]+(neighbou?rhood\s+watch|nw)$/i, "").trim();
  return short || text;
}

/** Area label from the DB zone, else the organisation name, without a NW suffix. No hardcoded areas. */
export function shareAreaName(patrol, organizationName) {
  return shortAreaName(patrol?.zone) || shortAreaName(organizationName) || "";
}

/** Everything the card renders, derived from DB fields only. */
export function buildShareCardModel({ kind, patrol, organizationName, timeZone, appName = SHARE_APP_NAME, showVehicle = true }) {
  const tz = safeZone(timeZone);
  const isEnd = kind === "end";
  const area = shareAreaName(patrol, organizationName);
  const eventAt = isEnd ? patrol?.end_time : patrol?.start_time;
  return {
    kind: isEnd ? "end" : "start",
    theme: shareCardTheme(kind, patrol, tz),
    appName,
    areaName: area,
    dateLabel: formatShareDate(eventAt, tz),
    name: cleanText(patrol?.user_name) || "Patroller",
    initials: initialsOf(patrol?.user_name),
    timeOn: formatShareClock(patrol?.start_time, tz) || "—",
    timeOff: isEnd ? formatShareClock(patrol?.end_time, tz) || "—" : "—",
    duration: isEnd ? formatShareDuration(patrol?.start_time, patrol?.end_time) || "—" : "On patrol",
    area: area || "—",
    vehicle: showVehicle ? shareVehicle(patrol) : null,
    shareRef: cleanText(patrol?.share_ref),
  };
}

/**
 * WhatsApp caption. Phone (masked) and maps link only when toggled on.
 * WhatsApp renders *bold*.
 */
export function buildShareCaption({ kind, patrol, organizationName, timeZone, appName = SHARE_APP_NAME, options = {}, phone, location }) {
  const m = buildShareCardModel({ kind, patrol, organizationName, timeZone, appName, showVehicle: options.vehicle !== false });
  const lines = [];
  const where = m.areaName ? ` · ${m.areaName}` : "";
  // No leading emoji: astral-plane emoji arrived as U+FFFD via wa.me -> WhatsApp Desktop.
  lines.push(`*${m.name} signed ${m.kind === "end" ? "off" : "on"}*${where}`);
  if (m.kind === "end") {
    lines.push(`On ${m.timeOn} · Off ${m.timeOff}${m.duration && m.duration !== "—" ? ` · ${m.duration}` : ""}`);
  } else {
    lines.push(`On ${m.timeOn} · ${m.dateLabel}`);
  }
  if (m.vehicle) {
    const v = [m.vehicle.name, m.vehicle.plate].filter(Boolean).join(" · ");
    if (v) lines.push(`Vehicle: ${v}`);
  }
  if (options.phone) {
    const masked = maskPhone(phone);
    if (masked) lines.push(`Phone: ${masked}`);
  }
  if (options.location && location) {
    const link = mapsLink(location.lat, location.lng);
    if (link) lines.push(`Location: ${link}`);
  }
  if (m.shareRef) lines.push(`Ref ${m.shareRef} · ${m.appName}`);
  return lines.join("\n");
}

export const SHARE_PREFS_KEY = "watchman.patrolShare.prefs.v1";
export const DEFAULT_SHARE_PREFS = Object.freeze({ vehicle: true, phone: false, location: false });

export function parseSharePrefs(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!v || typeof v !== "object") return { ...DEFAULT_SHARE_PREFS };
    return {
      vehicle: typeof v.vehicle === "boolean" ? v.vehicle : DEFAULT_SHARE_PREFS.vehicle,
      phone: typeof v.phone === "boolean" ? v.phone : DEFAULT_SHARE_PREFS.phone,
      location: typeof v.location === "boolean" ? v.location : DEFAULT_SHARE_PREFS.location,
    };
  } catch {
    return { ...DEFAULT_SHARE_PREFS };
  }
}

/** "watchman-PT-7KQ3-on.png" / "watchman-PT-7KQ3-off.png"; safe characters only. */
export function shareImageFileName(shareRef, kind) {
  const ref = String(shareRef ?? "").trim().replace(/[^A-Za-z0-9-]/g, "") || "patrol";
  return `watchman-${ref}-${kind === "end" ? "off" : "on"}.png`;
}

/** The patroller's "not shared yet" banner only nags for this long after the event. */
export const SHARE_REMINDER_WINDOW_MS = 30 * 60 * 1000;

/** Event time (ms) from DB timestamps: sign-on counts from start_time, sign-off from end_time. NaN if missing. */
export function shareReminderEventMs(row) {
  const ts = row?.source === "active" ? row?.start_time : row?.end_time || row?.start_time;
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

/** Pending shares still inside the reminder window at nowMs (rows without a valid timestamp are dropped). */
export function filterFreshPendingShares(rows, nowMs, windowMs = SHARE_REMINDER_WINDOW_MS) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const ms = shareReminderEventMs(row);
    return Number.isFinite(ms) && nowMs - ms <= windowMs;
  });
}

/** Ms until the next fresh row expires (for a timer), or null when none. */
export function msUntilNextShareExpiry(rows, nowMs, windowMs = SHARE_REMINDER_WINDOW_MS) {
  const left = filterFreshPendingShares(rows, nowMs, windowMs).map((r) => shareReminderEventMs(r) + windowMs - nowMs);
  return left.length ? Math.max(0, Math.min(...left)) : null;
}

function nameWords(v) {
  return cleanText(v).split(/\s+/).filter(Boolean);
}

/**
 * Snapshot user_name on old patrol rows can be just a first name. When the patrol
 * belongs to the signed-in user, prefer their fuller name (profile full_name, or
 * auth metadata first + last) if it extends the stored name. Never swaps in a different person.
 */
export function withFullPatrollerName(patrol, { viewerUid, viewerFullName, viewerNameParts } = {}) {
  if (!patrol) return patrol;
  const owner = cleanText(patrol.user_id);
  if (!owner || !viewerUid || owner !== cleanText(viewerUid)) return patrol;
  const current = nameWords(patrol.user_name);
  const candidates = [viewerFullName, (viewerNameParts || []).map(cleanText).filter(Boolean).join(" ")];
  let best = current;
  for (const c of candidates) {
    const w = nameWords(c);
    const extends_ = current.length === 0 || current.every((part, i) => w[i] && w[i].toLowerCase() === part.toLowerCase());
    if (extends_ && w.length > best.length) best = w;
  }
  return best === current ? patrol : { ...patrol, user_name: best.join(" ") };
}
