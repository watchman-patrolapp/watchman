/**
 * In-app updates (Android, Google Play): pure decision helpers, unit-tested.
 * No React, no Capacitor, no Supabase here.
 */

export const FLEXIBLE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FORCED_CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const FLEXIBLE_LAST_CHECK_KEY = "wm-app-update-last-check";

// Mirrors @capawesome/capacitor-app-update enums (kept here so tests need no plugin).
export const UPDATE_AVAILABLE = 2;
export const UPDATE_IN_PROGRESS = 3;
export const INSTALL_STATUS_DOWNLOADED = 11;
export const INSTALL_STATUS_FAILED = 5;
export const INSTALL_STATUS_CANCELED = 6;

/** A positive integer versionCode, or null. Accepts numbers and numeric strings. */
export function parseVersionCode(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** -1, 0 or 1. Unparseable values compare as null and return null. */
export function compareVersionCodes(a, b) {
  const x = parseVersionCode(a);
  const y = parseVersionCode(b);
  if (x == null || y == null) return null;
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Updates only run in the installed Android app, never on web/PWA or dev builds. */
export function appUpdateMode({ isNative, platform, isDev }) {
  return isNative && platform === "android" && !isDev ? "android" : "off";
}

/**
 * Forced update when the installed versionCode is below the server minimum.
 * Fails open: missing config, 0, bad numbers or an unknown installed version never block.
 */
export function forcedUpdateDecision({ installedVersionCode, config }) {
  const min = parseVersionCode(config?.min_supported_version_code);
  const installed = parseVersionCode(installedVersionCode);
  if (min == null || installed == null) return { blocked: false, message: null };
  if (installed >= min) return { blocked: false, message: null };
  const message =
    typeof config?.update_message === "string" && config.update_message.trim()
      ? config.update_message.trim().slice(0, 300)
      : null;
  return { blocked: true, message };
}

/** Throttle Play checks (default once a day). Bad or future timestamps allow a check. */
export function shouldRunCheck(lastCheckMs, nowMs, intervalMs = FLEXIBLE_CHECK_INTERVAL_MS) {
  const last = Number(lastCheckMs);
  if (!Number.isFinite(last) || last <= 0 || last > nowMs) return true;
  return nowMs - last >= intervalMs;
}

/** What the flexible banner should show for a Play AppUpdateInfo. */
export function flexibleUpdateOffer(info) {
  if (!info || typeof info !== "object") return "none";
  if (info.installStatus === INSTALL_STATUS_DOWNLOADED) return "restart";
  if (info.updateAvailability !== UPDATE_AVAILABLE) return "none";
  if (info.flexibleUpdateAllowed === false) return "none";
  const cmp = compareVersionCodes(info.availableVersionCode, info.currentVersionCode);
  if (cmp != null && cmp <= 0) return "none";
  return "available";
}

/** Immediate (blocking) Play update is possible right now. */
export function canPerformImmediateUpdate(info) {
  if (!info || typeof info !== "object") return false;
  if (info.immediateUpdateAllowed === false) return false;
  return info.updateAvailability === UPDATE_AVAILABLE || info.updateAvailability === UPDATE_IN_PROGRESS;
}
