import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

/** Moderation queue RPCs (P1). Each returns { data, error }. */

export async function listCommunityReports(status = "open") {
  const { data, error } = await supabase.rpc("list_community_reports", { p_status: status });
  return { data: data || [], error };
}

export async function resolveCommunityReport(reportId, { status, note = null, hideContent = false }) {
  const { data, error } = await supabase.rpc("resolve_community_report", {
    p_report_id: reportId,
    p_status: status,
    p_note: note?.trim() || null,
    p_hide_content: Boolean(hideContent),
  });
  return { data, error };
}

export function moderationErrorMessage(error, fallback) {
  if (isRpcNotFoundError(error)) return "Run the P1 moderators SQL in Supabase first.";
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (/forbidden/i.test(msg)) return "You can't do that for this item.";
  if (/not found/i.test(msg)) return "This item is no longer available.";
  return msg || fallback;
}