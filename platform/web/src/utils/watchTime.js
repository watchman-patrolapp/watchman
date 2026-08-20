/**
 * Neighbourhood watch time is Africa/Johannesburg (UTC+2, no DST).
 * Browser / UTC calendars must not decide "this week" for Gqeberha patrols.
 */

export const WATCH_TIME_ZONE = "Africa/Johannesburg";

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad(n) {
  return String(n).padStart(2, "0");
}

export function watchZonedParts(date = new Date()) {
  const d = date instanceof Date ? date : parsePatrolTime(date);
  if (!d || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WATCH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

export function watchDayStamp(date = new Date()) {
  const p = watchZonedParts(date);
  if (!p) return "";
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addCalendarDays(ymd, delta) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(delta) || 0);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function watchMidnight(year, month, day) {
  return new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00+02:00`);
}

/**
 * Monday 00:00 SAST (week) or 1st of month 00:00 SAST. Null = all time.
 */
export function periodStartDate(periodId, now = new Date()) {
  const p = watchZonedParts(now);
  if (!p) return null;
  if (periodId === "week") {
    const dow = WEEKDAY_INDEX[p.weekday] ?? 1;
    const daysBack = dow === 0 ? 6 : dow - 1;
    const monday = addCalendarDays(`${p.year}-${pad(p.month)}-${pad(p.day)}`, -daysBack);
    const [y, m, d] = monday.split("-").map(Number);
    return watchMidnight(y, m, d);
  }
  if (periodId === "month") {
    return watchMidnight(p.year, p.month, 1);
  }
  return null;
}

export function parsePatrolTime(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  // Postgres / PostgREST often return "2026-08-19 18:56:24.597+00".
  // JS Date needs a T separator and a full offset (+00:00), not bare +00.
  let normalized = /T/.test(raw) ? raw : raw.replace(" ", "T");
  normalized = normalized.replace(/([+-])(\d{2})$/, "$1$2:00");

  let d = new Date(normalized);
  if (Number.isNaN(d.getTime())) d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the patrol belongs in a leaderboard window (week / month). */
export function logOverlapsSince(log, since, now = new Date()) {
  if (!since) return true;
  const start = parsePatrolTime(log?.start_time);
  const end = parsePatrolTime(log?.end_time);
  if (start || end) {
    const earliest = start || end;
    const latest = start && end ? (end > start ? end : start) : (end || start);
    return latest >= since && earliest <= now;
  }
  // Fallback only when start/end are missing (legacy / broken rows).
  const created = parsePatrolTime(log?.created_at);
  return Boolean(created && created >= since && created <= now);
}

/** Prefer stored duration; otherwise derive from start/end. */
export function durationMinutesFromLog(log) {
  const stored = Number(log?.duration_minutes);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const start = parsePatrolTime(log?.start_time);
  const end = parsePatrolTime(log?.end_time);
  if (!start || !end || end <= start) return Math.max(0, Number.isFinite(stored) ? stored : 0);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 60000));
}

export function activePatrolAsLog(row, now = new Date()) {
  const start = parsePatrolTime(row?.start_time);
  const durationMinutes = start
    ? Math.max(1, Math.floor((now.getTime() - start.getTime()) / 60000))
    : 0;
  return {
    user_name: row?.user_name,
    user_id: row?.user_id,
    start_time: row?.start_time,
    end_time: now.toISOString(),
    duration_minutes: durationMinutes,
    zone: row?.zone,
  };
}

/** YYYY-MM-DD for `<input type="date">` in Africa/Johannesburg. */
export function watchDateInputValue(value) {
  const d = value instanceof Date ? value : parsePatrolTime(value);
  return d ? watchDayStamp(d) : "";
}

/** HH:MM for `<input type="time">` in Africa/Johannesburg. */
export function watchTimeInputValue(value) {
  const p = watchZonedParts(value instanceof Date ? value : parsePatrolTime(value));
  if (!p) return "";
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Build an ISO timestamp from SAST calendar date + local time fields.
 * `dateYmd` = YYYY-MM-DD, `timeHm` = HH:MM (defaults midnight SAST).
 */
export function combineWatchDateTime(dateYmd, timeHm = "00:00") {
  const day = String(dateYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const hm = String(timeHm || "00:00").slice(0, 5);
  const time = /^\d{2}:\d{2}$/.test(hm) ? hm : "00:00";
  const d = new Date(`${day}T${time}:00+02:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Safe display string for timestamps / DOB-like values. */
export function formatWatchDateTime(value, opts = {}) {
  const d = value instanceof Date ? value : parsePatrolTime(value);
  if (!d) {
    const raw = String(value || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(`${raw}T12:00:00+02:00`).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: WATCH_TIME_ZONE,
      });
    }
    return "";
  }
  return d.toLocaleString("en-ZA", { timeZone: WATCH_TIME_ZONE, ...opts });
}

export function formatWatchDate(value) {
  const d = value instanceof Date ? value : parsePatrolTime(value);
  if (!d) {
    const raw = String(value || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(`${raw}T12:00:00+02:00`).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: WATCH_TIME_ZONE,
      });
    }
    return "";
  }
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: WATCH_TIME_ZONE,
  });
}
