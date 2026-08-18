import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

function resetWindowScroll() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const root = document.getElementById("root");
  if (root) root.scrollTop = 0;
}

/**
 * SPA navigations keep the previous window scroll (dashboard mid-page → hotspots/intel/admin).
 * Maps and late layout (Leaflet focus, images) can also jump the viewport after the first paint.
 * Reset to the top on every route change, then again as the new page settles.
 */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    if (hash) return;
    resetWindowScroll();
  }, [pathname, search, hash]);

  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "auto" });
        return undefined;
      }
    }

    resetWindowScroll();
    const frame = requestAnimationFrame(resetWindowScroll);
    const timers = [50, 150, 400].map((ms) => window.setTimeout(resetWindowScroll, ms));
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [pathname, search, hash]);

  return null;
}
