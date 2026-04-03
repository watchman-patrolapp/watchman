import * as Sentry from '@sentry/react';
import { registerSentryCapture } from '../chat/utils/chatTelemetry';

/**
 * Call once at app boot. Set VITE_SENTRY_DSN in .env to enable.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.08,
  });

  registerSentryCapture((error, context) => {
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: context?.extra,
    });
  });
}
