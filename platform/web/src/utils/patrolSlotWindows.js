/** Minutes from midnight for "HH:MM" or "HH:MM:SS" (matches DB / grid constants). */
export function timeToMinutes(t) {
  if (!t) return 0;
  const parts = String(t).trim().split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

/**
 * End of a patrol window in local time. When end clock time is not after start (e.g. 23:00–01:00),
 * the end is on the following calendar day.
 */
export function getSlotEndMs(dateStr, start, end) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const parts = String(end).trim().split(":");
  const eh = Number(parts[0]) || 0;
  const em = Number(parts[1]) || 0;
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const crossesMidnight = endMin <= startMin;
  const endDate = new Date(y, mo - 1, d, eh, em, 0, 0);
  if (crossesMidnight) endDate.setDate(endDate.getDate() + 1);
  return endDate.getTime();
}

export function isSlotEnded(dateStr, start, end, nowMs = Date.now()) {
  return nowMs >= getSlotEndMs(dateStr, start, end);
}

export function formatPatrolSlotTimeRange(startTime, endTime) {
  const fmt = (t) => {
    if (!t) return "";
    const [h, m] = String(t).slice(0, 5).split(":");
    return `${h}:${m}`;
  };
  return `${fmt(startTime)}–${fmt(endTime)}`;
}
