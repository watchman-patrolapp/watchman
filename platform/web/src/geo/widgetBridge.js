import { registerPlugin } from '@capacitor/core';
import { isAndroidNativePlatform } from './carSessionSync.js';

/**
 * JS side of the Android home-screen widgets (Watchman Patrol, Watchman Neighbourhood).
 * Android native only: every function is a no-op elsewhere, never rejects, and never shows or
 * logs more than a console.debug code. Nothing here touches tokens.
 */

let cachedPlugin = null;

function defaultPlugin() {
  if (!cachedPlugin) cachedPlugin = registerPlugin('WatchmanPatrol');
  return cachedPlugin;
}

/** Widget deep-link routes (za.co.africuz.watchman://widget/<route>). */
export const WIDGET_ROUTES = Object.freeze({
  'start-patrol': { path: '/dashboard', action: 'start-patrol' },
  'end-patrol': { path: '/dashboard', action: 'end-patrol' },
  'quick-report': { path: '/incident/new', action: null },
  'resident-report': { path: '/resident/activity/new', action: null },
  sos: { path: '/resident/sos', action: null },
  alerts: { path: '/sos', action: null },
  'sign-in': { path: '/login', action: null },
  open: { path: null, action: null },
});

/** First token of a full name; never an email. */
export function firstNameOf(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first.includes('@') ? '' : first;
}

/** Argument object for WatchmanPatrol.syncWidgetProfile. */
export function buildWidgetProfilePayload({ user, canPatrol, orgName }) {
  if (!user?.id) return null;
  const payload = {
    userId: user.id,
    firstName: firstNameOf(user.fullName),
    canPatrol: Boolean(canPatrol),
  };
  const org = String(orgName || '').trim();
  if (org) payload.orgName = org;
  return payload;
}

/** Redraws the widgets and fetches fresh data. Safe to call often; it never rejects. */
export async function refreshWidgets(deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return 'skipped';
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    await plugin.refreshWidgets();
    return 'refreshed';
  } catch (err) {
    console.debug('widgetBridge refresh:', err);
    return 'failed';
  }
}

export async function syncWidgetProfile(payload, deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative || !payload) return 'skipped';
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    await plugin.syncWidgetProfile(payload);
    return 'synced';
  } catch (err) {
    console.debug('widgetBridge profile:', err);
    return 'failed';
  }
}

/** Resolves to the pending widget route name (and clears it), or null. Never rejects. */
export async function consumeWidgetLink(deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return null;
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    const result = await plugin.consumeWidgetLink();
    const route = typeof result?.path === 'string' ? result.path : null;
    return route && Object.prototype.hasOwnProperty.call(WIDGET_ROUTES, route) ? route : null;
  } catch (err) {
    console.debug('widgetBridge link:', err);
    return null;
  }
}

/** Calls handler() whenever a widget link arrives while the WebView is alive. Returns cleanup. */
export function listenForWidgetLinks(handler, deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return () => {};
  let removed = false;
  let handle = null;
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    Promise.resolve(plugin.addListener('widgetLink', () => handler()))
      .then((added) => {
        handle = { remove: () => added?.remove?.() };
        if (removed) handle.remove();
      })
      .catch((err) => console.debug('widgetBridge listen:', err));
  } catch (err) {
    console.debug('widgetBridge listen:', err);
  }
  return () => {
    removed = true;
    try {
      handle?.remove();
    } catch {
      // Already gone.
    }
  };
}
