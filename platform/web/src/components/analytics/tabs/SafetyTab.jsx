import { formatSeconds } from "../../../utils/analytics";
import { countRows, formatCount, formatDuration } from "../../../utils/analyticsView";
import { Donut } from "../AnalyticsCharts";
import { BarList, Figure, FigureRow, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, MiniStat, Panel, SkeletonBlock } from "../AnalyticsUi";
import { n, TrendOrEmpty, useSeries } from "./shared";
import { useTabSection } from "./useTabSection";

const RISK_ORDER = ["critical", "high", "medium", "low"];

export default function SafetyTab({ data, args, refreshKey, onSection }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  const sec = useTabSection("analytics_safety", args, refreshKey, onSection);
  const s = sec.data || {};
  const ready = Boolean(sec.data);
  const loading = sec.status === "loading" && !sec.data;
  const statusRows = [
    { name: "Approved", value: n(c.incidents_approved) },
    { name: "Pending", value: n(c.incidents_pending) },
    { name: "Rejected", value: n(c.incidents_rejected) },
  ].filter((r) => r.value > 0);
  const m = s.moderation || {};
  const p = s.profiles || {};
  const q = s.match_queue || {};
  const age = q.pending_by_age || {};
  const byType = (s.by_type || []).map((t) => ({ name: t.type, value: n(t.incidents) }));
  const byArea = (s.by_area || []).map((a) => ({ name: a.suburb, sub: a.city || "", value: n(a.incidents) }));
  const byCity = (s.by_city || []).map((a) => ({ name: a.city, value: n(a.incidents) }));
  const risk = countRows(p.by_risk, "risk", "profiles").sort(
    (a, b) => RISK_ORDER.indexOf(a.name.toLowerCase()) - RISK_ORDER.indexOf(b.name.toLowerCase())
  );
  const ageRows = [
    { name: "Under a day", value: n(age.under_1_day) },
    { name: "1 to 7 days", value: n(age.days_1_7) },
    { name: "7 to 30 days", value: n(age.days_7_30) },
    { name: "Over 30 days", value: n(age.over_30_days) },
  ];

  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Incidents" value={formatCount(c.incidents)} sub={`${formatCount(c.incidents_pending)} pending`} tone={n(c.incidents_pending) ? "warn" : "default"} />
        <MiniStat label="SOS alerts" value={formatCount(c.sos_alerts)} />
        <MiniStat label="Median acknowledge" value={formatSeconds(c.sos_ack_median_seconds)} sub="time to first response" />
        <MiniStat
          label="SOS acknowledged"
          value={`${formatCount(c.sos_acknowledged)} / ${formatCount(c.sos_alerts)}`}
          sub={`90% within ${formatSeconds(c.sos_ack_p90_seconds)}`}
          tone={n(c.sos_alerts) > n(c.sos_acknowledged) ? "bad" : "good"}
        />
      </div>
      <SectionNotice error={sec.error} />
      <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
        <Panel title="Incidents and SOS alerts" className="lg:col-span-2">
          <div className="mt-3">
            <TrendOrEmpty
              rows={rows}
              keys={["incidents", "sos_alerts"]}
              empty="No incidents or SOS alerts in this period."
              lines={[
                { key: "incidents", name: "Incidents", color: "#f59e0b" },
                { key: "sos_alerts", name: "SOS alerts", color: "#ef4444" },
              ]}
            />
          </div>
        </Panel>
        <Panel title="Incident review status">
          <div className="mt-3">{statusRows.length ? <Donut data={statusRows} centerLabel="incidents" /> : <EmptyChart message="No incidents in this period." height={180} />}</div>
        </Panel>
      </div>

      {loading ? <SkeletonBlock className="h-48 w-full" /> : null}
      {ready ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
            <Panel title="Incidents by type" subtitle={`${formatCount(s.incidents)} reports, SOS alerts excluded`}>
              <div className="mt-3">
                <BarList rows={byType} color="bg-amber-500" empty="No incidents in this period." />
              </div>
            </Panel>
            <Panel title="Incidents by area" subtitle={byCity.length ? byCity.map((r) => `${r.name} ${formatCount(r.value)}`).join(" · ") : "Suburb and city of each report"}>
              <div className="mt-3">
                <BarList rows={byArea} color="bg-amber-500" empty="No incidents in this period." max={15} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
            <Panel title="Moderation turnaround" subtitle="From submitted to approved or rejected">
              <FigureRow>
                <Figure label="Median to approve" value={formatDuration(m.approve_median_seconds)} sub={`${formatCount(m.approved)} approved`} />
                <Figure label="90% approved within" value={formatDuration(m.approve_p90_seconds)} />
                <Figure label="Median to reject" value={formatDuration(m.reject_median_seconds)} sub={`${formatCount(m.rejected)} rejected`} />
                <Figure
                  label="Waiting now"
                  value={formatCount(m.pending_now)}
                  sub={n(m.pending_now) ? `oldest ${formatDuration(m.oldest_pending_seconds)}` : "queue is clear"}
                  tone={n(m.pending_now) ? "warn" : "good"}
                />
              </FigureRow>
            </Panel>
            <Panel title="Suspect profiles" subtitle={`${formatCount(p.total)} in scope · ${formatCount(p.new_in_period)} added in this period`}>
              <div className="mt-3 space-y-4">
                <BarList rows={countRows(p.by_status, "status", "profiles")} color="bg-slate-500" empty="No suspect profiles yet." max={6} />
                {risk.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {risk.map((r) => (
                      <span
                        key={r.name}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          r.name === "Critical" || r.name === "High"
                            ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                            : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {r.name} risk · {formatCount(r.value)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Panel>
            <Panel title="Profile match queue" subtitle={`${formatCount(q.created_in_period)} matches suggested in this period`}>
              <FigureRow>
                <Figure label="Awaiting review" value={formatCount(q.pending)} tone={n(q.pending) ? "warn" : "good"} sub={n(q.pending) ? `oldest ${formatDuration(q.oldest_pending_seconds)}` : "nothing waiting"} />
              </FigureRow>
              <div className="mt-3">{n(q.pending) ? <BarList rows={ageRows} color="bg-amber-500" format={(v) => formatCount(v)} /> : null}</div>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
