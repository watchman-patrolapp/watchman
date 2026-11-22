import { formatSeconds } from "../../../utils/analytics";
import { buildKpis, buildNeedsAttention, formatCount, formatMinutes, hasAnyValue } from "../../../utils/analyticsView";
import { Bars } from "../AnalyticsCharts";
import { AttentionList, EmptyChart, KpiCard, MiniStat, Panel } from "../AnalyticsUi";
import WatchTable from "../WatchTable";
import { TrendOrEmpty, useSeries } from "./shared";

export default function OverviewTab({ data, onSelectWatch, onShowWatches, nowMs }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const kpis = buildKpis(overview);
  const attention = buildNeedsAttention(overview);
  const c = overview?.current || {};
  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 dark:gap-2">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} series={rows} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
        <Panel title="Patrol hours and incidents" subtitle={`Grouped by ${overview?.range?.grain || "day"}`} className="lg:col-span-2">
          <div className="mt-3">
            <TrendOrEmpty
              rows={rows}
              keys={["patrol_hours", "incidents"]}
              empty="No patrols or incidents in this period."
              height={240}
              lines={[
                { key: "patrol_hours", name: "Patrol hours", color: "#0d9488", unit: "h" },
                { key: "incidents", name: "Incidents", color: "#f59e0b" },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Needs attention">
          <AttentionList items={attention} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
        <Panel title="SOS alerts and sign-ups">
          <div className="mt-3">
            {hasAnyValue(rows, "sos_alerts") || hasAnyValue(rows, "signups") ? (
              <Bars
                data={rows}
                height={200}
                bars={[
                  { key: "sos_alerts", name: "SOS alerts", color: "#ef4444" },
                  { key: "signups", name: "Sign-ups", color: "#0ea5e9" },
                ]}
              />
            ) : (
              <EmptyChart message="No SOS alerts or sign-ups in this period." height={200} />
            )}
          </div>
        </Panel>
        <Panel
          title="Top watches"
          subtitle="By patrol hours · tap a watch to focus on it"
          className="lg:col-span-2"
          action={
            data.watches.length > 5 ? (
              <button type="button" onClick={onShowWatches} className="text-sm font-medium text-teal-700 hover:underline dark:text-xs dark:text-teal-300">
                All {formatCount(data.watches.length)} →
              </button>
            ) : null
          }
        >
          <div className="mt-3">
            {data.watches.length ? (
              <WatchTable rows={data.watches} limit={5} onSelect={onSelectWatch} nowMs={nowMs} />
            ) : (
              <EmptyChart message="No watches match these filters." height={160} />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Volunteers on patrol" value={formatCount(c.patrol_volunteers)} sub="did at least one patrol" />
        <MiniStat label="Average patrol" value={formatMinutes(c.avg_patrol_minutes)} />
        <MiniStat label="SOS acknowledged" value={`${formatCount(c.sos_acknowledged)} / ${formatCount(c.sos_alerts)}`} sub={`90% within ${formatSeconds(c.sos_ack_p90_seconds)}`} />
        <MiniStat
          label="Watches"
          value={formatCount(overview?.watches?.total)}
          sub={`${formatCount(overview?.watches?.active)} active · ${formatCount(overview?.watches?.pending)} pending`}
        />
      </div>
    </div>
  );
}
