/**
 * Base URL for Supabase auth email links (reset password, etc.).
 * Set VITE_AUTH_REDIRECT_ORIGIN in production if the app URL differs from window.location.origin
 * (e.g. some Capacitor / proxy setups). No trailing slash.
 */
export function getAuthRedirectOrigin() {
  if (typeof window === 'undefined') return '';
  const env = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN;
  if (env && typeof env === 'string') return env.replace(/\/$/, '');
  return window.location.origin;
}
