/** PostgREST encodes `.in()` filters in the URL. Large id lists fail or stall the main thread. */

const DEFAULT_CHUNK = 150;

export function chunkIds(ids, size = DEFAULT_CHUNK) {
  const chunkSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_CHUNK;
  const seen = new Set();
  const unique = [];
  for (const id of ids || []) {
    if (id == null || id === "") continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }
  const chunks = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  return chunks;
}

function asError(error) {
  if (error instanceof Error) return error;
  const wrapped = new Error(error?.message || "Request failed");
  if (error && typeof error === "object") {
    if (error.code != null) wrapped.code = error.code;
    if (error.details != null) wrapped.details = error.details;
    if (error.hint != null) wrapped.hint = error.hint;
    if (error.status != null) wrapped.status = error.status;
  }
  return wrapped;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Run `makeQuery(chunk)` for each id chunk. `makeQuery` must return a Supabase
 * builder result `{ data, error }`. Rows are concatenated in chunk order.
 * Throws on the first error.
 */
export async function fetchInChunks(ids, makeQuery, { size = DEFAULT_CHUNK, concurrency = 4 } = {}) {
  const chunks = chunkIds(ids, size);
  if (chunks.length === 0) return [];
  const pages = await mapPool(chunks, concurrency, async (chunk) => {
    const result = await makeQuery(chunk);
    if (result?.error) throw asError(result.error);
    return Array.isArray(result?.data) ? result.data : [];
  });
  return pages.flat();
}
