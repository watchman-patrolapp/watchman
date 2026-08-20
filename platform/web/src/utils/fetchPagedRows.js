/**
 * PostgREST / Supabase caps a single select at 1000 rows (max_rows).
 * Repeat the query with range() until the page is short or maxRows is hit.
 */
export async function fetchAllQueryPages(makeQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  const out = [];
  let from = 0;
  while (from < maxRows) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
