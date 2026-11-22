import { formatCount, heatMatrix, hourLabel, WEEKDAYS } from "../../utils/analyticsView";

/** A friendly inline notice when one section's data could not load (the rest of the tab still works). */
export function SectionNotice({ error, onRetry }) {
  if (!error) return null;
  const tone = error.notReady
    ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm dark:rounded-[10px] ${tone}`}>
      <span>{error.message}</span>
      {onRetry && !error.notReady ? (
        <button type="button" onClick={onRetry} className="no-print rounded-lg border border-current px-2.5 py-1 text-xs font-semibold">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Horizontal bars as a list: readable on phones and in print. rows = [{ name, value, sub? }]. */
export function BarList({ rows, unit = "", color = "bg-teal-600", empty = "Nothing in this period.", max: maxRows = 10, format }) {
  const visible = (rows || []).slice(0, maxRows);
  if (!visible.length) return <p className="py-6 text-center text-sm text-gray-500 dark:text-slate-500">{empty}</p>;
  const top = Math.max(...visible.map((r) => Number(r.value) || 0), 1);
  return (
    <ul className="space-y-2.5 dark:space-y-2">
      {visible.map((r) => (
        <li key={`${r.name}-${r.sub || ""}`} className="break-inside-avoid">
          <div className="flex items-baseline justify-between gap-3 text-sm dark:text-xs">
            <span className="min-w-0 truncate text-gray-700 dark:text-slate-300" title={r.name}>
              {r.name}
              {r.sub ? <span className="ml-1.5 text-xs text-gray-400 dark:text-slate-500">{r.sub}</span> : null}
            </span>
            <span className="shrink-0 font-semibold text-gray-900 tabular-nums dark:text-white">
              {format ? format(r.value) : formatCount(r.value, 1)}
              {unit ? ` ${unit}` : ""}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-100 dark:h-1.5 dark:bg-slate-800">
            <div className={`h-2 rounded-full dark:h-1.5 ${color}`} style={{ width: `${Math.max(2, ((Number(r.value) || 0) / top) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Weekday x hour heat grid (Africa/Johannesburg time). */
export function HeatGrid({ heat }) {
  const { grid, max, busiest } = heatMatrix(heat);
  if (!max) return <p className="py-6 text-center text-sm text-gray-500 dark:text-slate-500">No patrols in this period.</p>;
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px] text-[10px] text-gray-400 dark:text-slate-500">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          {grid.map((row, d) => (
            <div key={WEEKDAYS[d]} className="mt-[3px] grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px]">
              <span className="self-center text-[11px] font-medium text-gray-500 dark:text-slate-400">{WEEKDAYS[d]}</span>
              {row.map((cell, h) => {
                const level = cell.patrols ? 0.15 + 0.85 * (cell.patrols / max) : 0;
                return (
                  <span
                    key={h}
                    title={`${WEEKDAYS[d]} ${hourLabel(h)}: ${formatCount(cell.patrols)} patrol${cell.patrols === 1 ? "" : "s"}, ${formatCount(cell.hours, 1)} h`}
                    className="h-5 rounded-[3px] sm:h-6 bg-gray-100 dark:bg-slate-800/70"
                    style={level ? { backgroundColor: `rgba(13, 148, 136, ${level.toFixed(2)})` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-slate-500">
        <span>
          Busiest: <strong className="text-gray-800 dark:text-slate-200">{WEEKDAYS[busiest.dow]} {hourLabel(busiest.hour)}</strong> ({formatCount(busiest.patrols)} patrol starts)
        </span>
        <span className="flex items-center gap-1">
          Fewer
          {[0.15, 0.4, 0.65, 1].map((o) => (
            <span key={o} className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: `rgba(13, 148, 136, ${o})` }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

/** Small labelled figure inside a panel. */
export function Figure({ label, value, sub, tone }) {
  const toneClass =
    tone === "warn" ? "text-amber-700 dark:text-amber-300" : tone === "bad" ? "text-red-700 dark:text-red-400" : tone === "good" ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-slate-500";
  return (
    <div className="min-w-0">
      <p className="text-xs leading-tight text-gray-500 dark:text-[10px] dark:uppercase dark:tracking-wider dark:text-slate-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums dark:text-lg dark:text-white">{value}</p>
      {sub ? <p className={`text-xs leading-tight ${toneClass}`}>{sub}</p> : null}
    </div>
  );
}

export function FigureRow({ children }) {
  return <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-3">{children}</div>;
}
