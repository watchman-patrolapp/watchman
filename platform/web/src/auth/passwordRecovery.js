/**
 * Password-recovery hand-off.
 *
 * supabase-js can consume the recovery hash/query and fire PASSWORD_RECOVERY
 * during client init, before Login or UpdatePassword mount. This module records
 * that in sessionStorage as soon as the client is created, so those pages can
 * still show or route to the new-password form.
 */

export const PASSWORD_RECOVERY_FLAG_KEY = 'watchman:passwordRecovery';

const AUTH_CALLBACK_KEYS = ['code', 'access_token', 'refresh_token', 'type', 'token_hash', 'error'];

function safeHref(href) {
  if (typeof href === 'string' && href) return href;
  if (typeof window !== 'undefined' && window.location?.href) return window.location.href;
  return '';
}

/** Parse search and hash params from an absolute URL or a path + search + hash. */
export function parseAuthUrlParts(href) {
  const raw = typeof href === 'string' ? href : '';
  if (!raw) {
    return {
      pathname: '',
      searchParams: new URLSearchParams(),
      hashParams: new URLSearchParams(),
    };
  }
  try {
    const url = new URL(raw, 'https://watchman.invalid');
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    return {
      pathname: url.pathname,
      searchParams: url.searchParams,
      hashParams: new URLSearchParams(hash),
    };
  } catch {
    return {
      pathname: '',
      searchParams: new URLSearchParams(),
      hashParams: new URLSearchParams(),
    };
  }
}

function paramsHaveTypeRecovery(searchParams, hashParams) {
  return searchParams.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
}

export function urlHasRecoveryType(href) {
  const { searchParams, hashParams } = parseAuthUrlParts(safeHref(href));
  return paramsHaveTypeRecovery(searchParams, hashParams);
}

export function urlHasPkceCode(href) {
  const { searchParams, hashParams } = parseAuthUrlParts(safeHref(href));
  return Boolean(searchParams.get('code') || hashParams.get('code'));
}

/** Tokens or a PKCE code still in the URL (recovery, signup, or a failed callback). */
export function urlHasAuthCallbackParams(href) {
  const { searchParams, hashParams } = parseAuthUrlParts(safeHref(href));
  return AUTH_CALLBACK_KEYS.some((key) => searchParams.get(key) || hashParams.get(key));
}

/**
 * URL itself says this is a recovery callback.
 * Bare ?code= is not enough — signup confirmation also uses PKCE and may land on /login.
 */
export function urlIndicatesPasswordRecovery(href) {
  return urlHasRecoveryType(href);
}

export function getPasswordRecoveryStorage() {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    /* private mode or blocked storage */
  }
  return null;
}

export function markPasswordRecovery(storage = getPasswordRecoveryStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(PASSWORD_RECOVERY_FLAG_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function clearPasswordRecovery(storage = getPasswordRecoveryStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(PASSWORD_RECOVERY_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasPasswordRecoveryFlag(storage = getPasswordRecoveryStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(PASSWORD_RECOVERY_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function capturePasswordRecoveryFromLocation(
  href = safeHref(),
  storage = getPasswordRecoveryStorage(),
) {
  if (urlHasRecoveryType(href)) {
    markPasswordRecovery(storage);
    return true;
  }
  return false;
}

export function isPasswordRecoveryPending(
  href = safeHref(),
  storage = getPasswordRecoveryStorage(),
) {
  return hasPasswordRecoveryFlag(storage) || urlHasRecoveryType(href);
}

/** Login (and similar auth routes) should leave for the new-password form. */
export function loginShouldRedirectToUpdatePassword(
  href = safeHref(),
  storage = getPasswordRecoveryStorage(),
) {
  return isPasswordRecoveryPending(href, storage);
}

/**
 * Show the choose-new-password form. ?code= counts only here because
 * redirectTo is /update-password; it must not be used on /login (signup).
 */
export function updatePasswordFormIsReady(
  href = safeHref(),
  { flag, eventFired } = {},
  storage = getPasswordRecoveryStorage(),
) {
  const pending = flag ?? hasPasswordRecoveryFlag(storage);
  return Boolean(pending || eventFired || urlHasRecoveryType(href) || urlHasPkceCode(href));
}

/**
 * Where `/` should send the browser.
 * 'wait' = auth callback params without a recovery type yet (PKCE may still fire PASSWORD_RECOVERY).
 */
export function rootRedirectTarget(
  href = safeHref(),
  { flag } = {},
  storage = getPasswordRecoveryStorage(),
) {
  const pending = flag ?? hasPasswordRecoveryFlag(storage);
  if (pending || urlHasRecoveryType(href)) return 'update-password';
  if (urlHasAuthCallbackParams(href)) return 'wait';
  return 'dashboard';
}

export function updatePasswordLocation(href = safeHref()) {
  const raw = safeHref(href);
  try {
    const url = new URL(raw, 'https://watchman.invalid');
    return { pathname: '/update-password', search: url.search, hash: url.hash };
  } catch {
    return { pathname: '/update-password', search: '', hash: '' };
  }
}

/**
 * Subscribe immediately after createClient so PASSWORD_RECOVERY is not missed.
 * Also stamps the flag when the current URL already has type=recovery.
 * SIGNED_OUT clears the flag.
 */
export function installPasswordRecoveryListener(
  auth,
  { storage = getPasswordRecoveryStorage(), href = safeHref() } = {},
) {
  capturePasswordRecoveryFromLocation(href, storage);
  if (!auth?.onAuthStateChange) return () => {};
  const { data } = auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') markPasswordRecovery(storage);
    if (event === 'SIGNED_OUT') clearPasswordRecovery(storage);
  });
  const subscription = data?.subscription;
  return () => subscription?.unsubscribe?.();
}
