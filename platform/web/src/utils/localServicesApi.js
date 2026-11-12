import { supabase } from "../supabase/client";
import { COMMUNITY_MEDIA_BUCKET, uploadCommunityImage } from "./communityMedia";

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.warn(`[local-services] ${name} failed`, error.code || "");
    throw error;
  }
  return data;
}

export { COMMUNITY_MEDIA_BUCKET };

export const listServiceCategories = async () => (await rpc("list_service_categories")) ?? [];

export const searchLocalServices = async ({ query = "", category = null, includeNeighbours = false, limit = 30, offset = 0 }) =>
  (await rpc("search_local_services", {
    p_query: query,
    p_category: category,
    p_limit: limit,
    p_offset: offset,
    p_include_neighbours: Boolean(includeNeighbours),
  })) ?? [];

export const getServiceListing = (id) => rpc("get_service_listing", { p_id: id });
export const listMyServiceListings = async () => (await rpc("list_my_service_listings")) ?? [];
export const upsertServiceListing = (id, payload) => rpc("upsert_service_listing", { p_id: id ?? null, p_payload: payload });
export const setServiceListingStatus = (id, status, reason = null) =>
  rpc("set_service_listing_status", { p_id: id, p_status: status, p_reason: reason });
export const confirmServiceListingCurrent = (id) => rpc("confirm_service_listing_current", { p_id: id });

export const listListingReviews = async (listingId) =>
  (await rpc("list_listing_reviews", { p_listing_id: listingId })) ?? [];
export const upsertServiceReview = (args) => rpc("upsert_service_review", args);
export const replyToServiceReview = (reviewId, reply) =>
  rpc("reply_to_service_review", { p_review_id: reviewId, p_reply: reply });
export const hideServiceReview = (reviewId, reason) =>
  rpc("hide_service_review", { p_review_id: reviewId, p_reason: reason });
export const deleteMyServiceReview = (reviewId) => rpc("delete_my_service_review", { p_review_id: reviewId });
export const featureServiceListing = (id, on) => rpc("feature_service_listing", { p_id: id, p_on: Boolean(on) });

/** Moderator view of this org's listings by status (RLS limits rows to moderators' org). */
export async function listListingsForModeration(orgId, status) {
  const { data, error } = await supabase
    .from("local_service_listings")
    .select("id,title,business_name,status,is_featured,moderation_reason,updated_at")
    .eq("organization_id", orgId)
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    console.warn("[local-services] moderation list failed", error.code || "");
    throw error;
  }
  return data ?? [];
}

export const listMyOrgNeighbours = async () => (await rpc("list_my_org_neighbours")) ?? [];
export const listOrgNeighbourCandidates = async () => (await rpc("list_org_neighbour_candidates")) ?? [];
export const setOrgNeighbour = (orgId, enabled) =>
  rpc("set_org_neighbour", { p_neighbour_org_id: orgId, p_enabled: Boolean(enabled) });

/** Upload files to {orgId}/services/{listingId}/… and return the stored paths. */
export async function uploadServicePhotos({ orgId, listingId, files }) {
  const paths = [];
  for (let i = 0; i < files.length; i += 1) {
    const { path } = await uploadCommunityImage({
      orgId,
      feature: "services",
      entityId: listingId,
      file: files[i],
      index: i,
    });
    paths.push(path);
  }
  return paths;
}
