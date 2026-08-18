import { supabase } from "../supabase/client";
import { loadPublicSignupOptions } from "./signupOptions";

export const EMPTY_CITY_HUB_STATS = {
  neighborhoods: 0,
  activeAlerts: 0,
  sharedReports: 0,
};

function countOrZero(result) {
  if (result?.error) {
    console.warn("City Hub stat query failed:", result.error.message);
    return 0;
  }
  return Number(result?.count) || 0;
}

export async function loadCityHubBannerStats() {
  const [signup, alerts, reports] = await Promise.all([
    loadPublicSignupOptions().catch((err) => {
      console.warn("City Hub neighborhood count failed:", err?.message || err);
      return { areas: [] };
    }),
    supabase
      .from("city_hub_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .in("type", ["suspect_alert", "pattern"]),
    supabase
      .from("city_hub_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
  ]);

  return {
    neighborhoods: signup.areas?.length || 0,
    activeAlerts: countOrZero(alerts),
    sharedReports: countOrZero(reports),
  };
}
