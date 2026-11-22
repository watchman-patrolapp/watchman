import { EmptyChart, Panel, SectionHeading } from "../AnalyticsUi";
import WatchTable from "../WatchTable";

export default function WatchesTab({ data, onSelectWatch, nowMs, selectedId }) {
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
