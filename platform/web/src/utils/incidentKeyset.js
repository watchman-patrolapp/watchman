/** Approved incident pages. Keyset is (created_at, id), newest first. */
export const INCIDENT_PAGE_SIZE = 200;

export function quotePostgrestValue(value) {
  return `"${String(value ?? "").replace(/"/g, "")}"`;
}

/**
 * PostgREST `or` filter for the next page after a (created_at, id) cursor.
 * Values are double-quoted so timestamps with `+` offsets survive the URL.
 */
export function incidentKeysetOr(cursor) {
  if (!cursor?.created_at || !cursor?.id) return null;
  const ts = quotePostgrestValue(cursor.created_at);
  const id = quotePostgrestValue(cursor.id);
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`;
}
