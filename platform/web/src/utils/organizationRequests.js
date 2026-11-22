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
