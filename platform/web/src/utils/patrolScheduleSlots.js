/** Shared 2-hour patrol windows used by Theescombe and every other watch area. */
export const PATROL_TIME_SLOTS = [
  { label: "19:00–21:00", start: "19:00", end: "21:00" },
  { label: "21:00–23:00", start: "21:00", end: "23:00" },
  { label: "23:00–01:00", start: "23:00", end: "01:00" },
  { label: "01:00–03:00", start: "01:00", end: "03:00" },
  { label: "03:00–05:00", start: "03:00", end: "05:00" },
  { label: "05:00–07:00", start: "05:00", end: "07:00" },
  { label: "07:00–09:00", start: "07:00", end: "09:00" },
  { label: "09:00–11:00", start: "09:00", end: "11:00" },
  { label: "11:00–13:00", start: "11:00", end: "13:00" },
  { label: "13:00–15:00", start: "13:00", end: "15:00" },
  { label: "15:00–17:00", start: "15:00", end: "17:00" },
  { label: "17:00–19:00", start: "17:00", end: "19:00" },
];

export const PATROL_SCHEDULE_DAYS = 7;

export function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getScheduleWindowDates(startOffset = 0, days = PATROL_SCHEDULE_DAYS) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + startOffset + i);
    dates.push(toLocalDateStr(d));
  }
  return dates;
}

export function formatScheduleDateHeader(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}

export function isLocalDateToday(dateStr) {
  return toLocalDateStr(new Date()) === dateStr;
}

export function normalizeSlotClock(value) {
  return String(value || "").slice(0, 5);
}

export function slotDateValue(slot) {
  return String(slot?.slot_date || slot?.date || "").slice(0, 10);
}

export function shortVolunteerName(fullName) {
  if (!fullName) return "?";
  const first = String(fullName).split(" ")[0];
  return first.length > 10 ? `${first.substring(0, 9)}…` : first;
}
