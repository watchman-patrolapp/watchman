import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

export const ROLE_SQL_MISSING_MESSAGE =
  "Run the 20261031040000_admin_set_user_role.sql migration in Supabase first.";

/**
 * Change another user's role. Uses admin_set_user_role, which raises instead of
 * silently updating 0 rows. Falls back to a direct update with a row check
 * when the RPC is not deployed yet.
 * Returns { ok, changed, role, error, sqlMissing }.
 */
export async function setUserRole(userId, role) {
  const { data, error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (!error) {
    return { ok: true, changed: data?.changed !== false, role: data?.role || role, error: null, sqlMissing: false };
  }
  if (!isRpcNotFoundError(error)) {
    return { ok: false, changed: false, role: null, error, sqlMissing: false };
  }

  const { data: rows, error: updErr } = await supabase
    .from("users")
    .update({ role })
    .eq("id", userId)
    .select("id, role");
  if (updErr) return { ok: false, changed: false, role: null, error: updErr, sqlMissing: true };
  if (!rows || rows.length === 0) {
    return {
      ok: false,
      changed: false,
      role: null,
      error: new Error(`Not saved: you are not allowed to change this user. ${ROLE_SQL_MISSING_MESSAGE}`),
      sqlMissing: true,
    };
  }
  return { ok: true, changed: true, role: rows[0].role || role, error: null, sqlMissing: true };
}
