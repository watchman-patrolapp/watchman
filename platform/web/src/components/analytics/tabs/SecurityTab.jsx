import { Link } from "react-router-dom";
import { FaArrowRight, FaShieldAlt } from "react-icons/fa";
import { countRows, formatBucketLabel, formatCount, formatDuration, hasAnyValue, labelize } from "../../../utils/analyticsView";
import { Bars } from "../AnalyticsCharts";
import { BarList, Figure, FigureRow, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, MiniStat, Panel, SkeletonBlock } from "../AnalyticsUi";
import { n } from "./shared";
import { useTabSection } from "./useTabSection";

const H4 = "mb-2 text-sm font-semibold text-gray-800 dark:text-xs dark:uppercase dark:tracking-wider dark:text-slate-400";

function InsightsLink() {
  return (
    <Link
      to="/admin/security-insights"
      className="no-print inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-xs dark:text-slate-300 dark:hover:bg-slate-800"
    >
      Per-company detail
      <FaArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}

export default function SecurityTab({ data, args, refreshKey, onSection }) {
  const grain = data.overview?.range?.grain || args?.p_grain || "day";
  const sec = useTabSection("analytics_security", args, refreshKey, onSection);
  const s = sec.data || {};
  const c = s.companies || {};
  const ar = s.areas || {};
  const cl = s.clients || {};
  const mv = s.movement || {};
  const sf = s.safety || {};
  const cv = s.coverage || {};
  const series = (s.series || []).map((r) => ({ ...r, label: formatBucketLabel(r.bucket, grain) }));

  if (sec.status === "loading" && !sec.data) return <SkeletonBlock className="h-96 w-full" />;
  if (!sec.data) return <SectionNotice error={sec.error} />;

  if (!n(c.total)) {
    return (
      <Panel>
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 dark:rounded-xl dark:bg-teal-500/10 dark:text-teal-300">
            <FaShieldAlt className="h-6 w-6" aria-hidden />
          </span>
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-base dark:text-white">No security companies yet</h3>
          <p className="mt-2 max-w-md text-sm text-gray-600 dark:text-slate-400">
            This section fills in as security companies join Watchman. You'll see how many are set up, the areas they cover, the residents linked to them, clients won and lost, and how quickly SOS alerts in their areas are acknowledged.
          </p>
          <div className="mt-5">
            <InsightsLink />
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Security companies" value={formatCount(c.total)} sub={`${formatCount(c.active)} active · ${formatCount(c.new_in_period)} new`} />
        <MiniStat label="Clients linked" value={formatCount(cl.linked)} sub={`${formatCount(cl.verified)} verified`} tone={n(cl.awaiting_verification) ? "warn" : "default"} />
        <MiniStat label="Watch areas covered" value={`${formatCount(ar.watch_areas_covered)} / ${formatCount(ar.watch_areas_total)}`} sub={`${formatCount(ar.assigned_suburbs)} assigned suburbs`} />
        <MiniStat label="Live patrols now" value={formatCount(cv.live_patrols_now)} sub={`${formatCount(cv.scheduled_next_7_days)} scheduled next 7 days`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
        <Panel title="Onboarding" subtitle="Companies set up and client links added in each period" className="lg:col-span-2">
          <div className="mt-3">
            {hasAnyValue(series, "companies") || hasAnyValue(series, "clients") ? (
              <Bars
                data={series}
                height={200}
                bars={[
                  { key: "companies", name: "Companies set up", color: "#0d9488" },
                  { key: "clients", name: "Client links", color: "#0ea5e9" },
                ]}
              />
            ) : (
              <EmptyChart message="No companies or client links added in this period." height={160} />
            )}
          </div>
        </Panel>
        <Panel title="Companies by status" action={<InsightsLink />}>
          <div className="mt-3">
            <BarList rows={countRows(c.by_status, "status", "companies")} color="bg-teal-600" format={(v) => formatCount(v)} />
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
            {formatCount(c.with_assignments)} with assigned suburbs · {formatCount(c.city_wide)} covering a whole city
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="Clients" subtitle="Residents who say they're with a company">
          <FigureRow>
            <Figure label="Linked now" value={formatCount(cl.linked)} />
            <Figure label="Verified" value={formatCount(cl.verified)} sub={`${formatCount(cl.verified_in_period)} in this period`} tone="good" />
            <Figure label="Awaiting verification" value={formatCount(cl.awaiting_verification)} tone={n(cl.awaiting_verification) ? "warn" : undefined} />
            <Figure label="New links" value={formatCount(cl.new_in_period)} sub="in this period" />
          </FigureRow>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className={H4}>Won and lost in this period</h4>
              <div className="flex gap-6">
                <Figure label="Won" value={formatCount(mv.won)} tone="good" sub="claims and transfers in" />
                <Figure label="Lost" value={formatCount(mv.lost)} tone={n(mv.lost) ? "bad" : undefined} sub="withdrawn, expired, moved" />
              </div>
              {n(mv.rejected) ? <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">{formatCount(mv.rejected)} claims rejected by a company</p> : null}
            </div>
            <div>
              <h4 className={H4}>Access granted</h4>
              <BarList rows={countRows(cl.access_by_level, "level", "residents").map((r) => ({ ...r, name: r.name === "Sos only" ? "SOS only" : r.name }))} color="bg-sky-500" empty="No resident access granted yet." format={(v) => formatCount(v)} max={4} />
            </div>
          </div>
        </Panel>

        <Panel title="Safety in partner areas" subtitle="SOS alerts and incidents in the watch areas companies cover">
          <FigureRow>
            <Figure label="SOS alerts" value={formatCount(sf.sos)} sub={`${formatCount(sf.sos_acknowledged)} acknowledged`} tone={n(sf.sos) > n(sf.sos_acknowledged) ? "bad" : undefined} />
            <Figure label="Median acknowledge" value={formatDuration(sf.sos_ack_median_seconds)} sub={`90% within ${formatDuration(sf.sos_ack_p90_seconds)}`} />
            <Figure label="Acknowledged by security" value={formatCount(sf.sos_ack_by_security)} sub={n(sf.sos_ack_by_security) ? `median ${formatDuration(sf.sos_security_ack_median_seconds)}` : "none yet"} />
            <Figure label="Resolved by security" value={formatCount(sf.sos_resolved_by_security)} />
          </FigureRow>
          <FigureRow>
            <Figure label="Incidents" value={formatCount(sf.incidents)} sub={`${formatCount(sf.incidents_approved)} approved`} />
            <Figure label="Median to approve" value={formatDuration(sf.incident_approve_median_seconds)} />
            <Figure label="Scheduled today" value={formatCount(cv.scheduled_today)} sub="patrol slots" />
            <Figure label="Next 7 days" value={formatCount(cv.scheduled_next_7_days)} sub="patrol slots" />
          </FigureRow>
        </Panel>
      </div>

      <Panel title="Companies" subtitle="Top 10 by clients" action={<InsightsLink />}>
        <ol className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
          {(s.top_companies || []).map((co, i) => (
            <li key={`${co.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm dark:text-xs">
              <span className="w-5 shrink-0 text-right font-semibold text-gray-400 tabular-nums dark:text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium text-gray-900 dark:text-slate-200">{co.name}</span>
                <span className="block text-xs text-gray-500 dark:text-[11px] dark:text-slate-500">
                  {labelize(co.status)} · {formatCount(co.suburbs)} assigned suburbs · {formatCount(co.watch_areas)} watch areas
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="font-semibold text-gray-900 dark:text-white">{formatCount(co.clients)}</span>
                <span className="ml-1 text-xs text-gray-500 dark:text-slate-500">clients · {formatCount(co.verified)} verified</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
          A company covers a watch when one of its assigned suburbs is the watch's suburb, or the watch is in the company's city (as on the partner dashboard).
        </p>
      </Panel>
    </div>
  );
}
