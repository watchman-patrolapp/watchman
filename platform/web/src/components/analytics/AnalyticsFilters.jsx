import { useState } from "react";
import { FaFileCsv, FaFilePdf, FaFilter, FaSyncAlt } from "react-icons/fa";
import { ANALYTICS_GRAINS, ANALYTICS_PRESETS } from "../../utils/analytics";
import { ANALYTICS_TABS, GRAIN_LABELS, PRESET_LABELS } from "../../utils/analyticsView";

const SELECT =
  "h-9 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-60 sm:w-auto sm:max-w-[13rem] dark:h-8 dark:rounded-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:text-xs";
const LABEL = "text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-slate-500";

function Segmented({ label, options, value, onChange, labels }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:rounded-md dark:border dark:border-slate-700 dark:bg-slate-900">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition sm:px-3 sm:text-sm dark:rounded dark:text-xs ${
              active
                ? "bg-white text-gray-900 shadow-sm dark:bg-teal-500/20 dark:text-teal-300 dark:shadow-none"
                : "text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {labels[opt] || opt}
          </button>
        );
      })}
    </div>
  );
}

const EXPORT_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:h-8 dark:border-slate-700 dark:bg-slate-900 dark:text-xs dark:text-slate-300 dark:hover:bg-slate-800";

function Picker({ id, label, value, onChange, options, allLabel, disabled }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className={LABEL}>{label}</span>
      <select id={id} className={SELECT} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.status && o.status !== "active" ? ` (${o.status})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Sticky filter bar: date presets, custom range, city / suburb / watch, grain, tabs, CSV and PDF export.
 * `onChange(patch)` receives a partial page state; the page writes it to the URL.
 */
export default function AnalyticsFilters({ state, options, optionsLoading, onChange, onRefresh, refreshing, onExportCsv, onExportPdf, exporting, canPrint }) {
  const [open, setOpen] = useState(false);
  const activeCount = [state.cityId, state.suburbId, state.orgId].filter(Boolean).length;

  const setPreset = (preset) => {
    if (preset === "custom") onChange({ preset, from: state.from, to: state.to });
    else onChange({ preset, grainIsDefault: true });
  };

  return (
    <div className="space-y-3 dark:space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Date range" options={ANALYTICS_PRESETS} value={state.preset} onChange={setPreset} labels={PRESET_LABELS} />
        {state.preset === "custom" ? (
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="analytics-from">From</label>
            <input
              id="analytics-from"
              type="date"
              className={`${SELECT} w-auto`}
              value={state.from}
              max={state.to}
              onChange={(e) => e.target.value && onChange({ preset: "custom", from: e.target.value })}
            />
            <span className="text-xs text-gray-500 dark:text-slate-500">to</span>
            <label className="sr-only" htmlFor="analytics-to">To</label>
            <input
              id="analytics-to"
              type="date"
              className={`${SELECT} w-auto`}
              value={state.to}
              min={state.from}
              onChange={(e) => e.target.value && onChange({ preset: "custom", to: e.target.value })}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="analytics-filter-panel"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 md:hidden dark:h-8 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <FaFilter className="h-3 w-3" aria-hidden />
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
      </div>

      <div id="analytics-filter-panel" className={`${open ? "grid" : "hidden"} grid-cols-1 gap-2 md:flex md:flex-wrap md:items-center md:gap-3`}>
        <Picker
          id="analytics-city"
          label="City"
          value={state.cityId}
          onChange={(cityId) => onChange({ cityId, suburbId: "", orgId: "" })}
          options={options.cities}
          allLabel={optionsLoading ? "Loading…" : "All cities"}
          disabled={optionsLoading}
        />
        <Picker
          id="analytics-suburb"
          label="Suburb"
          value={state.suburbId}
          onChange={(suburbId) => onChange({ suburbId, orgId: "" })}
          options={options.suburbs}
          allLabel={optionsLoading ? "Loading…" : "All suburbs"}
          disabled={optionsLoading}
        />
        <Picker
          id="analytics-watch"
          label="Watch"
          value={state.orgId}
          onChange={(orgId) => onChange({ orgId })}
          options={options.watches}
          allLabel={optionsLoading ? "Loading…" : "All watches"}
          disabled={optionsLoading}
        />
        <div className="flex items-center gap-2">
          <span className={LABEL}>Group by</span>
          <Segmented
            label="Chart grouping"
            options={ANALYTICS_GRAINS}
            value={state.grain}
            onChange={(grain) => onChange({ grain, grainIsDefault: false })}
            labels={GRAIN_LABELS}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {activeCount ? (
            <button
              type="button"
              onClick={() => onChange({ cityId: "", suburbId: "", orgId: "" })}
              className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300 dark:text-xs"
            >
              Clear filters
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:h-8 dark:border-slate-700 dark:bg-slate-900 dark:text-xs dark:text-slate-300"
          >
            <FaSyncAlt className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={!onExportCsv || exporting}
            title="Download this tab's figures and the watch table as a spreadsheet (CSV)"
            className={EXPORT_BTN}
          >
            <FaFileCsv className="h-3.5 w-3.5" aria-hidden />
            Export CSV
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            disabled={!onExportPdf || exporting}
            title={canPrint ? "Print this tab, or choose Save as PDF in the print window" : "PDF export works in a web browser, not in the Android app. Use Export CSV here."}
            className={EXPORT_BTN}
          >
            <FaFilePdf className="h-3.5 w-3.5" aria-hidden />
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsTabs({ tab, onChange }) {
  return (
    <nav aria-label="Analytics sections" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ANALYTICS_TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition dark:py-2 dark:text-xs dark:uppercase dark:tracking-wider ${
              active
                ? "border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-slate-500 dark:hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
