import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

export async function pingResidentPresence() {
  const { data, error } = await supabase.rpc("ping_resident_presence");
  if (error && !isRpcNotFoundError(error)) {
    console.warn("ping_resident_presence:", error.message);
  }
  return data || null;
}

export async function getMyHouseholdCivic() {
  const { data, error } = await supabase.rpc("get_my_household_civic");
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("get_my_household_civic:", error.message);
    }
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row === "string") {
    try {
      return JSON.parse(row);
    } catch {
      return null;
    }
  }
  return row || null;
}
