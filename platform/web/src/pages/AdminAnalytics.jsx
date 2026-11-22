import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaChartBar } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import { EmptyState, ErrorState } from "../components/ui";
import AnalyticsFilters, { AnalyticsTabs } from "../components/analytics/AnalyticsFilters";
import { AnalyticsLoading } from "../components/analytics/AnalyticsUi";
import { useAnalytics, useAnalyticsFilterOptions } from "../hooks/useAnalytics";
import toast from "../utils/notify";
import { ANALYTICS_TABS, analyticsRequest, analyticsSearchString, narrowFilterOptions, parseAnalyticsSearch } from "../utils/analyticsView";
import { exportFileName, sectionsToCsv, tabExportSections } from "../utils/analyticsExport";
import { canPrintReport, printReport, saveCsv } from "../utils/analyticsDownload";

// Each tab is its own chunk, loaded the first time it is opened.
const TABS = {
  overview: lazy(() => import("../components/analytics/tabs/OverviewTab")),
  patrols: lazy(() => import("../components/analytics/tabs/PatrolsTab")),
  safety: lazy(() => import("../components/analytics/tabs/SafetyTab")),
  people: lazy(() => import("../components/analytics/tabs/PeopleTab")),
  community: lazy(() => import("../components/analytics/tabs/CommunityTab")),
  watches: lazy(() => import("../components/analytics/tabs/WatchesTab")),
};

function formatLoadedAt(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatRange(from, to) {
  const fmt = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };
  return from && to ? `${fmt(from)} – ${fmt(to)}` : "";
}

function formatGeneratedAt(ms) {
  return new Date(ms).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }) + " SAST";
}

/**
 * Platform analytics for global admins and technical support only (route guarded by RequireRole,
 * data guarded server-side by is_global_app_staff()). Tab and filters live in the URL query.
 */
export default function AdminAnalytics() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => parseAnalyticsSearch(location.search), [location.search]);
  const request = useMemo(() => analyticsRequest(state), [state]);
  const analytics = useAnalytics(request.ok ? request.args : null, { enabled: request.ok });
  const filterOptions = useAnalyticsFilterOptions();

  const narrowed = useMemo(
    () => ({
      cities: filterOptions.cities,
      ...narrowFilterOptions(filterOptions, { cityId: state.cityId, suburbId: state.suburbId }),
    }),
    [filterOptions, state.cityId, state.suburbId]
  );

  const update = useCallback(
    (patch) => {
      const qs = analyticsSearchString(state, patch);
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, { replace: true });
    },
    [state, navigate, location.pathname]
  );

  const selectWatch = useCallback((row) => update({ orgId: row.organization_id, tab: "overview" }), [update]);

  const scopeLabel = useMemo(() => {
    const byId = (list, id) => list.find((x) => x.id === id)?.name;
    const parts = [
      state.orgId && (byId(filterOptions.watches, state.orgId) || "1 watch"),
      state.suburbId && (byId(filterOptions.suburbs, state.suburbId) || "1 suburb"),
      state.cityId && (byId(filterOptions.cities, state.cityId) || "1 city"),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "All watches, platform-wide";
  }, [state.orgId, state.suburbId, state.cityId, filterOptions]);

  const { status, data, error, loadedAt } = analytics;
  const [sections, setSections] = useState({});
  const [exporting, setExporting] = useState(false);
  const [printedAt, setPrintedAt] = useState(null);
  const sectionHandlers = useMemo(
    () => Object.fromEntries(Object.keys(TABS).map((id) => [id, (value) => setSections((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }))])),
    []
  );
  const tabId = TABS[state.tab] ? state.tab : "overview";
  const tabLabel = ANALYTICS_TABS.find((t) => t.id === tabId)?.label || "Overview";
  const printable = canPrintReport();

  const exportCsv = useCallback(async () => {
    if (!data) {
      toast.error("Wait for the dashboard to finish loading, then try again.");
      return;
    }
    setExporting(true);
    try {
      const meta = [
        ["Report", `Watchman platform analytics · ${tabLabel}`],
        ["Date range", `${state.from} to ${state.to}`],
        ["Scope", scopeLabel],
        ["Grouped by", request.args?.p_grain || state.grain || "auto"],
        ["Generated", formatGeneratedAt(Date.now())],
      ];
      const csv = sectionsToCsv(meta, tabExportSections(tabId, { overview: data.overview, watches: data.watches, section: sections[tabId] || null }));
      const result = await saveCsv(csv, exportFileName(tabId, state.from, state.to, "csv"));
      if (result === "downloaded") toast.success("CSV downloaded.");
    } catch (err) {
      console.warn("Analytics CSV export failed", err);
      toast.error("Couldn't create the CSV. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [data, sections, tabId, tabLabel, state.from, state.to, state.grain, scopeLabel, request.args]);

  const exportPdf = useCallback(async () => {
    if (!printable) {
      toast.error("PDF export works in a web browser. In the app, use Export CSV instead.");
      return;
    }
    if (!data) {
      toast.error("Wait for the dashboard to finish loading, then try again.");
      return;
    }
    setPrintedAt(Date.now());
    try {
      await printReport();
    } catch (err) {
      console.warn("Analytics print failed", err);
      toast.error("Couldn't open the print window. Please try again.");
    }
  }, [printable, data]);

  let body;
  if (!request.ok) {
    body = <ErrorState title="Check the date range" message={request.error} />;
  } else if (status === "error") {
    body = error?.notReady ? (
      <EmptyState icon={FaChartBar} title="Analytics isn't switched on yet" message={error.message} />
    ) : (
      <ErrorState title="Couldn't load analytics" message={error?.message} onRetry={analytics.refetch} />
    );
  } else if (!data) {
    body = <AnalyticsLoading />;
  } else {
    const Tab = TABS[tabId];
    body = (
      <div className={status === "loading" ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={status === "loading"}>
        <Suspense fallback={<AnalyticsLoading />}>
          <Tab
            data={data}
            args={request.args}
            refreshKey={analytics.refreshKey}
            onSection={sectionHandlers[tabId]}
            onSelectWatch={selectWatch}
            onShowWatches={() => update({ tab: "watches" })}
            nowMs={loadedAt}
            selectedId={state.orgId}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="analytics-report-page min-h-screen bg-gray-50 text-gray-900 dark:bg-[#060b14] dark:text-slate-200">
      <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur pt-[var(--safe-area-top,0px)] dark:border-slate-800 dark:bg-[#070d18]/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 py-3 dark:py-2">
            <Link
              to="/admin"
              aria-label="Back to Admin"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 dark:h-8 dark:w-8 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <FaArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold sm:text-xl dark:text-base dark:font-semibold dark:tracking-wide dark:text-white">
                <span className="mr-2 hidden h-2 w-2 rounded-full bg-teal-400 align-middle shadow-[0_0_8px_#2dd4bf] dark:inline-block" aria-hidden />
                Platform analytics
              </h1>
              <p className="truncate text-xs text-gray-500 dark:text-slate-500">
                {scopeLabel} · {formatRange(state.from, state.to)}
                {loadedAt ? ` · updated ${formatLoadedAt(loadedAt)}` : ""}
              </p>
            </div>
            <ThemeToggle variant="toolbar" />
          </div>
          <div className="pb-3 dark:pb-2">
            <AnalyticsFilters
              state={state}
              options={narrowed}
              optionsLoading={filterOptions.loading}
              onChange={update}
              onRefresh={analytics.refetch}
              refreshing={status === "loading"}
              onExportCsv={exportCsv}
              onExportPdf={exportPdf}
              exporting={exporting}
              canPrint={printable}
            />
            {filterOptions.failed ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Some filter options couldn't load. The dashboard still works without them.</p>
            ) : null}
          </div>
          <AnalyticsTabs tab={state.tab} onChange={(tab) => update({ tab })} />
        </div>
      </header>

      <main className="analytics-report mx-auto max-w-7xl px-4 py-6 pb-[calc(1.5rem+var(--safe-area-bottom,0px))] sm:px-6 lg:px-8 dark:py-3">
        <div className="mb-4 hidden border-b border-gray-300 pb-3 print:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Watchman · Platform analytics</p>
          <h1 className="text-xl font-bold text-gray-900">{tabLabel} report</h1>
          <p className="text-sm text-gray-700">
            {formatRange(state.from, state.to)} · {scopeLabel}
            {request.args?.p_grain ? ` · grouped by ${request.args.p_grain}` : ""}
          </p>
          <p className="text-xs text-gray-500">
            Generated {formatGeneratedAt(printedAt || loadedAt || 0)}
            {loadedAt ? ` · data loaded ${formatLoadedAt(loadedAt)}` : ""} · Confidential: for Watchman admins and support only
          </p>
        </div>
        {body}
      </main>
    </div>
  );
}
