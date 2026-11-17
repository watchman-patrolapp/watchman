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

export async function reportCommunityContent({
  contentType,
  contentId,
  reason,
  details = "",
}) {
  const { data, error } = await supabase.rpc("report_community_content", {
    p_content_type: contentType,
    p_content_id: contentId,
    p_reason: reason,
    p_details: details?.trim() || null,
  });
  return { data, error };
}

export function friendlyReportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("already reported")) return "You have already reported this.";
  if (msg.includes("too many reports")) return "You've reached today's report limit. Try again tomorrow.";
  if (msg.includes("not found")) return "This content isn't available to report.";
  if (msg.includes("forbidden")) return "This content isn't available to report.";
  if (msg.includes("cannot be reported")) return "This item can't be reported yet.";
  return "Could not send the report. Please try again.";
}

export async function listHiddenCityHubPosts({ limit = 30 } = {}) {
  const { data, error } = await supabase.rpc("list_hidden_city_hub_posts", {
    p_limit: limit ?? 30,
  });
  return { data: data || [], error };
}

export async function restoreHiddenCityHubPost(postId) {
  const { data, error } = await supabase.rpc("restore_hidden_city_hub_post", {
    p_post_id: postId,
  });
  return { data, error };
}

export const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "scam", label: "Scam" },
  { value: "offensive", label: "Offensive" },
  { value: "false_info", label: "False information" },
  { value: "privacy", label: "Privacy concern" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
];

export const REPORTABLE_CONTENT_TYPES = [
  "area_broadcast",
  "service_listing",
  "service_review",
  "city_hub_post",
  "chat_message",
  "user_profile",
  "incident_report",
  "criminal_profile",
];

export function moderationErrorMessage(error, fallback) {
  if (isRpcNotFoundError(error)) return "This isn't available yet. Please try again later.";
  const msg = String(error?.message || "");
  if (/forbidden/i.test(msg)) return "You can't do that for this item.";
  if (/not found/i.test(msg)) return "This item is no longer available.";
  if (/please give a reason/i.test(msg)) return "Please give a reason.";
  return fallback;
}
