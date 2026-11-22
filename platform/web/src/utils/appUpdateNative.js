/**
 * Thin, failure-proof wrappers around Capacitor + @capawesome/capacitor-app-update.
 * Every call resolves (null / false on any error); nothing here throws to the UI.
 */
import { Capacitor } from "@capacitor/core";
import { appUpdateMode } from "./appUpdate";

let pluginPromise = null;
function loadPlugin() {
  if (!pluginPromise) {
    pluginPromise = import("@capawesome/capacitor-app-update").catch((e) => {
      pluginPromise = null;
      throw e;
    });
  }
  return pluginPromise;
}

export function currentAppUpdateMode() {
  try {
    return appUpdateMode({
      isNative: Capacitor.isNativePlatform(),
      platform: Capacitor.getPlatform(),
      isDev: Boolean(import.meta.env.DEV),
    });
  } catch {
    return "off";
  }
}

/** Installed Android versionCode (App.getInfo().build), or null. */
export async function getInstalledVersionCode() {
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return info?.build ?? null;
  } catch (e) {
    console.warn("App update: version lookup failed", e?.message || e);
    return null;
  }
}

export async function getPlayUpdateInfo() {
  try {
    const { AppUpdate } = await loadPlugin();
    return await AppUpdate.getAppUpdateInfo();
  } catch (e) {
    // Normal for builds not installed from Play (sideloaded / debug).
    console.warn("App update: Play check unavailable", e?.message || e);
    return null;
  }
}

/** Result code from the plugin (0 = OK), or null on error. */
export async function startFlexibleUpdate() {
  try {
    const { AppUpdate } = await loadPlugin();
    const result = await AppUpdate.startFlexibleUpdate();
    return result?.code ?? 0;
  } catch (e) {
    console.warn("App update: flexible update failed", e?.message || e);
    return null;
  }
}

export async function completeFlexibleUpdate() {
  try {
    const { AppUpdate } = await loadPlugin();
    await AppUpdate.completeFlexibleUpdate();
    return true;
  } catch (e) {
    console.warn("App update: restart failed", e?.message || e);
    return false;
  }
}

export async function performImmediateUpdate() {
  try {
    const { AppUpdate } = await loadPlugin();
    const result = await AppUpdate.performImmediateUpdate();
    return result?.code ?? 0;
  } catch (e) {
    console.warn("App update: immediate update failed", e?.message || e);
    return null;
  }
}

export async function openPlayStoreListing() {
  try {
    const { AppUpdate } = await loadPlugin();
    await AppUpdate.openAppStore();
    return true;
  } catch (e) {
    console.warn("App update: could not open Play Store", e?.message || e);
    return false;
  }
}

/** Calls back with the install status (11 = downloaded). Returns an unsubscribe function. */
export async function onFlexibleUpdateState(callback) {
  try {
    const { AppUpdate } = await loadPlugin();
    const handle = await AppUpdate.addListener("onFlexibleUpdateStateChange", (state) => {
      callback(state?.installStatus);
    });
    return () => {
      void handle?.remove?.();
    };
  } catch {
    return () => {};
  }
}

/** Calls back when the app returns to the foreground. Returns an unsubscribe function. */
export async function onAppResume(callback) {
  try {
    const { App } = await import("@capacitor/app");
    const handle = await App.addListener("resume", callback);
    return () => {
      void handle?.remove?.();
    };
  } catch {
    return () => {};
  }
}
