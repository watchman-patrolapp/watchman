/**
 * Marks "opened the app today" for the signed-in member (touch_activity RPC, own row only).
 * At most one call per member per South African day per session; also re-checks when the app
 * comes back to the foreground on a new day. Never throws and never shows anything.
 * Feeds the active-member and retention figures on the analytics dashboard.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabase/client";

const touched = new Map(); // userId -> "YYYY-MM-DD"

/** Today's date in South Africa as YYYY-MM-DD. */
export function activityDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function platformName() {
  try {
    const p = Capacitor.getPlatform();
    return p === "android" || p === "ios" ? p : "web";
  } catch {
    return "web";
  }
}

export async function touchActivityOnce(userId) {
  if (!userId) return;
  const day = activityDay();
  if (touched.get(userId) === day) return;
  // Marked before the call so a slow network never sends it twice.
  touched.set(userId, day);
  try {
    await supabase.rpc("touch_activity", { p_platform: platformName() });
  } catch {
    /* fail silently: an old database, offline or any error is ignored */
  }
}
