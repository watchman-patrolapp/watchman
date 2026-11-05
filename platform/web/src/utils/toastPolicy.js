/** Stable toast id + duration. Identical string messages share an id so they replace instead of stacking. */

const SUCCESS_MS = 2000;
const ERROR_MS = 8000;

export function toastIdentity(kind, message, options = {}) {
  const text = typeof message === "string" ? message.trim() : "";
  const id = options.id || (text ? `${kind}:${text.slice(0, 180)}` : undefined);
  let duration = options.duration;
  if (duration == null) {
    if (kind === "success") duration = SUCCESS_MS;
    else if (kind === "error") duration = ERROR_MS;
  }
  return { id, duration };
}
