import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../supabase/client";
import { CITY_HUB_READ_EVENT, isCityHubPath, readCityHubLastSeen } from "../utils/cityHubUnread";

/**
 * Published City Hub posts newer than this user's last visit.
 * City Hub is cross-neighborhood, so this is not scoped to the working area.
 */
export function useUnreadCityHubCount(enabled, userId) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const viewingHub = isCityHubPath(pathname);

  const fetchCount = useCallback(async () => {
    if (!enabled || !userId || viewingHub) {
      setCount(0);
      return;
    }
    try {
      const lastSeen = readCityHubLastSeen(userId);
      let query = supabase
        .from("city_hub_posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published");
      if (lastSeen) {
        query = query.gt("created_at", lastSeen);
      }
      const { count: n, error } = await query;
      if (error) throw error;
      setCount(typeof n === "number" ? n : 0);
    } catch {
      setCount(0);
    }
  }, [enabled, userId, viewingHub]);

  useEffect(() => {
    void fetchCount();
  }, [enabled, fetchCount, pathname]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;

    const channel = supabase
      .channel(`unread-city-hub-posts-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "city_hub_posts" },
        () => {
          void fetchCount();
        }
      )
      .subscribe();

    const onVis = () => {
      if (!document.hidden) void fetchCount();
    };
    const onRead = () => {
      void fetchCount();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(CITY_HUB_READ_EVENT, onRead);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(CITY_HUB_READ_EVENT, onRead);
    };
  }, [enabled, fetchCount, userId]);

  return viewingHub ? 0 : count;
}
