import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../supabase/client";
import { listWishlistOffers } from "../utils/equipmentWishlist";
import { useLiveRefresh } from "./useLiveRefresh";

/**
 * Count of Needs offers still "new" (not yet acknowledged) in the working org.
 * Managers only. Refreshes on route change, tab focus and on a new 'wishlist'
 * in-app notification for this user (offers RLS hides other residents' rows
 * from Realtime, so the notification row is the signal).
 */
export function useNewWishlistOffersCount(enabled, userId, orgId) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const { data, error } = await listWishlistOffers({ includeClosed: false });
    setCount(error ? 0 : (data || []).filter((o) => o.status === "new").length);
  }, [enabled]);

  useEffect(() => {
    void fetchCount();
  }, [fetchCount, pathname, orgId]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const channel = supabase
      .channel(`wishlist-new-offers-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload?.new?.kind === "wishlist") void fetchCount();
        }
      )
      .subscribe();
    const onVis = () => {
      if (!document.hidden) void fetchCount();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, userId, fetchCount]);

  useLiveRefresh(fetchCount, { enabled: Boolean(enabled), intervalMs: 15000 });

  return { count, refetch: fetchCount };
}
