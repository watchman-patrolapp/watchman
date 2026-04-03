/**
 * Debug logging — disabled by default so devtools stays quiet.
 * Set localStorage DEBUG=1 to enable.
 */
function debugEnabled() {
  try {
    return import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG') === '1';
  } catch {
    return false;
  }
}

export function devLog(...args) {
  if (debugEnabled()) console.log(...args);
}

export function devWarn(...args) {
  if (debugEnabled()) console.warn(...args);
}
