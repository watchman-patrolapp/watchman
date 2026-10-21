/** One reload per short window so a stale lazy chunk cannot refresh forever. */
const STORAGE_KEY = "watchman:chunk-reload-at";
const RELOAD_WINDOW_MS = 60_000;
let reloadStarted = false;

const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /mime type of ["']text\/html["']/i,
  /expected a javascript-or-wasm module script/i,
];

export function isChunkLoadError(error) {
  const name = String(error?.name || "");
  if (name === "ChunkLoadError") return true;
  const message = String(error?.message || error || "");
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Reload once. A timestamp in sessionStorage blocks a second reload in the
 * same tab until the window passes, including when sessionStorage is shared
 * across the reload. Returns false when a reload must not start.
 */
export function reloadOnceForChunkError() {
  if (reloadStarted) return true;
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const last = raw ? Number(raw) : 0;
    const now = Date.now();
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  reloadStarted = true;
  window.location.reload();
  return true;
}

/** Vite emits this when a preload of a lazy chunk fails. No Capacitor APIs. */
export function installChunkLoadRecovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForChunkError();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    reloadOnceForChunkError();
  });
}
