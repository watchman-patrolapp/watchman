/**
 * Optional Sentry reporting for chat send/upload failures.
 * Set VITE_SENTRY_DSN in env; init runs from main.jsx via initChatSentry().
 */
let sentryCapture = null;

export function registerSentryCapture(fn) {
  sentryCapture = typeof fn === 'function' ? fn : null;
}

export function captureChatError(error, context = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[chat]', context?.operation || 'error', err, context);
  try {
    sentryCapture?.(err, { tags: { area: 'chat' }, extra: context });
  } catch {
    /* ignore */
  }
}
