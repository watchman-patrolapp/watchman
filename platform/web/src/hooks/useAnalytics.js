import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { friendlyError } from "../utils/friendlyError";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { cityIdsInUse } from "../utils/analyticsView";

const CACHE_MS = 5 * 60 * 1000;
const resultCache = new Map(); // JSON(args) -> { at, value }
let optionsCache = null; // { at, value }

export const ANALYTICS_NOT_READY_MESSAGE =
  "The analytics database update hasn't been applied yet. Once it has been run, refresh this page.";

/** Friendly, non-technical description of an analytics load error. */
export function analyticsErrorInfo(error) {
  if (isRpcNotFoundError(error)) return { notReady: true, message: ANALYTICS_NOT_READY_MESSAGE };
  return { notReady: false, message: friendlyError(error, "Couldn't load analytics. Please try again.") };
}

/**
 * Loads analytics_overview and analytics_watch_table for one set of RPC args.
 * Results are cached for 5 minutes per argument set; stale data stays on screen while reloading.
 */
export function useAnalytics(args, { enabled = true } = {}) {
  const key = JSON.stringify(args || {});
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ status: "loading", data: null, error: null, loadedAt: null });

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, status: "idle", error: null }));
      return undefined;
    }
    const hit = resultCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setState({ status: "ready", data: hit.value, error: null, loadedAt: hit.at });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ status: "loading", data: prev.data, error: null, loadedAt: prev.loadedAt }));
    (async () => {
      try {
        const params = JSON.parse(key);
        const [overview, watches] = await Promise.all([
          supabase.rpc("analytics_overview", params),
          supabase.rpc("analytics_watch_table", params),
        ]);
        const error = overview.error || watches.error;
        if (error) throw error;
        const value = { overview: overview.data || null, watches: Array.isArray(watches.data) ? watches.data : [] };
        const at = Date.now();
        resultCache.set(key, { at, value });
        if (!cancelled) setState({ status: "ready", data: value, error: null, loadedAt: at });
      } catch (err) {
        if (cancelled) return;
        console.warn("Analytics load failed", err?.code || "");
        setState({ status: "error", data: null, error: analyticsErrorInfo(err), loadedAt: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, enabled, tick]);

  const refetch = useCallback(() => {
    // Refresh reloads the whole dashboard, including the section RPCs for these filters.
    resultCache.clear();
    setTick((t) => t + 1);
  }, []);

  return { ...state, refetch, refreshKey: tick };
}

export const ANALYTICS_SECTION_NOT_READY_MESSAGE =
  "This section needs the latest analytics database update. Once it has been run, refresh this page.";

/**
 * Loads one phase 3 section RPC (analytics_patrols, analytics_safety, ...) with the same
 * arguments and 5-minute cache as useAnalytics. `refreshKey` changes force a reload.
 */
export function useAnalyticsSection(rpc, args, { enabled = true, refreshKey = 0 } = {}) {
  const key = `${rpc}:${JSON.stringify(args || {})}`;
  const [state, setState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    if (!enabled || !rpc) {
      setState({ status: "idle", data: null, error: null });
      return undefined;
    }
    const hit = resultCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setState({ status: "ready", data: hit.value, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ status: "loading", data: prev.data, error: null }));
    (async () => {
      try {
        const { data, error } = await supabase.rpc(rpc, JSON.parse(key.slice(rpc.length + 1)));
        if (error) throw error;
        resultCache.set(key, { at: Date.now(), value: data || null });
        if (!cancelled) setState({ status: "ready", data: data || null, error: null });
      } catch (err) {
        if (cancelled) return;
        console.warn("Analytics section load failed", rpc, err?.code || "");
        const info = analyticsErrorInfo(err);
        setState({
          status: "error",
          data: null,
          error: info.notReady ? { notReady: true, message: ANALYTICS_SECTION_NOT_READY_MESSAGE } : info,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, rpc, enabled, refreshKey]);

  return state;
}

/** Clears every cached analytics result (used by "Refresh"). */
export function clearAnalyticsCache() {
  resultCache.clear();
  optionsCache = null;
}

const CITY_ID_BATCH = 100;

/** Only the cities that have a suburb or a watch (the table lists every South African town). */
async function loadCitiesInUse(ids) {
  if (!ids.length) return { data: [], error: null };
  const batches = [];
  for (let i = 0; i < ids.length; i += CITY_ID_BATCH) batches.push(ids.slice(i, i + CITY_ID_BATCH));
  const results = await Promise.all(batches.map((batch) => supabase.from("cities").select("id, name").in("id", batch)));
  const failed = results.find((r) => r.error);
  if (failed) return { data: null, error: failed.error };
  const data = results.flatMap((r) => r.data || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { data, error: null };
}

async function loadFilterOptions() {
  const [suburbs, watches, orgSuburbs] = await Promise.all([
    supabase.from("suburbs").select("id, name, city_id").order("name"),
    supabase.from("organizations").select("id, name, status, city_id, primary_suburb_id").eq("type", "nw_group").order("name"),
    supabase.from("organization_suburbs").select("organization_id, suburb_id").eq("active", true),
  ]);
  const cities = await loadCitiesInUse(
    cityIdsInUse({ suburbs: suburbs.error ? [] : suburbs.data || [], watches: watches.error ? [] : watches.data || [] })
  );
  return {
    cities: cities.error ? [] : cities.data || [],
    suburbs: suburbs.error ? [] : suburbs.data || [],
    watches: watches.error ? [] : watches.data || [],
    // Optional: only narrows the Watch picker; the server applies the real filter.
    orgSuburbs: orgSuburbs.error ? [] : orgSuburbs.data || [],
    failed: Boolean(cities.error || suburbs.error || watches.error),
  };
}

/** City, suburb and watch options for the filter pickers (global staff can see all). */
export function useAnalyticsFilterOptions() {
  const [state, setState] = useState(() =>
    optionsCache ? { loading: false, ...optionsCache.value } : { loading: true, cities: [], suburbs: [], watches: [], orgSuburbs: [], failed: false }
  );
  useEffect(() => {
    if (optionsCache && Date.now() - optionsCache.at < CACHE_MS) {
      setState({ loading: false, ...optionsCache.value });
      return undefined;
    }
    let cancelled = false;
    loadFilterOptions()
      .then((value) => {
        if (!value.failed) optionsCache = { at: Date.now(), value };
        if (!cancelled) setState({ loading: false, ...value });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, cities: [], suburbs: [], watches: [], orgSuburbs: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
