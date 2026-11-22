/**
 * Reports the installed Android app version once per app session for the signed-in member
 * (report_app_version RPC, own row only). Feeds the version spread on the analytics dashboard.
 * Never throws and never shows anything: web, PWA, offline, an old database or any error are ignored.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabase/client";
import { appVersionReportPayload } from "./appUpdate";

const reportedThisSession = new Set();

export async function reportAppVersionOnce(userId) {
  if (!userId || reportedThisSession.has(userId)) return;
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    // Marked before the call so a slow network never sends it twice in one session.
    reportedThisSession.add(userId);
    const { App } = await import("@capacitor/app");
    const payload = appVersionReportPayload(await App.getInfo(), "android");
    if (!payload) return;
    await supabase.rpc("report_app_version", payload);
  } catch {
    /* fail silently: the next app start tries again */
  }
}
