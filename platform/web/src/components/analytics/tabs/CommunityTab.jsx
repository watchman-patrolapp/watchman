import { countRows, formatBucketLabel, formatCount, formatDuration, formatRand, hasAnyValue } from "../../../utils/analyticsView";
import { Bars } from "../AnalyticsCharts";
import { BarList, Figure, FigureRow, SectionNotice } from "../AnalyticsBlocks";
import { EmptyChart, MiniStat, Panel, SkeletonBlock } from "../AnalyticsUi";
import { n, TrendOrEmpty } from "./shared";
import { useTabSection } from "./useTabSection";

export default function CommunityTab({ data, args, refreshKey, onSection }) {
  const w = data.overview?.watches || {};
  const grain = data.overview?.range?.grain || args?.p_grain || "day";
  const sec = useTabSection("analytics_community", args, refreshKey, onSection);
  const s = sec.data || {};
  const ready = Boolean(sec.data);
  const series = (s.series || []).map((r) => ({ ...r, label: formatBucketLabel(r.bucket, grain) }));
  const needs = s.needs || {};
  const ledger = s.ledger || {};
  const hub = s.hub_posts || {};
  const chat = s.chat || {};
  const bc = s.broadcasts || {};
  const rep = s.reports || {};
  const fb = s.feedback || {};
  const net = n(ledger.raised_cents) - n(ledger.spent_cents);

  return (
    <div className="space-y-6 dark:space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 dark:gap-2">
        <MiniStat label="Watches" value={formatCount(w.total)} />
        <MiniStat label="Active" value={formatCount(w.active)} tone="good" />
        <MiniStat label="Pending approval" value={formatCount(w.pending)} tone={n(w.pending) ? "warn" : "default"} />
        <MiniStat label="Suspended" value={formatCount(w.suspended)} tone={n(w.suspended) ? "bad" : "default"} />
      </div>
      <SectionNotice error={sec.error} />
      {sec.status === "loading" && !sec.data ? <SkeletonBlock className="h-64 w-full" /> : null}
      {ready ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 dark:gap-2">
            <Panel title="Needs and offers" subtitle="Equipment wish lists and what neighbours offered">
              <FigureRow>
                <Figure label="Needs posted" value={formatCount(needs.items_created)} sub={`${formatCount(needs.items_open)} open now`} />
                <Figure label="Needs met" value={formatCount(needs.items_acquired)} tone={n(needs.items_acquired) ? "good" : "default"} />
                <Figure label="Offers" value={formatCount(needs.offers)} sub={`${formatCount(needs.offers_converted)} accepted or fulfilled`} />
                <Figure label="Conversion" value={needs.conversion_rate === null || needs.conversion_rate === undefined ? "—" : `${formatCount(needs.conversion_rate, 1)}%`} sub="withdrawn offers excluded" />
              </FigureRow>
              <div className="mt-4">
                {hasAnyValue(series, "offers") ? (
                  <Bars
                    data={series}
                    height={180}
                    bars={[
                      { key: "offers", name: "Offers", color: "#0ea5e9" },
                      { key: "offers_converted", name: "Converted", color: "#10b981" },
                    ]}
                  />
                ) : (
                  <EmptyChart message="No offers in this period." height={140} />
                )}
              </div>
              {(needs.offers_by_kind || []).length ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-500">
                  {countRows(needs.offers_by_kind, "kind", "offers")
                    .map((r) => `${formatCount(r.value)} ${r.name.toLowerCase()}`)
                    .join(" · ")}
                </p>
              ) : null}
            </Panel>
            <Panel title="Money raised and spent" subtitle={`From the needs ledger · ${formatCount(ledger.entries)} entries`}>
              <FigureRow>
                <Figure label="Raised" value={formatRand(ledger.raised_cents)} tone="good" />
                <Figure label="Spent" value={formatRand(ledger.spent_cents)} />
                <Figure label="Net" value={formatRand(net)} tone={net < 0 ? "bad" : "default"} />
              </FigureRow>
              <div className="mt-4">
                {hasAnyValue(series, "raised_rand") || hasAnyValue(series, "spent_rand") ? (
                  <Bars
                    data={series}
                    height={180}
                    bars={[
                      { key: "raised_rand", name: "Raised (R)", color: "#10b981" },
                      { key: "spent_rand", name: "Spent (R)", color: "#f59e0b" },
                    ]}
                  />
                ) : (
                  <EmptyChart message="No money recorded in this period." height={140} />
                )}
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
            <Panel title="City Hub posts" subtitle={`${formatCount(hub.total)} published · ${formatCount(hub.hidden)} hidden`}>
              <div className="mt-3">
                <BarList rows={countRows(hub.by_type, "type", "posts")} color="bg-teal-600" empty="No City Hub posts in this period." format={(v) => formatCount(v)} />
              </div>
            </Panel>
            <Panel title="Chat activity" subtitle="Message counts only, never content" className="lg:col-span-2">
              <FigureRow>
                <Figure label="Messages" value={formatCount(chat.messages)} />
                <Figure label="Active days" value={formatCount(chat.active_days)} />
                <Figure label="Per active day" value={formatCount(chat.per_active_day, 1)} />
              </FigureRow>
              <div className="mt-3">
                <TrendOrEmpty rows={series} keys={["chat_messages"]} empty="No chat messages in this period." height={160} lines={[{ key: "chat_messages", name: "Messages", color: "#8b5cf6" }]} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 dark:gap-2">
            <Panel title="Area broadcasts">
              <FigureRow>
                <Figure label="Sent" value={formatCount(bc.total)} />
                <Figure label="Hidden" value={formatCount(bc.hidden)} />
              </FigureRow>
            </Panel>
            <Panel title="Community reports" subtitle="Content flagged by members">
              <FigureRow>
                <Figure label="Reports" value={formatCount(rep.total)} />
                <Figure label="Open now" value={formatCount(rep.open_now)} tone={n(rep.open_now) ? "warn" : "good"} />
                <Figure label="Median to handle" value={formatDuration(rep.handle_median_seconds)} />
              </FigureRow>
              <div className="mt-3">
                <BarList rows={countRows(rep.by_reason, "reason", "reports")} color="bg-red-500" empty="No reports in this period." max={6} format={(v) => formatCount(v)} />
              </div>
            </Panel>
            <Panel title="Feedback" subtitle="From the in-app feedback form">
              <FigureRow>
                <Figure label="Received" value={formatCount(fb.total)} />
                <Figure label="Reviewed" value={formatCount(fb.reviewed)} />
                <Figure label="Unreviewed now" value={formatCount(fb.unreviewed_now)} tone={n(fb.unreviewed_now) ? "warn" : "good"} />
              </FigureRow>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}
