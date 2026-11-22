import { formatBucketLabel, formatCount, formatDuration, monthLabel, percent, roleGroupLabel } from "../../../utils/analyticsView";
import { BarList, Figure, FigureRow, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, MiniStat, Panel, ProgressRow, SkeletonBlock } from "../AnalyticsUi";
import { n, TrendOrEmpty } from "./shared";
import { useTabSection } from "./useTabSection";

const H4 = "mb-2 text-sm font-semibold text-gray-800 dark:text-xs dark:uppercase dark:tracking-wider dark:text-slate-400";
const TH = "px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-[10px] dark:uppercase dark:tracking-wider dark:text-slate-500";
const TD = "px-2 py-2 tabular-nums text-gray-800 dark:text-slate-300";

function fmtDay(ymd) {
  if (!ymd) return "";
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Rate({ retained, eligible }) {
  if (!n(eligible)) return <span className="text-gray-400 dark:text-slate-600">—</span>;
  const pct = percent(retained, eligible);
  return (
    <span>
      <strong className="font-semibold text-gray-900 dark:text-white">{formatCount(pct, 0)}%</strong>
      <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">
        {formatCount(retained)}/{formatCount(eligible)}
      </span>
    </span>
  );
}

function cohortRows(cohorts) {
  const byMonth = new Map();
  for (const c of cohorts || []) {
    const row = byMonth.get(c.month) || { month: c.month };
    row[c.group] = c;
    byMonth.set(c.month, row);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

export default function ResidentsTab({ data, args, refreshKey, onSection }) {
  const grain = data.overview?.range?.grain || args?.p_grain || "day";
  const sec = useTabSection("analytics_residents", args, refreshKey, onSection);
  const s = sec.data || {};
  const a = s.active || {};
  const rep = s.reports || {};
  const sub = s.suburbs || {};
  const ret = s.retention || {};
  const sv = s.services || {};
  const series = (a.series || []).map((r) => ({ ...r, label: formatBucketLabel(r.bucket, grain) }));
  const roles = rep.by_role || [];
  const resident = roles.find((r) => r.role === "resident") || {};
  const patroller = roles.find((r) => r.role === "patroller") || {};
  const tracking = Boolean(a.tracking_since);
  const totals = Object.fromEntries((ret.totals || []).map((t) => [t.group, t]));
  const cohorts = cohortRows(ret.cohorts);

  if (sec.status === "loading" && !sec.data) return <SkeletonBlock className="h-96 w-full" />;
  if (!sec.data) return <SectionNotice error={sec.error} />;

  return (
    <div className="space-y-6 dark:space-y-3">
      {!tracking || n(a.days_tracked) < 30 ? (
        <div role="status" className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:rounded-[10px] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {tracking
            ? `Active-member counts started on ${fmtDay(a.tracking_since)}, so earlier days show as zero. Weekly and monthly figures become complete after 7 and 30 days.`
            : "Active-member counts start once members open the updated app. They fill in from then on; nothing is counted retrospectively."}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Daily active residents" value={formatCount(a.dau?.residents)} sub={`${formatCount(a.dau?.patrollers)} patrollers on ${fmtDay(a.as_of)}`} />
        <MiniStat label="Weekly active residents" value={formatCount(a.wau?.residents)} sub={`${formatCount(a.wau?.patrollers)} patrollers · last 7 days`} />
        <MiniStat label="Monthly active residents" value={formatCount(a.mau?.residents)} sub={`${formatCount(a.mau?.patrollers)} patrollers · last 30 days`} />
        <MiniStat label="Residents active in period" value={formatCount(a.in_period?.residents)} sub={`average ${formatCount(a.avg_dau?.residents, 1)} a day`} />
      </div>

      <Panel title="Active members over time" subtitle="Members who opened the app at least once in each period">
        <div className="mt-3">
          <TrendOrEmpty
            rows={series}
            keys={["residents", "patrollers"]}
            empty={tracking ? "No app opens recorded in this period." : "Nothing recorded yet. This fills in as members open the updated app."}
            lines={[
              { key: "residents", name: "Residents", color: "#0ea5e9" },
              { key: "patrollers", name: "Patrollers", color: "#0d9488" },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="Who raises reports" subtitle={`${formatCount(rep.incidents)} incidents and ${formatCount(rep.sos)} SOS alerts in this period`}>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className={H4}>Incidents</h4>
              <BarList rows={roles.map((r) => ({ name: roleGroupLabel(r.role), value: n(r.incidents) })).filter((r) => r.value)} color="bg-amber-500" empty="No incidents in this period." format={(v) => formatCount(v)} />
            </div>
            <div>
              <h4 className={H4}>SOS alerts</h4>
              <BarList rows={roles.map((r) => ({ name: roleGroupLabel(r.role), value: n(r.sos) })).filter((r) => r.value)} color="bg-red-500" empty="No SOS alerts in this period." format={(v) => formatCount(v)} />
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">Grouped by the reporter's current role.</p>
        </Panel>
        <Panel title="Response to residents" subtitle="How quickly resident reports are handled">
          <FigureRow>
            <Figure label="Median to approve" value={formatDuration(resident.approve_median_seconds)} sub={`${formatCount(resident.approved)} of ${formatCount(resident.incidents)} approved`} />
            <Figure label="90% approved within" value={formatDuration(resident.approve_p90_seconds)} sub={n(resident.pending) ? `${formatCount(resident.pending)} still pending` : undefined} tone={n(resident.pending) ? "warn" : undefined} />
            <Figure label="Median SOS acknowledge" value={formatDuration(resident.sos_ack_median_seconds)} sub={`${formatCount(resident.sos_acknowledged)} of ${formatCount(resident.sos)} acknowledged`} tone={n(resident.sos) > n(resident.sos_acknowledged) ? "bad" : undefined} />
            <Figure label="90% acknowledged within" value={formatDuration(resident.sos_ack_p90_seconds)} />
          </FigureRow>
          {n(patroller.incidents) || n(patroller.sos) ? (
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
              For comparison, patroller reports: median {formatDuration(patroller.approve_median_seconds)} to approve · SOS median {formatDuration(patroller.sos_ack_median_seconds)} to acknowledge.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Residents and patrol coverage by suburb"
        subtitle={`Patrols in this period next to the residents living there. ${formatCount(sub.under_covered)} suburb${n(sub.under_covered) === 1 ? "" : "s"} flagged as under-covered.`}
      >
        {(sub.rows || []).length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm dark:text-xs">
              <thead className="border-b border-gray-200 dark:border-slate-800">
                <tr>
                  <th className={TH}>Suburb</th>
                  <th className={`${TH} text-right`}>Residents</th>
                  <th className={`${TH} text-right`}>Patrols</th>
                  <th className={`${TH} text-right`}>Hours</th>
                  <th className={`${TH} text-right`}>Hours per 100 residents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {sub.rows.map((r) => (
                  <tr key={r.suburb_id || "none"} className={r.under_covered ? "bg-amber-50/70 dark:bg-amber-500/5" : ""}>
                    <td className={`${TD} font-medium`}>
                      {r.suburb}
                      {r.city ? <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-slate-500">{r.city}</span> : null}
                      {r.under_covered ? (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Under-covered</span>
                      ) : null}
                    </td>
                    <td className={`${TD} text-right`}>{formatCount(r.residents)}</td>
                    <td className={`${TD} text-right`}>{formatCount(r.patrols)}</td>
                    <td className={`${TD} text-right`}>{formatCount(r.hours, 1)}</td>
                    <td className={`${TD} text-right`}>{r.hours_per_100_residents === null ? "—" : formatCount(r.hours_per_100_residents, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyChart message="No residents or patrols match these filters." height={140} />
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
          Under-covered: at least {sub.min_residents ?? 5} residents and no patrols, or under half the platform's {formatCount(sub.platform_hours_per_100, 1)} patrol hours per 100 residents. Residents are placed by their home suburb, else their watch's suburb.
          {n(sub.residents_without_area) ? ` ${formatCount(sub.residents_without_area)} residents have no area set.` : ""}
        </p>
      </Panel>

      <Panel title="Retention" subtitle="Members still active 30 and 90 days after joining, by sign-up month (last 12 months)">
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {["resident", "patroller"].map((g) => (
            <div key={g} className="space-y-3">
              <h4 className={H4}>{roleGroupLabel(g)}</h4>
              <ProgressRow label="Active after 30 days" value={percent(totals[g]?.retained_30, totals[g]?.eligible_30)} sub={`${formatCount(totals[g]?.retained_30)} of ${formatCount(totals[g]?.eligible_30)} who joined 30+ days ago`} />
              <ProgressRow label="Active after 90 days" color="bg-sky-500" value={percent(totals[g]?.retained_90, totals[g]?.eligible_90)} sub={`${formatCount(totals[g]?.retained_90)} of ${formatCount(totals[g]?.eligible_90)} who joined 90+ days ago`} />
            </div>
          ))}
        </div>
        {cohorts.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm dark:text-xs">
              <thead className="border-b border-gray-200 dark:border-slate-800">
                <tr>
                  <th className={TH}>Joined</th>
                  <th className={`${TH} text-right`}>Residents</th>
                  <th className={`${TH} text-right`}>30 days</th>
                  <th className={`${TH} text-right`}>90 days</th>
                  <th className={`${TH} text-right`}>Patrollers</th>
                  <th className={`${TH} text-right`}>30 days</th>
                  <th className={`${TH} text-right`}>90 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className={`${TD} font-medium`}>{monthLabel(c.month)}</td>
                    <td className={`${TD} text-right`}>{formatCount(c.resident?.joined ?? 0)}</td>
                    <td className={`${TD} text-right`}><Rate retained={c.resident?.retained_30} eligible={c.resident?.eligible_30} /></td>
                    <td className={`${TD} text-right`}><Rate retained={c.resident?.retained_90} eligible={c.resident?.eligible_90} /></td>
                    <td className={`${TD} text-right`}>{formatCount(c.patroller?.joined ?? 0)}</td>
                    <td className={`${TD} text-right`}><Rate retained={c.patroller?.retained_30} eligible={c.patroller?.eligible_30} /></td>
                    <td className={`${TD} text-right`}><Rate retained={c.patroller?.retained_90} eligible={c.patroller?.eligible_90} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyChart message="No residents or patrollers joined in the last 12 months." height={120} />
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
          "Active" uses the most recent sign of life: an app open{tracking ? ` (recorded since ${fmtDay(ret.tracking_since)})` : " (once recording starts)"}, else the last sign-in or app version check.
          {` Based on app opens for ${formatCount(ret.sources?.activity_days)}, last sign-in only for ${formatCount(ret.sources?.sign_in_only)}, no signal for ${formatCount(ret.sources?.no_signal)}.`}
          {" "}Last sign-in only changes when someone signs in again, so older cohorts can read low until app opens build up.
        </p>
      </Panel>

      <Panel title="Local services and talents" subtitle="Business and service listings residents have set up">
        <FigureRow>
          <Figure label="Listings" value={formatCount(sv.listings)} sub={`${formatCount(sv.new_in_period)} new in this period`} />
          <Figure label="Active" value={formatCount(sv.active)} sub={`${formatCount(sv.inactive)} inactive · ${formatCount(sv.awaiting_review)} awaiting review`} tone={n(sv.awaiting_review) ? "warn" : undefined} />
          <Figure label="Providers" value={formatCount(sv.providers)} sub={`${formatCount(sv.active_providers)} with an active listing`} />
          <Figure label="Reviews" value={formatCount(sv.reviews?.total)} sub={sv.reviews?.avg_rating ? `average ${formatCount(sv.reviews.avg_rating, 1)} of 5` : "no ratings yet"} />
        </FigureRow>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className={H4}>By category</h4>
            <BarList rows={(sv.by_category || []).map((c) => ({ name: c.category, sub: `${formatCount(c.active)} active`, value: n(c.listings) }))} color="bg-teal-600" empty="No listings yet. They appear as residents add their services." format={(v) => formatCount(v)} />
          </div>
          <div>
            <h4 className={H4}>By status</h4>
            <BarList rows={(sv.by_status || []).map((c) => ({ name: c.status === "published" ? "Active" : c.status === "pending" ? "Awaiting review" : c.status.charAt(0).toUpperCase() + c.status.slice(1), value: n(c.listings) }))} color="bg-slate-500" empty="No listings yet." format={(v) => formatCount(v)} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
