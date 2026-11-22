/**
 * Building blocks for the platform analytics page. Light mode follows the "Option C" cards;
 * dark mode switches to the dense control-room look (Option B) through Tailwind `dark:` classes.
 */
import { Sparkline } from "./AnalyticsCharts";

export function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 dark:rounded-[10px] dark:border-slate-800 dark:bg-gradient-to-b dark:from-slate-900 dark:to-[#0b1322] dark:p-3 dark:shadow-none ${className}`}
    >
      {title || action ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="dark:text-[10px] dark:font-semibold dark:uppercase dark:tracking-[0.1em] dark:text-slate-400 text-sm font-semibold text-gray-900">{title}</h3> : null}
            {subtitle ? <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-500">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SectionHeading({ title, hint }) {
  return (
    <div className="mb-3 flex items-center gap-2 dark:mb-2">
      <h2 className="text-base font-semibold text-gray-900 dark:text-[11px] dark:font-bold dark:uppercase dark:tracking-[0.14em] dark:text-teal-300">
        {title}
      </h2>
      <span className="hidden h-px flex-1 bg-gradient-to-r from-teal-900 to-transparent dark:block" aria-hidden />
      {hint ? <span className="ml-auto text-xs text-gray-500 dark:ml-0 dark:text-[11px] dark:text-slate-500">{hint}</span> : null}
    </div>
  );
}

const DELTA_TONE = {
  good: "bg-emerald-50 text-emerald-700 dark:bg-transparent dark:px-0 dark:text-emerald-400",
  bad: "bg-red-50 text-red-700 dark:bg-transparent dark:px-0 dark:text-red-400",
  flat: "bg-gray-100 text-gray-600 dark:bg-transparent dark:px-0 dark:text-slate-400",
};

export function DeltaPill({ delta, className = "" }) {
  if (!delta || delta.direction === "none") {
    return <span className={`whitespace-nowrap text-[11px] text-gray-400 dark:text-slate-500 ${className}`} title="No data for the previous period">no prior data</span>;
  }
  const tone = delta.good === true ? DELTA_TONE.good : delta.good === false ? DELTA_TONE.bad : DELTA_TONE.flat;
  const arrow = delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "•";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums sm:px-2 sm:text-xs ${tone} ${className}`}>
      <span aria-hidden>{arrow}</span>
      {delta.text}
    </span>
  );
}

export function KpiCard({ kpi, series }) {
  const sparkColor = kpi.delta?.good === false ? "#dc2626" : "#0d9488";
  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:p-5 dark:rounded-[10px] dark:border-slate-800 dark:bg-gradient-to-b dark:from-slate-900 dark:to-[#0b1322] dark:p-3 dark:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <p className="dark:text-[10px] dark:font-semibold dark:uppercase dark:tracking-[0.1em] dark:text-slate-400 text-xs font-medium text-gray-500 lg:text-sm">{kpi.label}</p>
        <span className="hidden sm:inline-flex dark:sm:hidden">
          <DeltaPill delta={kpi.delta} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900 tabular-nums lg:text-3xl dark:text-[26px] dark:text-white">{kpi.value}</p>
      <div className="sm:hidden dark:sm:block">
        <DeltaPill delta={kpi.delta} />
        <span className="ml-1 hidden text-[11px] text-slate-500 dark:inline">vs prev</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-gray-500 lg:text-xs dark:text-slate-500" title={kpi.sub}>
        {kpi.sub}
      </p>
      <div className="mt-2 h-8 dark:h-7">
        {kpi.spark && series?.length > 1 ? <Sparkline data={series} dataKey={kpi.spark} color={sparkColor} /> : null}
      </div>
    </div>
  );
}

export function MiniStat({ label, value, sub, tone = "default" }) {
  const subTone = tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "warn" ? "text-amber-700 dark:text-amber-300" : tone === "bad" ? "text-red-700 dark:text-red-400" : "text-gray-500 dark:text-slate-500";
  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:rounded-[10px] dark:border-slate-800 dark:bg-[#0d1526] dark:p-3 dark:shadow-none">
      <p className="dark:text-[10px] dark:font-semibold dark:uppercase dark:tracking-[0.1em] dark:text-slate-400 truncate text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums dark:text-white">{value}</p>
      {sub ? <p className={`truncate text-xs font-medium ${subTone}`}>{sub}</p> : null}
    </div>
  );
}

export function ProgressRow({ label, value, sub, color = "bg-teal-600" }) {
  const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-gray-600 dark:text-slate-400">{label}</span>
        <span className="font-semibold text-gray-900 tabular-nums dark:text-white">{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-gray-100 dark:h-1.5 dark:bg-slate-800">
        <div className={`h-2 rounded-full dark:h-1.5 ${color}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {sub ? <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function EmptyChart({ message = "No data for this period yet.", height = 200 }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-500 dark:bg-slate-900/60 dark:text-slate-500" style={{ height }}>
      {message}
    </div>
  );
}

export function SkeletonBlock({ className = "" }) {
  return <div className={`skeleton rounded-2xl dark:rounded-[10px] ${className}`} aria-hidden />;
}

export function AnalyticsLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading analytics</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 dark:gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonBlock key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
        <SkeletonBlock className="h-72 lg:col-span-2" />
        <SkeletonBlock className="h-72" />
      </div>
    </div>
  );
}

const TONES = {
  red: "bg-red-50 dark:bg-red-500/10 dark:ring-1 dark:ring-red-500/30",
  amber: "bg-amber-50 dark:bg-amber-500/10 dark:ring-1 dark:ring-amber-500/30",
  sky: "bg-sky-50 dark:bg-sky-500/10 dark:ring-1 dark:ring-sky-500/30",
  gray: "bg-gray-50 dark:bg-slate-800/60",
};
const ICONS = { red: "⚠️", amber: "⏳", sky: "📱", gray: "📝" };

export function AttentionList({ items }) {
  if (!items.length) {
    return <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Nothing needs attention right now.</p>;
  }
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {items.map((item) => (
        <li key={item.key} className={`flex gap-3 rounded-xl p-3 ${TONES[item.tone] || TONES.gray}`}>
          <span aria-hidden>{ICONS[item.tone] || "•"}</span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white">{item.title}</p>
            {item.detail ? <p className="text-xs text-gray-600 dark:text-slate-400">{item.detail}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
