/** Minutes from midnight for "HH:MM" or "HH:MM:SS" (matches DB / grid constants). */
export function timeToMinutes(t) {
  if (!t) return 0;
  const parts = String(t).trim().split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * End of a patrol window in Africa/Johannesburg wall time.
 * When end clock is not after start (e.g. 23:00–01:00), end is the next calendar day.
 */
export function getSlotEndMs(dateStr, start, end) {
  const [y, mo, d] = String(dateStr || "").split("-").map(Number);
  if (!y || !mo || !d) return 0;
  const parts = String(end || "").trim().split(":");
  const eh = Number(parts[0]) || 0;
  const em = Number(parts[1]) || 0;
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const crossesMidnight = endMin <= startMin;

  let endY = y;
  let endM = mo;
  let endD = d;
  if (crossesMidnight) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    endY = dt.getUTCFullYear();
    endM = dt.getUTCMonth() + 1;
    endD = dt.getUTCDate();
  }

  const endIso = `${endY}-${pad2(endM)}-${pad2(endD)}T${pad2(eh)}:${pad2(em)}:00+02:00`;
  const ms = new Date(endIso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function isSlotEnded(dateStr, start, end, nowMs = Date.now()) {
  const endMs = getSlotEndMs(dateStr, start, end);
  if (!endMs) return false;
  return nowMs >= endMs;
}

export function formatPatrolSlotTimeRange(startTime, endTime) {
  const fmt = (t) => {
    if (!t) return "";
    const [h, m] = String(t).slice(0, 5).split(":");
    return `${h}:${m}`;
  };
  return `${fmt(startTime)}–${fmt(endTime)}`;
}
