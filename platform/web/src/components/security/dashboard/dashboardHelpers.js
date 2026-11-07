import { slotDateValue } from "../../../utils/patrolScheduleSlots";
import { parsePatrolTime, watchZonedParts } from "../../../utils/watchTime";

export const HOT_ZONE_ID = "hot-zones";
export const PATROL_ROLES = new Set([
  "volunteer",
  "patroller",
  "investigator",
  "committee",
  "nw_admin",
  "admin",
  "technical_support",
  "security_admin",
  "city_admin",
]);

export const AREA_THEMES = [
  {
    bar: "bg-teal-500",
    border: "border-teal-300 dark:border-teal-800",
    header: "bg-teal-50 dark:bg-teal-950/50",
    chipOn: "bg-teal-600 text-white ring-teal-600",
    chipOff: "bg-teal-50 text-teal-900 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-100 dark:ring-teal-800",
    count: "bg-teal-600 text-white",
    article: "border-teal-200 dark:border-teal-900",
  },
  {
    bar: "bg-sky-500",
    border: "border-sky-300 dark:border-sky-800",
    header: "bg-sky-50 dark:bg-sky-950/50",
    chipOn: "bg-sky-600 text-white ring-sky-600",
    chipOff: "bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-800",
    count: "bg-sky-600 text-white",
    article: "border-sky-200 dark:border-sky-900",
  },
  {
    bar: "bg-violet-500",
    border: "border-violet-300 dark:border-violet-800",
    header: "bg-violet-50 dark:bg-violet-950/50",
    chipOn: "bg-violet-600 text-white ring-violet-600",
    chipOff: "bg-violet-50 text-violet-900 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-100 dark:ring-violet-800",
    count: "bg-violet-600 text-white",
    article: "border-violet-200 dark:border-violet-900",
  },
  {
    bar: "bg-amber-500",
    border: "border-amber-300 dark:border-amber-800",
    header: "bg-amber-50 dark:bg-amber-950/40",
    chipOn: "bg-amber-600 text-white ring-amber-600",
    chipOff: "bg-amber-50 text-amber-950 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800",
    count: "bg-amber-600 text-white",
    article: "border-amber-200 dark:border-amber-900",
  },
  {
    bar: "bg-rose-500",
    border: "border-rose-300 dark:border-rose-800",
    header: "bg-rose-50 dark:bg-rose-950/50",
    chipOn: "bg-rose-600 text-white ring-rose-600",
    chipOff: "bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:ring-rose-800",
    count: "bg-rose-600 text-white",
    article: "border-rose-200 dark:border-rose-900",
  },
  {
    bar: "bg-indigo-500",
    border: "border-indigo-300 dark:border-indigo-800",
    header: "bg-indigo-50 dark:bg-indigo-950/50",
    chipOn: "bg-indigo-600 text-white ring-indigo-600",
    chipOff: "bg-indigo-50 text-indigo-900 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-100 dark:ring-indigo-800",
    count: "bg-indigo-600 text-white",
    article: "border-indigo-200 dark:border-indigo-900",
  },
];

export function themeForIndex(index) {
  return AREA_THEMES[((Number(index) || 0) + AREA_THEMES.length) % AREA_THEMES.length];
}

export const PANELS = {
  overview: { title: "Overview", sub: "Registered neighborhood areas, coverage, and live duty" },
  schedule: { title: "Roster & schedule", sub: "Theescombe time grid for each registered neighborhood" },
  areas: { title: "Areas", sub: "Live snapshot of each registered neighborhood" },
  incidents: { title: "Incidents by area", sub: "Approved patrol incidents, grouped by neighborhood" },
  reports: { title: "Resident reports", sub: "SOS and household activity reports from assigned areas" },
  residents: { title: "Residents", sub: "Your clients, other companies, and unlinked households" },
  claims: { title: "Client claims", sub: "Verify residents who named your company as their armed response" },
};

export function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function parseHour(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const p = watchZonedParts(value);
    return p ? p.hour + p.minute / 60 : null;
  }
  const text = String(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) return Number(match[1]) + Number(match[2]) / 60;
  const asDate = parsePatrolTime(text);
  if (!asDate) return null;
  const p = watchZonedParts(asDate);
  return p ? p.hour + p.minute / 60 : null;
}

export function isSosRow(row) {
  return Boolean(row?.is_sos) || String(row?.type || "").toUpperCase() === "SOS";
}

export function isVisibleIncident(row) {
  const status = String(row?.status || "").toLowerCase();
  if (status === "rejected" || status === "closed" || status === "archived") return false;
  if (isSosRow(row)) return true;
  return status === "approved";
}

export function isResidentReport(row) {
  if (isSosRow(row)) return true;
  const role = String(row?.reporter_role || "").toLowerCase().replace(/-/g, "_");
  if (PATROL_ROLES.has(role)) return false;
  if (role === "resident" || role === "user") return true;
  return false;
}

export function residentReportMeta(row) {
  if (isSosRow(row)) {
    return {
      label: "SOS",
      tag: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
      accent: "border-l-red-500",
      card: "bg-red-50/70 border-red-200 dark:bg-red-950/30 dark:border-red-900",
    };
  }
  const type = String(row?.type || "").toLowerCase();
  const s = String(row?.status || "").toLowerCase();
  const statusTag =
    s === "approved"
      ? { label: "Logged for patrol", tag: "bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200" }
      : { label: "Pending review", tag: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" };
  if (type.includes("vehicle")) {
    return { ...statusTag, accent: "border-l-sky-500", card: "bg-white border-sky-200 dark:bg-gray-900 dark:border-sky-900" };
  }
  if (type.includes("noise")) {
    return { ...statusTag, accent: "border-l-violet-500", card: "bg-white border-violet-200 dark:bg-gray-900 dark:border-violet-900" };
  }
  if (type.includes("suspicious")) {
    return { ...statusTag, accent: "border-l-amber-500", card: "bg-white border-amber-200 dark:bg-gray-900 dark:border-amber-900" };
  }
  return { ...statusTag, accent: "border-l-slate-400", card: "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700" };
}

export function areaId(area) {
  return area?.organization_id || area?.suburb_id || "";
}

export function areaKeyForIncident(row) {
  return row.organization_id || row.suburb_id || "unassigned";
}

export function areaLabelForIncident(row) {
  return row.organization_name || row.suburb_name || "Unassigned area";
}

export function rowBelongsToArea(row, area) {
  if (!area) return false;
  const rowOrg = row.organization_id || row.neighborhood_id;
  if (area.organization_id && rowOrg) return rowOrg === area.organization_id;
  if (area.organization_id && row.organization_name && row.organization_name === area.organization_name) {
    return true;
  }
  if (area.suburb_id && row.suburb_id === area.suburb_id && !rowOrg) return true;
  const zone = String(row.zone || "").toLowerCase();
  const suburb = String(area.suburb_name || "").toLowerCase();
  const org = String(area.organization_name || "").toLowerCase();
  if (org && zone.includes(org)) return true;
  if (suburb && !rowOrg && zone.includes(suburb)) return true;
  return false;
}

export function areaSnapshot(area, { patrols, slots, incidents, residents, counts, todayDate }) {
  const live = patrols.filter((row) => rowBelongsToArea(row, area));
  const todaySlots = slots.filter(
    (row) => slotDateValue(row) === todayDate && rowBelongsToArea(row, area)
  );
  const areaIncidents = incidents.filter((row) => rowBelongsToArea(row, area) && isVisibleIncident(row));
  const open = areaIncidents;
  const reports = areaIncidents.filter(isResidentReport);
  const sos = areaIncidents.filter((row) => row.is_sos);
  const linked = residents.filter((row) => rowBelongsToArea(row, area));
  const last = areaIncidents[0] || null;
  const countRow = counts.find((row) => row.organization_id === area.organization_id);
  const bookedNames = [...new Set(todaySlots.map((row) => String(row.volunteer_name || "").trim()).filter(Boolean))];
  return {
    live,
    todaySlots,
    open,
    reports,
    sos,
    linked,
    last,
    bookedNames,
    memberCount: Number(countRow?.member_count || 0),
    residentCount: Number(countRow?.resident_count || 0),
    linkedCount: Number(countRow?.linked_resident_count ?? linked.length),
  };
}

export function statusBadge(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "approved" || s === "verified") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200";
  if (s === "linked" || s === "active") return "bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-200";
  if (s === "rejected" || s === "closed") return "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200";
  return "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200";
}

export function formatHourLabel(hour) {
  const wrapped = ((hour % 24) + 24) % 24;
  const h = Math.floor(wrapped);
  const m = Math.round((wrapped - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function slotBlocksForArea(area, todaySlots) {
  const areaSlots = todaySlots.filter((slot) => rowBelongsToArea(slot, area));

  const byPerson = new Map();
  for (const slot of areaSlots) {
    const start = parseHour(slot.start_time) ?? 0;
    const rawEnd = parseHour(slot.end_time);
    const end = rawEnd == null || rawEnd <= start ? 24 : rawEnd;
    const name = String(slot.volunteer_name || "Patroller").trim();
    const key = name.toLowerCase();
    if (!byPerson.has(key)) byPerson.set(key, { name, spans: [] });
    byPerson.get(key).spans.push({
      id: slot.id,
      start,
      end,
      label: `${formatHourLabel(start)}–${formatHourLabel(end)}`,
    });
  }

  return [...byPerson.values()]
    .map((person) => {
      const spans = [...person.spans].sort((a, b) => a.start - b.start);
      const merged = [];
      for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span.start <= last.end + 0.25) {
          last.end = Math.max(last.end, span.end);
          last.label = `${formatHourLabel(last.start)}–${formatHourLabel(last.end)}`;
        } else {
          merged.push({ ...span });
        }
      }
      return {
        name: person.name,
        spans: merged,
        firstStart: merged[0]?.start ?? 24,
      };
    })
    .sort((a, b) => a.firstStart - b.firstStart || a.name.localeCompare(b.name));
}
