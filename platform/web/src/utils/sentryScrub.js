// Privacy scrubbing for Sentry events (POPIA). No imports so it can be unit-tested with node --test.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<![\w-])(?:\+\d{1,3}[\s-]?)?\(?0?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}(?![\w-])/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;
const TOKEN_RE = /(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const SENSITIVE_KEY_RE = /^(e-?mail|phone|phone_?number|mobile|lat|lng|lon|latitude|longitude|coords?|coordinates|location|token|password|authorization|cookie|api_?key|access_token|refresh_token|text|content|body)$/i;

export function scrubString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(TOKEN_RE, '[token]')
    .replace(EMAIL_RE, '[email]')
    .replace(COORD_RE, '[coords]')
    .replace(PHONE_RE, '[phone]');
}

export function stripQuery(url) {
  if (typeof url !== 'string') return url;
  return url.split('?')[0];
}

export function scrubValue(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(item => scrubValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = scrubValue(value[key], depth + 1);
      }
    }
    return result;
  }
  return value;
}

export function scrubEvent(event) {
  if (!event) return event;

  if (event.user) {
    event.user = { id: event.user.id };
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    event.request.query_string = undefined;
    event.request.url = stripQuery(event.request.url);
  }

  if (event.message) {
    event.message = scrubString(event.message);
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(value => {
      value.value = scrubString(value.value);
      return value;
    });
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra);
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts);
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  }

  return event;
}

export function scrubBreadcrumb(crumb) {
  if (!crumb) return crumb;
  if (crumb.category === 'console') return null;
  if (crumb.data) {
    if (crumb.data.url) {
      crumb.data.url = stripQuery(crumb.data.url);
    }
    crumb.data = scrubValue(crumb.data);
  }
  if (crumb.message) {
    crumb.message = scrubString(crumb.message);
  }
  return crumb;
}
