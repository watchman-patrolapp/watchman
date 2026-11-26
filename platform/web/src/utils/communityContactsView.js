/** Pure helpers for the community admin contacts list (platform and global staff). */

const TYPE_ORDER = ["nw_group", "security_company"];

export const CONTACT_TYPE_LABELS = {
  nw_group: "Neighbourhood watches",
  security_company: "Security companies",
};

function text(value) {
  return value == null ? "" : String(value).trim();
}

/** Groups rows by organisation type, A–Z by name inside each group. Unknown types are dropped. */
export function groupContacts(rows) {
  const groups = TYPE_ORDER.map((type) => ({ type, label: CONTACT_TYPE_LABELS[type], rows: [] }));
  for (const row of Array.isArray(rows) ? rows : []) {
    const group = groups.find((g) => g.type === row?.organization_type);
    if (group) group.rows.push(row);
  }
  for (const group of groups) {
    group.rows.sort((a, b) =>
      text(a.organization_name).localeCompare(text(b.organization_name), undefined, { sensitivity: "base" }),
    );
  }
  return groups;
}

/** Case-insensitive match on organisation, admin name, email, phone, city, suburb or province. */
export function filterContacts(rows, query) {
  const q = text(query).toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!q) return list;
  return list.filter((row) =>
    [row.organization_name, row.admin_name, row.admin_email, row.admin_phone, row.city, row.suburb, row.province]
      .map((v) => text(v).toLowerCase())
      .some((v) => v.includes(q)),
  );
}

/** "Nw admin" style role label for the listed contact. */
export function contactRoleLabel(role) {
  const r = text(role).replace(/_/g, " ");
  if (!r) return "";
  if (r.toLowerCase() === "nw admin") return "NW admin";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** "Sea Point · Cape Town, Western Cape" style place line; "" when nothing is known. */
export function contactPlaceLine(row) {
  const suburb = text(row?.suburb);
  const city = text(row?.city);
  const province = text(row?.province);
  const cityPart = city && province && !city.toLowerCase().includes(province.toLowerCase()) ? `${city}, ${province}` : city;
  return [suburb, cityPart].filter(Boolean).join(" · ");
}

/** Cities in the list, A–Z, for the city filter. */
export function contactCities(rows) {
  const names = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const city = text(row?.city);
    if (city) names.add(city);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Rows in one city ("" = all cities). */
export function filterContactsByCity(rows, city) {
  const list = Array.isArray(rows) ? rows : [];
  const c = text(city).toLowerCase();
  if (!c) return list;
  return list.filter((row) => text(row?.city).toLowerCase() === c);
}
