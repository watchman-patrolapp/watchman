/**
 * Validates a return URL as an in-app path only (no protocol, no // open redirect).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function safeInternalReturnPath(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let path = raw.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('://') || path.includes('\\')) return null;
  return path;
}
