import { formatSeconds } from "../../utils/analytics";
import {
  buildKpis,
  buildNeedsAttention,
  formatBucketLabel,
  formatCount,
  formatMinutes,
  hasAnyValue,
  roleRows,
  seriesRows,
  versionRows,
} from "../../utils/analyticsView";
import { Bars, Donut, TrendArea } from "./AnalyticsCharts";
import { AttentionList, ComingNext, EmptyChart, KpiCard, MiniStat, Panel, ProgressRow, SectionHeading } from "./AnalyticsUi";
import WatchTable from "./WatchTable";

function useSeries(overview) {
  const grain = overview?.range?.grain || "day";
  return seriesRows(overview).map((row) => ({ ...row, label: formatBucketLabel(row.bucket, grain) }));
}

function TrendOrEmpty({ rows, keys, empty, ...props }) {
  if (!keys.some((k) => hasAnyValue(rows, k))) return <EmptyChart message={empty} height={props.height || 220} />;
  return <TrendArea data={rows} {...props} />;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function OverviewPanel({ data, onSelectWatch, onShowWatches, nowMs }) {
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

export function PatrolsPanel({ data }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Patrols" value={formatCount(c.patrols)} />
        <MiniStat label="Patrol hours" value={`${formatCount(c.patrol_hours, 1)} h`} />
        <MiniStat label="Volunteers" value={formatCount(c.patrol_volunteers)} />
        <MiniStat label="Average patrol" value={formatMinutes(c.avg_patrol_minutes)} />
      </div>
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
        <Panel title="Distance patrolled" subtitle={`${formatCount(c.distance_km, 1)} km from saved routes`}>
          <div className="mt-3">
            {hasAnyValue(rows, "distance_km") ? (
              <Bars data={rows} unit="km" bars={[{ key: "distance_km", name: "Distance", color: "#8b5cf6" }]} />
            ) : (
              <EmptyChart message="No saved patrol routes in this period." />
            )}
          </div>
        </Panel>
      </div>
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
      <ComingNext items={["Busiest patrol hours and days", "Top patrollers and streaks", "Route coverage heat map", "Check-ins per patrol"]} />
    </div>
  );
}

export function SafetyPanel({ data }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  const statusRows = [
    { name: "Approved", value: n(c.incidents_approved) },
    { name: "Pending", value: n(c.incidents_pending) },
    { name: "Rejected", value: n(c.incidents_rejected) },
  ].filter((r) => r.value > 0);
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
      <ComingNext items={["Incident types and trends", "Hotspot map by suburb", "Time of day breakdown", "Repeat locations and suspects"]} />
    </div>
  );
}

export function PeoplePanel({ data }) {
  const overview = data.overview;
  const rows = useSeries(overview);
  const c = overview?.current || {};
  const members = roleRows(overview?.members_by_role);
  const signupRoles = roleRows(c.signups_by_role);
  const versions = versionRows(overview?.app_versions);
  const terms = overview?.terms || {};
  const total = n(overview?.members_total);
  const termsPct = total && terms.latest_version ? Math.round((n(terms.on_latest) / total) * 100) : null;
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
            <p className="text-sm text-gray-600 dark:text-slate-400">
              {formatCount(c.terms_accepted)} acceptances recorded in this period.
            </p>
          </div>
        </Panel>
      </div>
      <ComingNext items={["Daily and monthly active members", "Retention after sign-up", "Members per watch over time", "Notification reach"]} />
    </div>
  );
}

export function CommunityPanel({ data }) {
  const w = data.overview?.watches || {};
  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Watches" value={formatCount(w.total)} />
        <MiniStat label="Active" value={formatCount(w.active)} tone="good" />
        <MiniStat label="Pending approval" value={formatCount(w.pending)} tone={n(w.pending) ? "warn" : "default"} />
        <MiniStat label="Suspended" value={formatCount(w.suspended)} tone={n(w.suspended) ? "bad" : "default"} />
      </div>
      <ComingNext
        title="Community analytics are coming next"
        items={["City Hub posts and engagement", "Chat activity per watch", "Feedback and support requests", "Events and meetings", "Most active contributors", "WhatsApp group reach"]}
      />
    </div>
  );
}

export function WatchesPanel({ data, onSelectWatch, nowMs, selectedId }) {
  return (
    <div className="space-y-4">
      <SectionHeading title="Watch comparison" hint="Click a watch to filter the whole dashboard to it" />
      <Panel>
        {data.watches.length ? (
          <WatchTable rows={data.watches} onSelect={onSelectWatch} nowMs={nowMs} selectedId={selectedId} />
        ) : (
          <EmptyChart message="No watches match these filters." height={160} />
        )}
      </Panel>
    </div>
  );
}
