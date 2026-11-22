import { useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaChartBar } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import { EmptyState, ErrorState } from "../components/ui";
import AnalyticsFilters, { AnalyticsTabs } from "../components/analytics/AnalyticsFilters";
import { AnalyticsLoading } from "../components/analytics/AnalyticsUi";
import {
  CommunityPanel,
  OverviewPanel,
  PatrolsPanel,
  PeoplePanel,
  SafetyPanel,
  WatchesPanel,
} from "../components/analytics/AnalyticsPanels";
import { useAnalytics, useAnalyticsFilterOptions } from "../hooks/useAnalytics";
import { analyticsRequest, analyticsSearchString, narrowFilterOptions, parseAnalyticsSearch } from "../utils/analyticsView";

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
  const panelProps = { data, onSelectWatch: selectWatch, nowMs: loadedAt, selectedId: state.orgId };

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
    const panels = {
      overview: <OverviewPanel {...panelProps} onShowWatches={() => update({ tab: "watches" })} />,
      patrols: <PatrolsPanel {...panelProps} />,
      safety: <SafetyPanel {...panelProps} />,
      people: <PeoplePanel {...panelProps} />,
      community: <CommunityPanel {...panelProps} />,
      watches: <WatchesPanel {...panelProps} />,
    };
    body = (
      <div className={status === "loading" ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={status === "loading"}>
        {panels[state.tab] || panels.overview}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-[#060b14] dark:text-slate-200">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur pt-[var(--safe-area-top,0px)] dark:border-slate-800 dark:bg-[#070d18]/95">
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
            />
            {filterOptions.failed ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Some filter options couldn't load. The dashboard still works without them.</p>
            ) : null}
          </div>
          <AnalyticsTabs tab={state.tab} onChange={(tab) => update({ tab })} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-[calc(1.5rem+var(--safe-area-bottom,0px))] sm:px-6 lg:px-8 dark:py-3">{body}</main>
    </div>
  );
}
