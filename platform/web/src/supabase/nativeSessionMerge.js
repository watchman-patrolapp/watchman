/**
 * Adopts tokens the Android Auto process refreshed. The phone and the car share one single-use
 * refresh token, so whichever refreshed last holds the only valid one.
 *
 * Returns a new session JSON string, or null when the stored session should be left alone:
 * unreadable JSON, a different user, or a native session that is not newer.
 * Never log either argument: they contain tokens.
 */
export function mergeNativeSession(storedJson, native, nowSec = Math.floor(Date.now() / 1000)) {
  if (!native || !native.accessToken || !native.refreshToken || !native.userId) return null;
  let stored;
  try {
    stored = JSON.parse(storedJson);
  } catch {
    return null;
  }
  if (!stored || typeof stored !== 'object' || stored.user?.id !== native.userId) return null;

  const nativeExpiresAt = Number(native.expiresAt) || 0;
  const storedExpiresAt = Number(stored.expires_at) || 0;
  if (nativeExpiresAt <= storedExpiresAt) return null;

  return JSON.stringify({
    ...stored,
    access_token: native.accessToken,
    refresh_token: native.refreshToken,
    expires_at: nativeExpiresAt,
    expires_in: Math.max(0, nativeExpiresAt - nowSec),
  });
}
