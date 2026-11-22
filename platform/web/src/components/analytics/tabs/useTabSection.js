import { useEffect } from "react";
import { useAnalyticsSection } from "../../../hooks/useAnalytics";

/** Loads a tab's section RPC and hands the result to the page (for CSV export). */
export function useTabSection(rpc, args, refreshKey, onSection) {
  const state = useAnalyticsSection(rpc, args, { refreshKey });
  useEffect(() => {
    onSection?.(state.status === "ready" ? state.data : null);
  }, [state.status, state.data, onSection]);
  return state;
}
