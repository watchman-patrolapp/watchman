import { countRows, formatCount, formatDuration, percent, roleRows, versionRows } from "../../../utils/analyticsView";
import { Bars, Donut } from "../AnalyticsCharts";
import { BarList, Figure, FigureRow, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, Panel, ProgressRow, SkeletonBlock } from "../AnalyticsUi";
import { n, TrendOrEmpty, useSeries } from "./shared";
import { useTabSection } from "./useTabSection";

export default function PeopleTab({ data, args, refreshKey, onSection }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  const sec = useTabSection("analytics_people", args, refreshKey, onSection);
  const s = sec.data || {};
  const ready = Boolean(sec.data);
  const members = roleRows(overview?.members_by_role);
  const signupRoles = roleRows(c.signups_by_role);
  const versions = versionRows(overview?.app_versions);
  const terms = overview?.terms || {};
  const total = n(overview?.members_total);
  const termsPct = total && terms.latest_version ? Math.round((n(terms.on_latest) / total) * 100) : null;
  const res = s.residents || {};
  const vouches = s.vouches || {};
  const reqs = s.patroller_requests || {};
  const del = s.deletions || {};
  const byWatch = (s.signups_by_watch || []).map((w) => ({ name: w.watch, value: n(w.signups) }));
  if (n(s.signups_without_watch)) byWatch.push({ name: "Not in a watch yet", value: n(s.signups_without_watch) });

  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="Members by role" subtitle={`${formatCount(total)} members in scope`}>
          <div className="mt-3">{members.length ? <Donut data={members} centerLabel="members" /> : <EmptyChart message="No members match these filters." height={180} />}</div>
        </Panel>
        <Panel title="New sign-ups" subtitle={`${formatCount(c.signups)} in this period`}>
          <div className="mt-3">
            <TrendOrEmpty rows={rows} keys={["signups"]} empty="No sign-ups in this period." height={180} lines={[{ key: "signups", name: "Sign-ups", color: "#0ea5e9" }]} />
            {signupRoles.length ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">{signupRoles.map((r) => `${formatCount(r.value)} ${r.name.toLowerCase()}`).join(" · ")}</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <SectionNotice error={sec.error} />
      {sec.status === "loading" && !sec.data ? <SkeletonBlock className="h-48 w-full" /> : null}
      {ready ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
            <Panel title="Sign-ups per watch" subtitle={`${formatCount(s.signups)} new accounts in this period`}>
              <div className="mt-3">
                <BarList rows={byWatch} color="bg-sky-500" empty="No sign-ups in this period." max={15} format={(v) => formatCount(v)} />
              </div>
            </Panel>
            <Panel title="Resident verification" subtitle={`${formatCount(res.total)} residents in scope`}>
              <div className="mt-4 space-y-4">
                <ProgressRow
                  label="Verified"
                  value={percent(res.verified, res.total)}
                  color="bg-emerald-500"
                  sub={`${formatCount(res.verified)} verified · ${formatCount(res.pending)} still pending`}
                />
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-xs dark:uppercase dark:tracking-wider dark:text-slate-400">How residents were verified</h4>
                  <BarList rows={countRows(res.by_method, "method", "residents")} color="bg-emerald-500" empty="No verified residents yet." max={6} format={(v) => formatCount(v)} />
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
            <Panel title="Vouches" subtitle="Neighbours vouching for residents in this period">
              <FigureRow>
                <Figure label="Vouches" value={formatCount(vouches.total)} />
                <Figure label="Residents vouched" value={formatCount(vouches.residents_vouched)} />
                <Figure label="Vouchers" value={formatCount(vouches.vouchers)} />
              </FigureRow>
            </Panel>
            <Panel title="Patroller requests" subtitle={`${formatCount(reqs.in_period)} requested in this period`}>
              <FigureRow>
                <Figure label="Waiting now" value={formatCount(reqs.pending_now)} tone={n(reqs.pending_now) ? "warn" : "good"} />
                <Figure label="Median review" value={formatDuration(reqs.review_median_seconds)} />
              </FigureRow>
              <div className="mt-3">
                <BarList rows={countRows(reqs.by_status, "status", "requests")} color="bg-teal-600" empty="No requests in this period." max={5} format={(v) => formatCount(v)} />
              </div>
            </Panel>
            <Panel title="Account deletions" subtitle="From the audit log">
              <FigureRow>
                <Figure label="Deleted" value={formatCount(del.total)} tone={n(del.total) ? "warn" : "default"} />
                <Figure label="By the member" value={formatCount(del.self)} />
                <Figure label="By an admin" value={formatCount(del.by_admin)} />
              </FigureRow>
              {(del.by_role || []).length ? (
                <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">
                  {countRows(del.by_role, "role", "deletions")
                    .map((r) => `${formatCount(r.value)} ${r.name.toLowerCase()}`)
                    .join(" · ")}
                </p>
              ) : null}
            </Panel>
          </div>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
        <Panel title="Android app versions" subtitle={overview?.app_versions?.devices ? `${formatCount(overview.app_versions.devices)} devices seen in the last 90 days` : "Devices report their version when the app opens"}>
          <div className="mt-3">
            {versions.length ? (
              <Bars data={versions} xKey="name" layout="vertical" height={Math.max(120, versions.length * 34)} bars={[{ key: "value", name: "Devices", color: "#0d9488" }]} />
            ) : (
              <EmptyChart message="No app versions reported yet. They appear as members open the updated Android app." height={160} />
            )}
          </div>
        </Panel>
        <Panel title="Terms and conditions" subtitle={terms.latest_version ? `Current version ${terms.latest_version}` : "No published terms version found"}>
          <div className="mt-4 space-y-4">
            <ProgressRow label="Members on the current terms" value={termsPct} sub={`${formatCount(terms.on_latest)} of ${formatCount(total)} members`} />
            <p className="text-sm text-gray-600 dark:text-slate-400">{formatCount(c.terms_accepted)} acceptances recorded in this period.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
