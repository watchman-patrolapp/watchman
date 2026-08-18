import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

/**
 * Upserts a household row for the signed-in user. Watch members are marked
 * verified as neighbourhood members; email/phone/name stay on users.
 */
export async function ensureMyHouseholdProfile() {
  const { data, error } = await supabase.rpc("ensure_my_household_profile");
  if (error && !isRpcNotFoundError(error)) {
    console.warn("ensure_my_household_profile:", error.message);
    return { data: null, error };
  }
  return { data: data || null, error: null };
}
