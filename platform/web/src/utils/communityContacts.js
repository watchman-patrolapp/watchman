import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { friendlyError } from "./friendlyError";

export const CONTACTS_NOT_READY =
  "Community contacts need the latest database update. Once it has been run, refresh this page.";

/**
 * Admin contact per watch and security company, with city, province and suburb (SA places P6).
 * Platform and global staff only. Older databases without list_community_contacts() fall back to
 * list_community_admin_contacts() (no city or suburb).
 */
export async function listCommunityAdminContacts() {
  const first = await supabase.rpc("list_community_contacts");
  if (!first.error) return Array.isArray(first.data) ? first.data : [];
  if (!isRpcNotFoundError(first.error)) {
    throw new Error(friendlyError(first.error, "Could not load community contacts."));
  }
  const { data, error } = await supabase.rpc("list_community_admin_contacts");
  if (error) {
    const err = new Error(
      isRpcNotFoundError(error) ? CONTACTS_NOT_READY : friendlyError(error, "Could not load community contacts."),
    );
    err.notReady = isRpcNotFoundError(error);
    throw err;
  }
  return Array.isArray(data) ? data : [];
}
