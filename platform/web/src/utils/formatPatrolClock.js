import { formatDistanceToNow } from 'date-fns';

function parseValidDate(isoOrDate) {
  if (isoOrDate == null) return null;
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** e.g. "SAST", "GMT+2" — viewer browser locale/TZ */
export function shortTimeZoneName(d) {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(d)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

function sameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Live map: last GPS — viewer local wall time + TZ + relative age.
 * Pass `displayTime` (e.g. server `created_at`) when the row `timestamp` may be device-skewed.
 */
export function formatLastGpsForMap(isoOrDate) {
  const d = parseValidDate(isoOrDate);
  if (!d) {
    return { primary: '—', secondary: '', title: '' };
  }
  const tz = shortTimeZoneName(d);
  const now = new Date();
  const today = sameCalendarDay(d, now);
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const primary = today
    ? `${time}${tz ? ` ${tz}` : ''}`
    : `${d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })} ${time}${tz ? ` ${tz}` : ''}`;
  const secondary = formatDistanceToNow(d, { addSuffix: true });
  const title = `UTC: ${d.toISOString()}`;
  return { primary, secondary, title };
}
