import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { COMMUNITY_MEDIA_BUCKET } from "./communityMedia";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { PATROL_MEMBER_ROLES } from "../auth/roleMatrix";
import { equipmentErrorMessage as baseErrorMessage } from "./equipmentMeta";

export * from "./equipmentMeta";

/**
 * P3a equipment catalogue RPC wrappers. Each returns { data, error }.
 * Members never select restricted unit columns (price, serial, QR token, supplier,
 * invoice, funding); everything goes through list_/get_ RPCs.
 */

/** Server: can_manage_equipment = NW admin (+ global/platform staff). The custodian capability is not used yet. */
export const EQUIPMENT_MANAGER_ROLES = ["admin", "technical_support", "nw_admin"];

export function canManageEquipment(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return EQUIPMENT_MANAGER_ROLES.includes(normalizeAppRole(role));
}

export function canBrowseEquipment(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return PATROL_MEMBER_ROLES.includes(normalizeAppRole(role));
}

export function equipmentPhotoUrl(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export function equipmentErrorMessage(error, fallback) {
  return baseErrorMessage(error, isRpcNotFoundError(error), fallback);
}

export async function listEquipmentCatalogue({ includeArchived = false } = {}) {
  const { data, error } = await supabase.rpc("list_equipment_catalogue", { p_include_archived: includeArchived });
  return { data: data || [], error };
}

export async function getEquipmentItem(itemId) {
  const { data, error } = await supabase.rpc("get_equipment_item", { p_item_id: itemId });
  return { data: data || null, error };
}

export async function getEquipmentUnit(unitId) {
  const { data, error } = await supabase.rpc("get_equipment_unit", { p_unit_id: unitId });
  return { data: data || null, error };
}

export async function resolveEquipmentQr(token) {
  const { data, error } = await supabase.rpc("resolve_equipment_qr", { p_token: token });
  return { data: data || null, error };
}

export async function listEquipmentUnitLedger(unitId, limit = 50) {
  const { data, error } = await supabase.rpc("list_equipment_unit_ledger", { p_unit_id: unitId, p_limit: limit });
  return { data: data || [], error };
}

// ---------------------------------------------------------------------------
// Admin (can_manage_equipment). Server re-checks everything; cross-org = "not found".
// ---------------------------------------------------------------------------

export async function listEquipmentCategories(orgId) {
  let q = supabase.from("equipment_categories").select("id, name, sort_order").order("sort_order").order("name");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function ensureEquipmentDefaults() {
  const { data, error } = await supabase.rpc("ensure_equipment_defaults");
  return { data, error };
}

export async function upsertEquipmentItem({ id = null, name, categoryId = null, description = null, photoPath = null, requiresCertification = false, isArchived = false }) {
  const { data, error } = await supabase.rpc("upsert_equipment_item", {
    p_id: id,
    p_name: name,
    p_category_id: categoryId || null,
    p_description: description || null,
    p_photo_path: photoPath || null,
    p_requires_certification: Boolean(requiresCertification),
    p_is_archived: Boolean(isArchived),
  });
  return { data, error };
}

export async function setEquipmentItemDetails(itemId, { kitContents = null, maxLoanHours = null } = {}) {
  const { error } = await supabase.rpc("set_equipment_item_details", {
    p_item_id: itemId,
    p_kit_contents: kitContents || null,
    p_max_loan_hours: maxLoanHours == null || maxLoanHours === "" ? null : Number(maxLoanHours),
  });
  return { error };
}

export async function setEquipmentItemPhotos(itemId, paths) {
  const { data, error } = await supabase.rpc("set_equipment_item_photos", { p_item_id: itemId, p_paths: paths || [] });
  return { data: data || [], error };
}

export async function addEquipmentUnit(u) {
  const { data, error } = await supabase.rpc("add_equipment_unit", {
    p_item_id: u.itemId,
    p_asset_tag: String(u.assetTag || "").trim().toUpperCase(),
    p_condition: u.condition || "good",
    p_location_note: u.locationNote || null,
    p_serial_number: u.serialNumber || null,
    p_purchase_price_cents: u.purchasePriceCents ?? null,
    p_purchase_date: u.purchaseDate || null,
    p_supplier: u.supplier || null,
    p_invoice_path: u.invoicePath || null,
    p_funding_source: u.fundingSource || null,
    p_photo_path: u.photoPath || null,
  });
  return { data, error };
}

export async function updateEquipmentUnitDetails(u) {
  const { error } = await supabase.rpc("update_equipment_unit_details", {
    p_unit_id: u.id,
    p_condition: u.condition || "good",
    p_location_note: u.locationNote || null,
    p_serial_number: u.serialNumber || null,
    p_purchase_price_cents: u.purchasePriceCents ?? null,
    p_purchase_date: u.purchaseDate || null,
    p_supplier: u.supplier || null,
    p_invoice_path: u.invoicePath || null,
    p_funding_source: u.fundingSource || null,
    p_photo_path: u.photoPath || null,
  });
  return { error };
}

export async function setEquipmentUnitNotes(unitId, notes) {
  const { error } = await supabase.rpc("set_equipment_unit_notes", { p_unit_id: unitId, p_notes: notes || null });
  return { error };
}

export async function rotateEquipmentQr(unitId) {
  const { data, error } = await supabase.rpc("rotate_equipment_qr", { p_unit_id: unitId });
  return { data, error };
}

export async function listEquipmentUnitsAdmin(itemId = null) {
  const { data, error } = await supabase.rpc("list_equipment_units_admin", { p_item_id: itemId });
  return { data: data || [], error };
}

export async function suggestEquipmentAssetTag(itemId) {
  const { data, error } = await supabase.rpc("suggest_equipment_asset_tag", { p_item_id: itemId });
  return { data: data || "", error };
}

export async function createEquipmentFromWishlist(wishlistItemId, categoryId = null) {
  const { data, error } = await supabase.rpc("create_equipment_from_wishlist", {
    p_wishlist_item_id: wishlistItemId,
    p_category_id: categoryId,
  });
  return { data, error };
}

/** Map wishlist_item_id -> equipment item id. Empty map if the RPC is missing (older DB). */
export async function listEquipmentWishlistLinks() {
  const { data, error } = await supabase.rpc("list_equipment_wishlist_links");
  if (error) return { data: new Map(), error: isRpcNotFoundError(error) ? null : error };
  return { data: new Map((data || []).map((r) => [r.wishlist_item_id, r.item_id])), error: null };
}
