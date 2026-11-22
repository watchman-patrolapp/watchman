import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDarkMode } from "../../hooks/useDarkMode";
import { formatCount } from "../../utils/analyticsView";

export const CHART_COLORS = ["#0d9488", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b", "#10b981", "#ec4899"];

function sharePercent(value, total) {
  if (!total) return "";
  const pct = (Number(value) / total) * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

function useChartTheme() {
  const dark = useDarkMode();
  return {
    dark,
    grid: dark ? "#1e293b" : "#e5e7eb",
    tick: { fontSize: 11, fill: dark ? "#64748b" : "#6b7280" },
    tooltip: {
      backgroundColor: dark ? "#0f172a" : "#ffffff",
      color: dark ? "#e2e8f0" : "#111827",
      borderRadius: 8,
      border: `1px solid ${dark ? "#334155" : "#e5e7eb"}`,
      fontSize: 12,
    },
    label: { color: dark ? "#e2e8f0" : "#111827", fontWeight: 600 },
  };
}

function valueFormatter(unit) {
  return (value, name) => [`${formatCount(value, 1)}${unit ? ` ${unit}` : ""}`, name];
}

/** Line/area trend. `lines` = [{ key, name, color, unit }]. */
export function TrendArea({ data, lines, height = 220, xKey = "label" }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {lines.map((line) => (
            <linearGradient key={line.key} id={`analytics-fill-${line.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line.color} stopOpacity={t.dark ? 0.35 : 0.22} />
              <stop offset="100%" stopColor={line.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={t.tick} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={t.tick} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
        <Tooltip contentStyle={t.tooltip} labelStyle={t.label} formatter={(value, name, item) => valueFormatter(lines.find((l) => l.key === item?.dataKey)?.unit)(value, name)} />
        {lines.map((line) => (
          <Area
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.name}
            stroke={line.color}
            strokeWidth={2}
            fill={`url(#analytics-fill-${line.key})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Vertical or horizontal bars. `bars` = [{ key, name, color }]. */
export function Bars({ data, bars, height = 220, xKey = "label", layout = "horizontal", unit = "", stacked = false }) {
  const t = useChartTheme();
  const vertical = layout === "vertical";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: vertical ? 8 : -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" tick={t.tick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey={xKey} tick={t.tick} tickLine={false} axisLine={false} width={96} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={t.tick} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis tick={t.tick} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
          </>
        )}
        <Tooltip contentStyle={t.tooltip} labelStyle={t.label} cursor={{ fill: t.dark ? "#1e293b" : "#f3f4f6" }} formatter={valueFormatter(unit)} />
        {bars.map((bar) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.name}
            fill={bar.color}
            stackId={stacked ? "a" : undefined}
            radius={stacked ? 0 : vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centre total. `data` = [{ name, value }]. */
export function Donut({ data, height = 180, centerLabel }) {
  const t = useChartTheme();
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative w-full max-w-[200px]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1} stroke="none" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={t.tooltip} labelStyle={t.label} formatter={valueFormatter("")} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-gray-900 tabular-nums dark:text-white">{formatCount(total)}</span>
          {centerLabel ? <span className="text-[11px] text-gray-500 dark:text-slate-500">{centerLabel}</span> : null}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-slate-400">{d.name}</span>
            <span className="font-semibold text-gray-900 tabular-nums dark:text-white">{formatCount(d.value)}</span>
            <span className="w-10 text-right text-xs text-gray-400 tabular-nums dark:text-slate-500">{sharePercent(d.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ data, dataKey, color = "#0d9488" }) {
  const id = `analytics-spark-${useId().replace(/:/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.75} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
