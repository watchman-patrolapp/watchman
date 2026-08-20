import { supabase } from "../supabase/client";
import { formatWatchDate } from "./watchTime";

export const CITY_HUB_SHARE_POST_TYPES = [
  { value: "suspect_alert", label: "Suspect Alert" },
  { value: "pattern", label: "Pattern" },
  { value: "resource_request", label: "Resource Request" },
  { value: "general", label: "General" },
];

const PATTERN_TYPE_RE = /theft|break|burglar|robbery|vandal|vehicle|suspicious|assault|hijack/i;
const MAX_DESCRIPTION_CHARS = 480;

function formatShareDate(value) {
  const raw = value || null;
  if (!raw) return "Date unknown";
  return formatWatchDate(raw) || "Date unknown";
}

function sanitizeDescription(text) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= MAX_DESCRIPTION_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_DESCRIPTION_CHARS).trim()}…`;
}

export function incidentHasSuspectSignal({ incident, linkedProfiles = [], incidentSuspects = [] } = {}) {
  if (linkedProfiles.length > 0) return true;
  if (incidentSuspects.length > 0) return true;
  if (String(incident?.suspect_name || "").trim()) return true;
  if (String(incident?.suspect_description || "").trim()) return true;
  return false;
}

export function defaultCityHubShareType(args) {
  if (incidentHasSuspectSignal(args)) return "suspect_alert";
  if (PATTERN_TYPE_RE.test(String(args?.incident?.type || ""))) return "pattern";
  return "general";
}

export function buildCityHubShareDraft({
  incident,
  organizationName,
  linkedProfiles = [],
  incidentSuspects = [],
} = {}) {
  const neighborhood = String(organizationName || "").trim() || "this neighborhood";
  const typeLabel = String(incident?.type || "Incident").trim() || "Incident";
  const dateLabel = formatShareDate(incident?.incident_date || incident?.submitted_at);
  const hasSuspect = incidentHasSuspectSignal({ incident, linkedProfiles, incidentSuspects });

  const lines = [
    `Neighborhood: ${neighborhood}`,
    `Date: ${dateLabel}`,
    `Type: ${typeLabel}`,
    "",
  ];

  const summary = sanitizeDescription(incident?.description);
  if (summary) {
    lines.push(summary, "");
  }

  const suspectDescription = sanitizeDescription(incident?.suspect_description);
  if (suspectDescription) {
    lines.push("Suspect description:", suspectDescription, "");
  }

  const vehicle = String(incident?.vehicle_info || "").trim();
  if (vehicle) {
    lines.push(`Vehicle: ${vehicle}`, "");
  }

  lines.push(
    "This is a neighborhood-to-city briefing. Reporter identity, witnesses, street address, photos, and case numbers are omitted."
  );

  return {
    type: defaultCityHubShareType({ incident, linkedProfiles, incidentSuspects }),
    title: `${typeLabel} in ${neighborhood}`,
    content: lines.join("\n").trim(),
    hasSuspect,
    profileOptions: (linkedProfiles || [])
      .map((link) => {
        const profile = link?.profile || link;
        const id = profile?.id || link?.profile_id;
        if (!id) return null;
        return {
          id,
          label: profile?.primary_name || "Unnamed profile",
        };
      })
      .filter(Boolean),
  };
}

export async function fetchCityHubShareForIncident(incidentId) {
  if (!incidentId) return null;
  const { data, error } = await supabase
    .from("city_hub_posts")
    .select("id, title, created_at, status")
    .eq("related_incident_id", incidentId)
    .eq("status", "published")
    .maybeSingle();
  if (error) {
    if (String(error.message || "").toLowerCase().includes("related_incident_id")) {
      return null;
    }
    throw error;
  }
  return data || null;
}

export async function publishIncidentToCityHub({
  incidentId,
  organizationId,
  userId,
  type,
  title,
  content,
  relatedProfileId = null,
}) {
  if (!incidentId) throw new Error("Missing incident.");
  if (!userId) throw new Error("You must be signed in.");

  const { data: incidentRow, error: incidentReadError } = await supabase
    .from("incidents")
    .select("id, status, organization_id")
    .eq("id", incidentId)
    .single();
  if (incidentReadError) throw incidentReadError;
  if (incidentRow?.status !== "approved") {
    throw new Error("Only approved incidents can be shared to City Hub.");
  }

  const existing = await fetchCityHubShareForIncident(incidentId);
  if (existing) {
    const err = new Error("This incident was already shared to City Hub.");
    err.alreadyShared = true;
    err.existing = existing;
    throw err;
  }

  const authorOrganizationId = incidentRow.organization_id || organizationId;
  if (!authorOrganizationId) {
    throw new Error("Select a working area before sharing to City Hub.");
  }

  const { data: rpcPost, error: rpcError } = await supabase.rpc("publish_incident_to_city_hub", {
    p_incident_id: incidentId,
    p_type: type,
    p_title: title,
    p_content: content,
    p_related_profile_id: relatedProfileId || null,
  });

  if (!rpcError && rpcPost) {
    return Array.isArray(rpcPost) ? rpcPost[0] : rpcPost;
  }

  const rpcMissing =
    rpcError &&
    (String(rpcError.code) === "42883" ||
      String(rpcError.message || "").toLowerCase().includes("could not find the function"));
  if (rpcError && !rpcMissing) {
    if (String(rpcError.message || "").includes("CITY_HUB_ALREADY_SHARED") || String(rpcError.code) === "23505") {
      const err = new Error("This incident was already shared to City Hub.");
      err.alreadyShared = true;
      throw err;
    }
    throw rpcError;
  }

  const { data: post, error } = await supabase
    .from("city_hub_posts")
    .insert({
      author_organization_id: authorOrganizationId,
      type,
      title,
      content,
      visibility: "city_wide",
      status: "published",
      created_by_user_id: userId,
      related_incident_id: incidentId,
      related_suspect_profile_id: relatedProfileId || null,
    })
    .select("id, title, created_at, status")
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      const err = new Error("This incident was already shared to City Hub.");
      err.alreadyShared = true;
      throw err;
    }
    throw error;
  }

  const { error: incidentError } = await supabase
    .from("incidents")
    .update({
      city_hub_post_id: post.id,
      city_hub_shared_at: new Date().toISOString(),
    })
    .eq("id", incidentId);

  if (incidentError && !String(incidentError.message || "").toLowerCase().includes("city_hub_")) {
    console.warn("Could not stamp incident city hub share:", incidentError.message);
  }

  return post;
}
