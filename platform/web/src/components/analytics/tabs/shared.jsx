import { formatBucketLabel, hasAnyValue, seriesRows } from "../../../utils/analyticsView";
import { TrendArea } from "../AnalyticsCharts";
import { EmptyChart } from "../AnalyticsUi";

export function useSeries(overview) {
  const grain = overview?.range?.grain || "day";
  return seriesRows(overview).map((row) => ({ ...row, label: formatBucketLabel(row.bucket, grain) }));
}

export function TrendOrEmpty({ rows, keys, empty, ...props }) {
  if (!keys.some((k) => hasAnyValue(rows, k))) return <EmptyChart message={empty} height={props.height || 220} />;
  return <TrendArea data={rows} {...props} />;
}

export function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
