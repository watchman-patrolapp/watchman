import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

/** RPC wrappers for P0a org_capability_grants. Each returns { data, error }. */

export async function grantCapability({ userId, capability, title = null, note = null, expiresAt = null }) {
  const { data, error } = await supabase.rpc("grant_org_capability", {
    p_user_id: userId,
    p_capability: capability,
    p_title: title?.trim() || null,
    p_note: note?.trim() || null,
    p_expires_at: expiresAt || null,
  });
  return { data, error };
}

export async function revokeCapability(grantId, reason = null) {
  const { data, error } = await supabase.rpc("revoke_org_capability", {
    p_grant_id: grantId,
    p_reason: reason?.trim() || null,
  });
  return { data, error };
}

export async function listCapabilityGrants(includeRevoked = false) {
  const { data, error } = await supabase.rpc("list_org_capability_grants", {
    p_include_revoked: Boolean(includeRevoked),
  });
  return { data: data || [], error };
}

/** Map of userId -> [{ capability, title }]. Missing RPC reads as no badges. */
export async function listCapabilityBadges(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return { data: new Map(), error: null };
  const { data, error } = await supabase.rpc("list_capability_badges", { p_user_ids: ids });
  const map = new Map();
  if (error) return { data: map, error: isRpcNotFoundError(error) ? null : error };
  for (const row of data || []) {
    const list = map.get(row.user_id) || [];
    list.push({ capability: row.capability, title: row.title });
    map.set(row.user_id, list);
  }
  return { data: map, error: null };
}

/** Own active grants (RLS: a user reads their own rows). */
export async function listMyCapabilityGrants(userId) {
  if (!userId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("org_capability_grants")
    .select("id, capability, title, expires_at, organization_id")
    .eq("user_id", userId)
    .is("revoked_at", null);
  const now = Date.now();
  return {
    data: (data || []).filter((g) => !g.expires_at || new Date(g.expires_at).getTime() > now),
    error,
  };
}

export function capabilityErrorMessage(error, fallback) {
  if (isRpcNotFoundError(error)) return "Run the capability SQL (P0a) in Supabase first.";
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (/no neighbourhood selected/i.test(msg)) return "Choose a neighbourhood first (Choose area).";
  if (/only verified households/i.test(msg)) return "Only verified households can hold this responsibility.";
  if (/not in this neighbourhood/i.test(msg)) return "That person is not in this neighbourhood.";
  if (/not allowed for this role/i.test(msg)) return "That role can't hold this responsibility.";
  if (/must be a watch member/i.test(msg)) return "Equipment custodian must be a watch member.";
  if (/forbidden/i.test(msg)) return "You can't manage resident roles here.";
  return msg || fallback;
}