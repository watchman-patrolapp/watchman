import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Hands the phone's Supabase session to the native WatchmanPatrol plugin so the Android Auto
 * screen can tell who is signed in even when the WebView is not running.
 *
 * Android native only. Failures are swallowed (console.debug); the patroller never sees them.
 * Never log the session or the payload: they contain tokens.
 */

let cachedPlugin = null;

function defaultPlugin() {
  if (!cachedPlugin) cachedPlugin = registerPlugin('WatchmanPatrol');
  return cachedPlugin;
}

function readViteEnv(name) {
  try {
    return import.meta.env?.[name];
  } catch {
    return undefined;
  }
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function isAndroidNativePlatform(capacitor = Capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.()) && capacitor.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

/**
 * Maps a Supabase session to the argument object of WatchmanPatrol.syncSession.
 * Returns null when there is no access token or user id.
 */
export function buildCarSessionPayload(session, env = {}) {
  const accessToken = session?.access_token;
  const userId = session?.user?.id;
  if (!accessToken || !userId) return null;

  const metadata = session.user.user_metadata || {};
  return {
    accessToken,
    refreshToken: session.refresh_token || '',
    expiresAt: Number(session.expires_at) || 0,
    userId,
    supabaseUrl: env?.supabaseUrl || '',
    anonKey: env?.anonKey || '',
    email: firstNonBlank(session.user.email),
    userName: firstNonBlank(metadata.full_name, metadata.name),
    organizationId: firstNonBlank(metadata.organization_id),
  };
}

/**
 * Called from AuthProvider on every auth event (and the native fallback / resume paths).
 * Resolves to 'skipped' | 'synced' | 'cleared' | 'failed'. It never rejects.
 */
export async function syncCarSessionFromAuth(event, session, deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return 'skipped';

  try {
    const plugin = deps.plugin ?? defaultPlugin();

    const payload =
      event === 'SIGNED_OUT'
        ? null
        : buildCarSessionPayload(session, {
            supabaseUrl: deps.supabaseUrl ?? readViteEnv('VITE_SUPABASE_URL'),
            anonKey: deps.anonKey ?? readViteEnv('VITE_SUPABASE_ANON_KEY'),
          });

    if (!payload) {
      await plugin.clearSession();
      return 'cleared';
    }

    await plugin.syncSession(payload);
    return 'synced';
  } catch (err) {
    console.debug('carSessionSync:', err);
    return 'failed';
  }
}

/**
 * Asks the native side for tokens the car refreshed on its own (the car and the phone share one
 * single-use refresh token, so the WebView must adopt the newer pair). Resolves to a plain
 * { accessToken, refreshToken, expiresAt, userId } or null; never rejects, never returns the
 * plugin proxy, and gives up after `timeoutMs`. Never log the result: it contains tokens.
 */
export async function readNativeSession(deps = {}) {
  const isAndroidNative = deps.isAndroidNative ?? isAndroidNativePlatform();
  if (!isAndroidNative) return null;

  let timer = 0;
  try {
    const plugin = deps.plugin ?? defaultPlugin();
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), deps.timeoutMs ?? 1500);
    });
    const result = await Promise.race([plugin.readNativeSession(), timeout]);
    if (!result?.present) return null;
    return {
      accessToken: String(result.accessToken || ''),
      refreshToken: String(result.refreshToken || ''),
      expiresAt: Number(result.expiresAt) || 0,
      userId: String(result.userId || ''),
    };
  } catch (err) {
    console.debug('readNativeSession:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
