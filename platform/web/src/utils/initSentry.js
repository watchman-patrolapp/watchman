import * as Sentry from '@sentry/react';
import { registerSentryCapture } from '../chat/utils/chatTelemetry';
import { scrubBreadcrumb, scrubEvent, scrubValue } from './sentryScrub';

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
    sendDefaultPii: false,
    // No session replay: do not add replayIntegration without an explicit opt-in consent gate.
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });

  registerSentryCapture((error, context) => {
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: scrubValue(context?.extra),
    });
  });
}
