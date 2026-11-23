import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { friendlyError } from "./friendlyError";

export const CONTACTS_NOT_READY =
  "Community contacts need the latest database update. Once it has been run, refresh this page.";

/** Admin contact per watch and security company. Platform and global staff only. */
export async function listCommunityAdminContacts() {
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
