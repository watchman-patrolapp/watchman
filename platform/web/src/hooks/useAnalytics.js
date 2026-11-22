import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { friendlyError } from "../utils/friendlyError";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";

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
    resultCache.delete(key);
    setTick((t) => t + 1);
  }, [key]);

  return { ...state, refetch };
}

/** Clears every cached analytics result (used by "Refresh"). */
export function clearAnalyticsCache() {
  resultCache.clear();
  optionsCache = null;
}

async function loadFilterOptions() {
  const [cities, suburbs, watches, orgSuburbs] = await Promise.all([
    supabase.from("cities").select("id, name").order("name"),
    supabase.from("suburbs").select("id, name, city_id").order("name"),
    supabase.from("organizations").select("id, name, status, city_id, primary_suburb_id").eq("type", "nw_group").order("name"),
    supabase.from("organization_suburbs").select("organization_id, suburb_id").eq("active", true),
  ]);
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
