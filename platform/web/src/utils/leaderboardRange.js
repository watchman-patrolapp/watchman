import { addCalendarDays, combineWatchDateTime, periodStartDate, watchDayStamp } from "./watchTime.js";

/** Inclusive last-90-days window in Africa/Johannesburg calendar days. */
export function last90DayRange(now = new Date()) {
  const to = watchDayStamp(now);
  const from = addCalendarDays(to, -89);
  return { preset: "90d", from, to };
}

export function rangeForPreset(preset, now = new Date()) {
  const today = watchDayStamp(now);
  if (preset === "all") return { preset: "all", from: "", to: "" };
  if (preset === "90d") return last90DayRange(now);
  if (preset === "week" || preset === "month") {
    const start = periodStartDate(preset, now);
    return { preset, from: start ? watchDayStamp(start) : today, to: today };
  }
  return last90DayRange(now);
}

/** ISO bounds for the RPC. Empty dates mean all time. `to` is the end of that SAST day. */
export function boundsForRange(range) {
  let fromYmd = String(range?.from || "");
  let toYmd = String(range?.to || "");
  if (fromYmd && toYmd && fromYmd > toYmd) {
    const swap = fromYmd;
    fromYmd = toYmd;
    toYmd = swap;
  }
  if (!fromYmd && !toYmd) return { from: null, to: null };
  const from = fromYmd ? combineWatchDateTime(fromYmd, "00:00") : null;
  let to = null;
  if (toYmd) {
    const nextMidnight = combineWatchDateTime(addCalendarDays(toYmd, 1), "00:00");
    to = nextMidnight ? new Date(new Date(nextMidnight).getTime() - 1).toISOString() : null;
  }
  return { from, to };
}

export function rangeLabel(range) {
  if (!range?.from && !range?.to) return "All time";
  if (range.preset === "week") return "This week";
  if (range.preset === "month") return "This month";
  if (range.preset === "90d") return "Last 90 days";
  if (range.from && range.to) return `${range.from} – ${range.to}`;
  return "Custom range";
}
