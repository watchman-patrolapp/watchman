/** Pure helpers for city scope (no Supabase import, so they can be unit-tested). */

/** { id, name } for a cities row; { id: null, name: "" } when unknown. Never invents a city. */
export function cityResult(row) {
  const id = row?.id ? String(row.id) : null;
  const name = row?.name ? String(row.name).trim() : "";
  return id && name ? { id, name } : { id: null, name: "" };
}

/** "the city" in copy when the name is not known yet. */
export function cityLabel(city, fallback = "your city") {
  const name = city?.name ? String(city.name).trim() : "";
  return name || fallback;
}
