import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

export const SECURITY_BRANDING_BUCKET = "security-branding";
export const MAX_BRANDING_IMAGE_BYTES = 8 * 1024 * 1024;
/** Facebook cover photo size. */
export const COVER_WIDTH = 820;
export const COVER_HEIGHT = 312;

export async function getMySecurityBranding() {
  const { data, error } = await supabase.rpc("get_my_security_branding");
  if (error) throw error;
  return data?.[0] || null;
}

export async function saveMySecurityBranding({
  logoUrl,
  bannerUrl,
  contactPhone,
  contactEmail,
  contactPersonName,
}) {
  const { error } = await supabase.rpc("upsert_security_company_branding", {
    p_logo_url: logoUrl || null,
    p_banner_url: bannerUrl || null,
    p_contact_phone: contactPhone || null,
    p_contact_email: contactEmail || null,
    p_contact_person_name: contactPersonName || null,
  });
  if (error) throw error;
}

/** Local neighbourhood rows first. Rows with no organization_id stay city-wide. */
export function sortEmergencyDirectoryRows(rows) {
  return [...(rows || [])].sort((left, right) => {
    const leftRank = left?.organization_id ? 0 : 1;
    const rightRank = right?.organization_id ? 0 : 1;
    return leftRank - rightRank;
  });
}

export async function listEmergencyDirectory() {
  const { data, error } = await supabase.rpc("list_emergency_directory");
  if (error) throw error;
  return sortEmergencyDirectoryRows(data || []);
}

export async function saveEmergencyDirectoryEntry(entry) {
  const payload = {
    p_id: entry.id || null,
    p_kind: entry.kind || "other",
    p_name: entry.name || "",
    p_phone: entry.phone || null,
    p_alt_phone: entry.alt_phone || null,
    p_email: entry.email || null,
    p_contact_person_name: entry.contact_person_name || null,
    p_notes: entry.notes || null,
    p_sort_order: Number.isFinite(Number(entry.sort_order)) ? Number(entry.sort_order) : 100,
    p_active: entry.active !== false,
    p_logo_url: entry.logo_url || null,
    p_banner_url: entry.banner_url || null,
    p_scope: entry.scope === "global" ? "global" : "org",
  };
  const first = await supabase.rpc("upsert_emergency_directory_entry", payload);
  if (!first.error) return first.data;

  // Before the org-scope migration, PostgREST only has the 12-arg upsert.
  // Retry edits and city-wide creates on that signature. A new neighbourhood
  // contact must not fall back: the old RPC would publish it city-wide.
  const neighbourhoodCreate = !entry.id && payload.p_scope !== "global";
  if (!isRpcNotFoundError(first.error) || neighbourhoodCreate) throw first.error;

  const { p_scope: _scope, ...legacy } = payload;
  const second = await supabase.rpc("upsert_emergency_directory_entry", legacy);
  if (second.error) throw second.error;
  return second.data;
}

export async function setEmergencyDirectoryActive(id, active) {
  const { error } = await supabase.rpc("set_emergency_directory_active", {
    p_id: id,
    p_active: Boolean(active),
  });
  if (error) throw error;
}

export async function listDirectorySecurityCompanies() {
  const { data, error } = await supabase.rpc("list_directory_security_companies");
  if (error) throw error;
  return data || [];
}

export const EMERGENCY_DIRECTORY_BUCKET = "emergency-directory";

export async function uploadEmergencyDirectoryImage(userId, kind, file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_BRANDING_IMAGE_BYTES) {
    throw new Error("That image is larger than 8MB.");
  }
  const owner = String(userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "anon";
  const ext = String(file.name?.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "jpg";
  const filePath = `${owner}/${kind}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(EMERGENCY_DIRECTORY_BUCKET).upload(filePath, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) {
    throw new Error(error.message || "Could not upload. Run the emergency directory media SQL if the bucket is missing.");
  }
  const { data } = supabase.storage.from(EMERGENCY_DIRECTORY_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || "";
}

export async function uploadSecurityBrandingImage(companyId, kind, file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_BRANDING_IMAGE_BYTES) {
    throw new Error("That image is larger than 8MB.");
  }
  const ext = String(file.name?.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "jpg";
  const filePath = `${companyId}/${kind}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(SECURITY_BRANDING_BUCKET).upload(filePath, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) {
    throw new Error(error.message || "Could not upload. Run the branding SQL if the bucket is missing.");
  }
  const { data } = supabase.storage.from(SECURITY_BRANDING_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || "";
}
