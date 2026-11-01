import { useEffect, useId, useRef } from "react";
import { supabase } from "../supabase/client";

/**
 * Keeps a page in sync without a refresh (web + Capacitor):
 * - light poll every intervalMs while the tab/app is visible (paused when hidden),
 * - immediate refetch on tab visible, window focus, back online and Capacitor app resume,
 * - fast path: a new in-app notification of `kind` for this user (app_notifications is in
 *   the supabase_realtime publication; the Needs and equipment tables are not, and their
 *   RLS would hide other people's rows anyway).
 * All triggers are debounced into one call. Everything is torn down on unmount.
 */
export function useLiveRefresh(refresh, { enabled = true, intervalMs = 12000, userId = null, debounceMs = 600, kind = "wishlist" } = {}) {
  const fnRef = useRef(refresh);
  const channelKey = useId();

  useEffect(() => {
    fnRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let debounce = null;
    let timer = null;
    let channel = null;
    let resumeHandle = null;

    const trigger = () => {
      if (disposed) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!disposed) void fnRef.current?.();
      }, debounceMs);
    };
    const startPoll = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        if (!document.hidden) trigger();
      }, Math.max(5000, intervalMs));
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        trigger();
        startPoll();
      }
    };

    if (!document.hidden) startPoll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);

    if (userId) {
      channel = supabase
        .channel(`${kind}-live-${userId}-${channelKey}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "app_notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            if (payload?.new?.kind === kind) trigger();
          }
        )
        .subscribe();
    }

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) trigger();
        });
        if (disposed) handle.remove();
        else resumeHandle = handle;
      } catch {
        // Not running in Capacitor: visibilitychange covers the browser.
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", trigger);
      window.removeEventListener("online", trigger);
      if (channel) supabase.removeChannel(channel);
      resumeHandle?.remove?.();
    };
  }, [enabled, intervalMs, userId, debounceMs, channelKey, kind]);
}
