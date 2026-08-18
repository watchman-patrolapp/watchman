import { isRpcNotFoundError } from "./isRpcNotFound";

const CITY_HUB_AUTHOR_ROLE_LABELS = {
  admin: "Main admin",
  technical_support: "Technical support",
  nw_admin: "Neighborhood admin",
  city_admin: "City admin",
  security_admin: "Security admin",
  committee: "Committee",
  investigator: "Investigator",
  patroller: "Patroller",
  volunteer: "Volunteer",
};

export function cityHubAuthorDisplayName(profile) {
  const name = String(profile?.full_name || "").trim();
  if (name) return name;
  const email = String(profile?.email || "").trim();
  if (email) return email;
  return "Unknown author";
}

export function cityHubAuthorRoleLabel(role) {
  const key = String(role || "").trim().toLowerCase();
  if (!key) return "Staff";
  return CITY_HUB_AUTHOR_ROLE_LABELS[key] || key.replaceAll("_", " ");
}

export function cityHubAuthorInitials(profile) {
  const name = String(profile?.full_name || "").trim();
  if (name) {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  const email = String(profile?.email || "").trim();
  return email ? email.charAt(0).toUpperCase() : "?";
}

export function cityHubTelHref(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, "");
  return compact ? `tel:${compact}` : null;
}

function rowsToAuthorMap(rows) {
  const out = new Map();
  for (const row of rows || []) {
    if (!row?.id) continue;
    out.set(String(row.id), row);
  }
  return out;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase */
export async function fetchCityHubAuthorProfiles(supabase, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  if (ids.length === 0) return new Map();

  let byId = new Map();

  const { data: rpcData, error: rpcError } = await supabase.rpc("city_hub_author_profiles", {
    p_user_ids: ids,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    byId = rowsToAuthorMap(rpcData);
  } else if (rpcError && !isRpcNotFoundError(rpcError)) {
    console.warn("city_hub_author_profiles:", rpcError.message);
  }

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length === 0) return byId;

  // Names/emails for nw_admin and patrollers who cannot SELECT other users rows.
  const { data: labels, error: labelError } = await supabase.rpc("user_labels_for_audit", {
    p_user_ids: missing,
  });
  if (!labelError && Array.isArray(labels)) {
    byId = new Map([...byId, ...rowsToAuthorMap(labels)]);
  } else if (labelError && !isRpcNotFoundError(labelError)) {
    console.warn("user_labels_for_audit:", labelError.message);
  }

  const stillMissing = ids.filter((id) => !byId.has(id));
  if (stillMissing.length === 0) return byId;

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, phone, role, avatar_url, organization_id")
    .in("id", stillMissing);
  if (error || !data) return byId;
  return new Map([...byId, ...rowsToAuthorMap(data)]);
}
