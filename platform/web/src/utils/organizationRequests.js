import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { friendlyError } from "./friendlyError";

export const REQUESTS_NOT_READY =
  "Organisation requests need the latest database update. Once it has been run, refresh this page.";

function wrap(error, fallback) {
  const err = new Error(isRpcNotFoundError(error) ? REQUESTS_NOT_READY : friendlyError(error, fallback));
  err.notReady = isRpcNotFoundError(error);
  return err;
}

export async function listOrganizationRequests() {
  const { data, error } = await supabase.rpc("list_organization_requests");
  if (error) throw wrap(error, "Could not load organisation requests.");
  return Array.isArray(data) ? data : [];
}

export async function approveOrganizationRequest(orgId, userId = null, note = null) {
  const { data, error } = await supabase.rpc("approve_organization", {
    p_org_id: orgId,
    p_user_id: userId,
    p_note: note,
  });
  if (error) throw wrap(error, "Could not approve this request.");
  return data;
}

export async function rejectOrganizationRequest(orgId, userId = null, note = null) {
  const { data, error } = await supabase.rpc("reject_organization", {
    p_org_id: orgId,
    p_user_id: userId,
    p_note: note,
  });
  if (error) throw wrap(error, "Could not reject this request.");
  return data;
}

/** Reviewers: fold a pending watch / suburb request into an approved watch in the same city (SA places P5). */
export async function mergeSuburbRequest(orgId, intoOrgId, note = null) {
  const { data, error } = await supabase.rpc("merge_suburb_request", {
    p_org_id: orgId,
    p_into_org_id: intoOrgId,
    p_note: note,
  });
  if (error) throw wrap(error, "Could not merge this request.");
  return data;
}

/** Approved watches in a city, for the "Merge into…" picker. */
export async function listMergeTargets(cityId) {
  if (!cityId) return [];
  const { data, error } = await supabase.rpc("list_city_watches", { p_city_id: cityId });
  if (error) throw wrap(error, "Could not load the watches in this city.");
  return Array.isArray(data) ? data : [];
}

/** People waiting to join a watch the caller runs (or any watch, for reviewers). */
export async function listWatchJoinRequests() {
  const { data, error } = await supabase.rpc("list_watch_join_requests");
  if (error) throw wrap(error, "Could not load join requests.");
  return Array.isArray(data) ? data : [];
}

export async function reviewWatchJoin(orgId, userId, approve, note = null) {
  const { data, error } = await supabase.rpc("review_watch_join", {
    p_org_id: orgId,
    p_user_id: userId,
    p_approve: Boolean(approve),
    p_note: note,
  });
  if (error) throw wrap(error, approve ? "Could not approve this request." : "Could not decline this request.");
  return data;
}

/** The signed-in person's own pending or declined admin requests. Quietly empty if not available. */
export async function myOrganizationRequests() {
  try {
    const { data, error } = await supabase.rpc("my_organization_requests");
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
