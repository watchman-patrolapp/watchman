import { lazy, Suspense } from "react";
import { distanceSub, formatCount, formatMinutes, hasAnyValue, labelize } from "../../../utils/analyticsView";
import { Bars } from "../AnalyticsCharts";
import { BarList, Figure, FigureRow, HeatGrid, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, MiniStat, Panel, ProgressRow, SkeletonBlock } from "../AnalyticsUi";
import { n, TrendOrEmpty, useSeries } from "./shared";
import { useTabSection } from "./useTabSection";
import { useAnalyticsSection } from "../../../hooks/useAnalytics";

const CoverageMap = lazy(() => import("../CoverageMap"));

function Loading({ h = "h-40" }) {
  return <SkeletonBlock className={`mt-3 ${h} w-full`} />;
}

export default function PatrolsTab({ data, args, refreshKey, onSection }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  const sec = useTabSection("analytics_patrols", args, refreshKey, onSection);
  const cov = useAnalyticsSection("analytics_patrol_coverage", args, { refreshKey });
  const s = sec.data || {};
  const loading = sec.status === "loading" && !sec.data;
  const dist = s.distance || {};
  const suburbs = (s.coverage_by_suburb || []).map((r) => ({ name: r.suburb, sub: r.city || "", value: n(r.patrols) }));
  const top = s.top_patrollers || [];
  const checks = s.checks || {};
  const vehicles = (s.vehicles || []).map((v) => ({ name: labelize(v.vehicle), value: n(v.patrols) }));
  const cells = cov.data?.cells || [];

  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Patrols" value={formatCount(c.patrols)} />
        <MiniStat label="Patrol hours" value={`${formatCount(c.patrol_hours, 1)} h`} />
        <MiniStat label="Volunteers" value={formatCount(c.patrol_volunteers)} />
        <MiniStat label="Average patrol" value={formatMinutes(c.avg_patrol_minutes)} />
      </div>
      <SectionNotice error={sec.error} />
      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="Patrol hours" subtitle="With the number of patrols">
          <div className="mt-3">
            <TrendOrEmpty
              rows={rows}
              keys={["patrol_hours", "patrols"]}
              empty="No patrols in this period."
              lines={[
                { key: "patrol_hours", name: "Hours", color: "#0d9488", unit: "h" },
                { key: "patrols", name: "Patrols", color: "#0ea5e9" },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Distance patrolled" subtitle={`${formatCount(c.distance_km, 1)} km · ${distanceSub(c)}`}>
          <div className="mt-3">
            {hasAnyValue(rows, "distance_km") ? (
              <Bars data={rows} unit="km" bars={[{ key: "distance_km", name: "Distance", color: "#8b5cf6" }]} />
            ) : (
              <EmptyChart message="No GPS-tracked patrols in this period." />
            )}
            {sec.data && n(dist.tracked_patrols) ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                {formatCount(dist.from_routes)} from saved routes · {formatCount(dist.from_gps)} from live GPS points · about {formatCount(dist.avg_km_per_tracked_patrol, 1)} km per tracked patrol
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel title="Busiest times" subtitle="Patrol starts by weekday and hour (South African time)">
        <div className="mt-3">{loading ? <Loading /> : sec.data ? <HeatGrid heat={s.heat} /> : null}</div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-5 dark:gap-2">
        <Panel
          title="Route coverage"
          subtitle="Areas covered by several patrols and volunteers. Individual routes and homes are never shown."
          className="lg:col-span-3"
        >
          <div className="mt-3 space-y-4">
            {cov.status === "loading" && !cov.data ? <Loading h="h-72" /> : null}
            {cov.error ? <SectionNotice error={cov.error} /> : null}
            {cells.length ? (
              <div className="print:hidden">
                <Suspense fallback={<Loading h="h-72" />}>
                  <CoverageMap coverage={cov.data} />
                </Suspense>
              </div>
            ) : null}
            {cov.data ? (
              <p className="text-xs text-gray-500 dark:text-slate-500">
                {cells.length
                  ? `${formatCount(cells.length)} areas of about 500 m shown. `
                  : "No area has enough overlapping patrols to show on the map yet. "}
                An area appears once at least {cov.data.min_patrols} patrols by {cov.data.min_volunteers} or more volunteers pass through it; the first and last {cov.data.trim_minutes} minutes of each patrol are left out.
                {n(cov.data.cells_hidden) ? ` ${formatCount(cov.data.cells_hidden)} quieter areas are hidden for privacy.` : ""}
              </p>
            ) : null}
            {sec.data ? (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-xs dark:uppercase dark:tracking-wider dark:text-slate-400">Patrols by suburb</h4>
                <BarList rows={suburbs} empty="No patrols in this period." />
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Top patrollers" subtitle="By patrol hours in this period" className="lg:col-span-2">
          {loading ? <Loading /> : null}
          {sec.data ? (
            top.length ? (
              <ol className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
                {top.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="flex items-center gap-3 py-2 text-sm dark:text-xs">
                    <span className="w-5 shrink-0 text-right font-semibold text-gray-400 tabular-nums dark:text-slate-500">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium text-gray-900 dark:text-slate-200" title={p.name}>{p.name}</span>
                      <span className="block text-xs text-gray-500 dark:text-[11px] dark:text-slate-500">
                        {formatCount(p.patrols)} patrols · {formatCount(p.days)} days
                        {n(p.longest_streak_days) > 1 ? ` · ${p.longest_streak_days}-day streak` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-gray-900 tabular-nums dark:text-white">{formatCount(p.hours, 1)} h</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyChart message="No patrols in this period." height={160} />
            )
          ) : null}
          {sec.data && top.length ? (
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
              Longest streak: {formatCount(s.streaks?.longest_days)} days in a row · {formatCount(s.streaks?.volunteers_3plus)} volunteers patrolled 3 or more days in a row
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="WhatsApp sharing" subtitle="Share of patrols where the sign-on or sign-off message was shared">
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ProgressRow
              label="Sign-on shared"
              value={c.share_rate_start}
              sub={`${formatCount(c.shared_start)} of ${formatCount(c.patrols)} patrols · previous period ${overview?.previous?.share_rate_start ?? "—"}%`}
            />
            <ProgressRow
              label="Sign-off shared"
              value={c.share_rate_end}
              color="bg-sky-500"
              sub={`${formatCount(c.shared_end)} of ${formatCount(c.patrols)} patrols · previous period ${overview?.previous?.share_rate_end ?? "—"}%`}
            />
          </div>
        </Panel>
        <Panel title="Camera checks during patrols" subtitle="Hotspot camera checks logged by the patroller while on patrol">
          {loading ? <Loading h="h-24" /> : null}
          {sec.data ? (
            <>
              <FigureRow>
                <Figure label="Checks on patrol" value={formatCount(checks.during_patrols)} sub={`${formatCount(checks.total)} checks in total`} />
                <Figure label="Per patrol" value={formatCount(checks.per_patrol, 2)} />
                <Figure label="Patrols with a check" value={formatCount(checks.patrols_with_checks)} sub={`of ${formatCount(s.patrols)}`} />
                <Figure label="Volunteers" value={formatCount(s.volunteers)} />
              </FigureRow>
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-xs dark:uppercase dark:tracking-wider dark:text-slate-400">How they patrolled</h4>
                <BarList rows={vehicles} color="bg-sky-500" empty="No patrols in this period." max={6} />
              </div>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
