import { useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "../../../utils/leaflet-icons";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { watchDayStamp } from "../../../utils/watchTime";
import {
  areaId,
  isResidentReport,
  residentReportMeta,
  slotBlocksForArea,
  statusBadge,
} from "./dashboardHelpers";

export function AreaSection({ title, subtitle, count, theme, action, empty, stacked, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-gray-800 ${theme.border}`}>
      <div className={`flex items-center gap-3 border-b px-4 py-3 ${theme.border} ${theme.header}`}>
        <span className={`h-11 w-1.5 shrink-0 rounded-full ${theme.bar}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle ? (
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${theme.count}`}>{count}</span>
        <div className="flex shrink-0 items-center gap-2">
          {action || null}
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300"
            aria-expanded={!collapsed}
          >
            {collapsed ? <FaChevronDown className="h-3 w-3" /> : <FaChevronUp className="h-3 w-3" />}
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {collapsed ? null : count === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-500">{empty}</p>
      ) : stacked ? (
        <div className="space-y-2 bg-gray-50 p-3 dark:bg-gray-950/50">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

export function PartnerMap({ patrols }) {
  const withCoords = patrols.filter(
    (p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
  );
  if (withCoords.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No live GPS yet. Patroller details still show in the list when someone is on duty.
      </p>
    );
  }
  const center = [Number(withCoords[0].latitude), Number(withCoords[0].longitude)];
  return (
    <div className="h-56 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom={false} keyboard={false}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {withCoords.map((patrol) => (
          <Marker
            key={patrol.user_id}
            position={[Number(patrol.latitude), Number(patrol.longitude)]}
            icon={L.divIcon({
              className: "",
              html: `<div style="width:14px;height:14px;border-radius:999px;background:#0d9488;border:2px solid white;box-shadow:0 0 0 1px #0f766e"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })}
          >
            <Popup>
              <p className="font-semibold">{patrol.full_name}</p>
              <p className="text-xs">{patrol.organization_name || patrol.zone || "Area unknown"}</p>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export function CoverageTimeline({ areas, slots }) {
  const today = watchDayStamp();
  const todaySlots = slots.filter((slot) => String(slot.slot_date || "").slice(0, 10) === today);

  if (areas.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No registered neighborhood areas yet.</p>;
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Coverage timeline — today</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">One row per patroller. Bars show shift time only.</p>
        </div>
        <span className="font-mono text-[11px] text-gray-400">00:00 → 24:00</span>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {areas.map((area) => {
          const people = slotBlocksForArea(area, todaySlots);
          const areaTitle = area.organization_name || area.suburb_name || "Area";
          return (
            <div key={areaId(area)} className="px-4 py-3">
              <div className="mb-3">
                <h3 className="text-sm font-semibold leading-5 text-gray-900 dark:text-white">{areaTitle}</h3>
                <p className="font-mono text-[11px] uppercase tracking-wide text-gray-400">
                  {area.suburb_name && area.suburb_name !== areaTitle ? `${area.suburb_name} · ` : ""}
                  {people.length === 0 ? "No booked coverage" : `${people.length} on the roster today`}
                </p>
              </div>

              {people.length === 0 ? (
                <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-amber-400 bg-[repeating-linear-gradient(45deg,rgba(245,158,11,0.16),rgba(245,158,11,0.16)_4px,transparent_4px,transparent_8px)] font-mono text-[11px] text-amber-600">
                  Gap — no shifts booked
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="mb-1 flex gap-3">
                    <div className="hidden w-52 shrink-0 sm:block" />
                    <div className="relative h-4 min-w-0 flex-1 font-mono text-[10px] text-gray-400">
                      {["00:00", "06:00", "12:00", "18:00"].map((label, index) => (
                        <span key={label} className="absolute" style={{ left: `${index * 25}%` }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {people.map((person) => (
                      <div key={person.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <div className="w-full shrink-0 sm:w-52">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{person.name}</p>
                          <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                            {person.spans.map((span) => span.label).join(" · ")}
                          </p>
                        </div>
                        <div className="relative h-6 min-w-0 flex-1 rounded-md bg-gray-100 dark:bg-gray-900">
                          {person.spans.map((span) => (
                            <div
                              key={span.id}
                              title={`${person.name} ${span.label}`}
                              className="absolute top-1 bottom-1 rounded bg-teal-500"
                              style={{
                                left: `${(span.start / 24) * 100}%`,
                                width: `${(Math.max(span.end - span.start, 0.5) / 24) * 100}%`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function IncidentRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start justify-between gap-3 bg-teal-50 px-3 py-2.5 text-left hover:bg-teal-100 dark:bg-teal-950/55 dark:hover:bg-teal-900/50"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{row.type || row.title || "Incident"}</p>
          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">
            {row.location || "Location not set"}
            {row.reporter_name ? ` · ${row.reporter_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-medium ${statusBadge(row.status)}`}>
            {row.status || "pending"}
          </span>
          {isResidentReport(row) ? (
            <span className="rounded-md bg-sky-100 px-2 py-0.5 font-mono text-[10px] text-sky-800 dark:bg-sky-950/70 dark:text-sky-200">
              Resident
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{formatRelativeTime(row.submitted_at || row.incident_date)}</span>
        </div>
      </button>
      {open ? (
        <div className="border-t-2 border-amber-500 bg-amber-200 px-3 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-amber-950 dark:text-amber-200">Report text</p>
          <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-50">{row.description || "No description on file."}</p>
          {row.organization_name ? (
            <p className="mt-2 text-xs text-amber-900 dark:text-amber-200/80">{row.organization_name}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ResidentReportRow({ row }) {
  const meta = residentReportMeta(row);
  return (
    <article className={`rounded-xl border border-l-4 p-3 shadow-sm ${meta.accent} ${meta.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{row.type || "Activity"}</p>
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${meta.tag}`}>{meta.label}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {row.reporter_name || "A neighbour"}
            {row.location ? ` · ${row.location}` : ""}
          </p>
          {row.description ? (
            <div className="mt-2 rounded-lg border border-amber-400 bg-amber-200 px-2.5 py-2 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-950 dark:text-amber-200">Report text</p>
              <p className="text-sm leading-snug text-amber-950 dark:text-amber-50">{row.description}</p>
            </div>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-gray-400">
          {formatRelativeTime(row.submitted_at || row.incident_date)}
        </span>
      </div>
    </article>
  );
}
