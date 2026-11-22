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

/** Case-insensitive match on organisation, admin name, email or phone. */
export function filterContacts(rows, query) {
  const q = text(query).toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!q) return list;
  return list.filter((row) =>
    [row.organization_name, row.admin_name, row.admin_email, row.admin_phone]
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
