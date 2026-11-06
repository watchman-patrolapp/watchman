/** Approved incident pages. Keyset is (submitted_at, id), newest first. incidents has no created_at column. */
export const INCIDENT_PAGE_SIZE = 200;

export function quotePostgrestValue(value) {
  return `"${String(value ?? "").replace(/"/g, "")}"`;
}

/**
 * PostgREST `or` filter for the next page after a (submitted_at, id) cursor.
 * Values are double-quoted so timestamps with `+` offsets survive the URL.
 */
export function incidentKeysetOr(cursor) {
  if (!cursor?.submitted_at || !cursor?.id) return null;
  const ts = quotePostgrestValue(cursor.submitted_at);
  const id = quotePostgrestValue(cursor.id);
  return `submitted_at.lt.${ts},and(submitted_at.eq.${ts},id.lt.${id})`;
}
