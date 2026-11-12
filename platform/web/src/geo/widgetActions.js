/**
 * One-shot hand-off from the widget deep-link host to the Dashboard. A widget "Start patrol" or
 * "End patrol" tap lands on /dashboard with an action here; the Dashboard runs the existing
 * handleCheckIn / handleCheckOut once (so the vehicle picker and permission disclosures still
 * appear) and clears it, so a later resume can never start or end a patrol again.
 */

const VALID = new Set(['start-patrol', 'end-patrol']);
const MAX_AGE_MS = 2 * 60 * 1000;

let pending = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

/** For useSyncExternalStore: lets a mounted Dashboard react to a new widget action. */
export function subscribeWidgetAction(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPendingWidgetAction(action, now = Date.now()) {
  pending = VALID.has(action) ? { action, at: now } : null;
  notify();
}

/** Returns the pending action without clearing it, or null (also null once it is stale). */
export function peekWidgetAction(now = Date.now()) {
  if (!pending) return null;
  if (now - pending.at > MAX_AGE_MS) {
    pending = null;
    return null;
  }
  return pending.action;
}

/** Returns and clears the pending action. */
export function takeWidgetAction(now = Date.now()) {
  const action = peekWidgetAction(now);
  pending = null;
  if (action) notify();
  return action;
}
