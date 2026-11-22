import { useState } from "react";
import { formatDelta } from "../../utils/analytics";
import { formatAgo, formatCount, sortWatches } from "../../utils/analyticsView";
import { DeltaPill } from "./AnalyticsUi";

const COLUMNS = [
  { key: "watch_name", label: "Watch", align: "left" },
  { key: "members", label: "Members" },
  { key: "patrollers", label: "Patrollers" },
  { key: "patrols", label: "Patrols" },
  { key: "patrol_hours", label: "Hours" },
  { key: "delta", label: "vs prev" },
  { key: "distance_km", label: "km" },
  { key: "incidents", label: "Incidents" },
  { key: "sos_alerts", label: "SOS" },
  { key: "last_activity_at", label: "Last activity" },
];

const STATUS_TONE = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  suspended: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

function StatusBadge({ status }) {
  if (!status || status === "active") return null;
  return <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${STATUS_TONE[status] || "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400"}`}>{status}</span>;
}

function place(row) {
  return [row.suburb_name, row.city_name].filter(Boolean).join(", ");
}

function hoursDelta(row) {
  return formatDelta(Number(row.patrol_hours) || 0, Number(row.previous_patrol_hours) || 0, { mode: "percent", higherIsBetter: true });
}

/**
 * Sortable watch comparison. Desktop: table. Mobile: cards.
 * `limit` shows the top N (by hours) without sort controls; `onSelect(row)` sets the watch filter.
 */
export default function WatchTable({ rows, onSelect, limit = 0, nowMs, selectedId = "" }) {
  const [sort, setSort] = useState({ key: "patrol_hours", dir: "desc" });
  const sorted = sortWatches(rows, limit ? "patrol_hours" : sort.key, limit ? "desc" : sort.dir);
  const visible = limit ? sorted.slice(0, limit) : sorted;
  const columns = limit ? COLUMNS.filter((c) => ["watch_name", "patrols", "patrol_hours", "delta", "incidents"].includes(c.key)) : COLUMNS;

  const toggle = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "watch_name" ? "asc" : "desc" }));

  const cell = (row, key) => {
    switch (key) {
      case "watch_name":
        return (
          <div className="min-w-0">
            <span className="font-semibold text-gray-900 dark:text-white">{row.watch_name || "Unnamed watch"}</span>
            <StatusBadge status={row.watch_status} />
            {place(row) ? <p className="truncate text-xs text-gray-500 dark:text-slate-500">{place(row)}</p> : null}
          </div>
        );
      case "patrol_hours":
        return formatCount(row.patrol_hours, 1);
      case "distance_km":
        return formatCount(row.distance_km, 1);
      case "delta":
        return <DeltaPill delta={hoursDelta(row)} />;
      case "last_activity_at":
        return formatAgo(row.last_activity_at, nowMs);
      default:
        return formatCount(row[key]);
    }
  };

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-sm dark:text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-slate-800 dark:text-[10px] dark:uppercase dark:tracking-wider dark:text-slate-500">
              {columns.map((c) => {
                const active = !limit && sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`whitespace-nowrap px-2 py-2 font-medium ${c.align === "left" ? "text-left" : "text-right"}`}
                  >
                    {limit ? (
                      c.label
                    ) : (
                      <button type="button" onClick={() => toggle(c.key)} className={`inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-slate-200 ${active ? "text-gray-900 dark:text-teal-300" : ""}`}>
                        {c.label}
                        <span aria-hidden className="text-[9px]">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.organization_id}
                tabIndex={0}
                onClick={() => onSelect?.(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect?.(row);
                  }
                }}
                title="Show this watch only"
                className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-teal-50/60 focus:bg-teal-50 focus:outline-none dark:border-slate-800/70 dark:hover:bg-slate-800/50 dark:focus:bg-slate-800/70 ${
                  row.organization_id === selectedId ? "bg-teal-50 dark:bg-teal-500/10" : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-2.5 tabular-nums text-gray-700 dark:py-1.5 dark:text-slate-300 ${c.align === "left" ? "max-w-[16rem] text-left" : "whitespace-nowrap text-right"}`}>
                    {cell(row, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {visible.map((row) => (
          <li key={row.organization_id}>
            <button
              type="button"
              onClick={() => onSelect?.(row)}
              className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left dark:rounded-lg dark:border-slate-800 dark:bg-slate-900/60"
            >
              <div className="flex items-start justify-between gap-2">
                {cell(row, "watch_name")}
                <DeltaPill delta={hoursDelta(row)} />
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                {[
                  ["Hours", formatCount(row.patrol_hours, 1)],
                  ["Patrols", formatCount(row.patrols)],
                  ["Incidents", formatCount(row.incidents)],
                  ["SOS", formatCount(row.sos_alerts)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-gray-500 dark:text-slate-500">{label}</dt>
                    <dd className="font-semibold text-gray-900 tabular-nums dark:text-white">{value}</dd>
                  </div>
                ))}
              </dl>
              {!limit ? <p className="mt-1.5 text-[11px] text-gray-400 dark:text-slate-500">Last activity {formatAgo(row.last_activity_at, nowMs)}</p> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
